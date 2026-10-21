import csv
import json
import re
from collections import Counter, defaultdict
import os
import urllib.request
import datetime

CSV_URL = "https://docs.google.com/spreadsheets/d/11HUECMQG_30Sc1AupFLac7OxBDiFiZOD339LjiOkpdc/export?format=csv&gid=0"
base_dir = os.path.dirname(os.path.abspath(__file__))
csv_path = os.path.join(base_dir, "sheet_data.csv")
data_dir = os.path.join(base_dir, "data")
js_dir = os.path.join(base_dir, "js")
os.makedirs(data_dir, exist_ok=True)
os.makedirs(js_dir, exist_ok=True)

print("Fetching latest Google Sheet CSV...")
try:
    urllib.request.urlretrieve(CSV_URL, csv_path)
    print(f"Downloaded latest CSV to {csv_path}")
except Exception as e:
    print(f"Fetch failed ({e}), using existing CSV if available.")

def clean_num(val, is_float=False):
    if not val:
        return None
    val = val.replace("Â°C", "").replace("°C", "").replace("C", "").replace("%", "").replace(",", ".").strip()
    match = re.search(r"[-+]?\d*\.?\d+", val)
    if match:
        try:
            return float(match.group(0)) if is_float else int(float(match.group(0)))
        except:
            return None
    return None

raw_rows = []
loc_tiers = {}

with open(csv_path, mode="r", encoding="utf-8", errors="ignore") as f:
    reader = csv.DictReader(f)
    for r in reader:
        loc = r.get("Nama Lokasi", "").strip()
        tier = r.get("Tier", "").strip()
        if loc and tier:
            loc_tiers[loc] = tier
        raw_rows.append(r)

