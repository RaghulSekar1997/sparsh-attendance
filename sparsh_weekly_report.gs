// =============================================================================
// SPARSH BOUTIQUE — CEO WEEKLY ATTENDANCE REPORT
// Week = Saturday → Friday  (Sparsh definition)
// Report auto-adjusts to Sat → today  (e.g. if run on Wednesday, shows Sat–Wed)
// Mobile + Laptop responsive · Direct HTML email (no attachments)
// =============================================================================
// SETUP:
//   1. Open the same Apps Script project as sparsh_daily_report.gs
//   2. File → New → Script → name it "sparsh_weekly_report"
//   3. Paste all code from this file, save (Ctrl/Cmd + S)
//   4. Set a trigger: ⏱ Triggers → + Add Trigger
//      → sendWeeklyAttendanceReport | Time-driven | Week timer | Saturday 8 PM–9 PM
//   5. Update doGet() in sparsh_daily_report.gs to route ?type=weekly (see that file)
//
// NOTE: All shared constants (SPREADSHEET_ID, REPORT_EMAIL, BOUTIQUE_NAME, etc.)
//       and utility functions (toSheetDateStr, ukToIST, dowSakamoto, tl, hc, p2,
//       getSheetRows, loadStaffMaster, TDA …) are defined in sparsh_daily_report.gs
//       and are available here automatically — do NOT redefine them.
// =============================================================================

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

function sendWeeklyAttendanceReport() {
  const tz    = Session.getScriptTimeZone();
  const today = new Date();

  // ── Build date list: this week's Saturday → today ─────────────────────────
  const weekDates = getWeekDates(today, tz);          // array of Date objects
  const dateStrs  = weekDates.map(d => toSheetDateStr(d)); // "25-May-2026 (Mon)"
  const totalDays = dateStrs.length;

  // Sunday = holiday (optional attendance). Mark which slots are Sundays.
  const sundayFlags = weekDates.map(function(date) {
    var dd  = parseInt(Utilities.formatDate(date, tz, 'd'), 10);
    var mon = parseInt(Utilities.formatDate(date, tz, 'M'), 10);
    var yr  = parseInt(Utilities.formatDate(date, tz, 'yyyy'), 10);
    return dowSakamoto(yr, mon, dd) === 0; // true = Sunday
  });
  const mandatoryDays = sundayFlags.filter(function(s) { return !s; }).length;

  Logger.log('Weekly report | ' + dateStrs[0] + ' → ' + dateStrs[totalDays - 1] +
             ' | mandatory days: ' + mandatoryDays + ' (Sundays excluded)');

  // ── Load data ─────────────────────────────────────────────────────────────
  const allStaff  = loadStaffMaster();               // from sparsh_daily_report.gs
  const weeklyMap = loadWeeklyData(dateStrs);        // { dateStr → [records] }
  const staffData = buildStaffWeeklySummary(allStaff, weeklyMap, dateStrs, sundayFlags);

  // ── KPI computations (attendance % uses mandatory days, Sundays excluded) ──
  const totalStaff      = allStaff.length;
  const activeStaff     = staffData.filter(s => s.daysPresent > 0).length;
  const totalHrsAll     = staffData.reduce((s, p) => s + p.totalHours, 0);
  const mandatorySlots  = totalStaff * mandatoryDays;
  const totalMandPres   = staffData.reduce((s, p) => s + p.mandatoryPresent, 0);
  const avgAttPct       = mandatorySlots > 0 ? (totalMandPres / mandatorySlots * 100).toFixed(1) : '0.0';
  const perfectDays     = staffData.filter(s => s.daysAbsent === 0).length; // 0 mandatory absences
  const totalAbsDays    = staffData.reduce((s, p) => s + p.daysAbsent, 0);
  const avgHrsPerHead   = activeStaff > 0 ? (totalHrsAll / activeStaff).toFixed(1) : '0.0';

  const html = buildWeeklyHTML({
    today, tz,
    weekDates, dateStrs, totalDays,
    sundayFlags, mandatoryDays,
    allStaff, staffData,
    totalStaff, activeStaff,
    totalHrsAll, avgAttPct, perfectDays,
    totalAbsDays, avgHrsPerHead
  });

  const weekStartFmt = Utilities.formatDate(weekDates[0], tz, 'd MMM');
  const weekEndFmt   = Utilities.formatDate(today,         tz, 'd MMM yyyy');

  GmailApp.sendEmail(
    REPORT_EMAIL,
    BOUTIQUE_NAME + ' — Weekly Report | ' + weekStartFmt + ' – ' + weekEndFmt,
    'Please view this email in an HTML-capable email client.',
    {
      htmlBody: html,
      name: BOUTIQUE_NAME + ' Attendance'
    }
  );

  Logger.log('Weekly report emailed: ' + weekStartFmt + ' → ' + weekEndFmt);
}

// =============================================================================
// DATE HELPERS
// =============================================================================

