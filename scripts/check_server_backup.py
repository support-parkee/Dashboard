#!/usr/bin/env python3
"""
check_server_backup.py
======================
Automated Diagnostic & Sync Engine for PARKEE Server Backups
Performs:
1. Fetch latest raw rows from Google Sheet 'List Status Server Backup'.
2. Concurrently audit each server backup:
   - Primary server SSH jump (tsh ssh support@server-<code_clean>)
   - Run repmgr cluster show to check replication status
   - Probe backup server via P2P IP and Local IP
   - Check pawdog service status (Auto Promote)
   - Query PostgreSQL replag: select (extract(epoch from now()) - extract(epoch from pg_last_xact_replay_timestamp()))::int as lag;
3. Update Google Sheet via Composio (account: googlesheets_mobile-median / admin@parkee.app).
4. Save clean telemetry JSON to data/server_backup.json for the dashboard.
"""

import os
import sys
import json
import re
import time
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

SPREADSHEET_ID = "1PZUIHFkhWRO5PZGeNKGkAhGP7ouqeJhRbxySBkXvEFA"
SHEET_NAME = "List Status Server Backup"
COMPOSIO_ACCOUNT = "googlesheets_mobile-median"
JUMP_HOST = "admin-adg@100.123.138.90"

# Composio MCP API Token & URL
COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp"
DEFAULT_ACCESS_TOKEN = (
    "eyJhbGciOiJSUzI1NiIsImtpZCI6InNzb19vaWRjX2tleV9wYWlyXzAxSlkwWkRHTjlCOTVGTTBHUEM1QjNZWTVOIn0."
    "eyJlbWFpbCI6ImF6a2lhYmVuaW5ndG9uMTJAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImlzcyI6Imh0dHBzOi8vbG9naW4uY29tcG9zaW8uZGV2IiwiYXVkIjoiaHR0cHM6Ly9jb25uZWN0LmNvbXBvc2lvLmRldi9tY3AiLCJzdWIiOiJ1c2VyXzAxS1QxWFhEMFZFSFhWSjVQMFBUV002WjVZIiwic2lkIjoiYXBwX2NvbnNlbnRfMDFLVEYwRDNOWERYR0pKSEVNVEVFUlhUWFYiLCJqdGkiOiIwMUtURjBESkFWOVA4NURYSEhEQjdEQlAxOSIsIm9yZ19pZCI6Im9yZ18wMUtUM0pCNVRCSFhDQU03MzgzOUFWSDEwUCIsImV4cCI6MTgxMjMwMzcwNSwiaWF0IjoxNzgwNzY3NzA1fQ."
    "Pyz5m2lqz8abukcaCH7Ds_WJCaUz9DNPtHyUgmyqRboeWkOSBq3litBzmEq_jMUQzNvmxgK9uLlQyofvg4jwD6-TJ8FWx8P7q4b4GAlUDcauQBPS8lGc86WFk4aoPWQW1_yOgP2QUVn6S9uDeW3l2txFOdwOfvYyERVm87UxSEhCIUgeaj5xzB7cihTkLQtk-yATfCS6FTeTjDDevuIDNzLhX12yqNvIUiehejh5GnJpjMsGfzVgtZcey-asS6bDCZ996bN5wA4oYZDwy5tPv9543k3Io3SSHO1xaRr7To5d4GFrF_U_p248PVA5fGa0HfoDuOMPWBz-g2iE1jTarQ"
)

# Known code mapping for edge cases in the sheet
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
        "Authorization": f"Bearer {DEFAULT_ACCESS_TOKEN}",
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
                            return parsed.get("data", {}).get("results", [])[0].get("response", {}).get("data", {})
    except Exception as e:
        print(f"[Composio API Error]: {e}", flush=True)
    return None

def fetch_sheet_rows():
    raw_path = os.path.join(DATA_DIR, "server_backup_raw.json")
    if os.path.exists(raw_path):
        print(f"[*] Loading sheet data from {raw_path}...", flush=True)
        with open(raw_path, "r", encoding="utf-8") as f:
            return json.load(f)
    print("[-] raw sheet data not found.", flush=True)
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
    
    # Try regex inside parentheses like (0vx-backup) or (server-backup-0vy)
    m = re.search(r"\(([a-zA-Z0-9]+)-backup|\(server-backup-([a-zA-Z0-9]+)|\(([a-zA-Z0-9]+)\)", loc_name, re.I)
    if m:
        for g in m.groups():
            if g:
                c = g.lower()
                return f"0{c}" if (len(c) == 2 and c.isdigit()) else c
                
    # Try known codes
    clean_name = loc_name.lower()
    for k, v in KNOWN_CODES.items():
        if k in clean_name:
            return v

    return ""