records = []
for r in raw_rows:
    loc = r.get("Nama Lokasi", "").strip()
    if not loc:
        continue
    host = r.get("Nama Device / Hostname", "").strip()
    temp_val = clean_num(r.get("Temperature", ""), is_float=True)
    ssd_h = clean_num(r.get("Health SSD", ""))
    ssd_u = clean_num(r.get("SSD Usage", ""))
    
    h_lower = host.lower()
    dev_cat = "Other / Network"
    if h_lower.startswith("server"):
        dev_cat = "Server"
    elif h_lower.startswith("admin"):
        dev_cat = "Admin"
    elif any(k in h_lower for k in ["pm", "pos", "gate", "barrier", "kiosk", "dispenser", "in-", "out-", "entry", "exit", "b1", "b2", "lobby", "pelataran"]):
        dev_cat = "Gate / Kiosk"
    elif "cashier" in h_lower or "kasir" in h_lower:
        dev_cat = "Cashier"

    tier = r.get("Tier", "").strip() or loc_tiers.get(loc, "Standard / Unset")

    ssd_type_raw = r.get("Type SSD (SATA/NVME)", "").strip().upper()
    ssd_type = "NVMe" if "NVME" in ssd_type_raw else ("SATA" if "SATA" in ssd_type_raw else "")

    ssd_brand_raw = r.get("Merk SSD", "").strip().lower()
    ssd_brand = ""
    if "samsung" in ssd_brand_raw: ssd_brand = "Samsung"
    elif "kingston" in ssd_brand_raw: ssd_brand = "Kingston"
    elif "v-gen" in ssd_brand_raw or "vgen" in ssd_brand_raw: ssd_brand = "V-Gen"
    elif "midas" in ssd_brand_raw: ssd_brand = "MidasForce"
    elif "klevv" in ssd_brand_raw: ssd_brand = "Klevv"
    elif "wd" in ssd_brand_raw or "western" in ssd_brand_raw: ssd_brand = "Western Digital"
    elif "sandisk" in ssd_brand_raw: ssd_brand = "SanDisk"
    elif "crucial" in ssd_brand_raw: ssd_brand = "Crucial"
    elif "adata" in ssd_brand_raw: ssd_brand = "ADATA"
    elif ssd_brand_raw and ssd_brand_raw not in ["other", "other brand", "-"]: ssd_brand = r.get("Merk SSD", "").strip()

    ssd_size_raw = r.get("Size SSD", "").strip()
    ssd_size = "" if ssd_size_raw.lower() in ["0", "-", "0b", "other", "other brand", "none"] else ssd_size_raw

    ram_raw = r.get("Merek Ram", "").strip().lower()
    ram_brand = ""
    if "samsung" in ram_raw: ram_brand = "Samsung"
    elif "kingston" in ram_raw: ram_brand = "Kingston"
    elif "corsair" in ram_raw or "cmk" in ram_raw: ram_brand = "Corsair"
    elif "v-gen" in ram_raw or "vgen" in ram_raw: ram_brand = "V-Gen"
    elif "hynix" in ram_raw: ram_brand = "SK Hynix"
    elif "crucial" in ram_raw or "micron" in ram_raw: ram_brand = "Micron/Crucial"
    elif "klevv" in ram_raw: ram_brand = "Klevv"
    elif ram_raw and ram_raw not in ["other", "other brand", "-"] and not ram_raw.startswith("0x") and "unknown" not in ram_raw: ram_brand = r.get("Merek Ram", "").strip()

    ram_val_raw = r.get("Total Ram", "").strip()
    ram_val = "" if ram_val_raw.lower() in ["0", "-", "other", "other brand", "- (other)", "none"] else ram_val_raw

    mb_raw = r.get("Merek Motherboard", "").strip().lower()
    mb_brand = ""
    if "asus" in mb_raw: mb_brand = "ASUS"
    elif "gigabyte" in mb_raw: mb_brand = "Gigabyte"
    elif "msi" in mb_raw or "micro-star" in mb_raw: mb_brand = "MSI"
    elif "asrock" in mb_raw: mb_brand = "ASRock"
    elif "ecs" in mb_raw: mb_brand = "ECS"
    elif "biostar" in mb_raw: mb_brand = "Biostar"
    elif "intel" in mb_raw: mb_brand = "Intel"
    elif mb_raw and mb_raw not in ["other", "other brand", "-", "default string", "none"]: mb_brand = r.get("Merek Motherboard", "").strip()

    mb_val_raw = r.get("Merek Motherboard", "").strip()
    mb_val = "" if mb_val_raw.lower() in ["other", "other brand", "-", "default string", "none"] else mb_val_raw

    cpu_val_raw = r.get("Processor", "").strip()
    cpu_val = "" if cpu_val_raw.lower() in ["-", "other", "other cpu", "none"] else cpu_val_raw
    cpu_raw = cpu_val.lower()

    cpu_family = ""
    if "core(tm) i7" in cpu_raw: cpu_family = "Intel Core i7"
    elif "core(tm) i5" in cpu_raw: cpu_family = "Intel Core i5"
    elif "core(tm) i3" in cpu_raw: cpu_family = "Intel Core i3"
    elif "pentium" in cpu_raw: cpu_family = "Intel Pentium"
    elif "celeron" in cpu_raw: cpu_family = "Intel Celeron"
    elif "ryzen" in cpu_raw: cpu_family = "AMD Ryzen"
    elif "xeon" in cpu_raw: cpu_family = "Intel Xeon"
    elif cpu_raw: cpu_family = "Other x86/ARM"

    os_val_raw = r.get("OS Version", "").strip()
    os_val = "" if os_val_raw.lower() in ["-", "other", "none"] else os_val_raw

    # Strict server criteria: hostname must start with "server"
    is_server = h_lower.startswith("server")

    records.append({
        "loc": loc,
        "code": r.get("Kode Unik Lokasi", "").strip(),
        "tier": tier,
        "host": host,
        "cat": dev_cat,
        "is_server": is_server,
        "ip": r.get("IP local lokasi", "").strip(),
        "zt": r.get("IP ZT Lokasi", "").strip(),
        "sync": r.get("Last Sync", "").strip(),
        "agent": r.get("Agent Version", "").strip(),
        "fisherman": r.get("Fisherman Version", "").strip(),
        "watersheep": r.get("Watersheep Version", "").strip(),
        "wbo": r.get("WBO Version", "").strip(),
        "reader_ver": r.get("Versi Reader", "").strip(),
        "reader_sn": r.get("SN Reader", "").strip(),
        "cpu": cpu_val,
        "cpu_family": cpu_family,
        "ram": ram_val,
        "ram_brand": ram_brand,
        "mb": mb_val,
        "mb_brand": mb_brand,
        "ssd_brand": ssd_brand,
        "ssd_type": ssd_type,
        "ssd_size": ssd_size,
        "ssd_health": ssd_h,
        "ssd_usage": ssd_u,
        "temp": temp_val,
        "os": os_val
    })

