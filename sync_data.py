import csv
import json
import re
from collections import Counter
import os
import urllib.request

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
    if "server" in h_lower:
        dev_cat = "Server"
    elif "admin" in h_lower:
        dev_cat = "Admin"
    elif any(k in h_lower for k in ["pm", "pos", "gate", "barrier", "kiosk", "dispenser", "in-", "out-", "entry", "exit", "b1", "b2", "lobby"]):
        dev_cat = "Gate / Kiosk"
    elif "cashier" in h_lower or "kasir" in h_lower:
        dev_cat = "Cashier"

    tier = r.get("Tier", "").strip() or loc_tiers.get(loc, "Standard / Unset")

    ssd_type_raw = r.get("Type SSD (SATA/NVME)", "").strip().upper()
    ssd_type = "NVMe" if "NVME" in ssd_type_raw else ("SATA" if "SATA" in ssd_type_raw else (ssd_type_raw if ssd_type_raw else "-"))

    ssd_brand_raw = r.get("Merk SSD", "").strip().lower()
    ssd_brand = "Other"
    if "samsung" in ssd_brand_raw: ssd_brand = "Samsung"
    elif "kingston" in ssd_brand_raw: ssd_brand = "Kingston"
    elif "v-gen" in ssd_brand_raw or "vgen" in ssd_brand_raw: ssd_brand = "V-Gen"
    elif "midas" in ssd_brand_raw: ssd_brand = "MidasForce"
    elif "klevv" in ssd_brand_raw: ssd_brand = "Klevv"
    elif "wd" in ssd_brand_raw or "western" in ssd_brand_raw: ssd_brand = "Western Digital"
    elif "sandisk" in ssd_brand_raw: ssd_brand = "SanDisk"
    elif "crucial" in ssd_brand_raw: ssd_brand = "Crucial"
    elif "adata" in ssd_brand_raw: ssd_brand = "ADATA"
    elif ssd_brand_raw: ssd_brand = "Other Brand"

    ram_raw = r.get("Merek Ram", "").strip().lower()
    ram_brand = "Other"
    if "samsung" in ram_raw: ram_brand = "Samsung"
    elif "kingston" in ram_raw: ram_brand = "Kingston"
    elif "corsair" in ram_raw or "cmk" in ram_raw: ram_brand = "Corsair"
    elif "v-gen" in ram_raw or "vgen" in ram_raw: ram_brand = "V-Gen"
    elif "hynix" in ram_raw: ram_brand = "SK Hynix"
    elif "crucial" in ram_raw or "micron" in ram_raw: ram_brand = "Micron/Crucial"
    elif "klevv" in ram_raw: ram_brand = "Klevv"
    elif ram_raw: ram_brand = "Other Brand"

    mb_raw = r.get("Merek Motherboard", "").strip().lower()
    mb_brand = "Other"
    if "asus" in mb_raw: mb_brand = "ASUS"
    elif "gigabyte" in mb_raw: mb_brand = "Gigabyte"
    elif "msi" in mb_raw or "micro-star" in mb_raw: mb_brand = "MSI"
    elif "asrock" in mb_raw: mb_brand = "ASRock"
    elif "ecs" in mb_raw: mb_brand = "ECS"
    elif "biostar" in mb_raw: mb_brand = "Biostar"
    elif "intel" in mb_raw: mb_brand = "Intel"
    elif mb_raw: mb_brand = "Other Brand"

    cpu_raw = r.get("Processor", "").strip().lower()
    cpu_family = "Other CPU"
    if "core(tm) i7" in cpu_raw: cpu_family = "Intel Core i7"
    elif "core(tm) i5" in cpu_raw: cpu_family = "Intel Core i5"
    elif "core(tm) i3" in cpu_raw: cpu_family = "Intel Core i3"
    elif "pentium" in cpu_raw: cpu_family = "Intel Pentium"
    elif "celeron" in cpu_raw: cpu_family = "Intel Celeron"
    elif "ryzen" in cpu_raw: cpu_family = "AMD Ryzen"
    elif "xeon" in cpu_raw: cpu_family = "Intel Xeon"
    elif cpu_raw: cpu_family = "Other x86/ARM"

    records.append({
        "loc": loc,
        "code": r.get("Kode Unik Lokasi", "").strip(),
        "tier": tier,
        "host": host,
        "cat": dev_cat,
        "ip": r.get("IP local lokasi", "").strip(),
        "zt": r.get("IP ZT Lokasi", "").strip(),
        "sync": r.get("Last Sync", "").strip(),
        "agent": r.get("Agent Version", "").strip(),
        "cpu": r.get("Processor", "").strip(),
        "cpu_family": cpu_family,
        "ram": r.get("Total Ram", "").strip(),
        "ram_brand": ram_brand,
        "mb": r.get("Merek Motherboard", "").strip(),
        "mb_brand": mb_brand,
        "ssd_brand": ssd_brand,
        "ssd_type": ssd_type,
        "ssd_size": r.get("Size SSD", "").strip(),
        "ssd_health": ssd_h,
        "ssd_usage": ssd_u,
        "temp": temp_val,
        "os": r.get("OS Version", "").strip()
    })

print(f"Processed {len(records)} records")

# Save fleet.json
fleet_file = os.path.join(data_dir, "fleet.json")
with open(fleet_file, "w", encoding="utf-8") as f:
    json.dump(records, f, separators=(',', ':'))

unique_locs = len(set(r["loc"] for r in records))
tier_counts = Counter(r["tier"] for r in records)
cat_counts = Counter(r["cat"] for r in records)

