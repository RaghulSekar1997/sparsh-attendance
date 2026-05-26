# Google Sheet Briefing — Sparsh Salary Auto V3

**Generated:** 25 May 2026
**Sheet URL:** https://docs.google.com/spreadsheets/d/1kPTD1_2YiNWZl1qT-eSCnDivvqCJmpTAu8DCEWNQpj0
**Service Account:** `python-sheet-bot@sparsh-attendance.iam.gserviceaccount.com`
**Project:** `sparsh-attendance`

---

## What This Spreadsheet Is

This is the **Sparsh Tailoring attendance & salary automation workbook**. Raw biometric punch data (exported from a DoLynk Pro attendance device) is pasted into the `Records` tab, and a chain of formula-driven tabs automatically computes daily attendance, hours worked, salary payable, and management dashboards — all without manual calculation.

---

## Tabs Overview

| Tab | Purpose | Live Rows |
|---|---|---|
| **CEO Dashboard** | High-level KPI view — period summary, team breakdown, trend chart, top earners | 116 |
| **Salary Dashboard** | Full per-staff salary table for any chosen date range | 70 |
| **Team Metrics** | Performance grouped by team number | 34 |
| **Daily Attendance** | One row per staff × day — entry time, exit time, hours, status | 293 |
| **Staff Master** | Auto-populated staff directory with rates and monthly salary | 27 |
| **Rate Card** | Editable hourly rate per staff member | 26 |
| **Punches** | Raw punch records with parsed date/time columns (formula-driven, do not edit) | 311 |
| **Records** | **Data entry point** — paste biometric export rows here | 309 |
| **How It Works** | Documentation explaining all formulas and sheet logic | 107 |

---

## Current Period Summary (20–21 May 2026)

These figures come from the **Salary Dashboard** and **CEO Dashboard** as of the last data load.

| Metric | Value |
|---|---|
| Period | 20 May 2026 – 21 May 2026 |
| Working Days | 2 |
| Total Staff | 23 |
| Total Hours Worked | 83.15 hrs |
| Total Salary Payable | ₹10,005 |
| Present Days (all staff combined) | 32 |
| Absent Days (all staff combined) | 14 |
| Overall Attendance Rate | **69.6%** |

### Team Breakdown

| Team | Role | Headcount | Total Hours | Attendance % | Salary |
|---|---|---|---|---|---|
| Team 1 | Supervisor | 1 | 0.00 | 50.0% | ₹0 |
| Team 2 | Senior Tailor | 6 | 52.24 | 91.7% | ₹6,629 |
| Team 3 | Master Tailor | 2 | 10.15 | 50.0% | ₹1,459 |
| Team 4 | Tailor | 10 | 16.73 | 55.0% | ₹1,595 |
| Team 5 | Helper | 1 | 0.00 | 100.0% | ₹0 |
| Team 0 | Unenrolled / Pending | 3 | 4.02 | 83.3% | ₹322 |

> **Note:** Team 2 (Senior Tailors) drives the bulk of hours and salary. Several Team 4 Tailors show low attendance for this period.

### Top Earners (Period)

| Name | Hours | Salary |
|---|---|---|
| Mareeswari B | 19.86 | ₹2,614 |
| Indhirani R | 17.87 | ₹2,257 |
| Janarthanan T | 10.15 | ₹1,459 |
| Subbu | 9.99 | ₹989 |
| Deepa M | 8.26 | ₹1,007 |
| Priya Karnan | 6.71 | ₹604 |
| Menaga S | 5.49 | ₹658 |
| Nandhini B | 2.45 | ₹196 |
| Jesika A | 1.57 | ₹126 |
| Priyanka S | 0.77 | ₹92 |

---

## Daily Attendance Trend (Recent Days)

| Date | Staff Present | Total Hours |
|---|---|---|
| 25 May 2026 | 15 | 28.61 |
| 24 May 2026 | 1 | 0.00 |
| 23 May 2026 | 16 | 47.11 |
| 22 May 2026 | 21 | 45.94 |
| 21 May 2026 | 21 | 45.85 |
| 20 May 2026 | 11 | 37.29 |

> 24 May shows only 1 staff present with 0 hours — likely a partial/test punch or a holiday.

---

## Staff Master (All 23 Active + 3 Unenrolled)