print(f"Processed {len(records)} records")

# 1. Save fleet.json
fleet_file = os.path.join(data_dir, "fleet.json")
with open(fleet_file, "w", encoding="utf-8") as f:
    json.dump(records, f, separators=(',', ':'))

# 2. Separate Server records & Client records
server_records = [r for r in records if r["is_server"]]
client_records = [r for r in records if not r["is_server"]]

servers_file = os.path.join(data_dir, "servers.json")
with open(servers_file, "w", encoding="utf-8") as f:
    json.dump(server_records, f, separators=(',', ':'))

# 3. Aggregate 961 Locations for 'Location Information'
locs_map = defaultdict(lambda: {
    "loc": "",
    "code": "",
    "tier": "",
    "zt": "",
    "last_sync": "",
    "agent": "",
    "fisherman": "",
    "watersheep": "",
    "wbo": "",
    "os": "",
    "total_devs": 0,
    "total_servers": 0,
    "total_clients": 0,
    "server_overheats": 0,
    "client_overheats": 0,
    "has_reader": False
})

for r in records:
    loc_name = r["loc"]
    entry = locs_map[loc_name]
    entry["loc"] = loc_name
    entry["total_devs"] += 1

    if r["code"] and not entry["code"]: entry["code"] = r["code"]
    if r["tier"] and not entry["tier"]: entry["tier"] = r["tier"]

    if r["is_server"]:
        entry["total_servers"] += 1
        if r["temp"] and r["temp"] >= 80: entry["server_overheats"] += 1
        if r["zt"]: entry["zt"] = r["zt"]
        if r["sync"]: entry["last_sync"] = r["sync"]
        if r["agent"]: entry["agent"] = r["agent"]
        if r["fisherman"]: entry["fisherman"] = r["fisherman"]
        if r["watersheep"]: entry["watersheep"] = r["watersheep"]
        if r["wbo"]: entry["wbo"] = r["wbo"]
        if r["os"]: entry["os"] = r["os"]
    else:
        entry["total_clients"] += 1
        if r["temp"] and r["temp"] >= 80: entry["client_overheats"] += 1
        if r["reader_ver"] or r["reader_sn"]: entry["has_reader"] = True
        # Fallback values if server hasn't set them yet
        if r["zt"] and not entry["zt"]: entry["zt"] = r["zt"]
        if r["sync"] and not entry["last_sync"]: entry["last_sync"] = r["sync"]
        if r["agent"] and not entry["agent"]: entry["agent"] = r["agent"]
        if r["fisherman"] and not entry["fisherman"]: entry["fisherman"] = r["fisherman"]
        if r["watersheep"] and not entry["watersheep"]: entry["watersheep"] = r["watersheep"]
        if r["wbo"] and not entry["wbo"]: entry["wbo"] = r["wbo"]
        if r["os"] and not entry["os"]: entry["os"] = r["os"]

locations_list = sorted(list(locs_map.values()), key=lambda x: x["loc"].lower())

locations_file = os.path.join(data_dir, "locations.json")
with open(locations_file, "w", encoding="utf-8") as f:
    json.dump(locations_list, f, separators=(',', ':'))

# 4. Storage Audit Data (Server Only)
server_storage_list = []
for s in server_records:
    server_storage_list.append({
        "loc": s["loc"],
        "code": s["code"],
        "tier": s["tier"],
        "host": s["host"],
        "ssd_brand": s["ssd_brand"],
        "ssd_type": s["ssd_type"],
        "ssd_size": s["ssd_size"],
        "ssd_health": s["ssd_health"],
        "ssd_usage": s["ssd_usage"],
        "temp": s["temp"],
        "sync": s["sync"]
    })

