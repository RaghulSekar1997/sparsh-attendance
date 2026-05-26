#!/usr/bin/env python3
# Make `X | Y` union annotations work on Python 3.9 (they're strings, not evaluated at runtime)
from __future__ import annotations
"""
Attendance CSV Downloader
=========================
Logs into pro.dolynkcloud.com and downloads the daily attendance CSV export.
Designed to run daily at 9 AM via macOS launchd.

Usage:
    python main.py              # Normal headless run
    python main.py --headful    # Debug: visible browser window
    python main.py --force      # Re-download even if today's file exists
    python main.py --verbose    # Enable DEBUG-level logging
"""

import argparse
import asyncio
import datetime
import logging
import os
import sys
import tempfile
from logging.handlers import RotatingFileHandler
from pathlib import Path

import openpyxl
import gspread
import requests
import yaml
from google.oauth2.service_account import Credentials
from playwright.async_api import (
    Download,
    Frame,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

# ─── Config (config.yml) ──────────────────────────────────────────────────────

_CONFIG_FILE = Path(__file__).resolve().parent / "config.yml"

def _load_config() -> dict:
    if not _CONFIG_FILE.exists():
        raise FileNotFoundError(
            f"config.yml not found at {_CONFIG_FILE}\n"
            "Copy config.yml.example to config.yml and fill in your credentials."
        )
    with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

_cfg = _load_config()

# DoLynk credentials
WEBSITE_URL = _cfg["dolynk"]["login_url"]
RECORDS_URL = _cfg["dolynk"]["records_url"]
USERNAME    = _cfg["dolynk"]["username"]
PASSWORD    = _cfg["dolynk"]["password"]

# Script behaviour
HEADLESS    = bool(_cfg["settings"].get("headless",    True))
MAX_RETRIES = int(_cfg["settings"].get("max_retries",  3))
TIMEOUT     = int(_cfg["settings"].get("timeout_ms",   30000))

# Google Sheets — credentials_json may be relative (to config.yml) or absolute
_creds_raw          = _cfg["google"]["credentials_json"]
_creds_path         = Path(_creds_raw)
GOOGLE_CREDENTIALS_JSON = str(
    _creds_path if _creds_path.is_absolute()
    else _CONFIG_FILE.parent / _creds_path
)
GOOGLE_SHEET_NAME   = _cfg["google"]["sheet_name"]
GOOGLE_TAB_NAME     = _cfg["google"]["tab_name"]

# Logs live inside the project folder (next to main.py)
_PROJECT_DIR = Path(__file__).resolve().parent
LOG_DIR      = _PROJECT_DIR / "logs"

# State file: records the last date the script ran successfully (replaces file-exists check)
_LAST_RUN_FILE = LOG_DIR / ".last_success"

logger = logging.getLogger("attendance")


# ─── Logging ──────────────────────────────────────────────────────────────────

def setup_logging(verbose: bool = False) -> None:
    """Write to a daily rotating log file AND stdout."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.date.today().strftime("%Y_%m_%d")
    log_file = LOG_DIR / f"{date_str}.log"

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)-8s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotate after 5 MB; keep 14 days of logs
    file_handler = RotatingFileHandler(
        log_file, maxBytes=5 * 1024 * 1024, backupCount=14, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(fmt)

    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)


# ─── Directory & state helpers ────────────────────────────────────────────────

def ensure_directories() -> None:
    """Only logs/ needs to exist — no local download directory required."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger.debug(f"Log dir : {LOG_DIR}")


def already_run_today() -> bool:
    """Return True if the script already completed successfully today.
    Uses a small state file (logs/.last_success) instead of checking for a local file.
    """
    if _LAST_RUN_FILE.exists():
        last = _LAST_RUN_FILE.read_text().strip()
        if last == str(datetime.date.today()):
            logger.info("Already completed successfully today — skipping. (Use --force to override)")
            return True
    return False


def mark_success() -> None:
    """Write today's date to the state file after a successful run."""
    _LAST_RUN_FILE.write_text(str(datetime.date.today()))


# ─── Playwright helpers ───────────────────────────────────────────────────────

async def _spa_ready(page: Page) -> None:
    """Wait for a Vue/SPA to finish loading (networkidle, with graceful fallback)."""
    try:
        await page.wait_for_load_state("networkidle", timeout=TIMEOUT)
    except PlaywrightTimeoutError:
        logger.warning("networkidle timed out — continuing")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5_000)
        except PlaywrightTimeoutError:
            pass