| Staff ID | Name | Team | Role | Hourly Rate | Daily Wage | Monthly Salary (@26 days) |
|---|---|---|---|---|---|---|
| 1001 | soundharya v | 1 | Supervisor | ₹150 | ₹1,200 | ₹31,200 |
| 2001 | Samyutha S | 2 | Senior Tailor | ₹120 | ₹960 | ₹24,960 |
| 2002 | Priyanka S | 2 | Senior Tailor | ₹120 | ₹960 | ₹24,960 |
| 2004 | Deepa M | 2 | Senior Tailor | ₹120 | ₹960 | ₹24,960 |
| 2005 | Menaga S | 2 | Senior Tailor | ₹120 | ₹960 | ₹24,960 |
| 2006 | Indhirani R | 2 | Senior Tailor | ₹120 | ₹960 | ₹24,960 |
| 2007 | Mareeswari B | 2 | Senior Tailor | ₹120 | ₹960 | ₹24,960 |
| 3001 | Janarthanan T | 3 | Master Tailor | ₹130 | ₹1,040 | ₹27,040 |
| 3004 | Mani B | 3 | Master Tailor | ₹130 | ₹1,040 | ₹27,040 |
| 4001 | Selvarani M | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4002 | Manjula R | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4003 | Priya Karnan | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4004 | Selva Meena B | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4005 | Meenakchi S M | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4006 | Maheshwari I | 4 | Tailor | ₹0 | ₹0 | ₹0 |
| 4007 | Lal | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4008 | Subbu | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4009 | Joel | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 4011 | Dhana Lakshmi G | 4 | Tailor | ₹90 | ₹720 | ₹18,720 |
| 5002 | Malliga N | 5 | Helper | ₹75 | ₹600 | ₹15,600 |
| — | Jesika A | 0 | Unenrolled / Pending | ₹80 | ₹640 | ₹16,640 |
| — | Madhumitha R | 0 | Unenrolled / Pending | ₹80 | ₹640 | ₹16,640 |
| — | Nandhini B | 0 | Unenrolled / Pending | ₹80 | ₹640 | ₹16,640 |

> **Maheshwari I (4006)** has a ₹0 hourly rate — this needs to be corrected in the Rate Card tab before salary calculations will include her.
> **3 unenrolled staff** (Jesika A, Madhumitha R, Nandhini B) are punching in but lack a biometric Staff ID. They should be enrolled in the DoLynk device and the Records matched.

---

## Records Tab — Biometric Data Format

This is the raw data paste zone. Each row is one punch event from the biometric device.

| Column | Description | Example |
|---|---|---|
| Name | Staff name from device | Menaga S |
| Staff ID | Biometric enrolment ID | 2005 |
| Organization | Company name | Sparsh Designer |
| Site | Location | Sparsh |
| Device Name | Hardware identifier | sparsh biometric attendance |
| Access Point | Camera/reader ID | DHI-ASI621EE48-1 |
| Unlock Time | Timestamp (HH:MM:SS DD/MM/YYYY) | 15:38:06 25/05/2026 |
| Unlock Method | Authentication type | Face Unlock |
| Results | Success/failure flag | Successful |
| Processor | Processing system | — |
| Remarks | Free text | — |
| Snapshot | Photo reference | — |

The **Punches** tab then auto-parses these timestamps and feeds the **Daily Attendance** tab which computes entry/exit/hours per staff per day.

---

## Automation Setup

The project uses a Python script (`main.py`) that:
1. Logs into the DoLynk Pro portal (`https://pro.dolynkcloud.com`) using Playwright
2. Downloads the latest attendance CSV/export
3. Uploads/appends the new rows into the `Records` tab of this sheet via the Google Sheets API
4. The sheet formulas then propagate the data automatically through all other tabs

The script is configured to run on a schedule via macOS **launchd** (`attendance_scheduler.plist`).

---

## Things to Action

1. **Fix Maheshwari I's rate** — set her hourly rate in the Rate Card tab (currently ₹0, so she earns nothing in reports).
2. **Enrol the 3 unenrolled staff** — Jesika A, Madhumitha R, and Nandhini B punch in but their Staff IDs show `--`. Enrol them in the DoLynk device so their records link properly.
3. **Investigate 24 May** — only 1 attendance record with 0 hours; confirm if this was a planned holiday or a data gap.
4. **Supervisor attendance** — soundharya v (1001, Supervisor) shows 50% attendance for the period; worth verifying.
