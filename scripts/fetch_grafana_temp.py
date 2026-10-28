#!/usr/bin/env python3
"""
Fetch Live Temperature Telemetry from Grafana (monitoring.sistemparkiran.com)
Prometheus Datasource: id 3
Enriches with metadata from data/servers.json & data/locations.json
"""

import json
import os
import re
import sys
import tempfile
import datetime
import urllib.request
import urllib.parse
import http.cookiejar

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVERS_JSON = os.path.join(BASE_DIR, "data", "servers.json")
LOCS_JSON = os.path.join(BASE_DIR, "data", "locations.json")
OUTPUT_JSON = os.path.join(BASE_DIR, "data", "temperature.json")


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

GRAFANA_URL = os.environ.get("GRAFANA_URL", "https://monitoring.sistemparkiran.com")
GRAFANA_USER = os.environ.get("GRAFANA_USER", "support")
GRAFANA_PASS = os.environ.get("GRAFANA_PASS", "")


def load_local_mappings():
    server_map = {}
    if os.path.exists(SERVERS_JSON):
        try:
            with open(SERVERS_JSON, "r", encoding="utf-8") as f:
                servers = json.load(f)
                for s in servers:
                    code = (s.get("code") or "").strip().lower()
                    loc = (s.get("loc") or "").strip().lower()
                    if code:
                        server_map[code] = s
                    if loc:
                        server_map[loc] = s
        except Exception as e:
            print(f"Warning loading servers.json: {e}")
    return server_map


def extract_code_from_instance(instance_str):
    m = re.search(r"[\(\[]([a-zA-Z0-9]{3,4})[\)\]]", instance_str)
    if m:
        return m.group(1).strip()
    return ""


def clean_loc_name(instance_str):
    s = re.sub(r"[\(\[][a-zA-Z0-9]{3,4}[\)\]]", "", instance_str).strip()
    return s or instance_str


def fetch_telemetry():
    if not GRAFANA_PASS:
        print("Error: GRAFANA_PASS not configured in .env or environment.", file=sys.stderr)
        return False

    print(f"[{datetime.datetime.now()}] Logging into Grafana...")
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    login_payload = {"user": GRAFANA_USER, "password": GRAFANA_PASS}
    login_req = urllib.request.Request(
        f"{GRAFANA_URL}/login",
        data=json.dumps(login_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with opener.open(login_req, timeout=15) as res:
            if res.status != 200:
                raise RuntimeError(f"Login failed: HTTP {res.status}")
    except Exception as e:
        print(f"Login error: {e}", file=sys.stderr)
        return False

    print("Querying Prometheus temperature metrics...")
    query = "max by (instance) (node_hwmon_temp_celsius or node_thermal_zone_temp)"
    query_url = f"{GRAFANA_URL}/api/datasources/proxy/3/api/v1/query?" + urllib.parse.urlencode({"query": query})

    query_req = urllib.request.Request(query_url)
    try:
        with opener.open(query_req, timeout=20) as res:
            resp_data = json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"Query error: {e}", file=sys.stderr)
        return False

    results = resp_data.get("data", {}).get("result", [])
    print(f"Raw temperature series count: {len(results)}")
    if not results:
        print("Error: Prometheus returned 0 temperature series.", file=sys.stderr)
        return False

    server_mappings = load_local_mappings()
    records = []
    overheat_cnt = 0
    warm_cnt = 0
    normal_cnt = 0
    sum_temp = 0.0

    for item in results:
        raw_instance = item.get("metric", {}).get("instance", "").strip()
        if not raw_instance:
            continue

        val_list = item.get("value", [0, "0"])
        try:
            temp = float(val_list[1])
        except (IndexError, ValueError):
            continue

        # Filter out extreme hardware sensor anomalies (below 10C or above 115C)
        if temp < 10.0 or temp > 115.0:
            continue

        code = extract_code_from_instance(raw_instance)
        clean_loc = clean_loc_name(raw_instance)

        matched_server = server_mappings.get(code.lower()) or server_mappings.get(clean_loc.lower()) or {}

        hostname = matched_server.get("host") or (f"server-{code}" if code else raw_instance)
        ip = matched_server.get("ip") or "-"
        cpu = matched_server.get("cpu") or "-"
        ram = matched_server.get("ram") or "-"
        final_loc = matched_server.get("loc") or clean_loc
        final_code = matched_server.get("code") or code or "-"

        status = "normal"
        if temp >= 80.0:
            status = "overheat"
            overheat_cnt += 1
        elif temp >= 70.0:
            status = "warm"
            warm_cnt += 1
        else:
            normal_cnt += 1

        sum_temp += temp

        records.append({
            "loc": final_loc,
            "code": final_code,
            "host": hostname,
            "ip": ip,
            "temp": round(temp, 1),
            "status": status,
            "cpu": cpu,
            "ram": ram,
            "raw_instance": raw_instance
        })

    records.sort(key=lambda x: x["temp"], reverse=True)

    avg_temp = round(sum_temp / len(records), 1) if records else 0.0
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S WIB")

    payload = {
        "updated_at": now_str,
        "total_monitored": len(records),
        "overheat_count": overheat_cnt,
        "warm_count": warm_cnt,
        "normal_count": normal_cnt,
        "avg_temp": avg_temp,
        "servers": records
    }

    out_dir = os.path.dirname(OUTPUT_JSON)
    os.makedirs(out_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".temp_", suffix=".json", dir=out_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
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

    print(f"Successfully generated {OUTPUT_JSON}")
    print(f"Summary: {len(records)} servers | Overheat: {overheat_cnt} | Warm: {warm_cnt} | Normal: {normal_cnt} | Avg: {avg_temp}C")
    return True


if __name__ == "__main__":
    if not fetch_telemetry():
        sys.exit(1)
