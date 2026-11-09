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
git fetch origin main >> "$LOG_FILE" 2>&1 || true
git reset --hard origin/main >> "$LOG_FILE" 2>&1 || true

# Run Python GLPI fetch and processing script (last 3 months)
/usr/bin/python3 scripts/fetch_tickets.py >> "$LOG_FILE" 2>&1

# Check if data/tickets.json or data/tickets_summary.json changed
if [ -n "$(git status --porcelain data/tickets.json data/tickets_summary.json)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Detected ticket updates. Consolidating into 1 single chore(auto-sync) commit..." >> "$LOG_FILE"
    git add data/tickets.json data/tickets_summary.json >> "$LOG_FILE" 2>&1
    /usr/bin/python3 scripts/collapse_chore_commit.py "chore(auto-sync): automated dataset & GLPI ticket sync at $(date '+%Y-%m-%d %H:%M:%S WIB')" >> "$LOG_FILE" 2>&1

    PUSH_SUCCESS=0
    for attempt in 1 2 3; do
        if git push --force origin main >> "$LOG_FILE" 2>&1; then
            PUSH_SUCCESS=1
            echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Successfully pushed single-commit tickets update to GitHub Pages (attempt $attempt)!" >> "$LOG_FILE"
            break
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Git push failed on attempt $attempt/3. Retrying in $((attempt * 5))s..." >> "$LOG_FILE"
            sleep $((attempt * 5))
        fi
    done

    if [ "$PUSH_SUCCESS" -ne 1 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Error: Git push failed after 3 attempts." >> "$LOG_FILE"
        exit 1
    fi

    git gc --prune=now --quiet >> "$LOG_FILE" 2>&1 || true
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] No new ticket data changes detected." >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Ticketing Sync Completed." >> "$LOG_FILE"
