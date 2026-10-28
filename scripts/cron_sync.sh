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
git checkout -- data/ js/ 2>/dev/null || true
git pull origin main >> "$LOG_FILE" 2>&1 || true

# 1. Run Python Google Sheet data sync (Locations, Servers, Clients, Summary)
/usr/bin/python3 sync_data.py >> "$LOG_FILE" 2>&1

# 2. Run Server Backup status check & Google Sheet update
# Note: GLPI Ticketing sync is already handled daily at 03:00 WIB by cron_ticket_sync.sh
/usr/bin/python3 scripts/check_server_backup.py >> "$LOG_FILE" 2>&1 || true

# 3. Stage only main-branch dataset files (excluding live temperature.json which lives on 'telemetry' branch)
SYNC_FILES="data/fleet.json data/servers.json data/locations.json data/summary.json data/server_backup.json data/server_backup_raw.json js/summary-data.js"

if [ -n "$(git status --porcelain $SYNC_FILES 2>/dev/null)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Detected changes in datasets. Committing and pushing..." >> "$LOG_FILE"
    git add $SYNC_FILES >> "$LOG_FILE" 2>&1
    git commit -m "chore(auto-sync): automated sync at $(date '+%Y-%m-%d %H:%M:%S WIB') from Google Sheet" >> "$LOG_FILE" 2>&1
    git push origin main >> "$LOG_FILE" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Successfully pushed update to origin/main!" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] No changes in dataset. Nothing to commit." >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Dashboard Sync Completed." >> "$LOG_FILE"