/**
 * Returns an array of Date objects from this week's Saturday up to (and including) today.
 * "This week's Saturday" = today minus daysSinceSat days.
 *
 * Sakamoto dow:  0=Sun  1=Mon  2=Tue  3=Wed  4=Thu  5=Fri  6=Sat
 * Days since Sat: Sat→0  Sun→1  Mon→2  Tue→3  Wed→4  Thu→5  Fri→6
 * Formula: (dow + 1) % 7
 */
function getWeekDates(today, tz) {
  const day = parseInt(Utilities.formatDate(today, tz, 'd'),    10);
  const mon = parseInt(Utilities.formatDate(today, tz, 'M'),    10);
  const yr  = parseInt(Utilities.formatDate(today, tz, 'yyyy'), 10);
  const dow = dowSakamoto(yr, mon, day);

  const daysSinceSat = (dow + 1) % 7;

  const dates = [];
  for (let offset = daysSinceSat; offset >= 0; offset--) {
    // Subtract whole days in UTC. IST has no DST so each calendar day = 86 400 000 ms.
    // Utilities.formatDate(result, 'Asia/Kolkata', ...) gives the correct IST date.
    dates.push(new Date(today.getTime() - offset * 86400000));
  }
  return dates;   // [Saturday, Sunday, ..., today]
}

// =============================================================================
// DATA LOADERS
// =============================================================================

/**
 * Reads the Daily Attendance sheet once and partitions rows by date string.
 * Returns:  { "25-May-2026 (Mon)": [ {id, name, team, entryTime, exitTime, hours, status}, … ], … }
 */
function loadWeeklyData(dateStrs) {
  const lookup = {};
  dateStrs.forEach(ds => { lookup[ds] = []; });

  getSheetRows('Daily Attendance', 5).forEach(function(r) {
    var ds = String(r[3] || '').trim();
    if (lookup[ds] !== undefined) {
      var dc = parseDateStr(ds);
      lookup[ds].push({
        id:        String(r[0] || '').trim(),
        name:      String(r[1] || '').trim(),
        team:      String(r[2] || '0').trim(),
        entryTime: dc ? ukToIST(String(r[4] || '').trim(), dc.year, dc.month, dc.day) : '',
        exitTime:  dc ? ukToIST(String(r[5] || '').trim(), dc.year, dc.month, dc.day) : '',
        punches:   parseInt(r[6])   || 0,
        hours:     parseFloat(r[7]) || 0,
        status:    String(r[8] || '').trim()
      });
    }
  });

  return lookup;
}

/**
 * Builds per-staff weekly summary.
 * dailyHours[i] = hours for dateStrs[i], or null if absent that day.
 */
/**
 * sundayFlags[i] = true means dateStrs[i] is a Sunday (holiday — absence not penalised).
 * daysAbsent  = mandatory absences only (Sundays not counted even if absent).
 * mandatoryPresent = days present on non-Sunday days.
 */
function buildStaffWeeklySummary(allStaff, weeklyMap, dateStrs, sundayFlags) {
  var mandatoryCount = sundayFlags.filter(function(f) { return !f; }).length;

  return allStaff.map(function(s) {
    var dailyHours = dateStrs.map(function(ds) {
      var recs = weeklyMap[ds] || [];
      var rec  = recs.filter(function(r) { return r.name === s.name; })[0];
      return rec ? rec.hours : null;   // null = absent
    });

    var daysPresent      = dailyHours.filter(function(h) { return h !== null; }).length;
    // Only flag absences on mandatory (non-Sunday) days
    var mandatoryAbsent  = dailyHours.filter(function(h, i) { return h === null && !sundayFlags[i]; }).length;
    var mandatoryPresent = mandatoryCount - mandatoryAbsent;
    var totalHours       = dailyHours.reduce(function(sum, h) { return sum + (h || 0); }, 0);
    var avgHoursPerDay   = daysPresent > 0 ? totalHours / daysPresent : 0;

    return {
      id: s.id, name: s.name, team: s.team, role: s.role,
      dailyHours:       dailyHours,
      daysPresent:      daysPresent,       // all days including voluntary Sunday
      mandatoryPresent: mandatoryPresent,  // present on non-Sunday days
      daysAbsent:       mandatoryAbsent,   // absences on mandatory days only
      totalHours:       totalHours,
      avgHoursPerDay:   avgHoursPerDay
    };
  });
}

// =============================================================================
// HEATMAP COLOUR
// =============================================================================

/**
 * Returns { bg, txt, tc, bold } for a heatmap cell.
 * hours = null → absent.
 */