async def _try_click(
    page: "Page | Frame",
    selectors: list[str],
    label: str,
    timeout_each: int = 4_000,
) -> bool:
    """Attempt each CSS/text selector in order; return True on first success."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=timeout_each)
            await loc.click()
            logger.debug(f"Clicked {label} via {sel!r}")
            return True
        except Exception:
            continue
    return False


async def _wait_for_any(
    page: "Page | Frame",
    selectors: list[str],
    timeout: int = 5_000,
) -> str | None:
    """Return the first selector that becomes visible, or None."""
    for sel in selectors:
        try:
            await page.wait_for_selector(sel, timeout=timeout)
            return sel
        except PlaywrightTimeoutError:
            continue
    return None


# ─── Core automation steps ────────────────────────────────────────────────────

async def _dismiss_cookie_banner(page: Page) -> None:
    """
    Dismiss the cookie consent banner if it appears.
    DoLynk Pro shows "Decline All" / "Accept All" buttons on first visit.
    We click Accept All so the banner doesn't block any UI elements.
    """
    banner_selectors = [
        'button:has-text("Accept All")',
        'button:has-text("Accept")',
        'button:has-text("Decline All")',
        '[class*="cookie"] button',
        '[id*="cookie"] button',
        '[class*="consent"] button',
    ]
    for sel in banner_selectors:
        try:
            btn = page.locator(sel).first
            await btn.wait_for(state="visible", timeout=3_000)
            await btn.click()
            logger.debug(f"Cookie banner dismissed via {sel!r}")
            # Give the banner time to animate away before interacting with the form
            await page.wait_for_timeout(500)
            return
        except PlaywrightTimeoutError:
            continue
    # No banner found — that's fine (already accepted on a previous run)


async def login(page: Page) -> None:
    """
    Navigate to the login page and authenticate.
    Retries up to MAX_RETRIES times with exponential backoff.
    Raises RuntimeError if every attempt fails.

    Observed login page (pro.dolynkcloud.com/#/login):
      - Cookie consent banner: "Decline All" / "Accept All"
      - Email field placeholder: "Email/Phone No."
      - Password field placeholder: "Please enter the password"
      - Terms checkbox: "I have read and agree to Privacy Policy…"
      - Button text: "Log in"  (two words)
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info(f"Login attempt {attempt}/{MAX_RETRIES}")
            await page.goto(WEBSITE_URL, wait_until="domcontentloaded", timeout=TIMEOUT)
            await _spa_ready(page)

            # Step 1 — dismiss cookie banner (blocks UI on first visit)
            await _dismiss_cookie_banner(page)

            # Step 2 — fill username
            # Placeholder is "Email/Phone No." — checked from live screenshot
            username_selectors = [
                'input[placeholder="Email/Phone No."]',
                'input[placeholder*="Email/Phone" i]',
                'input[placeholder*="Phone No" i]',
                'input[type="email"]',
                'input[placeholder*="email" i]',
                'input[placeholder*="account" i]',
                'input[placeholder*="用户" i]',
                'input[name*="user" i]',
                '.el-input input:not([type="password"])',
                'form input:first-of-type',
            ]
            username_loc = None
            for sel in username_selectors:
                try:
                    loc = page.locator(sel).first
                    await loc.wait_for(state="visible", timeout=3_000)
                    username_loc = loc
                    logger.debug(f"Username field matched by: {sel!r}")
                    break
                except PlaywrightTimeoutError:
                    continue

            if username_loc is None:
                raise RuntimeError("Username input not found on page")

            await username_loc.fill(USERNAME)  # fill() clears existing text then types

            # Step 3 — fill password
            # Placeholder is "Please enter the password"
            pw_loc = page.locator('input[type="password"]').first
            await pw_loc.wait_for(state="visible", timeout=TIMEOUT)
            await pw_loc.fill(PASSWORD)  # fill() clears existing text then types

            # Step 4 — check the "I have read and agree" terms checkbox.
            # IMPORTANT: DoLynk Pro uses a custom styled checkbox (common in Element UI / Vue).
            # The real <input type="checkbox"> has opacity:0 so wait_for("visible") always
            # fails. The fix: click the VISIBLE label or the styled span instead.
            # We also use force=True as a fallback to click even when Playwright considers
            # the element "hidden" (the click still registers on the DOM).
            try:
                # Strategy 1: click the visible label text — always works for custom checkboxes
                terms_label_selectors = [
                    'label:has-text("I have read")',
                    'label:has-text("agree")',
                    'label:has-text("Privacy Policy")',
                    '.el-checkbox__inner',          # Element UI visual checkbox span
                    '.el-checkbox',                  # Element UI outer wrapper
                    '[class*="checkbox"]:visible',
                    '[class*="agree"]:visible',
                ]
                checked = False
                for sel in terms_label_selectors:
                    try:
                        el = page.locator(sel).first
                        await el.wait_for(state="visible", timeout=2_000)
                        await el.click()
                        logger.debug(f"Terms checkbox clicked via {sel!r}")
                        checked = True
                        break
                    except PlaywrightTimeoutError:
                        continue

                if not checked:
                    # Strategy 2: force-click the hidden <input> directly
                    cb = page.locator('input[type="checkbox"]').first
                    await cb.click(force=True)
                    logger.debug("Terms checkbox force-clicked (hidden input)")

            except Exception as terms_err:
                logger.debug(f"Terms checkbox handling skipped: {terms_err}")

            # Step 5 — click "Log in" button
            # Exact button text from screenshot: "Log in"  (capital L, lowercase i)
            submit_selectors = [
                'button:has-text("Log in")',
                'button:has-text("Login")',
                'button:has-text("Log In")',
                'button[type="submit"]',
                'button:has-text("Sign In")',
                'button:has-text("登录")',
                '.login-btn',
            ]
            clicked = await _try_click(page, submit_selectors, "Log in button")
            if not clicked:
                # Last resort: Enter key from password field
                await pw_loc.press("Enter")
                logger.debug("Pressed Enter to submit login form")

            # Step 6 — handle "Privacy Protection" modal that appears after clicking Log in.
            # Modal title: "Privacy Protection"
            # Buttons: "Disagree" | "Agree and Continue"
            # This modal must be accepted before the page navigates away from #/login.
            privacy_modal_selectors = [
                'button:has-text("Agree and Continue")',
                'button:has-text("Agree")',
                'button:has-text("Accept")',
                'button:has-text("Continue")',
                '.el-button--primary:has-text("Agree")',
            ]
            try:
                # Give the modal up to 8 s to appear after the Log in click
                await page.wait_for_selector(
                    'button:has-text("Agree and Continue")', timeout=8_000
                )
                await _try_click(page, privacy_modal_selectors, "Privacy Protection → Agree and Continue")
                logger.debug("Privacy Protection modal accepted")
            except PlaywrightTimeoutError:
                # Modal didn't appear — either already accepted previously or not shown
                logger.debug("No Privacy Protection modal — continuing")

            # Step 7 — wait until URL leaves the login page
            await page.wait_for_function(
                "() => !window.location.href.includes('#/login')",
                timeout=TIMEOUT,
            )
            await _spa_ready(page)
            logger.info("Login successful")
            return

        except Exception as exc:
            logger.warning(f"Login attempt {attempt} failed: {exc}")
            if attempt == MAX_RETRIES:
                raise RuntimeError(f"Login failed after {MAX_RETRIES} attempts") from exc
            delay = 2 ** attempt
            logger.info(f"Retrying in {delay}s…")
            await asyncio.sleep(delay)


async def navigate_to_records(page: Page) -> None:
    """Navigate to the records list page; re-login automatically if session expired."""
    logger.info(f"Navigating to records page: {RECORDS_URL}")
    await page.goto(RECORDS_URL, wait_until="domcontentloaded", timeout=TIMEOUT)
    await _spa_ready(page)

    # Detect silent redirect to login (session expiry)
    if "#/login" in page.url or "/login" in page.url.lower():
        logger.warning("Session expired — re-authenticating")
        await login(page)
        await page.goto(RECORDS_URL, wait_until="domcontentloaded", timeout=TIMEOUT)
        await _spa_ready(page)

    # Confirm the records table / list has rendered
    content_selectors = [
        ".el-table",
        ".el-table__body",
        "table tbody tr",
        ".record-list",
        "[class*='table-container']",
        "[class*='record-container']",
    ]
    found = await _wait_for_any(page, content_selectors, timeout=10_000)
    if found:
        logger.info(f"Records page ready (matched: {found!r})")
    else:
        logger.warning("Could not confirm records table — page may be loading slowly, continuing")


async def export_and_download(page: Page) -> Path:
    """
    Click the Export button, handle the confirmation (native dialog or Element UI
    modal), wait for the download to complete, and save it with a dated filename.
    Returns the path of the saved file.
    """
    # ── Native browser dialog acceptor (alert / confirm) ─────────────────────
    # Registered BEFORE any click that might trigger a dialog
    async def _accept_dialog(dialog):
        logger.info(f"Native dialog ({dialog.type}): {dialog.message!r} → accepting")
        await dialog.accept()

    page.once("dialog", _accept_dialog)

    # ── Locate Export button ──────────────────────────────────────────────────
    export_selectors = [
        'button:has-text("Export")',
        'button:has-text("导出")',
        'button:has-text("EXPORT")',
        'a:has-text("Export")',
        '[data-export]',
        '[class*="export-btn"]',
        '.export-button',
        'button[class*="export"]',
    ]

    # Search in sub-frames too (in case the table lives inside an iframe)
    target: "Page | Frame" = page
    if len(page.frames) > 1:
        logger.debug(f"Page has {len(page.frames)} frames — scanning for Export button in each")
        for frame in page.frames[1:]:
            found_in_frame = await _wait_for_any(frame, export_selectors, timeout=2_000)
            if found_in_frame:
                logger.info("Export button found in sub-frame")
                target = frame
                break

    logger.info("Clicking Export button…")
    export_clicked = await _try_click(target, export_selectors, "Export", timeout_each=6_000)

    if not export_clicked:
        # Brute-force: iterate every <button> and check its text
        all_btns = await target.locator("button").all()
        for btn in all_btns:
            try:
                text = (await btn.inner_text()).strip()
                if "export" in text.lower() or "导出" in text:
                    logger.info(f"Export button found via text scan: {text!r}")
                    await btn.click()
                    export_clicked = True
                    break
            except Exception:
                continue

    if not export_clicked:
        raise RuntimeError(
            "Export button not found. Run with --headful to inspect the page layout."
        )

    # ── Wait for the download; handle modal inside the expect_download context ─
    # We MUST start expect_download BEFORE the confirm click so we don't miss
    # the download event. The with-block captures any download that starts during it.
    modal_selectors = [
        ".el-message-box__wrapper",
        ".el-message-box",
        ".el-dialog__wrapper",
        "[role='dialog']",
        ".ant-modal-content",
        ".v-dialog",
        "[class*='modal']",
        "[class*='dialog']",
    ]
    confirm_btn_selectors = [
        ".el-message-box__btns .el-button--primary",
        ".el-message-box .el-button--primary",
        ".el-dialog__footer .el-button--primary",
        "[role='dialog'] .el-button--primary",
        'button:has-text("确定")',
        'button:has-text("OK")',
        'button:has-text("Ok")',
        'button:has-text("Confirm")',
        'button:has-text("Yes")',
    ]

    logger.info("Waiting for file download to start…")
    async with page.expect_download(timeout=TIMEOUT * 2) as dl_info:
        # Check for an Element UI confirmation modal (give it 5 s to appear)
        modal_sel = await _wait_for_any(page, modal_selectors, timeout=5_000)
        if modal_sel:
            logger.info(f"Confirmation modal appeared ({modal_sel!r}) — clicking Confirm")
            confirmed = await _try_click(page, confirm_btn_selectors, "Confirm", timeout_each=4_000)
            if not confirmed:
                logger.warning("Confirm button not found — pressing Enter as fallback")
                await page.keyboard.press("Enter")
        else:
            logger.debug(
                "No modal appeared — download started directly or via native dialog"
            )

    download: Download = await dl_info.value
    suggested = download.suggested_filename or "export.xlsx"
    logger.info(f"Download received: {suggested!r}")

    # Save to a temp file — no permanent local copy needed
    real_ext = Path(suggested).suffix or ".xlsx"
    tmp = tempfile.NamedTemporaryFile(suffix=real_ext, delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    await download.save_as(tmp_path)

    if not tmp_path.exists() or tmp_path.stat().st_size == 0:
        raise RuntimeError("Download appears empty — aborting")

    logger.info(f"Downloaded to temp: {tmp_path.name}  ({tmp_path.stat().st_size:,} bytes)")
    return tmp_path


# ─── Google Sheets Upload ─────────────────────────────────────────────────────

def upload_to_google_sheets(file_path: Path) -> None:
    """
    Read the downloaded xlsx and upload all rows into the 'Records' tab of
    'Sparsh_Salary_Auto V3', starting at row 3 (row 1 = instruction banner,
    row 2 = headers — both preserved untouched).

    Steps:
      1. Read xlsx → list of rows (all cells as strings)
      2. Authenticate with service account credentials
      3. Open the Google Sheet and select the Records tab
      4. Clear existing data from row 3 downward (A3:Z50000)
      5. Write new rows starting at A3
    """
    creds_path = Path(GOOGLE_CREDENTIALS_JSON)
    if not creds_path.exists():
        logger.warning(f"Google credentials file not found: {creds_path} — skipping upload")
        return
    if not GOOGLE_SHEET_NAME:
        logger.warning("GOOGLE_SHEET_NAME not set — skipping upload")
        return

    logger.info("─" * 50)
    logger.info("Uploading to Google Sheets…")

    # ── 1. Read xlsx ──────────────────────────────────────────────────────────
    try:
        wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
        ws_xl = wb.active
        rows: list[list[str]] = []
        for row in ws_xl.iter_rows(values_only=True):
            rows.append([str(cell) if cell is not None else "" for cell in row])
        wb.close()

        # Row 0 of xlsx = header (Name, Staff ID, …) — sheet already has headers in row 2
        # so we skip it to avoid duplicating the header row in the sheet
        if rows and rows[0] and rows[0][0].strip().lower() in ("name", "名称", "姓名"):
            rows = rows[1:]
            logger.debug("Skipped xlsx header row")

        logger.info(f"Read {len(rows)} data rows from {file_path.name}")
    except Exception as exc:
        logger.error(f"Failed to read xlsx file: {exc}")
        return

    if not rows:
        logger.warning("xlsx file is empty — nothing to upload")
        return

    # ── 2. Authenticate ───────────────────────────────────────────────────────
    try:
        creds = Credentials.from_service_account_file(
            str(creds_path),
            scopes=[
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive",
            ],
        )
        gc = gspread.authorize(creds)
        logger.info(f"Authenticated as: {creds.service_account_email}")
    except Exception as exc:
        logger.error(f"Google auth failed: {exc}")
        return

    # ── 3. Open sheet + tab ───────────────────────────────────────────────────
    try:
        spreadsheet = gc.open(GOOGLE_SHEET_NAME)
        tab = spreadsheet.worksheet(GOOGLE_TAB_NAME)
        logger.info(f"Opened: '{GOOGLE_SHEET_NAME}' → tab '{GOOGLE_TAB_NAME}'")
    except gspread.SpreadsheetNotFound:
        logger.error(f"Sheet '{GOOGLE_SHEET_NAME}' not found — check sharing settings")
        return
    except gspread.WorksheetNotFound:
        logger.error(f"Tab '{GOOGLE_TAB_NAME}' not found in the sheet")
        return
    except Exception as exc:
        logger.error(f"Could not open sheet: {exc}")
        return

    # ── 4. Clear existing data from row 3 downward ────────────────────────────
    try:
        tab.batch_clear(["A3:Z50000"])
        logger.info("Cleared existing data from row 3 downward")
    except Exception as exc:
        logger.error(f"Failed to clear old rows: {exc}")
        return

    # ── 5. Write new data starting at A3 ──────────────────────────────────────
    try:
        tab.update(range_name="A3", values=rows)
        logger.info(f"Uploaded {len(rows)} rows to '{GOOGLE_TAB_NAME}' tab starting at row 3")
    except Exception as exc:
        logger.error(f"Failed to write data: {exc}")
        return

    logger.info(f"Google Sheets upload complete ✓")
    logger.info("─" * 50)


def trigger_report_via_webhook() -> None:
    """
    Call the Apps Script web-app endpoint to fire the attendance email report.
    Requires config.yml → apps_script.webhook_url and apps_script.secret_key.
    Safe to skip if not configured — upload still succeeds.
    """
    webhook_url = _cfg.get("apps_script", {}).get("webhook_url", "").strip()
    secret_key  = _cfg.get("apps_script", {}).get("secret_key", "").strip()

    if not webhook_url:
        logger.info("apps_script.webhook_url not set in config.yml — skipping report trigger")
        return

    logger.info("Triggering attendance email report via Apps Script webhook…")
    try:
        resp = requests.get(
            webhook_url,
            params={"key": secret_key},
            timeout=60,
            allow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "ok":
            logger.info(f"✓ Email report triggered — {data.get('message', '')}")
        else:
            logger.warning(f"Webhook returned unexpected response: {data}")
    except requests.exceptions.Timeout:
        logger.warning("Webhook timed out (Apps Script may still be running — check your email)")
    except Exception as exc:
        logger.warning(f"Failed to trigger report webhook: {exc}")


# ─── Orchestrator ─────────────────────────────────────────────────────────────

async def run(headless: bool = True, force: bool = False, verbose: bool = False) -> int:
    """Full automation run. Returns 0 on success, 1 on failure."""
    setup_logging(verbose=verbose)

    logger.info("=" * 60)
    logger.info("Attendance Downloader — starting")
    logger.info(f"Date   : {datetime.date.today()}")
    logger.info(f"Mode   : {'headless' if headless else 'headful (debug)'}")
    logger.info(f"Target : {RECORDS_URL}")
    logger.info("=" * 60)

    if not USERNAME or not PASSWORD:
        logger.error("USERNAME / PASSWORD not set — copy .env.example to .env and fill it in")
        return 1

    ensure_directories()

    tmp_path = None
    try:
        async with async_playwright() as pw:
            logger.info("Launching Chromium")
            browser = await pw.chromium.launch(
                headless=headless,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = await browser.new_context(
                accept_downloads=True,
                viewport={"width": 1280, "height": 900},
                locale="en-US",
            )
            page = await context.new_page()
            page.set_default_timeout(TIMEOUT)

            try:
                await login(page)
                await navigate_to_records(page)
                tmp_path = await export_and_download(page)
            finally:
                await context.close()
                await browser.close()

        # Upload after browser is fully closed, then fire the email report
        if tmp_path:
            upload_to_google_sheets(tmp_path)
            trigger_report_via_webhook()
            mark_success()

        logger.info("SUCCESS — upload complete")
        return 0

    except Exception:
        logger.exception("Fatal error during automation run")
        return 1

    finally:
        # Always delete the temp file — no local files left behind
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()
            logger.debug(f"Temp file deleted: {tmp_path.name}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download daily attendance CSV from pro.dolynkcloud.com"
    )
    parser.add_argument(
        "--headful", action="store_true",
        help="Show the browser window (useful for debugging selectors)"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-download even if today's file already exists"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable DEBUG-level logging"
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(run(
        headless=not args.headful,
        force=args.force,
        verbose=args.verbose,
    )))


if __name__ == "__main__":
    main()
