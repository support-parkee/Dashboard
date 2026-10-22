#!/usr/bin/env bash
set -e

REPO_DIR="/home/admin-adg/dashboard-server-client"
LOG_FILE="/home/admin-adg/ticket_sync_cron.log"
TARGET_REPO="https://github.com/support-parkee/Dashboard.git"

echo "==================================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Starting Daily GLPI Ticketing Sync (03:00 WIB)..." >> "$LOG_FILE"

cd "$REPO_DIR"

# Ensure remote points to support-parkee/Dashboard
git remote set-url origin "$TARGET_REPO" >> "$LOG_FILE" 2>&1 || true

# Clean any working tree noise and pull latest
git checkout -- . 2>/dev/null || true
git pull origin main >> "$LOG_FILE" 2>&1 || true

# Run Python GLPI fetch and processing script (last 3 months)
/usr/bin/python3 scripts/fetch_tickets.py >> "$LOG_FILE" 2>&1

# Check if data/tickets.json or data/tickets_summary.json changed
if [ -n "$(git status --porcelain data/tickets.json data/tickets_summary.json)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Detected ticket updates. Committing and pushing to origin/main..." >> "$LOG_FILE"
    git add data/tickets.json data/tickets_summary.json >> "$LOG_FILE" 2>&1
    git commit -m "chore(tickets): daily 3-month GLPI ticket sync at $(date '+%Y-%m-%d %H:%M:%S WIB')" >> "$LOG_FILE" 2>&1
    git push origin main >> "$LOG_FILE" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Successfully pushed tickets update to GitHub Pages!" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] No new ticket data changes detected." >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Ticketing Sync Completed." >> "$LOG_FILE"