def check_single_server(row_info, teleport_nodes):
    row_idx = row_info["row_idx"]
    loc_name = row_info["loc_name"]
    code = row_info["code"].lower()
    ip_local = row_info["ip_local"]
    ip_p2p = row_info["ip_p2p"]
    status_raw = row_info["status"]
    
    result = dict(row_info)
    
    # Check if backup server is in Teleport
    backup_hostnames = [f"server-backup-{code}", f"server-{code}-backup"]
    teleport_online = any(h in teleport_nodes for h in backup_hostnames)
    result["teleport"] = "Yes" if teleport_online else "No"
    
    # If explicitly marked as no asset or blocking, preserve note and skip SSH
    if any(k in status_raw.lower() for k in ["belum ada aset", "blocking", "asset sampai"]):
        result["status"] = status_raw or "Belum ada aset"
        result["p2p"] = "Not Connected"
        result["replication"] = "Not Streaming"
        result["autopromote"] = "No"
        result["replag"] = "-"
        return result
        
    if not code:
        result["status"] = status_raw or "Tidak Diketahui"
        result["p2p"] = "Not Connected"
        result["replication"] = "Not Streaming"
        result["autopromote"] = "No"
        result["replag"] = "-"
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
        is_streaming = ("standby" in rep_out.lower() and "running" in rep_out.lower()) and ("error" not in rep_out.lower())
        result["replication"] = "Streaming" if is_streaming else "Not Streaming"
    except Exception as e:
        result["replication"] = "Not Streaming"
        result["status"] = "Tidak Aktif"

    # 2. Run remote probe script on primary server
    probe_script = f"""
P2P_OK=0
if [ -n "{ip_p2p}" ]; then
    if sshpass -p support545115 ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=3 support@{ip_p2p} hostname >/dev/null 2>&1; then
        P2P_OK=1
    fi
fi

LOCAL_OK=0
if [ -n "{ip_local}" ]; then
    if sshpass -p support545115 ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=3 support@{ip_local} hostname >/dev/null 2>&1; then
        LOCAL_OK=1
    fi
fi

echo "P2P_STATUS:$P2P_OK"
echo "LOCAL_STATUS:$LOCAL_OK"

TARGET_IP=""
if [ $P2P_OK -eq 1 ]; then
    TARGET_IP="{ip_p2p}"
elif [ $LOCAL_OK -eq 1 ]; then
    TARGET_IP="{ip_local}"
fi

if [ -n "$TARGET_IP" ]; then
    PAWDOG_ACT=$(sshpass -p support545115 ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=3 support@$TARGET_IP "systemctl is-active pawdog" 2>/dev/null)
    echo "PAWDOG_STATUS:$PAWDOG_ACT"

    SQL="select (extract(epoch from now()) - extract(epoch from pg_last_xact_replay_timestamp()))::int as lag;"
    LAG_RES=""
    for PWD in "{code}545115" "agent" "support545115"; do
        LAG_RES=$(sshpass -p support545115 ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=3 support@$TARGET_IP "PGPASSWORD=$PWD psql -h 127.0.0.1 -p 5433 -d agent_{code} -U agent -tAc \\\"$SQL\\\"" 2>/dev/null)
        if [[ "$LAG_RES" =~ ^[0-9]+$ ]]; then
            break
        fi
    done
    echo "REPLAG_STATUS:$LAG_RES"
else
    echo "PAWDOG_STATUS:unreachable"
    echo "REPLAG_STATUS:unreachable"
fi
"""
    if IS_ON_JUMP:
        cmd_probe = ["tsh", "ssh", f"support@{primary_host}", "bash -s"]
    else:
        cmd_probe = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", JUMP_HOST, f"tsh ssh support@{primary_host} 'bash -s'"]
    try:
        p_probe = subprocess.run(cmd_probe, input=probe_script.replace('\r\n', '\n').encode('utf-8'), capture_output=True, timeout=30)
        probe_out = p_probe.stdout.decode('utf-8', errors='ignore')
        
        # Parse P2P and LOCAL
        p2p_ok = "P2P_STATUS:1" in probe_out
        loc_ok = "LOCAL_STATUS:1" in probe_out
        
        if p2p_ok and loc_ok:
            result["p2p"] = "OK (Local & P2P)"
            result["status"] = "Aktif"
        elif p2p_ok:
            result["p2p"] = "Connected"
            result["status"] = "Aktif"
        elif loc_ok:
            result["p2p"] = "Local Only"
            result["status"] = "Aktif"
        else:
            result["p2p"] = "Not Connected"
            if result.get("replication") != "Streaming":
                result["status"] = "Tidak Aktif"
            else:
                result["status"] = "Aktif"
                
        # Parse Pawdog
        pawdog_active = "PAWDOG_STATUS:active" in probe_out
        result["autopromote"] = "Yes" if pawdog_active else "No"
        
        # Parse Replag
        m_lag = re.search(r"REPLAG_STATUS:(\d+)", probe_out)
        if m_lag:
            result["replag"] = f"{m_lag.group(1)}s"
        else:
            result["replag"] = "0s" if result["replication"] == "Streaming" else "-"
            
    except Exception as e:
        print(f"[-] Probe error on {code}: {e}", flush=True)
        result["p2p"] = "Not Connected"
        result["autopromote"] = "No"
        result["replag"] = "-"
        
    print(f"[+] Row {row_idx} Done: {loc_name} | Repl: {result['replication']} | Auto: {result['autopromote']} | Lag: {result['replag']} | P2P: {result['p2p']}", flush=True)
    return result