function hmCell(hours) {
  if (hours === null)  return { bg: '#fce7f3', txt: '—',               tc: '#e879a0', bold: false }; // absent
  if (hours < 1)       return { bg: '#fee2e2', txt: hours.toFixed(1),  tc: '#dc2626', bold: false }; // < 1 hr
  if (hours < 3)       return { bg: '#fed7aa', txt: hours.toFixed(1),  tc: '#9a3412', bold: false }; // 1–3 hrs
  if (hours < 6)       return { bg: '#fef08a', txt: hours.toFixed(1),  tc: '#713f12', bold: false }; // 3–6 hrs
  if (hours < 8)       return { bg: '#bbf7d0', txt: hours.toFixed(1),  tc: '#14532d', bold: false }; // 6–8 hrs
  return               { bg: '#4ade80',         txt: hours.toFixed(1), tc: '#052e16', bold: true  }; // ≥ 8 hrs
}

// =============================================================================
// HTML BUILDER
// =============================================================================

function buildWeeklyHTML(d) {
  var today        = d.today,        tz            = d.tz;
  var weekDates    = d.weekDates,    dateStrs      = d.dateStrs,    totalDays     = d.totalDays;
  var sundayFlags  = d.sundayFlags,  mandatoryDays = d.mandatoryDays;
  var allStaff     = d.allStaff,     staffData     = d.staffData;
  var totalStaff   = d.totalStaff,   activeStaff   = d.activeStaff;
  var totalHrsAll  = d.totalHrsAll,  avgAttPct     = d.avgAttPct,   perfectDays   = d.perfectDays;
  var totalAbsDays = d.totalAbsDays, avgHrsPerHead = d.avgHrsPerHead;

  // ── Day-column headers (e.g. "Sat 24") ────────────────────────────────────
  var DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var colHeaders = weekDates.map(function(date) {
    var dd  = parseInt(Utilities.formatDate(date, tz, 'd'), 10);
    var mon = parseInt(Utilities.formatDate(date, tz, 'M'), 10);
    var yr  = parseInt(Utilities.formatDate(date, tz, 'yyyy'), 10);
    return DOW_NAMES[dowSakamoto(yr, mon, dd)] + ' ' + p2(dd);
  });

  var weekStartFmt = Utilities.formatDate(weekDates[0], tz, 'd MMM');
  var weekEndFmt   = Utilities.formatDate(today,         tz, 'd MMM yyyy');
  var dayLabel     = Utilities.formatDate(today, tz, 'EEEE, d MMMM yyyy');
  var timeLabel    = Utilities.formatDate(today, tz, 'h:mm a');

  var attPctNum    = parseFloat(avgAttPct);
  var attCol       = attPctNum >= 85 ? '#059669' : attPctNum >= 70 ? '#d97706' : '#dc2626';

  // ── Sort: by team (asc), then total hours (desc) ──────────────────────────
  var sorted = staffData.slice().sort(function(a, b) {
    var t = parseInt(a.team) - parseInt(b.team);
    return t !== 0 ? t : b.totalHours - a.totalHours;
  });

  // ── Local cell style ──────────────────────────────────────────────────────
  var TDW  = 'padding:10px 13px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;';
  var TDWH = 'padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;text-align:center;';

  // ── Micro-helpers ─────────────────────────────────────────────────────────
  var kpi = function(val, sub, lbl, col) {
    return '<td width="33%" style="padding:5px" class="kpi-cell">' +
      '<div style="background:#fff;border-radius:12px;border-top:3px solid ' + col + ';padding:16px 8px 14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.12)" class="kpi-inner">' +
        '<div style="font-size:24px;font-weight:900;color:' + col + ';line-height:1;letter-spacing:-0.5px" class="kpi-value">' + val + '</div>' +
        '<div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin-top:6px;font-weight:700" class="kpi-sub">' + sub + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:3px;font-weight:500" class="kpi-lbl">' + lbl + '</div>' +
      '</div></td>';
  };

  var sh = function(text, grad) {
    return '<table cellpadding="0" cellspacing="0" style="margin-bottom:14px;width:100%"><tr>' +
      '<td style="width:4px;border-radius:3px;background:' + grad + ';vertical-align:middle">&thinsp;</td>' +
      '<td style="padding-left:12px;font-size:15px;font-weight:800;color:#0f172a;vertical-align:middle" class="sec-title">' + text + '</td>' +
      '</tr></table>';
  };

  var sc = function(inner) {
    return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:28px">' + inner + '</div>';
  };

  var scR = function(inner, border) {
    return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid ' + border + ';margin-bottom:28px">' + inner + '</div>';
  };

  var th = function(cols, tc, bg) {
    return '<tr style="background:' + bg + '">' + cols.map(function(c, i) {
      return '<th style="padding:10px 13px;text-align:' + (i === 0 ? 'left' : 'center') + ';font-size:10px;color:' + tc + ';letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap">' + c + '</th>';
    }).join('') + '</tr>';
  };

  // ── Heatmap table ─────────────────────────────────────────────────────────
  var hmHeaderRow = '<tr>' +
    '<th style="padding:10px 13px;text-align:left;font-size:10px;color:#bae6fd;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#0c4a6e,#0369a1)">STAFF MEMBER</th>' +
    '<th style="padding:10px 13px;text-align:center;font-size:10px;color:#bae6fd;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#0c4a6e,#0369a1)">ROLE</th>' +
    colHeaders.map(function(c, j) {
      // Sunday column gets a muted grey header with a "Holiday" sub-label
      if (sundayFlags[j]) {
        return '<th style="padding:8px 10px;text-align:center;font-size:10px;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:#334155">' +
               c + '<br><span style="font-size:8px;font-style:italic;letter-spacing:0;font-weight:400;color:#64748b">Holiday</span></th>';
      }
      return '<th style="padding:10px 13px;text-align:center;font-size:10px;color:#bae6fd;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#0c4a6e,#0369a1)">' + c + '</th>';
    }).join('') +
    '<th style="padding:10px 13px;text-align:center;font-size:10px;color:#bae6fd;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#0c4a6e,#0369a1)">DAYS IN</th>' +
    '<th style="padding:10px 13px;text-align:center;font-size:10px;color:#bae6fd;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#0c4a6e,#0369a1)">TOTAL HRS</th>' +
    '</tr>';

  var hmRows = sorted.map(function(s, i) {
    var rowBg = i % 2 === 0 ? '#ffffff' : '#f0f9ff';
    var cells = s.dailyHours.map(function(h, j) {
      // Sunday absent = grey "H" (holiday — expected, not flagged)
      if (h === null && sundayFlags[j]) {
        return '<td style="' + TDWH + 'background:#f1f5f9;color:#94a3b8;font-style:italic;font-size:11px">H</td>';
      }
      var c = hmCell(h);
      return '<td style="' + TDWH + 'background:' + c.bg + ';color:' + c.tc + ';font-weight:' + (c.bold ? '800' : '600') + '">' + c.txt + '</td>';
    }).join('');

    // DAYS IN shows mandatory present / mandatory total (Sundays excluded from denominator)
    var dayCol = s.mandatoryPresent === mandatoryDays ? '#059669'
               : s.mandatoryPresent === 0             ? '#dc2626'
               :                                        '#d97706';

    return '<tr style="background:' + rowBg + '">' +
      '<td style="' + TDW + 'font-weight:700;color:#0f172a;white-space:nowrap">' + s.name + '</td>' +
      '<td style="' + TDW + 'text-align:center;color:#64748b;font-size:12px;white-space:nowrap">' + tl(s.team) + '</td>' +
      cells +
      '<td style="' + TDW + 'text-align:center;font-weight:800;color:' + dayCol + '">' + s.mandatoryPresent + '/' + mandatoryDays + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-size:15px;font-weight:800;color:' + hc(s.avgHoursPerDay) + '">' + s.totalHours.toFixed(1) + '</td>' +
      '</tr>';
  }).join('');

  // ── Daily breakdown (one row per day) ─────────────────────────────────────
  var dayBreakRows = dateStrs.map(function(ds, i) {
    var isSun   = sundayFlags[i];
    var dayRecs = weeklyMap_ref(ds);
    var present = dayRecs.length;
    var totHrs  = dayRecs.reduce(function(s, r) { return s + r.hours; }, 0);
    var avgH    = present > 0 ? totHrs / present : 0;
    var absent  = totalStaff - present;
    var bg      = isSun ? '#f8fafc' : (i % 2 === 0 ? '#fff' : '#f8fafc');

    // Parse day name from date string e.g. "25-May-2026 (Mon)"
    var dateOnly = ds.replace(/\s*\(.*?\)/, '');
    var dayName  = ds.match(/\(([^)]+)\)/) ? ds.match(/\(([^)]+)\)/)[1] : '';

    if (isSun) {
      // Sunday row — holiday, no coverage target, show volunteers in green
      return '<tr style="background:#f1f5f9">' +
        '<td style="' + TDW + 'font-weight:600;color:#64748b;white-space:nowrap">' + dateOnly +
          ' <span style="color:#94a3b8;font-size:11px">' + dayName + '</span>' +
          ' &nbsp;<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#e2e8f0;color:#64748b;font-size:10px;font-weight:700">HOLIDAY</span></td>' +
        '<td style="' + TDW + 'text-align:center;font-weight:700;color:' + (present > 0 ? '#059669' : '#94a3b8') + '">' + (present > 0 ? present : '—') + '</td>' +
        '<td style="' + TDW + 'text-align:center;color:#94a3b8">—</td>' +
        '<td style="' + TDW + 'text-align:center;color:' + (present > 0 ? '#475569' : '#94a3b8') + '">' + (present > 0 ? totHrs.toFixed(1) + ' hrs' : '—') + '</td>' +
        '<td style="' + TDW + 'text-align:center;color:' + (present > 0 ? hc(avgH) : '#94a3b8') + ';font-weight:' + (present > 0 ? '800' : '400') + '">' + (present > 0 ? avgH.toFixed(1) + ' hrs' : '—') + '</td>' +
        '<td style="' + TDW + 'text-align:center;color:#94a3b8;font-style:italic;font-size:12px">optional</td>' +
        '</tr>';
    }

    var coverage = totalStaff > 0 ? (present / totalStaff * 100).toFixed(0) : '0';
    var covCol   = parseFloat(coverage) >= 85 ? '#059669' : parseFloat(coverage) >= 70 ? '#d97706' : '#dc2626';
    return '<tr style="background:' + bg + '">' +
      '<td style="' + TDW + 'font-weight:600;color:#0f172a;white-space:nowrap">' + dateOnly +
        ' <span style="color:#64748b;font-size:11px">' + dayName + '</span></td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:700;color:#059669">' + present + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:' + (absent > 0 ? '700' : '400') + ';color:' + (absent > 0 ? '#dc2626' : '#94a3b8') + '">' + (absent > 0 ? absent : '—') + '</td>' +
      '<td style="' + TDW + 'text-align:center;color:#475569">' + totHrs.toFixed(1) + ' hrs</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:800;color:' + hc(avgH) + '">' + (present > 0 ? avgH.toFixed(1) : '—') + ' hrs</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:700;color:' + covCol + '">' + coverage + '%</td>' +
      '</tr>';
  }).join('');

  // ── Team aggregate ─────────────────────────────────────────────────────────
  var teamsAgg = {};
  staffData.forEach(function(s) {
    if (!teamsAgg[s.team]) teamsAgg[s.team] = { present: 0, absent: 0, hours: 0, count: 0 };
    teamsAgg[s.team].present += s.daysPresent;
    teamsAgg[s.team].absent  += s.daysAbsent;
    teamsAgg[s.team].hours   += s.totalHours;
    teamsAgg[s.team].count++;
  });

  var teamRows = Object.keys(teamsAgg).sort(function(a, b) {
    return parseInt(a) - parseInt(b);
  }).map(function(t, i) {
    var ag      = teamsAgg[t];
    var avgHpd  = ag.present > 0 ? (ag.hours / ag.present).toFixed(1) : '0.0';
    var attRate = ag.count * totalDays > 0
                  ? (ag.present / (ag.count * totalDays) * 100).toFixed(0) + '%'
                  : '0%';
    var bg = i % 2 === 0 ? '#fff' : '#f8fafc';
    var rateCol = parseFloat(attRate) >= 85 ? '#059669' : parseFloat(attRate) >= 70 ? '#d97706' : '#dc2626';
    return '<tr style="background:' + bg + '">' +
      '<td style="' + TDW + 'font-weight:600;color:#0f172a">' + tl(t) + '</td>' +
      '<td style="' + TDW + 'text-align:center">' + ag.count + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:700;color:#059669">' + ag.present + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:' + (ag.absent > 0 ? '700' : '400') + ';color:' + (ag.absent > 0 ? '#dc2626' : '#94a3b8') + '">' + (ag.absent > 0 ? ag.absent : '—') + '</td>' +
      '<td style="' + TDW + 'text-align:center;color:#475569">' + ag.hours.toFixed(1) + ' hrs</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:700;color:' + rateCol + '">' + attRate + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:600;color:' + hc(parseFloat(avgHpd)) + '">' + avgHpd + ' hrs</td>' +
      '</tr>';
  }).join('');

  // ── Top 5 performers (by total hours) ─────────────────────────────────────
  var topPerformers = staffData.filter(function(s) { return s.daysPresent > 0; })
    .sort(function(a, b) { return b.totalHours - a.totalHours || b.daysPresent - a.daysPresent; })
    .slice(0, 5);

  // Styled rank badges — avoid emoji (supplementary-plane chars break in Apps Script HTML)
  var medalBg   = ['#f59e0b','#94a3b8','#c2732a','#475569','#475569'];
  var medalBord = ['#d97706','#64748b','#a0522d','#334155','#334155'];
  var medals = medalBg.map(function(bg, i) {
    return '<span style="display:inline-block;width:26px;height:26px;background:' + bg +
           ';border:2px solid ' + medalBord[i] + ';color:#fff;border-radius:50%;' +
           'font-size:12px;font-weight:900;text-align:center;line-height:22px">' +
           (i + 1) + '</span>';
  });

  var topRows = topPerformers.map(function(s, i) {
    var bg      = i === 0 ? '#fefce8' : i % 2 === 0 ? '#fff' : '#f8fafc';
    var attPct  = (s.daysPresent / totalDays * 100).toFixed(0);
    var pctCol  = parseFloat(attPct) >= 85 ? '#059669' : parseFloat(attPct) >= 70 ? '#d97706' : '#dc2626';
    return '<tr style="background:' + bg + '">' +
      '<td style="' + TDW + 'text-align:center">' + medals[i] + '</td>' +
      '<td style="' + TDW + 'font-weight:700;color:#0f172a">' + s.name + '</td>' +
      '<td style="' + TDW + 'text-align:center;color:#64748b;font-size:12px">' + tl(s.team) + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-size:16px;font-weight:900;color:' + hc(s.avgHoursPerDay) + '">' + s.totalHours.toFixed(1) + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:700;color:#059669">' + s.daysPresent + '/' + totalDays + '</td>' +
      '<td style="' + TDW + 'text-align:center;font-weight:700;color:' + pctCol + '">' + attPct + '%</td>' +
      '</tr>';
  }).join('');

  // ── Absence alert: staff absent for >50% of MANDATORY (non-Sunday) days ───
  var absentThreshold = Math.max(1, Math.ceil(mandatoryDays / 2));
  var atRisk = staffData.filter(function(s) { return s.daysAbsent >= absentThreshold; })
    .sort(function(a, b) { return b.daysAbsent - a.daysAbsent; });

  var absRows = atRisk.map(function(s, i) {
    var bg  = i % 2 === 0 ? '#fff1f2' : '#fff5f6';
    var pct = (s.daysAbsent / totalDays * 100).toFixed(0);
    return '<tr style="background:' + bg + '">' +
      '<td style="' + TDA + 'font-weight:700;color:#0f172a">' + s.name + '</td>' +
      '<td style="' + TDA + 'text-align:center;color:#64748b;font-size:12px">' + tl(s.team) + '</td>' +
      '<td style="' + TDA + 'text-align:center;font-size:16px;font-weight:900;color:#dc2626">' + s.daysAbsent + '</td>' +
      '<td style="' + TDA + 'text-align:center;font-weight:700;color:#059669">' + s.daysPresent + '</td>' +
      '<td style="' + TDA + 'text-align:center;font-weight:700;color:#dc2626">' + pct + '%</td>' +
      '<td style="' + TDA + 'text-align:center"><span style="display:inline-block;padding:4px 12px;border-radius:20px;background:#ef4444;color:#fff;font-size:11px;font-weight:700">' +
        (s.daysAbsent === totalDays ? 'FULL ABSENCE' : 'AT RISK') +
      '</span></td>' +
      '</tr>';
  }).join('');

  var absentSection = atRisk.length > 0
    ? sh('Absence Alert &nbsp;<small style="font-size:12px;font-weight:500;color:#64748b">' + atRisk.length + ' staff require attention</small>',
         'linear-gradient(#ef4444,#dc2626)') +
      '<div style="background:#fff1f2;border-left:4px solid #ef4444;border-radius:0 8px 8px 0;padding:13px 16px;margin-bottom:14px;font-size:13px;color:#9f1239;line-height:1.7">' +
        '&#9888; &nbsp;These staff members were absent for ' + absentThreshold + ' or more days this week. Please review with the supervisor.' +
      '</div>' +
      scR('<table width="100%" cellpadding="0" cellspacing="0" style="min-width:440px;border-collapse:collapse">' +
            th(['STAFF MEMBER','TEAM','DAYS ABSENT','DAYS IN','ABSENT %','STATUS'], '#fecdd3', 'linear-gradient(135deg,#7f1d1d,#991b1b)') +
            absRows +
          '</table>', '#fecdd3')
    : '<div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #6ee7b7;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px">' +
        '<div style="font-size:34px;margin-bottom:6px">&#11088;</div>' +
        '<div style="font-size:15px;font-weight:800;color:#065f46">Outstanding Attendance!</div>' +
        '<div style="font-size:13px;color:#047857;margin-top:4px">No critical absences this week — the entire team showed up strong.</div>' +
      '</div>';

  // ── Heatmap legend ────────────────────────────────────────────────────────
  var legendItems = [
    { bg: '#f1f5f9', label: 'H = Holiday (Sun)',  tc: '#94a3b8', italic: true  },
    { bg: '#fce7f3', label: 'Absent',             tc: '#e879a0', italic: false },
    { bg: '#fed7aa', label: '&lt; 3 hrs',         tc: '#9a3412', italic: false },
    { bg: '#fef08a', label: '3–6 hrs',            tc: '#713f12', italic: false },
    { bg: '#bbf7d0', label: '6–8 hrs',            tc: '#14532d', italic: false },
    { bg: '#4ade80', label: '&#8805; 8 hrs',      tc: '#052e16', italic: false }
  ];
  var legend = '<table cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>' +
    legendItems.map(function(it) {
      return '<td style="padding:2px 10px 2px 0;white-space:nowrap">' +
        '<span style="display:inline-block;width:22px;height:14px;background:' + it.bg + ';border-radius:3px;vertical-align:middle;margin-right:4px"></span>' +
        '<span style="font-size:11px;color:' + it.tc + ';font-style:' + (it.italic ? 'italic' : 'normal') + '">' + it.label + '</span>' +
        '</td>';
    }).join('') +
    '</tr></table>';

  // ── Need reference to weeklyMap for daily breakdown rows ──────────────────
  // (closure captures weeklyMap from loadWeeklyData; passed via argument d not in scope here)
  // We re-derive it via staffData for robustness.
  function weeklyMap_ref(ds) {
    // Pull records for date ds from staffData.dailyHours is already aggregated;
    // re-derive attendance count by checking who was present that day.
    var idx = dateStrs.indexOf(ds);
    if (idx === -1) return [];
    return staffData.filter(function(s) { return s.dailyHours[idx] !== null; })
      .map(function(s) { return { hours: s.dailyHours[idx] }; });
  }

  // ── FINAL HTML ────────────────────────────────────────────────────────────
  return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