server_storage_file = os.path.join(data_dir, "server_storage.json")
with open(server_storage_file, "w", encoding="utf-8") as f:
    json.dump(server_storage_list, f, separators=(',', ':'))

# 5. Summary Statistics for KPIs
unique_locs = len(locations_list)
tier_counts = Counter(r["tier"] for r in records)
server_overheats = sorted([r for r in server_records if r["temp"] is not None and r["temp"] >= 80], key=lambda x: x["temp"], reverse=True)
client_overheats = sorted([r for r in client_records if r["temp"] is not None and r["temp"] >= 80], key=lambda x: x["temp"], reverse=True)
critical_server_ssd = [r for r in server_records if r["ssd_health"] is not None and r["ssd_health"] < 70]
critical_server_storage = [r for r in server_records if r["ssd_usage"] is not None and r["ssd_usage"] >= 85]

server_temp_ranges = {
    "< 50°C (Cool)": sum(1 for r in server_records if r["temp"] is not None and r["temp"] < 50),
    "50-69°C (Normal)": sum(1 for r in server_records if r["temp"] is not None and 50 <= r["temp"] < 70),
    "70-79°C (Warm)": sum(1 for r in server_records if r["temp"] is not None and 70 <= r["temp"] < 80),
    "80-89°C (Hot)": sum(1 for r in server_records if r["temp"] is not None and 80 <= r["temp"] < 90),
    ">= 90°C (Critical)": sum(1 for r in server_records if r["temp"] is not None and r["temp"] >= 90),
}

server_ssd_health_ranges = {
    ">= 95% (Pristine)": sum(1 for r in server_records if r["ssd_health"] is not None and r["ssd_health"] >= 95),
    "80-94% (Good)": sum(1 for r in server_records if r["ssd_health"] is not None and 80 <= r["ssd_health"] < 95),
    "70-79% (Warning)": sum(1 for r in server_records if r["ssd_health"] is not None and 70 <= r["ssd_health"] < 80),
    "< 70% (Degraded)": len(critical_server_ssd),
}

server_ssd_usage_ranges = {
    "< 50% (Plenty)": sum(1 for r in server_records if r["ssd_usage"] is not None and r["ssd_usage"] < 50),
    "50-69% (Moderate)": sum(1 for r in server_records if r["ssd_usage"] is not None and 50 <= r["ssd_usage"] < 70),
    "70-84% (High)": sum(1 for r in server_records if r["ssd_usage"] is not None and 70 <= r["ssd_usage"] < 85),
    ">= 85% (Critical)": len(critical_server_storage),
}

summary = {
    "last_updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S WIB"),
    "total_devices": len(records),
    "total_servers": len(server_records),
    "total_clients": len(client_records),
    "unique_locations": unique_locs,
    "tier_counts": dict(tier_counts),
    "server_overheats_count": len(server_overheats),
    "client_overheats_count": len(client_overheats),
    "critical_server_ssd_count": len(critical_server_ssd),
    "critical_server_storage_count": len(critical_server_storage),
    "server_nvme_count": sum(1 for r in server_records if r["ssd_type"] == "NVMe"),
    "server_sata_count": sum(1 for r in server_records if r["ssd_type"] == "SATA"),
    "server_temp_ranges": server_temp_ranges,
    "server_ssd_health_ranges": server_ssd_health_ranges,
    "server_ssd_usage_ranges": server_ssd_usage_ranges,
    "top_server_overheats": server_overheats[:15],
    "top_server_ssd_critical": critical_server_ssd[:15],
    "top_server_storage_critical": critical_server_storage[:15]
}

summary_file = os.path.join(data_dir, "summary.json")
with open(summary_file, "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

js_file = os.path.join(js_dir, "summary-data.js")
with open(js_file, "w", encoding="utf-8") as f:
    f.write("window.PRECOMPUTED_SUMMARY = " + json.dumps(summary, indent=2) + ";\n")

print(f"Generated successfully: {unique_locs} locations, {len(server_records)} servers, {len(client_records)} clients!")