overheats = sorted([r for r in records if r["temp"] is not None and r["temp"] >= 80], key=lambda x: x["temp"], reverse=True)
critical_ssd = sorted([r for r in records if r["ssd_health"] is not None and r["ssd_health"] < 70], key=lambda x: x["ssd_health"])
critical_storage = sorted([r for r in records if r["ssd_usage"] is not None and r["ssd_usage"] >= 85], key=lambda x: x["ssd_usage"], reverse=True)

loc_issues = Counter()
for r in overheats: loc_issues[r["loc"]] += 3
for r in critical_ssd: loc_issues[r["loc"]] += 2
for r in critical_storage: loc_issues[r["loc"]] += 2

top_problem_locs = []
for loc_name, score in loc_issues.most_common(12):
    loc_devs = [r for r in records if r["loc"] == loc_name]
    top_problem_locs.append({
        "loc": loc_name,
        "score": score,
        "tier": loc_devs[0]["tier"] if loc_devs else "Standard",
        "total_devs": len(loc_devs),
        "overheats": sum(1 for r in loc_devs if r["temp"] and r["temp"] >= 80),
        "critical_ssd": sum(1 for r in loc_devs if r["ssd_health"] and r["ssd_health"] < 70),
        "critical_storage": sum(1 for r in loc_devs if r["ssd_usage"] and r["ssd_usage"] >= 85)
    })

temp_ranges = {
    "< 50°C (Cool)": sum(1 for r in records if r["temp"] is not None and r["temp"] < 50),
    "50-69°C (Normal)": sum(1 for r in records if r["temp"] is not None and 50 <= r["temp"] < 70),
    "70-79°C (Warm)": sum(1 for r in records if r["temp"] is not None and 70 <= r["temp"] < 80),
    "80-89°C (Hot)": sum(1 for r in records if r["temp"] is not None and 80 <= r["temp"] < 90),
    ">= 90°C (Critical)": sum(1 for r in records if r["temp"] is not None and r["temp"] >= 90),
}

health_ranges = {
    ">= 95% (Pristine)": sum(1 for r in records if r["ssd_health"] is not None and r["ssd_health"] >= 95),
    "80-94% (Good)": sum(1 for r in records if r["ssd_health"] is not None and 80 <= r["ssd_health"] < 95),
    "70-79% (Warning)": sum(1 for r in records if r["ssd_health"] is not None and 70 <= r["ssd_health"] < 80),
    "< 70% (Degraded)": sum(1 for r in records if r["ssd_health"] is not None and r["ssd_health"] < 70),
}

usage_ranges = {
    "< 50% (Plenty)": sum(1 for r in records if r["ssd_usage"] is not None and r["ssd_usage"] < 50),
    "50-69% (Moderate)": sum(1 for r in records if r["ssd_usage"] is not None and 50 <= r["ssd_usage"] < 70),
    "70-84% (High)": sum(1 for r in records if r["ssd_usage"] is not None and 70 <= r["ssd_usage"] < 85),
    ">= 85% (Critical)": sum(1 for r in records if r["ssd_usage"] is not None and r["ssd_usage"] >= 85),
}

os_counter = Counter()
for r in records:
    os_name = r["os"]
    if "22.04" in os_name: os_counter["Ubuntu/ParkeeOS 22.04 LTS"] += 1
    elif "18.04" in os_name: os_counter["ParkeeOS 18.04 LTS"] += 1
    elif "20.04" in os_name: os_counter["Ubuntu 20.04 LTS"] += 1
    elif "24.04" in os_name: os_counter["Ubuntu 24.04 LTS"] += 1
    elif os_name: os_counter["Other Linux"] += 1
    else: os_counter["Unreported"] += 1

import datetime
summary = {
    "last_updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S WIB"),
    "total_devices": len(records),
    "unique_locations": unique_locs,
    "tier_counts": dict(tier_counts),
    "device_categories": dict(cat_counts),
    "cpu_families": dict(Counter(r["cpu_family"] for r in records if r["cpu_family"]).most_common(6)),
    "ssd_brands": dict(Counter(r["ssd_brand"] for r in records if r["ssd_brand"]).most_common(6)),
    "ram_brands": dict(Counter(r["ram_brand"] for r in records if r["ram_brand"]).most_common(6)),
    "mb_brands": dict(Counter(r["mb_brand"] for r in records if r["mb_brand"]).most_common(6)),
    "temp_stats": {
        "reported": sum(temp_ranges.values()),
        "overheat_count": len(overheats),
        "ranges": temp_ranges,
        "top_overheats": overheats[:12]
    },
    "ssd_health_stats": {
        "reported": sum(health_ranges.values()),
        "critical_count": len(critical_ssd),
        "ranges": health_ranges,
        "top_critical": critical_ssd[:12]
    },
    "ssd_usage_stats": {
        "reported": sum(usage_ranges.values()),
        "critical_count": len(critical_storage),
        "ranges": usage_ranges,
        "top_critical": critical_storage[:12]
    },
    "ssd_types": {
        "NVMe": sum(1 for r in records if r["ssd_type"] == "NVMe"),
        "SATA": sum(1 for r in records if r["ssd_type"] == "SATA"),
        "Other": sum(1 for r in records if r["ssd_type"] not in ["NVMe", "SATA"] and r["ssd_type"] != "-")
    },
    "os_distribution": dict(os_counter.most_common(6)),
    "top_problem_locations": top_problem_locs
}

summary_file = os.path.join(data_dir, "summary.json")
with open(summary_file, "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

js_file = os.path.join(js_dir, "summary-data.js")
with open(js_file, "w", encoding="utf-8") as f:
    f.write("window.PRECOMPUTED_SUMMARY = " + json.dumps(summary, indent=2) + ";\n")

print("Generated summary.json, fleet.json, and js/summary-data.js successfully!")
