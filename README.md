# Attendance Automation

A production-ready Python automation script for macOS that logs into **DoLynk Pro**, exports the daily attendance report, and uploads it directly into a **Google Sheet** — automatically every day at **6:00 PM UK time**.

No files are saved locally. The data flows straight from DoLynk Pro → Google Sheets.

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Script](#running-the-script)
- [Automatic Daily Scheduling](#automatic-daily-scheduling)
- [Logs](#logs)
- [Troubleshooting](#troubleshooting)

---

## Features

- Headless browser automation using **Playwright + Chromium**
- Handles cookie banners, terms checkboxes, and privacy popups automatically
- Uploads attendance data directly into a specified Google Sheets tab
- Clears previous data and replaces with fresh records on every run
- No local files saved — downloads to temp memory, uploads, cleans up
- Retry logic with exponential backoff for login failures
- Daily deduplication — skips if already run successfully today
- All credentials stored securely in a single `config.yml` file
- Full logging with automatic daily log rotation

---

## How It Works

```
Mac runs script at 6:00 PM UK time (via launchd)
            │
            ▼
  Launch headless Chromium
            │
            ▼
  Log into pro.dolynkcloud.com
  (handles cookie banner, terms checkbox, privacy modal)
            │
            ▼
  Navigate to Access Records page
            │
            ▼
  Click Export → confirm → receive xlsx file
            │
            ▼
  Skip header row → upload 300+ rows to Google Sheets
  (clears existing data in "Records" tab first)
            │
            ▼
  Delete temp file → write success marker → done
```

---

## Project Structure

```
attendance_automation/
│
├── main.py                      # Core automation script
├── config.yml                   # All credentials and settings (DO NOT COMMIT)
├── config.yml.example           # Safe template — copy this to config.yml
├── requirements.txt             # Python dependencies
├── setup_launchd.sh             # One-command scheduler installer
├── attendance_scheduler.plist   # launchd job template
├── .gitignore
│
├── logs/                        # Daily log files (auto-created)
│   ├── 2026_05_25.log
│   ├── launchd_stdout.log
│   └── launchd_stderr.log
│
└── venv/                        # Python virtual environment (auto-created)
```

> **Note:** `config.yml` and `*.json` (Google API key) are listed in `.gitignore` and will never be committed.

---

## Prerequisites

- macOS 12 or later
- Python 3.9 or later — check with `python3 --version`
- A Google Service Account JSON key with access to your Google Sheet
- The target Google Sheet shared with the service account email

---

## Installation

### Step 1 — Clone or copy the project

```bash
cd "/Users/raghulsekar/Desktop/claude/claude code/attendance_automation"
```

### Step 2 — Create a Python virtual environment

```bash
python3 -m venv venv
```

### Step 3 — Activate the virtual environment

```bash
source venv/bin/activate
```

### Step 4 — Install dependencies

```bash
pip install -r requirements.txt
```

### Step 5 — Install the Chromium browser (Playwright)

```bash
playwright install chromium
```

---

## Configuration

All credentials and settings live in a single file: **`config.yml`**

### Step 1 — Create your config file

```bash
cp config.yml.example config.yml
```

### Step 2 — Edit `config.yml`

```yaml
dolynk:
  login_url:   "https://pro.dolynkcloud.com/#/login"
  records_url: "https://pro.dolynkcloud.com/#/access/record/list"
  username:    "your_email@example.com"        # DoLynk Pro login email
  password:    "your_password"                 # DoLynk Pro password

google:
  credentials_json: "sparsh-attendance-5ee4c1c7e02b.json"  # Google service account key
  sheet_name:       "Sparsh_Salary_Auto V3"                 # Exact Google Sheet name
  tab_name:         "Records"                               # Tab to upload into

settings:
  headless:     true     # true = invisible browser | false = visible (debug)
  max_retries:  3        # login retry attempts
  timeout_ms:   30000    # timeout per browser operation (milliseconds)
```

> **Tip:** The `credentials_json` path can be a filename (if the file is in the same folder as `config.yml`) or a full absolute path.

---

## Running the Script

> Make sure the virtual environment is active before running:
> ```bash
> source venv/bin/activate
> ```

### Standard run (recommended)

```bash
cd "/Users/raghulsekar/Desktop/claude/claude code/attendance_automation" && source venv/bin/activate && python main.py
```

### Force re-run (ignores today's deduplication check)

```bash
python main.py --force
```

### Debug mode — watch the browser live

```bash
python main.py --headful
```

### Verbose logging — see every step in detail

```bash
python main.py --verbose
```

### All options combined

```bash
python main.py --force --headful --verbose
```

### Command reference

| Command | Description |
|---|---|
| `python main.py` | Standard run — skips if already completed today |
| `python main.py --force` | Force run even if already done today |
| `python main.py --headful` | Show browser window (debug) |
| `python main.py --verbose` | Enable detailed DEBUG logging |
| `python main.py --force --headful --verbose` | Full debug run |

---

## Automatic Daily Scheduling

The script is scheduled to run every day at **6:00 PM UK time (GMT/BST)** using macOS launchd.

> **Timezone requirement:** Your Mac must be set to UK timezone for the schedule to fire at the correct UK time.
> Go to: **System Settings → General → Language & Region → Time Zone → London**

### Install the scheduler (one command)

```bash
chmod +x setup_launchd.sh
./setup_launchd.sh
```

This script automatically:
1. Fills your absolute paths into the plist
2. Copies it to `~/Library/LaunchAgents/`
3. Registers it with launchd

### Verify it is registered

```bash
launchctl list | grep attendance
```

### Trigger a test run immediately

```bash
launchctl start com.attendance.automation
```

### Disable the scheduler

```bash
launchctl unload ~/Library/LaunchAgents/com.attendance.automation.plist
```

### Re-enable the scheduler

```bash
launchctl load ~/Library/LaunchAgents/com.attendance.automation.plist
```

---

## Logs

All logs are stored inside the project folder:

```
attendance_automation/logs/
├── 2026_05_25.log        # Script output (rotates daily, kept 14 days)
├── launchd_stdout.log    # stdout captured by launchd scheduler
└── launchd_stderr.log    # stderr captured by launchd scheduler
```

### View today's log live

```bash
tail -f "/Users/raghulsekar/Desktop/claude/claude code/attendance_automation/logs/$(date +%Y_%m_%d).log"
```

### View launchd output

```bash
cat "/Users/raghulsekar/Desktop/claude/claude code/attendance_automation/logs/launchd_stdout.log"
```

---

## Troubleshooting

**"Export button not found"**
→ The website UI may have changed. Run with `--headful` to watch the browser and identify the new selector.

**"Login failed after 3 attempts"**
→ Check `username` and `password` in `config.yml`. Run with `--headful --verbose` to see what the login page looks like.

**"config.yml not found"**
→ Run `cp config.yml.example config.yml` and fill in your credentials.

**Script runs manually but not via launchd**
→ Check `logs/launchd_stderr.log`. Most common cause: wrong Python path in the plist. Re-run `./setup_launchd.sh` to regenerate it.

**"networkidle timed out"**
→ The site is loading slowly. Increase `timeout_ms` in `config.yml` (e.g. `60000` for 60 seconds).

**Scheduler not firing at 6 PM UK time**
→ Verify your Mac timezone is set to London: **System Settings → General → Language & Region → Time Zone**.

**Google Sheets upload fails**
→ Ensure the Google Sheet is shared with the service account email found in your `.json` credentials file (`client_email` field).

