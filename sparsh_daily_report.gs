// =============================================================================
// SPARSH BOUTIQUE — CEO DAILY ATTENDANCE REPORT
// Mobile + Laptop responsive · Direct HTML email (no attachments)
// =============================================================================
// SETUP (one-time):
//   1. Open "Sparsh_Salary_Auto V3" → Extensions → Apps Script
//   2. Replace ALL code with this file's content
//   3. Save → select "sendDailyAttendanceReport" → Run → approve Gmail access
//   4. Set trigger: ⏱ Triggers → + Add Trigger
//      → sendDailyAttendanceReport | Time-driven | Day timer | 7 PM–8 PM
// =============================================================================

const REPORT_EMAIL   = 'sparshdesigners.in@gmail.com';
const BOUTIQUE_NAME  = 'Sparsh Boutique';
const SPREADSHEET_ID = '1kPTD1_2YiNWZl1qT-eSCnDivvqCJmpTAu8DCEWNQpj0';
const WEBHOOK_SECRET = 'sparsh-report-2026'; // must match config.yml → apps_script.secret_key

const TEAM_LABELS = {
  '0': 'Unenrolled / Pending',
  '1': 'Supervisor',
  '2': 'Senior Tailor',
  '3': 'Master Tailor',
  '4': 'Tailor',
  '5': 'Helper'
};

// =============================================================================
// WEBHOOK — called by Python after each data upload
// Deploy this script as a Web App (Execute as: Me, Access: Anyone) then paste
// the deployment URL into config.yml → apps_script.webhook_url
// =============================================================================

function doGet(e) {
  const key  = e && e.parameter && e.parameter.key;
  // Optional: ?type=weekly  → weekly report   (default: daily)
  const type = (e && e.parameter && e.parameter.type) || 'daily';

  if (key !== WEBHOOK_SECRET) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  try {
    if (type === 'monthly') {
      sendMonthlyAttendanceReport();       // always covers 1st of month → today
    } else if (type === 'weekly') {
      sendWeeklyAttendanceReport();        // defined in sparsh_weekly_report.gs
    } else {
      sendDailyAttendanceReport();
    }
    const label = type === 'monthly' ? 'Monthly' : type === 'weekly' ? 'Weekly' : 'Daily';
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', message: label + ' report sent successfully' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

function sendDailyAttendanceReport() {
  const today   = new Date();
  const dateStr = toSheetDateStr(today);
  const tz      = Session.getScriptTimeZone();

  Logger.log('Timezone: ' + tz + ' | Looking for date: ' + dateStr);

  const allStaff   = loadStaffMaster();
  const attendance = loadDailyAttendance(dateStr);
  Logger.log('Staff loaded: ' + allStaff.length + ' | Attendance rows for today: ' + attendance.length);

  const presentNames = new Set(attendance.map(a => a.name));
  const absentStaff  = allStaff.filter(s => !presentNames.has(s.name));
  const flagged      = attendance.filter(a => a.status === 'Single-Punch' || a.hours < 1.0);

  const totalStaff     = allStaff.length;
  const presentCount   = attendance.length;
  const absentCount    = absentStaff.length;
  const attendanceRate = totalStaff > 0 ? ((presentCount / totalStaff) * 100).toFixed(1) : '0.0';
  const totalHours     = attendance.reduce((s, a) => s + a.hours, 0);
  const avgHours       = presentCount > 0 ? (totalHours / presentCount).toFixed(2) : '0.00';
  const flagCount      = flagged.length;

  const html = buildDailyHTML({
    today, dateStr, tz,
    totalStaff, presentCount, absentCount,
    attendanceRate, totalHours, avgHours, flagCount,
    attendance, absentStaff, flagged
  });

  const dayLabel = Utilities.formatDate(today, tz, 'EEEE, d MMMM yyyy');

  GmailApp.sendEmail(
    REPORT_EMAIL,
    `${BOUTIQUE_NAME} — Attendance Report | ${dayLabel}`,
    'Please view this email in an HTML-capable email client.',
    {
      htmlBody: html,
      name: `${BOUTIQUE_NAME} Attendance`
    }
  );

  Logger.log('Daily report sent for ' + dateStr);
}

// =============================================================================
// DATA LOADERS
// =============================================================================

function loadStaffMaster() {
  return getSheetRows('Staff Master', 5)
    .filter(r => r[1])
    .map(r => ({
      id:   String(r[0] || '').trim(),
      name: String(r[1] || '').trim(),
      team: String(r[2] || '0').trim(),
      role: String(r[3] || '').trim()
    }));
}

function loadDailyAttendance(dateStr) {
  const dc = parseDateStr(dateStr); // { day, month (1-based), year }
  Logger.log('loadDailyAttendance | dateStr=' + dateStr + ' | dc=' + JSON.stringify(dc));
  const allRows = getSheetRows('Daily Attendance', 5);
  const matched = allRows.filter(r => r[3] && String(r[3]).trim() === dateStr);
  if (matched.length > 0) {
    // Log first row's raw time values so we can see the exact format from the sheet
    Logger.log('Sample times (raw) | entry=' + matched[0][4] + ' | exit=' + matched[0][5]);
  }
  return matched
    .map(r => ({
      id:        String(r[0] || '').trim(),
      name:      String(r[1] || '').trim(),
      team:      String(r[2] || '0').trim(),
      // Sheet stores times in UK time — convert to IST for display
      entryTime: dc ? ukToIST(String(r[4] || '').trim(), dc.year, dc.month, dc.day)
                    : String(r[4] || '').trim(),
      exitTime:  dc ? ukToIST(String(r[5] || '').trim(), dc.year, dc.month, dc.day)
                    : String(r[5] || '').trim(),
      punches:   parseInt(r[6])   || 0,
      hours:     parseFloat(r[7]) || 0, // duration is timezone-independent (exit − entry)
      status:    String(r[8] || '').trim()
    }));
}

function getSheetRows(sheetName, startRow) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) return [];
  // getDisplayValues() returns the cell content exactly as shown on screen (always a string).
  // getValues() returns Date objects for date-formatted cells — those never match our string.
  const data = sheet.getDataRange().getDisplayValues();
  const rows = [];
  for (let i = startRow - 1; i < data.length; i++) {
    if (data[i].some(c => c !== '')) rows.push(data[i]);
  }
  return rows;
}

