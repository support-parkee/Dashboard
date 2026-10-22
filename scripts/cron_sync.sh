#!/usr/bin/env bash
set -e

REPO_DIR="/home/admin-adg/dashboard-server-client"
LOG_FILE="/home/admin-adg/dashboard_sync_cron.log"
TARGET_REPO="https://github.com/support-parkee/Dashboard.git"

echo "==================================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Starting Dashboard Sync..." >> "$LOG_FILE"

cd "$REPO_DIR"

# Ensure remote points to support-parkee/Dashboard
git remote set-url origin "$TARGET_REPO" >> "$LOG_FILE" 2>&1 || true

# Clean any working tree noise and pull latest
git checkout -- . 2>/dev/null || true
git pull origin main >> "$LOG_FILE" 2>&1 || true

# Run Python data sync
/usr/bin/python3 sync_data.py >> "$LOG_FILE" 2>&1

# Run GLPI Ticketing sync (last 3 months)
/usr/bin/python3 scripts/fetch_tickets.py >> "$LOG_FILE" 2>&1

# Check if data or summary-data changed
if [ -n "$(git status --porcelain data js/summary-data.js)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Detected changes in datasets. Committing and pushing..." >> "$LOG_FILE"
    git add data/ js/summary-data.js >> "$LOG_FILE" 2>&1
    git commit -m "chore(auto-sync): automated sync at $(date '+%Y-%m-%d %H:%M:%S WIB') from Google Sheet" >> "$LOG_FILE" 2>&1
    git push origin main >> "$LOG_FILE" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Successfully pushed update to origin/main!" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] No changes in dataset. Nothing to commit." >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Dashboard Sync Completed." >> "$LOG_FILE"
