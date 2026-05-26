#!/usr/bin/env bash
# =============================================================================
# setup_launchd.sh
# Generates a ready-to-use launchd plist with correct absolute paths and
# registers it so the script runs automatically every day at 18:00 UK time.
#
# IMPORTANT: Your Mac must be set to UK timezone (System Settings → General
#            → Language & Region → Time Zone → London) for the 6 PM schedule
#            to fire at the correct UK local time.
#
# Usage:
#   chmod +x setup_launchd.sh
#   ./setup_launchd.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/venv/bin/python"
LABEL="com.attendance.automation"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$SCRIPT_DIR/logs"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
if [[ ! -f "$VENV_PYTHON" ]]; then
    echo "ERROR: Virtual environment not found at $VENV_PYTHON"
    echo "       Run: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

if [[ ! -f "$SCRIPT_DIR/main.py" ]]; then
    echo "ERROR: main.py not found in $SCRIPT_DIR"
    exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# ── Write the plist with real paths substituted in ───────────────────────────
cat > "$PLIST_DEST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$VENV_PYTHON</string>
        <string>$SCRIPT_DIR/main.py</string>
    </array>

    <!-- Run daily at 18:00 UK local time (GMT/BST — Mac must be set to London timezone) -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>18</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/launchd_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/launchd_stderr.log</string>

    <key>RunAtLoad</key>
    <false/>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
EOF

echo "Plist written → $PLIST_DEST"

# ── Unload old job if already registered (handles re-runs of this script) ────
if launchctl list | grep -q "$LABEL" 2>/dev/null; then
    echo "Unloading previous job…"
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# ── Register the job ──────────────────────────────────────────────────────────
launchctl load "$PLIST_DEST"
echo ""
echo "Scheduler registered successfully!"
echo ""
echo "Verification:"
launchctl list | grep "$LABEL" || echo "(not visible in list yet — this is normal)"
echo ""
echo "The script will run every day at 18:00 UK time (GMT/BST)."
echo "To test immediately: launchctl start $LABEL"
echo "To stop:             launchctl unload $PLIST_DEST"
echo "Logs: $LOG_DIR/"