// =============================================================================
// UTILITIES
// =============================================================================

// ── Date string helpers ───────────────────────────────────────────────────────

function toSheetDateStr(date) {
  // Uses Utilities.formatDate (respects script timezone, e.g. Asia/Kolkata).
  // date.getDate() etc. would use UTC and give wrong results for India.
  const tz  = Session.getScriptTimeZone();
  const M   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const D   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const day = parseInt(Utilities.formatDate(date, tz, 'd'),    10);
  const mon = parseInt(Utilities.formatDate(date, tz, 'M'),    10) - 1; // 0-based
  const yr  = parseInt(Utilities.formatDate(date, tz, 'yyyy'), 10);
  const dd  = day < 10 ? '0' + day : '' + day;
  return dd + '-' + M[mon] + '-' + yr + ' (' + D[dowSakamoto(yr, mon + 1, day)] + ')';
}

function parseDateStr(dateStr) {
  // "25-May-2026 (Mon)" → { day:25, month:5, year:2026 }
  // Returns null if the format is unrecognised or month abbreviation is unknown.
  if (!dateStr) return null;
  const M = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  try {
    const p = String(dateStr).split('-');
    if (p.length < 3) return null;
    const day   = parseInt(p[0].trim(), 10);
    const month = M[p[1].trim()];          // undefined if unknown abbreviation
    const year  = parseInt(p[2].trim(), 10);
    if (!month || isNaN(day) || isNaN(year)) return null;
    return { day, month, year };
  } catch (e) { return null; }
}

// Sakamoto's algorithm: returns 0=Sun, 1=Mon … 6=Sat (month is 1-based)
function dowSakamoto(year, month, day) {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = year;
  if (month < 3) y--;
  return (y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) + t[month-1] + day) % 7;
}

// ── UK → IST time conversion ──────────────────────────────────────────────────
//
// IST  = UTC + 5:30  (no daylight saving — ever)
// BST  = UTC + 1     (British Summer Time, late-Mar → late-Oct)
// GMT  = UTC + 0     (rest of the year)
//
// Therefore:
//   During BST  →  IST = UK time + 4:30
//   During GMT  →  IST = UK time + 5:30