'  <meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
'  <title>' + BOUTIQUE_NAME + ' — Weekly Attendance</title>\n' +
'  <style>\n' +
'    body { margin:0; padding:0; background:#0f172a; }\n' +
'    @media only screen and (max-width:620px) {\n' +
'      .ew   { padding:10px 6px !important; }\n' +
'      .ehdr { padding:22px 18px 20px !important; }\n' +
'      .etit { font-size:22px !important; }\n' +
'      .esub { font-size:13px !important; margin-top:10px !important; }\n' +
'      .ekpi { padding:16px 10px 18px !important; }\n' +
'      .kpi-cell  { padding:3px !important; }\n' +
'      .kpi-inner { padding:14px 5px 12px !important; }\n' +
'      .kpi-value { font-size:19px !important; }\n' +
'      .kpi-sub   { font-size:8px  !important; letter-spacing:0.8px !important; }\n' +
'      .kpi-lbl   { font-size:10px !important; }\n' +
'      .ebod  { padding:22px 14px 18px !important; }\n' +
'      .sec-title { font-size:13px !important; }\n' +
'      .efoot { padding:16px 18px !important; }\n' +
'    }\n' +
'  </style>\n' +
'</head>\n' +
'<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif">\n\n' +

'<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a">\n' +
'<tr><td align="center" style="padding:24px 14px" class="ew">\n\n' +
'  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.6)">\n\n' +

