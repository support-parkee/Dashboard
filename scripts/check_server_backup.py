#!/usr/bin/env python3
"""
check_server_backup.py
======================
Automated Diagnostic & Sync Engine for PARKEE Server Backups
Performs:
1. Fetch latest raw rows live from Google Sheet 'List Status Server Backup' via Composio (with local fallback).
2. Concurrently audit each server backup:
   - Primary server SSH jump (tsh ssh support@server-<code_clean>)
   - Run repmgr cluster show to check standby replication status accurately per row
   - Probe backup server via P2P IP and Local IP
   - Check pawdog service status (Auto Promote)
   - Query PostgreSQL replag: select (extract(epoch from now()) - extract(epoch from pg_last_xact_replay_timestamp()))::int as lag;
3. Update Google Sheet via Composio (account: googlesheets_mobile-median).
4. Save clean telemetry JSON atomically to data/server_backup.json for the dashboard.
"""

import os
import sys
import json
import re
import time
import tempfile
import subprocess
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

IS_ON_JUMP = (socket.gethostname() == "admin-adg" or os.environ.get("USER") == "admin-adg")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_JSON = os.path.join(DATA_DIR, "server_backup.json")
LOCATIONS_JSON = os.path.join(DATA_DIR, "locations.json")


def load_dotenv():
    env_path = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_dotenv()

SPREADSHEET_ID = "1PZUIHFkhWRO5PZGeNKGkAhGP7ouqeJhRbxySBkXvEFA"
SHEET_NAME = "List Status Server Backup"
COMPOSIO_ACCOUNT = "googlesheets_mobile-median"
JUMP_HOST = "admin-adg@100.123.138.90"

COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp"
COMPOSIO_API_KEY = os.environ.get("COMPOSIO_API_KEY", "")
SSH_SUPPORT_PASS = os.environ.get("SSH_SUPPORT_PASS", "")

KNOWN_CODES = {
    "bandara adi soemarmo": "0vx",
    "bandara ahmad yani": "0vy",
    "bandara i gusti ngurah rai": "0vt",
    "bandara juanda": "0vz",
    "bandara pattimura": "0vo",
    "bandara sam ratulangi": "0vw",
    "bandara sentani": "0vs",
    "bandara soekarno hatta terminal 2": "0qy",
    "bandara soekarno-hatta terminal 1": "0qx",
    "bandara sultan hassanuddin": "0w0",
    "bandara syamsudin noor": "0vp",
    "bandara yogyakarta": "0w1",
    "bandara zainudin abdul madjid": "0vv",
    "grand indonesia": "0pv",
    "thamrin city": "17l",
    "pelindo benoa": "0uu",
    "nagoya hill batam": "028",
    "bandara sultan syarif kasim ii": "0ro",
    "rs. cipto mangunkusumo (rscm)": "08b",
    "bandara radin inten ii - lampung": "0qr",
    "big mall samarinda": "043",
    "manado town square": "045"
}