function ukToIST(timeStr, year, month, day) {
  if (!timeStr || timeStr === '—' || timeStr === '') return timeStr;
  const raw = String(timeStr).trim();
  if (!raw) return timeStr;

  // Robust parser — handles all formats that getDisplayValues() may return:
  //   "09:30:00"          24-hour with seconds    (most common)
  //   "09:30"             24-hour without seconds
  //   "9:30 AM"           12-hour AM, no seconds
  //   "9:30:00 AM"        12-hour AM with seconds
  //   "6:30 PM"           12-hour PM ← old code computed this WRONG (gave 6h not 18h)
  //   "6:30:00 PM"        12-hour PM with seconds
  //   "2026-05-26 09:30:00"  full datetime — take the trailing time token
  const m = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return timeStr;                  // unrecognised format — return as-is

  let   h   = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = m[3] ? m[3].substring(0, 2) : '00';
  const ap  = (m[4] || '').toUpperCase();

  // Convert 12-hour → 24-hour
  if (ap === 'PM' && h < 12) h += 12;     // 6 PM  → 18,  12 PM stays 12
  if (ap === 'AM' && h === 12) h = 0;     // 12 AM → midnight

  const addMins = isUKSummerTime(year, month, day) ? (4 * 60 + 30) : (5 * 60 + 30);
  const total   = h * 60 + min + addMins;
  const hOut    = Math.floor(total / 60) % 24;
  const mOut    = total % 60;
  return p2(hOut) + ':' + p2(mOut) + ':' + sec;
}

function isUKSummerTime(year, month, day) {
  // BST runs from last Sunday of March to last Sunday of October.
  // Months fully inside summer:  April–September → always BST
  // Months fully outside summer: November–February → always GMT
  // Boundary months: March and October — compare day against last Sunday
  if (month > 3  && month < 10) return true;
  if (month < 3  || month > 10) return false;
  const lastSun = lastSundayOfMonth(year, month);
  if (month === 3)  return day > lastSun;  // BST starts day after last Sun in March
  if (month === 10) return day < lastSun;  // BST ends on last Sun in October
  return false;
}