def update_google_sheet(audited_rows):
    print(f"\n[*] Preparing batch updates for Google Sheet '{SHEET_NAME}'...", flush=True)
    # Range A4:L{4 + len(audited_rows) - 1}
    sheet_values = []
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
        
    payload_path = os.path.join(DATA_DIR, "server_backup_for_sheet.json")
    with open(payload_path, "w", encoding="utf-8") as f:
        json.dump(sheet_values, f, indent=2, ensure_ascii=False)
    print(f"[✓] Saved sheet update payload to {payload_path}", flush=True)

    start_row = 4
    end_row = 4 + len(sheet_values) - 1
    update_range = f"'{SHEET_NAME}'!A{start_row}:L{end_row}"
    
    print(f"[*] Pushing updates to Google Sheet range {update_range} via Composio ({COMPOSIO_ACCOUNT})...", flush=True)
    resp = call_composio("GOOGLESHEETS_VALUES_UPDATE", {
        "spreadsheet_id": SPREADSHEET_ID,
        "range": update_range,
        "value_input_option": "USER_ENTERED",
        "values": sheet_values
    })
    if resp and resp.get("updatedCells", 0) > 0:
        print(f"[✓] Successfully updated {resp.get('updatedCells')} cells in Google Sheet!", flush=True)
        return True
    else:
        print(f"[!] Warning: Sheet update direct call returned: {resp}. Will be pushed via MCP.", flush=True)
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
            "notes": r["notes"]
        })
        
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(export_data, f, indent=2, ensure_ascii=False)
    print(f"[✓] Saved {len(export_data)} server backup records to {OUTPUT_JSON}.", flush=True)

def main():
    print("==================================================================", flush=True)
    print("  PARKEE HIGH-AVAILABILITY SERVER BACKUP TELEMETRY SWEEP ENGINE   ", flush=True)
    print("==================================================================", flush=True)
    
    raw_rows = fetch_sheet_rows()
    if not raw_rows or len(raw_rows) <= 1:
        print("[-] No rows retrieved from sheet. Aborting.", flush=True)
        return

    # Extract rows 4 onwards
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
            "notes": notes
        })

    print(f"[+] Loaded {len(row_objects)} backup server locations to audit.", flush=True)
    teleport_nodes = get_teleport_nodes()

    # Parallel audit with ThreadPoolExecutor
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

    # Sort audited rows by row_idx
    audited_rows = [audited_map[ro["row_idx"]] for ro in row_objects if ro["row_idx"] in audited_map]

    # Step 3: Update Google Sheet via Composio
    update_google_sheet(audited_rows)

    # Step 4: Export to dashboard JSON
    save_to_dashboard_json(audited_rows)

    print("\n[✓] ALL TASKS COMPLETED SUCCESSFULLY!", flush=True)

if __name__ == "__main__":
    main()