// ── HEADER ────────────────────────────────────────────────────────────────
'    <tr>\n' +
'      <td style="background:linear-gradient(145deg,#0c4a6e 0%,#0369a1 48%,#0ea5e9 100%);padding:34px 36px 28px" class="ehdr">\n' +
'        <div style="display:inline-block;background:rgba(186,230,253,0.15);border:1px solid rgba(186,230,253,0.3);border-radius:6px;padding:4px 12px;font-size:9px;font-weight:700;color:#bae6fd;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">\n' +
'          ' + BOUTIQUE_NAME.toUpperCase() + ' &nbsp;·&nbsp; WEEKLY PERFORMANCE INTELLIGENCE\n' +
'        </div>\n' +
'        <div style="color:#fff;font-size:28px;font-weight:900;line-height:1.1;letter-spacing:-0.5px" class="etit">Weekly Workforce</div>\n' +
'        <div style="color:#fff;font-size:28px;font-weight:900;line-height:1.1;letter-spacing:-0.5px" class="etit">Report</div>\n' +
'        <div style="color:#bae6fd;font-size:14px;margin-top:16px;font-weight:400" class="esub">\n' +
'          Week: ' + weekStartFmt + ' – ' + weekEndFmt + ' &nbsp;·&nbsp; Generated ' + timeLabel + '\n' +
'        </div>\n' +
'      </td>\n' +
'    </tr>\n\n' +