def call_composio(tool_slug, arguments):
    if not COMPOSIO_API_KEY:
        print("[Composio Warning]: COMPOSIO_API_KEY not set in .env", flush=True)
        return None

    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": "tools/call",
        "params": {
            "name": "COMPOSIO_MULTI_EXECUTE_TOOL",
            "arguments": {
                "tools": [
                    {
                        "tool_slug": tool_slug,
                        "arguments": arguments,
                        "account": COMPOSIO_ACCOUNT
                    }
                ],
                "sync_response_to_workbench": False,
                "session_id": "backup_checker"
            }
        }
    }
    headers = {
        "x-consumer-api-key": COMPOSIO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
    }
    req = urllib.request.Request(COMPOSIO_MCP_URL, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read().decode("utf-8")
            for line in text.split("\n"):
                if line.startswith("data:"):
                    data = json.loads(line[5:].strip())
                    results = data.get("result", {}).get("content", [])
                    for c in results:
                        if c.get("type") == "text":
                            parsed = json.loads(c.get("text", "{}"))
                            res_list = parsed.get("data", {}).get("results", [])
                            if res_list:
                                resp_obj = res_list[0].get("response", {})
                                if resp_obj.get("successful") is False:
                                    print(f"[Composio Tool Error ({tool_slug})]: {resp_obj.get('data')}", flush=True)
                                    return None
                                return resp_obj.get("data", {})
    except Exception as e:
        print(f"[Composio API Error ({tool_slug})]: {e}", flush=True)
    return None


def fetch_sheet_rows():
    raw_path = os.path.join(DATA_DIR, "server_backup_raw.json")
    print(f"[*] Fetching live sheet rows from '{SHEET_NAME}' via Composio...", flush=True)
    live_data = call_composio("GOOGLESHEETS_BATCH_GET", {
        "spreadsheet_id": SPREADSHEET_ID,
        "ranges": [f"'{SHEET_NAME}'!A3:S60"]
    })
    if live_data and isinstance(live_data.get("valueRanges"), list) and live_data["valueRanges"]:
        values = live_data["valueRanges"][0].get("values", [])
        if len(values) > 1:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(raw_path, "w", encoding="utf-8") as f:
                json.dump(values, f, indent=2, ensure_ascii=False)
            print(f"[+] Fetched {len(values) - 1} live backup rows from Google Sheets and cached to {raw_path}.", flush=True)
            return values

    if os.path.exists(raw_path):
        print(f"[*] Live fetch unavailable; loading cached sheet data from {raw_path}...", flush=True)
        with open(raw_path, "r", encoding="utf-8") as f:
            return json.load(f)
    print("[-] Raw sheet data not found.", flush=True)
    return []


def get_teleport_nodes():
    print("[*] Retrieving Teleport registered nodes from jump host...", flush=True)
    if IS_ON_JUMP:
        cmd = ["tsh", "ls", "--format=json"]
    else:
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", JUMP_HOST, "tsh ls --format=json"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if p.returncode == 0:
            nodes = json.loads(p.stdout)
            active_names = set()
            for n in nodes:
                spec = n.get("spec", {})
                hostname = spec.get("hostname", "")
                if hostname:
                    active_names.add(hostname.lower())
                name = n.get("metadata", {}).get("name", "")
                if name:
                    active_names.add(name.lower())
            print(f"[+] Loaded {len(active_names)} active Teleport hostnames.", flush=True)
            return active_names
    except Exception as e:
        print(f"[-] Failed to fetch Teleport nodes: {e}", flush=True)
    return set()


def resolve_uniq_code(loc_name, raw_code):
    raw_code = raw_code.strip()
    if raw_code and raw_code != "-":
        if len(raw_code) == 2 and raw_code.isdigit():
            return f"0{raw_code}"
        return raw_code.lower()

    m = re.search(r"\(([a-zA-Z0-9]+)-backup|\(server-backup-([a-zA-Z0-9]+)|\(([a-zA-Z0-9]+)\)", loc_name, re.I)
    if m:
        for g in m.groups():
            if g:
                c = g.lower()
                return f"0{c}" if (len(c) == 2 and c.isdigit()) else c

    clean_name = loc_name.lower()
    for k, v in KNOWN_CODES.items():
        if k in clean_name:
            return v

    return ""


def parse_repmgr_standby_streaming(rep_out):
    """
    Strictly inspect standby rows in `repmgr cluster show` output so a running
    primary with a failed/unreachable standby is never misclassified as Streaming.
    """
    if not rep_out or "error" in rep_out.lower():
        return False
    for line in rep_out.splitlines():
        ll = line.lower()
        if "standby" in ll and "|" in ll:
            if ("running" in ll or "streaming" in ll) and "unreachable" not in ll and "failed" not in ll and "stopped" not in ll:
                return True
    return False


def check_single_server(row_info, teleport_nodes):
    row_idx = row_info["row_idx"]
    loc_name = row_info["loc_name"]
    code = row_info["code"].lower()
    ip_local = row_info["ip_local"]
    ip_p2p = row_info["ip_p2p"]
    status_raw = row_info["status"]

    result = dict(row_info)

    backup_hostnames = [f"server-backup-{code}", f"server-{code}-backup"]
    teleport_online = any(h in teleport_nodes for h in backup_hostnames)
    result["teleport"] = "Yes" if teleport_online else "No"

    if any(k in status_raw.lower() for k in ["belum ada aset", "blocking", "asset sampai"]):
        result["status"] = status_raw or "Belum ada aset"
        result["p2p"] = "Not Connected"
        result["replication"] = "Not Streaming"
        result["autopromote"] = "No"
        result["replag"] = "-"
        result["conn_note"] = ""
        result["note_col_s"] = row_info.get("col_s_note", "")
        return result

    if not code:
        result["status"] = status_raw or "Tidak Diketahui"
        result["p2p"] = "Not Connected"
        result["replication"] = "Not Streaming"
        result["autopromote"] = "No"
        result["replag"] = "-"
        result["conn_note"] = ""
        result["note_col_s"] = row_info.get("col_s_note", "")
        return result

    primary_host = f"server-{code}"
    print(f"[*] Auditing Row {row_idx}: {loc_name} ({code}) via {primary_host}...", flush=True)

    # 1. SSH to primary server and run repmgr
    if IS_ON_JUMP:
        cmd_repmgr = ["tsh", "ssh", f"support@{primary_host}", "repmgr -f /etc/repmgr-local.conf cluster show"]
    else:
        cmd_repmgr = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", JUMP_HOST, f"tsh ssh support@{primary_host} 'repmgr -f /etc/repmgr-local.conf cluster show'"]
    try:
        p_rep = subprocess.run(cmd_repmgr, capture_output=True, text=True, timeout=20)
        rep_out = p_rep.stdout
        is_streaming = parse_repmgr_standby_streaming(rep_out)
        result["replication"] = "Streaming" if is_streaming else "Not Streaming"
    except Exception:
        result["replication"] = "Not Streaming"
        result["status"] = "Tidak Aktif"

    probe_ip_p2p = ip_p2p if ip_p2p else "10.1.1.2"
    ssh_pass = SSH_SUPPORT_PASS

    # 2. Run remote probe script on primary server via Python PTY
    probe_script = f"""
import pty, os, select, sys, time, re

def run_cmd(ip, remote_cmd, timeout=6):
    if not ip: return ""
    pid, fd = pty.fork()
    if pid == 0:
        os.execlp('ssh', 'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=3', f'support@{{ip}}', remote_cmd)
    else:
        output = b''
        sent = False
        start = time.time()
        while time.time() - start < timeout:
            r, _, _ = select.select([fd], [], [], 0.3)
            if fd in r:
                try:
                    data = os.read(fd, 1024)
                    if not data: break
                    output += data
                    if (b'password:' in output.lower() or b'password for' in output.lower()) and not sent:
                        os.write(fd, {repr((ssh_pass + chr(10)).encode('utf-8'))})
                        sent = True
                except OSError:
                    break
        try: os.close(fd)
        except: pass
        try: os.waitpid(pid, 0)
        except: pass
        return output.decode(errors='ignore')

p2p_out = run_cmd('{probe_ip_p2p}', 'hostname')
p2p_ok = 1 if any(k in p2p_out.lower() for k in ['server', 'backup', 'ubuntu', '{code}']) else 0

loc_out = run_cmd('{ip_local}', 'hostname')
loc_ok = 1 if any(k in loc_out.lower() for k in ['server', 'backup', 'ubuntu', '{code}']) else 0

print(f"P2P_STATUS:{{p2p_ok}}")
print(f"LOCAL_STATUS:{{loc_ok}}")

target_ip = '{probe_ip_p2p}' if p2p_ok else ('{ip_local}' if loc_ok else '')
if target_ip:
    pawdog_out = run_cmd(target_ip, 'systemctl is-active pawdog')
    pawdog_act = 'active' if 'active' in pawdog_out.split() else 'inactive'
    print(f"PAWDOG_STATUS:{{pawdog_act}}")

    sql_query = "select (extract(epoch from now()) - extract(epoch from pg_last_xact_replay_timestamp()))::int as lag;"
    lag_val = ""
    for pwd in ['{code}545115', 'agent', '{ssh_pass}', 'agent545115']:
        sql_cmd = 'PGPASSWORD=' + pwd + ' psql -h 127.0.0.1 -p 5433 -d agent_{code} -U agent -w -tAc \\"' + sql_query + '\\" 2>&1'
        sql_out = run_cmd(target_ip, sql_cmd)
        for line in sql_out.splitlines():
            line = line.strip()
            if not line: continue
            if 'password' in line.lower() or 'support@' in line or 'error' in line.lower() or 'fatal' in line.lower(): continue
            if re.match(r'^-?\\d+$', line):
                lag_val = line
                break
        if lag_val != "":
            break
    print(f"REPLAG_STATUS:{{lag_val}}")
else:
    print("PAWDOG_STATUS:unreachable")
    print("REPLAG_STATUS:unreachable")
"""
    if IS_ON_JUMP:
        cmd_probe = ["tsh", "ssh", f"support@{primary_host}", "python3"]
    else:
        cmd_probe = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", JUMP_HOST, f"tsh ssh support@{primary_host} python3"]
    try:
        p_probe = subprocess.run(cmd_probe, input=probe_script.replace('\r\n', '\n').encode('utf-8'), capture_output=True, timeout=30)
        probe_out = p_probe.stdout.decode('utf-8', errors='ignore')

        p2p_ok = "P2P_STATUS:1" in probe_out
        loc_ok = "LOCAL_STATUS:1" in probe_out

        if p2p_ok:
            result["p2p"] = "Connected"
            result["status"] = "Aktif"
            if not result.get("ip_p2p"):
                result["ip_p2p"] = probe_ip_p2p
        else:
            result["p2p"] = "Not Connected"
            if loc_ok:
                result["status"] = "Aktif"
            elif result.get("replication") != "Streaming":
                result["status"] = "Tidak Aktif"
            else:
                result["status"] = "Aktif"

        conn_note = ""
        if p2p_ok and loc_ok:
            conn_note = ""
        elif loc_ok and not p2p_ok:
            conn_note = "Local connect, P2P tidak connect"
        elif p2p_ok and not loc_ok:
            conn_note = "P2P connect, Local tidak connect"
        else:
            conn_note = "Local & P2P tidak connect"

        result["conn_note"] = conn_note

        existing_col_s = row_info.get("col_s_note", "").strip()
        if conn_note:
            if existing_col_s:
                if conn_note.lower() not in existing_col_s.lower():
                    result["note_col_s"] = f"{existing_col_s}; {conn_note}"
                else:
                    result["note_col_s"] = existing_col_s
            else:
                result["note_col_s"] = conn_note
        else:
            result["note_col_s"] = existing_col_s

        pawdog_active = "PAWDOG_STATUS:active" in probe_out
        result["autopromote"] = "Yes" if pawdog_active else "No"

        m_lag = re.search(r"REPLAG_STATUS:(-?\d+)", probe_out)
        if m_lag and result.get("replication") == "Streaming":
            result["replag"] = f"{m_lag.group(1)}s"
        elif result.get("replication") == "Streaming":
            result["replag"] = "0s"
        else:
            result["replag"] = "-"

    except Exception as e:
        print(f"[-] Probe error on {code}: {e}", flush=True)
        result["p2p"] = "Not Connected"
        result["autopromote"] = "No"
        result["replag"] = "-"
        result["conn_note"] = "Local & P2P tidak connect"
        existing_col_s = row_info.get("col_s_note", "").strip()
        if existing_col_s:
            if "tidak connect" not in existing_col_s.lower():
                result["note_col_s"] = f"{existing_col_s}; Local & P2P tidak connect"
            else:
                result["note_col_s"] = existing_col_s
        else:
            result["note_col_s"] = "Local & P2P tidak connect"

    print(f"[+] Row {row_idx} Done: {loc_name} | Repl: {result['replication']} | Auto: {result['autopromote']} | Lag: {result['replag']} | P2P: {result['p2p']}", flush=True)
    return result


def update_google_sheet(audited_rows):
    print(f"\n[*] Preparing batch updates for Google Sheet '{SHEET_NAME}'...", flush=True)
    sheet_values = []
    col_s_values = []
    for r in audited_rows:
        row_val = [
            r["loc_name"],
            r["code"],
            r["status"],
            r["p2p"],
            r["cable_type"],
            r["teleport"],
            r["ip_local"],
            r["ip_p2p"],
            r["replication"],
            r["autopromote"],
            r["replag"],
            r["notes"]
        ]
        sheet_values.append(row_val)
        col_s_values.append([r.get("note_col_s", "")])

    start_row = 4
    end_row = 4 + len(sheet_values) - 1
    update_range = f"'{SHEET_NAME}'!A{start_row}:L{end_row}"
    update_s_range = f"'{SHEET_NAME}'!S{start_row}:S{end_row}"

    print(f"[*] Pushing updates to Google Sheet range {update_range} and {update_s_range} via Composio ({COMPOSIO_ACCOUNT})...", flush=True)
    resp1 = call_composio("GOOGLESHEETS_VALUES_UPDATE", {
        "spreadsheet_id": SPREADSHEET_ID,
        "range": update_range,
        "value_input_option": "USER_ENTERED",
        "values": sheet_values
    })
    resp2 = call_composio("GOOGLESHEETS_VALUES_UPDATE", {
        "spreadsheet_id": SPREADSHEET_ID,
        "range": update_s_range,
        "value_input_option": "USER_ENTERED",
        "values": col_s_values
    })
    if resp1 is not None and resp2 is not None:
        print(f"[✓] Google Sheet '{SHEET_NAME}' updated successfully!", flush=True)
        return True
    else:
        print(f"[!] Warning: Google Sheet update returned incomplete status.", flush=True)
        return False


def save_to_dashboard_json(audited_rows):
    print(f"[*] Exporting dataset to {OUTPUT_JSON}...", flush=True)
    export_data = []
    for r in audited_rows:
        export_data.append({
            "loc": r["loc_name"],
            "code": r["code"],
            "status": r["status"],
            "p2p": r["p2p"],
            "cable_type": r["cable_type"],
            "teleport": r["teleport"],
            "ip_local": r["ip_local"],
            "ip_p2p": r["ip_p2p"],
            "replication": r["replication"],
            "autopromote": r["autopromote"],
            "replag": r["replag"],
            "notes": r["notes"],
            "note_col_s": r.get("note_col_s", ""),
            "conn_note": r.get("conn_note", "")
        })

    os.makedirs(DATA_DIR, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".bkp_", suffix=".json", dir=DATA_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(export_data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, OUTPUT_JSON)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise
    print(f"[✓] Saved {len(export_data)} server backup records to {OUTPUT_JSON}.", flush=True)


def main():
    print("==================================================================", flush=True)
    print("  PARKEE HIGH-AVAILABILITY SERVER BACKUP TELEMETRY SWEEP ENGINE   ", flush=True)
    print("==================================================================", flush=True)

    raw_rows = fetch_sheet_rows()
    if not raw_rows or len(raw_rows) <= 1:
        print("[-] No rows retrieved from sheet. Aborting.", flush=True)
        sys.exit(1)

    row_objects = []
    for idx, r in enumerate(raw_rows[1:], start=4):
        loc_name = r[0].strip() if len(r) > 0 else ""
        if not loc_name:
            continue
        raw_code = r[1].strip() if len(r) > 1 else ""
        resolved_code = resolve_uniq_code(loc_name, raw_code)

        status = r[2].strip() if len(r) > 2 else "Aktif"
        p2p = r[3].strip() if len(r) > 3 else "Connected"
        cable_type = r[4].strip() if len(r) > 4 else "Rakitan CAT6"
        teleport = r[5].strip() if len(r) > 5 else "No"
        ip_local = r[6].strip() if len(r) > 6 else ""
        ip_p2p = r[7].strip() if len(r) > 7 else ""
        replication = r[8].strip() if len(r) > 8 else "Streaming"
        autopromote = r[9].strip() if len(r) > 9 else "No"
        replag = r[10].strip() if len(r) > 10 else ""
        notes = r[11].strip() if len(r) > 11 else ""
        col_s_note = r[18].strip() if len(r) > 18 else ""

        row_objects.append({
            "row_idx": idx,
            "loc_name": loc_name,
            "code": resolved_code,
            "status": status,
            "p2p": p2p,
            "cable_type": cable_type,
            "teleport": teleport,
            "ip_local": ip_local,
            "ip_p2p": ip_p2p,
            "replication": replication,
            "autopromote": autopromote,
            "replag": replag,
            "notes": notes,
            "col_s_note": col_s_note
        })

    print(f"[+] Loaded {len(row_objects)} backup server locations to audit.", flush=True)
    teleport_nodes = get_teleport_nodes()

    audited_map = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        future_to_idx = {executor.submit(check_single_server, ro, teleport_nodes): ro["row_idx"] for ro in row_objects}
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                res = future.result()
                audited_map[idx] = res
            except Exception as e:
                print(f"[-] Exception auditing row {idx}: {e}", flush=True)

    audited_rows = [audited_map[ro["row_idx"]] for ro in row_objects if ro["row_idx"] in audited_map]

    update_google_sheet(audited_rows)
    save_to_dashboard_json(audited_rows)

    print("\n[✓] ALL TASKS COMPLETED SUCCESSFULLY!", flush=True)


if __name__ == "__main__":
    main()
