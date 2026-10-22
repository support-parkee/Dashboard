#!/usr/bin/env python3
"""
cron_guard.py - Universal Cron Failure Guard & WhatsApp Alert Notifier
Usage:
  python3 cron_guard.py --name "Job Name" [--log /path/to/log] -- <command> [args...]
If the command fails (exit code != 0 or exception), an alert is queued to
/home/admin-adg/agy-whatsapp-bot/reminders.json for WhatsApp delivery to Azkia (124107442098197@lid).
"""

import sys
import os
import subprocess
import json
import time
from datetime import datetime, timezone, timedelta

WIB = timezone(timedelta(hours=7))
REMINDERS_FILE = "/home/admin-adg/agy-whatsapp-bot/reminders.json"
TARGET_CHAT_ID = "124107442098197@lid"

def send_wa_alert(job_name, cmd_str, return_code, error_snippet):
    now = datetime.now(WIB)
    now_ts_ms = int(time.time() * 1000)
    rem_id = f"cron_fail_{int(now_ts_ms)}"
    
    clean_snippet = error_snippet.strip() if error_snippet else "Tidak ada output error tertangkap."
    if len(clean_snippet) > 800:
        clean_snippet = clean_snippet[-800:] + "\n...(dipotong)"

    msg = (
        f"🚨 *CRON JOB GAGAL / ERROR (admin-adg)* 🚨\n\n"
        f"⚠️ *Job:* {job_name}\n"
        f"💻 *Host:* admin-adg (100.123.138.90)\n"
        f"⏰ *Waktu:* {now.strftime('%Y-%m-%d %H:%M:%S WIB')}\n"
        f"❌ *Exit Code:* {return_code}\n\n"
        f"📝 *Perintah:*\n`{cmd_str}`\n\n"
        f"📋 *Rincian Log / Error:*\n"
        f"```\n{clean_snippet}\n```\n\n"
        f"_Notifikasi otomatis dari System Cron Guard admin-adg_"
    )

    new_reminder = {
        "id": rem_id,
        "chatId": TARGET_CHAT_ID,
        "targetTime": now.strftime("%Y-%m-%d %H:%M:%S WIB"),
        "targetTimestamp": now_ts_ms,
        "message": msg,
        "sender": "System Cron Guard",
        "status": "pending",
        "createdAt": now.strftime("%Y-%m-%d %H:%M:%S WIB")
    }

    try:
        reminders = []
        if os.path.exists(REMINDERS_FILE):
            with open(REMINDERS_FILE, "r", encoding="utf-8") as f:
                reminders = json.load(f)
        reminders.append(new_reminder)
        with open(REMINDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(reminders, f, indent=2, ensure_ascii=False)
        print(f"[CRON_GUARD] WA alert queued successfully to {TARGET_CHAT_ID}: {rem_id}", file=sys.stderr)
    except Exception as e:
        print(f"[CRON_GUARD] Failed to enqueue WA alert: {e}", file=sys.stderr)

def main():
    args = sys.argv[1:]
    job_name = "Unnamed Cron Job"
    log_file = None
    cmd = []

    i = 0
    while i < len(args):
        if args[i] == "--name" and i + 1 < len(args):
            job_name = args[i + 1]
            i += 2
        elif args[i] == "--log" and i + 1 < len(args):
            log_file = args[i + 1]
            i += 2
        elif args[i] == "--":
            cmd = args[i + 1:]
            break
        else:
            cmd = args[i:]
            break

    if not cmd:
        print("Usage: cron_guard.py --name 'Job Name' [--log /path/to/log] -- <command>", file=sys.stderr)
        sys.exit(1)

    cmd_str = " ".join(cmd)
    env = os.environ.copy()
    env["PATH"] = f"/home/admin-adg/.local/bin:{env.get('PATH', '/usr/local/bin:/usr/bin:/bin')}"

    # Execute the command
    try:
        res = subprocess.run(cmd, env=env)
        rc = res.returncode
    except Exception as exc:
        rc = 1
        send_wa_alert(job_name, cmd_str, rc, str(exc))
        sys.exit(rc)

    if rc != 0:
        error_snippet = ""
        if log_file and os.path.exists(log_file):
            try:
                with open(log_file, "r", encoding="utf-8", errors="ignore") as lf:
                    lines = lf.readlines()
                    error_snippet = "".join(lines[-25:])
            except Exception as le:
                error_snippet = f"Gagal membaca log {log_file}: {le}"
        send_wa_alert(job_name, cmd_str, rc, error_snippet)
        sys.exit(rc)

    sys.exit(0)

if __name__ == "__main__":
    main()