// ── KPI PULSE ─────────────────────────────────────────────────────────────
'    <tr>\n' +
'      <td style="background:linear-gradient(180deg,#0c4a6e 0%,#082f49 100%);padding:20px 22px 24px" class="ekpi">\n' +
'        <div style="text-align:center;font-size:10px;font-weight:700;color:#7dd3fc;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">\n' +
'          WEEK OF ' + weekStartFmt.toUpperCase() + ' – ' + weekEndFmt.toUpperCase() + ' &nbsp;·&nbsp; ' + totalDays + ' DAY' + (totalDays > 1 ? 'S' : '') + ' COVERED\n' +
'        </div>\n' +
'        <table width="100%" cellpadding="0" cellspacing="0">\n' +
'          <tr>\n' +
             kpi(totalStaff,                    'ROSTER',     'Total Staff',     '#a78bfa') +
             kpi(activeStaff,                   'THIS WEEK',  'Active Staff',    '#34d399') +
             kpi(totalDays,                     'SO FAR',     'Days Covered',    '#38bdf8') +
'          </tr>\n' +
'          <tr>\n' +
             kpi(totalHrsAll.toFixed(0) + 'h',  'COMBINED',   'Team Hours',      '#fbbf24') +
             kpi(avgAttPct + '%',               'EXCL. SUN',  'Attendance',      attCol) +
             kpi(perfectDays,                   'NO ABSENCES','Perfect Att.',     perfectDays > 0 ? '#34d399' : '#94a3b8') +
