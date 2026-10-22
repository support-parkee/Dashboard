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

# 3. Setup separate telemetry branch directory if not exists
if [ ! -d "$TELEMETRY_DIR/.git" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Initializing telemetry branch directory..." >> "$LOG_FILE"
    rm -rf "$TELEMETRY_DIR"
    mkdir -p "$TELEMETRY_DIR"
    cd "$TELEMETRY_DIR"
    git init -b telemetry >> "$LOG_FILE" 2>&1
    git remote add origin https://github.com/azkiabenington/dashboard-server-client.git >> "$LOG_FILE" 2>&1
    git config user.name "azkiabenington"
    git config user.email "azkiabenington12@gmail.com"
fi

cd "$TELEMETRY_DIR"
cp "$TEMP_FILE" "$TELEMETRY_DIR/temperature.json"

# 4. Single-Commit Force Push (Ensures branch telemetry has only 1 clean commit)
git add temperature.json >> "$LOG_FILE" 2>&1
git commit -m "chore(telemetry): live temperature cache at $(date '+%Y-%m-%d %H:%M:%S WIB')" >> "$LOG_FILE" 2>&1 || git commit --amend -m "chore(telemetry): live temperature cache at $(date '+%Y-%m-%d %H:%M:%S WIB')" >> "$LOG_FILE" 2>&1
git push --force origin telemetry >> "$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S WIB')] Telemetry branch updated successfully with 1 single commit!" >> "$LOG_FILE"