function lastSundayOfMonth(year, month) {
  // Day count for each month (index 1–12)
  const isLeap  = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dim     = [0, 31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const lastDay = dim[month];
  const wd      = dowSakamoto(year, month, lastDay); // 0=Sun
  return lastDay - wd; // subtract days-since-last-Sunday
}

function p2(n) { return n < 10 ? '0' + n : '' + n; }

function tl(n)    { return TEAM_LABELS[String(n)] || 'Team ' + n; }

function hc(h) {
  if (h >= 8) return '#059669';
  if (h >= 6) return '#2563eb';
  if (h >= 4) return '#d97706';
  if (h >= 1) return '#ea580c';
  return '#dc2626';
}

function badge(a) {
  const b = 'display:inline-block;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;';
  if (a.status === 'Single-Punch') return `<span style="${b}background:#f59e0b;color:#fff">Single Punch</span>`;
  if (a.hours < 1)                 return `<span style="${b}background:#ef4444;color:#fff">Under 1 hr</span>`;
  if (a.hours >= 8)                return `<span style="${b}background:#059669;color:#fff">Full Day ✓</span>`;
  return                                   `<span style="${b}background:#2563eb;color:#fff">Present</span>`;
}

// =============================================================================
// HTML BUILDER
// =============================================================================

function buildDailyHTML(d) {
  const { today, dateStr, tz, totalStaff, presentCount, absentCount,
          attendanceRate, totalHours, avgHours, flagCount,
          attendance, absentStaff, flagged } = d;

  const dayLabel  = Utilities.formatDate(today, tz, 'EEEE, d MMMM yyyy');
  const timeLabel = Utilities.formatDate(today, tz, 'h:mm a');
  const rateNum   = parseFloat(attendanceRate);
  const rateCol   = rateNum >= 85 ? '#059669' : rateNum >= 70 ? '#d97706' : '#dc2626';

  const byTeamName = (a, b) => {
    const t = parseInt(a.team) - parseInt(b.team);
    return t !== 0 ? t : a.name.localeCompare(b.name);
  };

  // ── Team summary ──────────────────────────────────────────────────────────
  const teamsMap = {};
  attendance.forEach(a => {
    if (!teamsMap[a.team]) teamsMap[a.team] = { count: 0, hours: 0 };
    teamsMap[a.team].count++;
    teamsMap[a.team].hours += a.hours;
  });
  const absByTeam = {};
  absentStaff.forEach(s => { absByTeam[s.team] = (absByTeam[s.team] || 0) + 1; });

  const teamRows = Object.keys(teamsMap)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((t, i) => {
      const s   = teamsMap[t];
      const avg = s.hours / s.count;
      const ab  = absByTeam[t] || 0;
      const bg  = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      return `
      <tr style="background:${bg}">
        <td style="${TD}font-weight:600;color:#0f172a">${tl(t)}</td>
        <td style="${TD}text-align:center;font-size:15px;font-weight:800;color:#059669">${s.count}</td>
        <td style="${TD}text-align:center;font-size:15px;font-weight:${ab > 0 ? '800' : '400'};color:${ab > 0 ? '#dc2626' : '#94a3b8'}">${ab > 0 ? ab : '—'}</td>
        <td style="${TD}text-align:center;color:#475569">${s.hours.toFixed(1)} hrs</td>
        <td style="${TD}text-align:center;font-size:14px;font-weight:800;color:${hc(avg)}">${avg.toFixed(2)} hrs</td>
      </tr>`;
    }).join('');

  // ── Attendance rows ───────────────────────────────────────────────────────
  const attRows = [...attendance].sort(byTeamName).map((a, i) => {
    const fl = a.status === 'Single-Punch' || a.hours < 1;
    const bg = fl ? '#fffbf0' : (i % 2 === 0 ? '#fff' : '#f8fafc');
    const bl = fl ? 'border-left:3px solid #f59e0b;' : '';
    return `
    <tr style="background:${bg}">
      <td style="${TD}${bl}font-weight:700;color:#0f172a;white-space:nowrap">${a.name}</td>
      <td style="${TD}text-align:center;color:#64748b;font-size:12px;white-space:nowrap">${tl(a.team)}</td>
      <td style="${TD}text-align:center;font-family:monospace;white-space:nowrap">${a.entryTime || '—'}</td>
      <td style="${TD}text-align:center;font-family:monospace;white-space:nowrap">${a.exitTime || '—'}</td>
      <td style="${TD}text-align:center;font-size:15px;font-weight:800;color:${hc(a.hours)};white-space:nowrap">${a.hours.toFixed(2)}</td>
      <td style="${TD}text-align:center;white-space:nowrap">${badge(a)}</td>
    </tr>`;
  }).join('');

  // ── Flagged rows ──────────────────────────────────────────────────────────
  const flaggedRows = flagged.map((a, i) => {
    const bg = i % 2 === 0 ? '#fffbeb' : '#fff8e1';
    return `
    <tr style="background:${bg}">
      <td style="${TD_W}font-weight:700;color:#0f172a">${a.name}</td>
      <td style="${TD_W}text-align:center;color:#64748b;font-size:12px">${tl(a.team)}</td>
      <td style="${TD_W}text-align:center;font-family:monospace">${a.entryTime || '—'}</td>
      <td style="${TD_W}text-align:center;font-family:monospace">${a.exitTime || '—'}</td>
      <td style="${TD_W}text-align:center;font-size:15px;font-weight:800;color:#dc2626">${a.hours.toFixed(2)}</td>
      <td style="${TD_W}text-align:center">${badge(a)}</td>
    </tr>`;
  }).join('');

  // ── Absent rows ───────────────────────────────────────────────────────────
  const absentRows = [...absentStaff].sort(byTeamName).map((s, i) => {
    const bg = i % 2 === 0 ? '#fff1f2' : '#fff5f6';
    return `
    <tr style="background:${bg}">
      <td style="${TDA}font-weight:700;color:#0f172a">${s.name}</td>
      <td style="${TDA}text-align:center;color:#64748b;font-size:12px">${tl(s.team)}</td>
      <td style="${TDA}text-align:center;color:#64748b;font-size:12px">${s.role}</td>
      <td style="${TDA}text-align:center"><span style="display:inline-block;padding:4px 12px;border-radius:20px;background:#ef4444;color:#fff;font-size:11px;font-weight:700">ABSENT</span></td>
    </tr>`;
  }).join('');

  // ── KPI card builder (3 per row) ──────────────────────────────────────────
  const kpi = (val, sub, lbl, col) => `
    <td width="33%" style="padding:5px" class="kpi-cell">
      <div style="background:#fff;border-radius:12px;border-top:3px solid ${col};padding:16px 8px 14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.12)" class="kpi-inner">
        <div style="font-size:24px;font-weight:900;color:${col};line-height:1;letter-spacing:-0.5px" class="kpi-value">${val}</div>
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin-top:6px;font-weight:700" class="kpi-sub">${sub}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;font-weight:500" class="kpi-lbl">${lbl}</div>
      </div>
    </td>`;

  // ── Section heading ───────────────────────────────────────────────────────
  const sh = (text, grad) => `
    <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;width:100%"><tr>
      <td style="width:4px;border-radius:3px;background:${grad};vertical-align:middle">&thinsp;</td>
      <td style="padding-left:12px;font-size:15px;font-weight:800;color:#0f172a;vertical-align:middle" class="sec-title">${text}</td>
    </tr></table>`;

  // ── Table header row ──────────────────────────────────────────────────────
  const th = (cols, tc, bg) =>
    `<tr style="background:${bg}">${cols.map((c, i) =>
      `<th style="padding:11px 14px;text-align:${i === 0 ? 'left' : 'center'};font-size:10px;color:${tc};letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap">${c}</th>`
    ).join('')}</tr>`;

  // ── Scrollable table wrapper ──────────────────────────────────────────────
  const sc = (inner, minW) =>
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:28px">${inner}</div>`;

  const scA = (inner) =>
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid #fecdd3;margin-bottom:28px">${inner}</div>`;

  const scF = (inner) =>
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid #fde68a;margin-bottom:28px">${inner}</div>`;

  // Absent section
  const absentSection = absentCount > 0
    ? sh(`Absent Today &nbsp;<small style="font-size:12px;font-weight:500;color:#64748b">${absentCount} not present today</small>`, 'linear-gradient(#ef4444,#dc2626)') +
      scA(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:380px;border-collapse:collapse">
        ${th(['STAFF MEMBER','TEAM','ROLE','STATUS'], '#fecdd3', 'linear-gradient(135deg,#7f1d1d,#991b1b)')}
        ${absentRows}
      </table>`)
    : `<div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #6ee7b7;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px">
        <div style="font-size:34px;margin-bottom:6px">&#10003;</div>
        <div style="font-size:15px;font-weight:800;color:#065f46">Full House Today!</div>
        <div style="font-size:13px;color:#047857;margin-top:4px">All ${totalStaff} staff members are present today.</div>
      </div>`;

  const flagSection = flagCount > 0
    ? sh(`Needs Attention &nbsp;<small style="font-size:12px;font-weight:500;color:#64748b">${flagCount} staff require follow-up</small>`, 'linear-gradient(#f59e0b,#d97706)') +
      `<div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:13px 16px;margin-bottom:14px;font-size:13px;color:#92400e;line-height:1.7">
        &#9888; &nbsp;These ${flagCount} staff member${flagCount > 1 ? 's' : ''} registered a single punch or worked under 1 hour. Please verify their actual attendance with the supervisor before finalising records.
      </div>` +
      scF(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:500px;border-collapse:collapse">
        ${th(['STAFF MEMBER','ROLE','ENTRY (IST)','EXIT (IST)','HRS','ISSUE'], '#fef3c7', 'linear-gradient(135deg,#78350f,#92400e)')}
        ${flaggedRows}
      </table>`)
    : '';

  // ── Final HTML ────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${BOUTIQUE_NAME} — Daily Attendance</title>
  <style>
    body { margin:0; padding:0; background:#0f172a; }
    @media only screen and (max-width:620px) {
      .ew  { padding:10px 6px !important; }
      .ehdr{ padding:22px 18px 20px !important; }
      .etit{ font-size:22px !important; }
      .esub{ font-size:13px !important; margin-top:10px !important; }
      .ekpi{ padding:16px 10px 18px !important; }
      .kpi-cell  { padding:3px !important; }
      .kpi-inner { padding:14px 5px 12px !important; }
      .kpi-value { font-size:19px !important; }
      .kpi-sub   { font-size:8px !important; letter-spacing:0.8px !important; }
      .kpi-lbl   { font-size:10px !important; }
      .ebod{ padding:22px 14px 18px !important; }
      .sec-title { font-size:13px !important; }
      .efoot{ padding:16px 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a">
<tr><td align="center" style="padding:24px 14px" class="ew">

  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.6)">

    <!-- ╔══════════════════════════════╗
         ║         HEADER               ║
         ╚══════════════════════════════╝ -->
    <tr>
      <td style="background:linear-gradient(145deg,#1a1744 0%,#2d2882 48%,#1d4ed8 100%);padding:34px 36px 28px" class="ehdr">
        <div style="display:inline-block;background:rgba(165,180,252,0.15);border:1px solid rgba(165,180,252,0.3);border-radius:6px;padding:4px 12px;font-size:9px;font-weight:700;color:#c7d2fe;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">
          ${BOUTIQUE_NAME.toUpperCase()} &nbsp;·&nbsp; ATTENDANCE INTELLIGENCE
        </div>
        <div style="color:#fff;font-size:28px;font-weight:900;line-height:1.1;letter-spacing:-0.5px" class="etit">Daily Operations</div>
        <div style="color:#fff;font-size:28px;font-weight:900;line-height:1.1;letter-spacing:-0.5px" class="etit">Report</div>
        <div style="color:#a5b4fc;font-size:14px;margin-top:16px;font-weight:400" class="esub">
          ${dayLabel} &nbsp;·&nbsp; Generated ${timeLabel}
        </div>
      </td>
    </tr>

    <!-- ╔══════════════════════════════╗
         ║      ATTENDANCE PULSE        ║
         ╚══════════════════════════════╝ -->
    <tr>
      <td style="background:linear-gradient(180deg,#1e3357 0%,#0f1f3d 100%);padding:20px 22px 24px" class="ekpi">
        <div style="text-align:center;font-size:10px;font-weight:700;color:#7dd3fc;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">TODAY'S ATTENDANCE PULSE</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${kpi(totalStaff,       'ROSTER',     'Total Staff',   '#a78bfa')}
            ${kpi(presentCount,     'TODAY',      'Present',       '#34d399')}
            ${kpi(absentCount,      'TODAY',      'Absent',        absentCount > 0 ? '#f87171' : '#34d399')}
          </tr>
          <tr>
            ${kpi(attendanceRate+'%','RATE',      'Attendance',    rateCol)}
            ${kpi(avgHours,         'PER PERSON', 'Avg Hours',     '#fbbf24')}
            ${kpi(flagCount,        'ALERTS',     'Need Review',   flagCount > 0 ? '#fb923c' : '#34d399')}
          </tr>
        </table>
      </td>
    </tr>

    <!-- ╔══════════════════════════════╗
         ║         MAIN BODY            ║
         ╚══════════════════════════════╝ -->
    <tr>
      <td style="background:#ffffff;padding:30px 30px 22px" class="ebod">

        <!-- TEAM OVERVIEW -->
        ${sh('Team Performance Overview', 'linear-gradient(180deg,#6366f1,#8b5cf6)')}
        ${sc(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:420px;border-collapse:collapse">
          ${th(['TEAM','PRESENT','ABSENT','TOTAL HRS','AVG HRS / HEAD'], '#c7d2fe', 'linear-gradient(135deg,#1e1b4b,#2d2a8a)')}
          ${teamRows}
        </table>`)}

        <!-- FULL ATTENDANCE TABLE -->
        ${sh(`Today's Attendance &nbsp;<small style="font-size:12px;font-weight:500;color:#94a3b8">${presentCount} of ${totalStaff} present</small>`, 'linear-gradient(180deg,#10b981,#059669)')}
        ${sc(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:510px;border-collapse:collapse">
          ${th(['STAFF MEMBER','ROLE','ENTRY (IST)','EXIT (IST)','HRS','STATUS'], '#a7f3d0', 'linear-gradient(135deg,#064e3b,#065f46)')}
          ${attRows}
        </table>`)}

        <!-- NEEDS ATTENTION -->
        ${flagSection}

        <!-- ABSENT TODAY -->
        ${absentSection}

      </td>
    </tr>

    <!-- ╔══════════════════════════════╗
         ║           FOOTER             ║
         ╚══════════════════════════════╝ -->
    <tr>
      <td style="background:linear-gradient(135deg,#1a1744,#0f172a);padding:20px 30px" class="efoot">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle">
              <div style="color:#a5b4fc;font-size:12px;font-weight:700">${BOUTIQUE_NAME} · Attendance System</div>
              <div style="color:#312e81;font-size:11px;margin-top:3px">Auto-generated · ${dayLabel}</div>
            </td>
            <td align="right" style="vertical-align:middle">
              <div style="color:#4338ca;font-size:11px">Sparsh_Salary_Auto V3</div>
              <div style="color:#312e81;font-size:11px;margin-top:2px">Google Sheets + Apps Script</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

// Shared cell styles
const TD  = 'padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;';
const TD_W= 'padding:11px 14px;border-bottom:1px solid #fde68a;font-size:13px;color:#374151;';
const TDA = 'padding:11px 14px;border-bottom:1px solid #fecdd3;font-size:13px;color:#374151;';