'          </tr>\n' +
'        </table>\n' +
'      </td>\n' +
'    </tr>\n\n' +

// ── WEEK RANGE BANNER ─────────────────────────────────────────────────────
'    <tr>\n' +
'      <td style="background:#f0f9ff;border-bottom:1px solid #bae6fd;padding:14px 30px">\n' +
'        <table width="100%" cellpadding="0" cellspacing="0"><tr>\n' +
'          <td style="vertical-align:middle">\n' +
'            <span style="font-size:13px;font-weight:700;color:#0369a1">&#128197; Reporting Period: </span>\n' +
'            <span style="font-size:13px;font-weight:400;color:#0c4a6e">' + weekStartFmt + ' (Sat) → ' + weekEndFmt + '</span>\n' +
'          </td>\n' +
'          <td align="right" style="vertical-align:middle">\n' +
'            <span style="font-size:12px;color:#0369a1;font-weight:600">' + totalDays + '/7 days &nbsp;·&nbsp; ' + totalStaff + ' staff on roster</span>\n' +
'          </td>\n' +
'        </tr></table>\n' +
'      </td>\n' +
'    </tr>\n\n' +

// ── MAIN BODY ─────────────────────────────────────────────────────────────
'    <tr>\n' +
'      <td style="background:#ffffff;padding:30px 30px 22px" class="ebod">\n\n' +

        // HEATMAP
        sh('Weekly Attendance Heatmap', 'linear-gradient(180deg,#0ea5e9,#0369a1)') +
        legend +
        sc('<table width="100%" cellpadding="0" cellspacing="0" style="min-width:580px;border-collapse:collapse">' +
             hmHeaderRow + hmRows +
           '</table>') +

        // DAILY BREAKDOWN
        sh('Daily Breakdown &nbsp;<small style="font-size:12px;font-weight:500;color:#94a3b8">day-by-day overview</small>',
           'linear-gradient(180deg,#10b981,#059669)') +
        sc('<table width="100%" cellpadding="0" cellspacing="0" style="min-width:440px;border-collapse:collapse">' +
             th(['DATE','PRESENT','ABSENT','TOTAL HRS','AVG HRS / HEAD','COVERAGE'], '#a7f3d0', 'linear-gradient(135deg,#064e3b,#065f46)') +
             dayBreakRows +
           '</table>') +

        // TEAM PERFORMANCE
        sh('Team Performance', 'linear-gradient(180deg,#6366f1,#8b5cf6)') +
        sc('<table width="100%" cellpadding="0" cellspacing="0" style="min-width:480px;border-collapse:collapse">' +
             th(['TEAM','STAFF','PRES. DAYS','ABS. DAYS','TOTAL HRS','ATT. RATE','AVG HRS/DAY'], '#c7d2fe', 'linear-gradient(135deg,#1e1b4b,#2d2a8a)') +
             teamRows +
           '</table>') +

        // TOP PERFORMERS
        (topPerformers.length > 0
          ? sh('Top Performers This Week', 'linear-gradient(180deg,#f59e0b,#d97706)') +
            sc('<table width="100%" cellpadding="0" cellspacing="0" style="min-width:440px;border-collapse:collapse">' +
                 th(['','STAFF MEMBER','ROLE','TOTAL HRS','DAYS IN','ATT. %'], '#fef3c7', 'linear-gradient(135deg,#78350f,#92400e)') +
                 topRows +
               '</table>')
          : '') +

        // ABSENCE ALERT
        absentSection +

'      </td>\n' +
'    </tr>\n\n' +

// ── FOOTER ────────────────────────────────────────────────────────────────
'    <tr>\n' +
'      <td style="background:linear-gradient(135deg,#082f49,#0f172a);padding:20px 30px" class="efoot">\n' +
'        <table width="100%" cellpadding="0" cellspacing="0"><tr>\n' +
'          <td style="vertical-align:middle">\n' +
'            <div style="color:#7dd3fc;font-size:12px;font-weight:700">' + BOUTIQUE_NAME + ' · Weekly Intelligence Report</div>\n' +
'            <div style="color:#164e63;font-size:11px;margin-top:3px">Auto-generated · ' + dayLabel + '</div>\n' +
'          </td>\n' +
'          <td align="right" style="vertical-align:middle">\n' +
'            <div style="color:#0369a1;font-size:11px">Sparsh_Salary_Auto V3</div>\n' +
'            <div style="color:#164e63;font-size:11px;margin-top:2px">Google Sheets + Apps Script</div>\n' +
'          </td>\n' +
'        </tr></table>\n' +
'      </td>\n' +
'    </tr>\n\n' +

'  </table>\n' +
'</td></tr>\n' +
'</table>\n' +
'</body>\n' +
'</html>';
}
