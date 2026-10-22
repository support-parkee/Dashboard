#!/usr/bin/env bash
set -e

MAIN_REPO="/home/admin-adg/dashboard-server-client"
TELEMETRY_DIR="/home/admin-adg/dashboard-telemetry-worktree"
LOG_FILE="/home/admin-adg/telemetry_cron.log"

echo "==================================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Running Temperature Telemetry Fetch..." >> "$LOG_FILE"

# 1. Run Python fetch script in main repo
cd "$MAIN_REPO"
/usr/bin/python3 scripts/fetch_grafana_temp.py >> "$LOG_FILE" 2>&1

# 2. Check if data/temperature.json was produced
TEMP_FILE="$MAIN_REPO/data/temperature.json"
if [ ! -f "$TEMP_FILE" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Error: $TEMP_FILE not found." >> "$LOG_FILE"
    exit 1
fi

TARGET_REPO="https://github.com/support-parkee/Dashboard.git"

# 3. Setup separate telemetry branch directory if not exists
if [ ! -d "$TELEMETRY_DIR/.git" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Initializing telemetry branch directory..." >> "$LOG_FILE"
    rm -rf "$TELEMETRY_DIR"
    mkdir -p "$TELEMETRY_DIR"
    cd "$TELEMETRY_DIR"
    git init -b telemetry >> "$LOG_FILE" 2>&1
    git remote add origin "$TARGET_REPO" >> "$LOG_FILE" 2>&1
    git config user.name "support-parkee"
    git config user.email "support@parkee.app"
    cp "$TEMP_FILE" "$TELEMETRY_DIR/temperature.json"
    git add temperature.json >> "$LOG_FILE" 2>&1
    git commit -m "chore(telemetry): live temperature cache at $(date '+%Y-%m-%d %H:%M:%S WIB')" >> "$LOG_FILE" 2>&1
else
    cd "$TELEMETRY_DIR"
    # Ensure remote points to support-parkee/Dashboard
    git remote set-url origin "$TARGET_REPO" >> "$LOG_FILE" 2>&1 || git remote add origin "$TARGET_REPO" >> "$LOG_FILE" 2>&1
    cp "$TEMP_FILE" "$TELEMETRY_DIR/temperature.json"
    git add temperature.json >> "$LOG_FILE" 2>&1
    # Always amend so that the branch history remains exactly 1 single commit
    git commit --amend -m "chore(telemetry): live temperature cache at $(date '+%Y-%m-%d %H:%M:%S WIB')" >> "$LOG_FILE" 2>&1
fi

# 4. Force Push the single commit
git push --force origin telemetry >> "$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Telemetry branch updated successfully with 1 single commit!" >> "$LOG_FILE"
