#!/usr/bin/env python3
"""
GLPI Ticket Fetcher and Processor for PARKEE Support Apps Dashboard.
Connects to https://parkee-ticket.nusa.technology, authenticates with Obscura/Requests,
filters tickets from the last 3 months, exports all pages CSV, and outputs
compact, structured data to data/tickets.json and data/tickets_summary.json.
"""

import os
import sys
import re
import csv
import io
import json
import subprocess
from datetime import datetime, timedelta
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://parkee-ticket.nusa.technology"
USERNAME = "hafizh.prasetya"
PASSWORD = "support545115"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "tickets_3months.csv")
JSON_PATH = os.path.join(DATA_DIR, "tickets.json")

def parse_glpi_date(dt_str):
    if not dt_str or not dt_str.strip():
        return ""
    dt_str = dt_str.strip()
    # Format typically: "22-10-2026 10:58" or "2026-10-22 10:58:00"
    for fmt in ("%d-%m-%Y %H:%M", "%d-%m-%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            d = datetime.strptime(dt_str, fmt)
            return d.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    return dt_str

def extract_location(title, desc, loc_col):
    if loc_col and loc_col.strip():
        return loc_col.strip()
    # Check title pipe: "issue description | Mall Taman Anggrek"
    if "|" in title:
        parts = title.split("|")
        candidate = parts[-1].strip()
        # Remove any trailing "Loading..." from GLPI
        candidate = re.sub(r'Loading\.\.\.?$', '', candidate).strip()
        if candidate and len(candidate) > 2:
            return candidate
    # Check description for "Location: ..."
    if desc:
        m = re.search(r'Location:\s*([^\n\r]+)', desc, re.I)
        if m:
            candidate = m.group(1).strip()
            if candidate:
                return candidate
    return "-"

def login_glpi(session):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Authenticating to GLPI ({BASE_URL})...")
    # Optional test if obscura exists and can dump cookies
    obscura_bin = "/home/admin-adg/.local/bin/obscura"
    if os.path.exists(obscura_bin):
        try:
            print("Verifying obscura availability...")
            # quick version check
            subprocess.run([obscura_bin, "-V"], capture_output=True, timeout=5)
        except Exception as e:
            print(f"Obscura check notice: {e}")

    r = session.get(f"{BASE_URL}/index.php", timeout=15)
    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form")
    if not form:
        raise RuntimeError("GLPI login form not found on index.php")

    login_input = form.find("input", id="login_name")
    password_input = form.find("input", id="login_password")
    csrf_input = form.find("input", {"name": "_glpi_csrf_token"})

    data = {}
    for inp in form.find_all("input"):
        n = inp.get("name")
        v = inp.get("value", "")
        if n:
            data[n] = v

    data[login_input["name"]] = USERNAME
    data[password_input["name"]] = PASSWORD
    if csrf_input:
        data["_glpi_csrf_token"] = csrf_input["value"]

    select_auth = form.find("select", {"name": "auth"})
    if select_auth and select_auth.find("option"):
        data["auth"] = select_auth.find("option").get("value", "local")

    action = form.get("action", "/front/login.php")
    if not action.startswith("http"):
        action = BASE_URL + ("/" if not action.startswith("/") else "") + action

    res = session.post(action, data=data, timeout=20, allow_redirects=True)
    if "front/central.php" in res.url or "front/ticket.php" in res.url or "hafizh" in res.text.lower():
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Login successful! Session established.")
        return True
    else:
        raise RuntimeError(f"Login failed. Final URL: {res.url}")

def fetch_3month_csv(session):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Requesting chunked CSV export for last 90 days...")

    # Windows of 30 days to avoid GLPI PHP memory exhaustion (which throws HTTP 500 on >40 days)
    windows = [
        (0, 30),
        (30, 60),
        (60, 90)
    ]

    all_ticket_rows = []
    header = None
    seen_ids = set()

    for i, (day_end, day_start) in enumerate(windows):
        dt_start = (datetime.now() - timedelta(days=day_start)).strftime("%Y-%m-%d")
        dt_end = (datetime.now() - timedelta(days=day_end)).strftime("%Y-%m-%d")

        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Fetching Window {i+1}/3: {dt_start} to {dt_end}...")

        params = {
            "item_type": "Ticket",
            "sort[0]": "15",
            "order[0]": "DESC",
            "start": "0",
            "criteria[0][field]": "15",
            "criteria[0][searchtype]": "morethan",
            "criteria[0][value]": f"{dt_start} 00:00:00",
            "display_type": "-3"
        }
        if day_end > 0:
            params["criteria[1][link]"] = "AND"
            params["criteria[1][field]"] = "15"
            params["criteria[1][searchtype]"] = "lessthan"
            params["criteria[1][value]"] = f"{dt_end} 00:00:00"

        export_url = f"{BASE_URL}/front/report.dynamic.php"
        try:
            res = session.get(export_url, params=params, timeout=120)
            if res.status_code != 200:
                print(f"Window {i+1} failed with HTTP {res.status_code}. Attempting smaller 15-day sub-chunks...")
                mid_days = (day_start + day_end) // 2
                for sub_end, sub_start in [(day_end, mid_days), (mid_days, day_start)]:
                    sub_dt_start = (datetime.now() - timedelta(days=sub_start)).strftime("%Y-%m-%d")
                    sub_dt_end = (datetime.now() - timedelta(days=sub_end)).strftime("%Y-%m-%d")
                    sub_params = {
                        "item_type": "Ticket",
                        "sort[0]": "15",
                        "order[0]": "DESC",
                        "start": "0",
                        "criteria[0][field]": "15",
                        "criteria[0][searchtype]": "morethan",
                        "criteria[0][value]": f"{sub_dt_start} 00:00:00",
                        "display_type": "-3"
                    }
                    if sub_end > 0:
                        sub_params["criteria[1][link]"] = "AND"
                        sub_params["criteria[1][field]"] = "15"
                        sub_params["criteria[1][searchtype]"] = "lessthan"
                        sub_params["criteria[1][value]"] = f"{sub_dt_end} 00:00:00"
                    sub_res = session.get(export_url, params=sub_params, timeout=90)
                    if sub_res.status_code == 200:
                        reader = csv.reader(io.StringIO(sub_res.text), delimiter=';')
                        sub_header = next(reader, None)
                        if not header and sub_header:
                            header = sub_header
                        for row in reader:
                            if row and len(row) > 1:
                                tid = row[0].replace(' ', '').replace('"', '').strip()
                                if tid and tid not in seen_ids:
                                    seen_ids.add(tid)
                                    all_ticket_rows.append(row)
                continue

            reader = csv.reader(io.StringIO(res.text), delimiter=';')
            chunk_header = next(reader, None)
            if not header and chunk_header:
                header = chunk_header

            chunk_count = 0
            for row in reader:
                if row and len(row) > 1:
                    tid = row[0].replace(' ', '').replace('"', '').strip()
                    if tid and tid not in seen_ids:
                        seen_ids.add(tid)
                        all_ticket_rows.append(row)
                        chunk_count += 1
            print(f"Window {i+1} fetched: {chunk_count:,} unique tickets (Total unique so far: {len(all_ticket_rows):,})")
        except Exception as e:
            print(f"Error fetching window {i+1}: {e}")

    if not all_ticket_rows:
        raise RuntimeError("No tickets could be fetched from GLPI across any window.")

    # Write combined CSV
    os.makedirs(DATA_DIR, exist_ok=True)
    out_io = io.StringIO()
    writer = csv.writer(out_io, delimiter=';')
    if header:
        writer.writerow(header)
    for r in all_ticket_rows:
        writer.writerow(r)

    combined_csv_text = out_io.getvalue()
    with open(CSV_PATH, "w", encoding="utf-8") as f:
        f.write(combined_csv_text)

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Saved combined CSV with {len(all_ticket_rows):,} tickets ({len(combined_csv_text):,} bytes) to {CSV_PATH}")
    return combined_csv_text

def process_tickets_csv(csv_text=None):
    if csv_text is None:
        if not os.path.exists(CSV_PATH):
            raise FileNotFoundError(f"CSV file not found at {CSV_PATH}")
        with open(CSV_PATH, "r", encoding="utf-8") as f:
            csv_text = f.read()

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Parsing tickets CSV...")
    reader = csv.reader(io.StringIO(csv_text), delimiter=';')
    try:
        raw_headers = next(reader)
    except StopIteration:
        print("Empty CSV file!")
        return

    # Clean headers (remove BOM and strip quotes)
    headers = [h.replace('\ufeff', '').strip('"').strip() for h in raw_headers]
    print("CSV Headers:", headers)

    col_map = {}
    for idx, h in enumerate(headers):
        clean_h = h.lower()
        if "id" == clean_h:
            col_map["id"] = idx
        elif "title" in clean_h:
            col_map["title"] = idx
        elif "opening date" in clean_h:
            col_map["opening_date"] = idx
        elif "resolution date" in clean_h:
            col_map["resolution_date"] = idx
        elif "closing date" in clean_h:
            col_map["closing_date"] = idx
        elif "last update" in clean_h:
            col_map["last_update"] = idx
        elif "status" in clean_h:
            col_map["status"] = idx
        elif "priority" in clean_h:
            col_map["priority"] = idx
        elif "assigned to - technician" in clean_h and "group" not in clean_h:
            col_map["technician"] = idx
        elif "requester - requester" in clean_h:
            col_map["requester"] = idx
        elif "category" in clean_h:
            col_map["category"] = idx
        elif "locations" in clean_h:
            col_map["locations"] = idx
        elif "urgency" in clean_h:
            col_map["urgency"] = idx
        elif "request sources" in clean_h:
            col_map["source"] = idx
        elif "description" in clean_h:
            col_map["desc"] = idx

    tickets = []
    status_counts = {
        "New": 0,
        "Processing": 0,
        "Processing (assigned)": 0,
        "Processing (planned)": 0,
        "Solved": 0,
        "Closed": 0,
        "Pending": 0,
        "Other": 0
    }
    priority_counts = {"P0": 0, "P1": 0, "P2": 0, "P3": 0, "P4": 0, "Other": 0}
    location_counts = {}
    category_counts = {}
    technician_counts = {}

    for row in reader:
        if not row or len(row) < 3:
            continue

        raw_id = row[col_map["id"]].replace(' ', '').strip() if "id" in col_map and col_map["id"] < len(row) else ""
        if not raw_id:
            continue

        raw_title = row[col_map["title"]].strip() if "title" in col_map and col_map["title"] < len(row) else ""
        raw_status = row[col_map["status"]].strip() if "status" in col_map and col_map["status"] < len(row) else ""
        raw_priority = row[col_map["priority"]].strip() if "priority" in col_map and col_map["priority"] < len(row) else ""
        raw_tech = row[col_map["technician"]].strip() if "technician" in col_map and col_map["technician"] < len(row) else ""
        raw_req = row[col_map["requester"]].strip() if "requester" in col_map and col_map["requester"] < len(row) else ""
        raw_cat = row[col_map["category"]].strip() if "category" in col_map and col_map["category"] < len(row) else ""
        raw_loc = row[col_map["locations"]].strip() if "locations" in col_map and col_map["locations"] < len(row) else ""
        raw_src = row[col_map["source"]].strip() if "source" in col_map and col_map["source"] < len(row) else ""
        raw_desc = row[col_map["desc"]].strip() if "desc" in col_map and col_map["desc"] < len(row) else ""

        open_dt = parse_glpi_date(row[col_map["opening_date"]]) if "opening_date" in col_map and col_map["opening_date"] < len(row) else ""
        close_dt = parse_glpi_date(row[col_map["closing_date"]]) if "closing_date" in col_map and col_map["closing_date"] < len(row) else ""
        resolve_dt = parse_glpi_date(row[col_map["resolution_date"]]) if "resolution_date" in col_map and col_map["resolution_date"] < len(row) else ""
        update_dt = parse_glpi_date(row[col_map["last_update"]]) if "last_update" in col_map and col_map["last_update"] < len(row) else ""

        loc = extract_location(raw_title, raw_desc, raw_loc)

        # Normalize status (Differentiate Processing planned vs assigned)
        st_norm = "Other"
        if "closed" in raw_status.lower():
            st_norm = "Closed"
        elif "planned" in raw_status.lower():
            st_norm = "Processing (planned)"
        elif "process" in raw_status.lower() or "assign" in raw_status.lower():
            st_norm = "Processing (assigned)"
        elif "solved" in raw_status.lower():
            st_norm = "Solved"
        elif "new" in raw_status.lower():
            st_norm = "New"
        elif "pending" in raw_status.lower() or "waiting" in raw_status.lower():
            st_norm = "Pending"

        status_counts[st_norm] = status_counts.get(st_norm, 0) + 1
        if st_norm.startswith("Processing"):
            status_counts["Processing"] = status_counts.get("Processing", 0) + 1

        # Normalize priority
        prio_norm = raw_priority if raw_priority in ["P0", "P1", "P2", "P3", "P4"] else "Other"
        priority_counts[prio_norm] = priority_counts.get(prio_norm, 0) + 1

        # Track location counts
        if loc and loc != "-":
            location_counts[loc] = location_counts.get(loc, 0) + 1

        # Track category
        cat_short = raw_cat.split(">")[-1].strip() if raw_cat else "Uncategorized"
        if raw_cat:
            category_counts[cat_short] = category_counts.get(cat_short, 0) + 1

        # Track technician
        if raw_tech:
            technician_counts[raw_tech] = technician_counts.get(raw_tech, 0) + 1

        # Clean title without trailing Loading...
        clean_title = re.sub(r'Loading\.\.\.?$', '', raw_title).strip()

        # Breakdown Category (Product, Kategori Issue, Sub-Kategori)
        cat_full_clean = raw_cat.strip() if raw_cat else ""
        cat_parts = [p.strip() for p in cat_full_clean.split(">") if p.strip()] if cat_full_clean else []
        if len(cat_parts) >= 2:
            prod_val = cat_parts[0]
            cat_issue_val = cat_parts[1]
            sub_issue_val = cat_parts[2] if len(cat_parts) > 2 else ""
        elif len(cat_parts) == 1:
            prod_val = cat_parts[0]
            cat_issue_val = cat_parts[0]
            sub_issue_val = ""
        else:
            prod_val = "Uncategorized"
            cat_issue_val = "Uncategorized"
            sub_issue_val = ""

        # Calculate Durasi Solving: Resolution Date - Opening Date
        # (jika resolution date kosong di = dengan opening date nya saja = 0:00:00)
        dur_solving = "0:00:00"
        dur_seconds = 0
        if open_dt and resolve_dt:
            try:
                d_open = datetime.strptime(open_dt, "%Y-%m-%d %H:%M")
                d_res = datetime.strptime(resolve_dt, "%Y-%m-%d %H:%M")
                sec_diff = int((d_res - d_open).total_seconds())
                if sec_diff > 0:
                    dur_seconds = sec_diff
                    h = sec_diff // 3600
                    m = (sec_diff % 3600) // 60
                    s = sec_diff % 60
                    dur_solving = f"{h}:{m:02d}:{s:02d}"
            except Exception:
                dur_solving = "0:00:00"

        # Brief description snippet (first 140 chars)
        desc_snippet = re.sub(r'\s+', ' ', raw_desc[:160]).strip() if raw_desc else ""

        ticket_item = {
            "id": raw_id,
            "title": clean_title,
            "loc": loc,
            "status": st_norm,
            "status_raw": raw_status,
            "priority": prio_norm,
            "tech": raw_tech or "-",
            "req": raw_req or "-",
            "product": prod_val,
            "cat_issue": cat_issue_val,
            "sub_issue": sub_issue_val,
            "cat": cat_issue_val,
            "cat_full": raw_cat,
            "open_date": open_dt,
            "close_date": close_dt,
            "resolve_date": resolve_dt,
            "dur_solving": dur_solving,
            "dur_seconds": dur_seconds,
            "last_update": update_dt,
            "source": raw_src or "-",
            "desc": desc_snippet
        }
        tickets.append(ticket_item)

    # Sort tickets by opening date DESC
    tickets.sort(key=lambda t: t.get("open_date", ""), reverse=True)

    # Prepare top stats
    top_locs = sorted([{"name": k, "count": v} for k, v in location_counts.items()], key=lambda x: -x["count"])[:10]
    top_cats = sorted([{"name": k, "count": v} for k, v in category_counts.items()], key=lambda x: -x["count"])[:10]
    top_techs = sorted([{"name": k, "count": v} for k, v in technician_counts.items()], key=lambda x: -x["count"])[:10]

    output_payload = {
        "meta": {
            "title": "PARKEE GLPI Ticketing (Last 3 Months)",
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S WIB"),
            "source": BASE_URL,
            "total_tickets": len(tickets),
            "date_range_days": 90
        },
        "stats": {
            "total": len(tickets),
            "closed": status_counts.get("Closed", 0),
            "processing": status_counts.get("Processing", 0),
            "processing_assigned": status_counts.get("Processing (assigned)", 0),
            "processing_planned": status_counts.get("Processing (planned)", 0),
            "new": status_counts.get("New", 0),
            "solved": status_counts.get("Solved", 0),
            "pending": status_counts.get("Pending", 0),
            "priority": priority_counts,
            "top_locations": top_locs,
            "top_categories": top_cats,
            "top_technicians": top_techs
        },
        "tickets": tickets
    }

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, separators=(',', ':'))

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Successfully processed {len(tickets)} tickets!")
    print(f"Saved compact JSON to {JSON_PATH} ({os.path.getsize(JSON_PATH):,} bytes)")

    # Also save a tiny lightweight summary file for fast dashboard overview
    summary_path = os.path.join(DATA_DIR, "tickets_summary.json")
    critical_tickets = [t for t in tickets if t.get("priority") in ("P0", "P1")]
    summary_payload = {
        "meta": output_payload["meta"],
        "stats": output_payload["stats"],
        "critical_tickets": critical_tickets,
        "recent_tickets": tickets[:50]
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary_payload, f, separators=(",", ":"))
    print(f"Saved lightweight summary to {summary_path}")

    return output_payload

def main():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    })

    # If --parse-only is passed, don't download again
    if "--parse-only" in sys.argv:
        process_tickets_csv()
        return

    try:
        login_glpi(s)
        csv_text = fetch_3month_csv(s)
        process_tickets_csv(csv_text)
    except Exception as e:
        print(f"Error during GLPI ticket fetch: {e}", file=sys.stderr)
        # If fetch failed but we have cached CSV, process it
        if os.path.exists(CSV_PATH):
            print("Falling back to local CSV cache...")
            process_tickets_csv()
        else:
            sys.exit(1)

if __name__ == "__main__":
    main()
