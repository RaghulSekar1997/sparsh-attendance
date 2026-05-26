// =============================================================================
// SPARSH BOUTIQUE — CEO MONTHLY ATTENDANCE REPORT
// Covers the full current calendar month (1st → last day)
// Sunday = holiday (optional).  Weeks defined as Saturday → Friday.
// =============================================================================
// SETUP:
//   1. Add this file to the same Apps Script project as the other two reports.
//   2. Set ONE trigger: Time-driven → Day timer → Every day → 9 PM to 10 PM
//      The function auto-checks if today is the last day of the month and
//      exits silently on every other day — no duplicate emails, ever.
//   3. All shared constants + utilities live in sparsh_daily_report.gs.
// =============================================================================

const MONTH_NAMES_LONG  = ['January','February','March','April','May','June',
                            'July','August','September','October','November','December'];
const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                            'Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_NAMES_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * @param {boolean} force  When true, skips the last-day-of-month guard.
 *                         The daily trigger always passes false (default).
 *                         The webhook (?type=monthly) passes true so you can
 *                         test the report at any time.
 */
function sendMonthlyAttendanceReport() {
  const tz    = Session.getScriptTimeZone();
  const today = new Date();

  const day   = parseInt(Utilities.formatDate(today, tz, 'd'),    10);
  const month = parseInt(Utilities.formatDate(today, tz, 'M'),    10);
  const year  = parseInt(Utilities.formatDate(today, tz, 'yyyy'), 10);

  // Report always covers 1st of current month → today.
  // Run on the 10th  → 1–10 May.  Run on the 31st → full month.
  const dim = day;

  Logger.log('Monthly report | 1–' + day + ' ' + MONTH_NAMES_LONG[month - 1] + ' ' + year);

  // ── Build calendar structure ───────────────────────────────────────────────
  const monthDateStrs = generateMonthDateStrs(year, month, dim);   // ds → {day,dow,isSunday}
  const allDateStrs   = Object.keys(monthDateStrs);
  const weekBounds    = getMonthWeekBoundaries(year, month, dim);  // [{weekNum,startDay,endDay,weekDates,label}]

  // ── Load + aggregate ───────────────────────────────────────────────────────
  const allStaff   = loadStaffMaster();
  const monthlyMap = loadMonthlyData(allDateStrs);
  const staffData  = buildStaffMonthlySummary(allStaff, monthlyMap, monthDateStrs, weekBounds);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const totalStaff    = allStaff.length;
  const activeStaff   = staffData.filter(s => s.daysPresent > 0).length;
  const totalHrsAll   = staffData.reduce((s, p) => s + p.totalHours, 0);
  const mandatoryDays = allDateStrs.filter(ds => !monthDateStrs[ds].isSunday).length;
  const totalMandPres = staffData.reduce((s, p) => s + p.mandatoryPresent, 0);
  const avgAttPct     = mandatoryDays * totalStaff > 0
                        ? (totalMandPres / (mandatoryDays * totalStaff) * 100).toFixed(1)
                        : '0.0';
  const perfectStaff  = staffData.filter(s => s.mandatoryAbsent === 0).length;
  const avgHrsPerHead = activeStaff > 0 ? (totalHrsAll / activeStaff).toFixed(1) : '0.0';

  const html = buildMonthlyHTML({
    today, tz, year, month, day, dim,
    monthDateStrs, allDateStrs, weekBounds,
    allStaff, staffData,
    totalStaff, activeStaff, mandatoryDays,
    totalHrsAll, avgAttPct, perfectStaff, avgHrsPerHead
  });

  // Subject shows exact range so it's clear when run mid-month
  const rangeLabel = day === getDaysInMonth(year, month)
                     ? MONTH_NAMES_LONG[month - 1] + ' ' + year + ' (Full Month)'
                     : '1&#8211;' + day + ' ' + MONTH_NAMES_SHORT[month - 1] + ' ' + year;

  GmailApp.sendEmail(
    REPORT_EMAIL,
    BOUTIQUE_NAME + ' — Monthly Report | ' + MONTH_NAMES_LONG[month - 1] + ' ' + year + ' (1–' + day + ' ' + MONTH_NAMES_SHORT[month - 1] + ')',
    'Please view this email in an HTML-capable email client.',
    { htmlBody: html, name: BOUTIQUE_NAME + ' Attendance' }
  );

  Logger.log('Monthly report emailed: 1–' + day + ' ' + MONTH_NAMES_LONG[month - 1] + ' ' + year);
}

// =============================================================================
// CALENDAR HELPERS
// =============================================================================

/** Leap-year-aware days-in-month. */
function getDaysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
}

/**
 * Returns an object: { "01-May-2026 (Fri)": { day:1, dow:5, isSunday:false }, … }
 * Keys match exactly what the sheet stores (built by toSheetDateStr in daily report).
 */
function generateMonthDateStrs(year, month, dim) {
  const result = {};
  for (let d = 1; d <= dim; d++) {
    const dow = dowSakamoto(year, month, d);
    const dd  = d < 10 ? '0' + d : '' + d;
    const ds  = dd + '-' + MONTH_NAMES_SHORT[month - 1] + '-' + year +
                ' (' + DOW_NAMES_SHORT[dow] + ')';
    result[ds] = { day: d, dow: dow, isSunday: dow === 0 };
  }
  return result;
}

/**
 * Splits the month into Sparsh week segments (Sat→Fri), clipped to month boundaries.
 * Each segment: { weekNum, startDay, endDay, weekDates:[{ds,isSunday,day}], label }
 */
function getMonthWeekBoundaries(year, month, dim) {
  const bounds  = [];
  let   d       = 1;
  let   weekNum = 1;

  while (d <= dim) {
    const dow       = dowSakamoto(year, month, d);
    const daysToFri = (5 - dow + 7) % 7;          // 0 if already Friday
    const endD      = Math.min(d + daysToFri, dim);

    const weekDates = [];
    for (let dd = d; dd <= endD; dd++) {
      const wd  = dowSakamoto(year, month, dd);
      const dds = (dd < 10 ? '0' : '') + dd + '-' + MONTH_NAMES_SHORT[month - 1] +
                  '-' + year + ' (' + DOW_NAMES_SHORT[wd] + ')';
      weekDates.push({ ds: dds, isSunday: wd === 0, day: dd });
    }

    const startFmt = d  + ' ' + MONTH_NAMES_SHORT[month - 1];
    const endFmt   = endD + ' ' + MONTH_NAMES_SHORT[month - 1];
    bounds.push({
      weekNum,
      startDay: d,
      endDay:   endD,
      weekDates,
      label:    'Wk ' + weekNum,
      dateRange: startFmt + (d !== endD ? '–' + endFmt : '')
    });

    weekNum++;
    d = endD + 1;
  }
  return bounds;
}

// =============================================================================
// DATA LOADERS
// =============================================================================

function loadMonthlyData(allDateStrs) {
  const lookup = {};
  allDateStrs.forEach(ds => { lookup[ds] = []; });

  getSheetRows('Daily Attendance', 5).forEach(r => {
    const ds = String(r[3] || '').trim();
    if (lookup[ds] !== undefined) {
      const dc = parseDateStr(ds);
      lookup[ds].push({
        id:     String(r[0] || '').trim(),
        name:   String(r[1] || '').trim(),
        team:   String(r[2] || '0').trim(),
        hours:  parseFloat(r[7]) || 0,
        status: String(r[8] || '').trim()
      });
    }
  });
  return lookup;
}

/**
 * Per-staff aggregation for the whole month + weekly breakdown.
 */
function buildStaffMonthlySummary(allStaff, monthlyMap, monthDateStrs, weekBounds) {
  const allDateStrs   = Object.keys(monthDateStrs);
  const mandatoryAll  = allDateStrs.filter(ds => !monthDateStrs[ds].isSunday).length;

  return allStaff.map(s => {
    // Build dailyData: ds → hours (null if absent)
    const dailyData = {};
    allDateStrs.forEach(ds => {
      const rec = (monthlyMap[ds] || []).find(r => r.name === s.name);
      dailyData[ds] = rec ? rec.hours : null;
    });

    let daysPresent = 0, mandatoryPresent = 0, totalHours = 0;
    allDateStrs.forEach(ds => {
      const h = dailyData[ds];
      if (h !== null) {
        daysPresent++;
        if (!monthDateStrs[ds].isSunday) mandatoryPresent++;
        totalHours += h;
      }
    });

    const mandatoryAbsent = mandatoryAll - mandatoryPresent;
    const avgHoursPerDay  = daysPresent > 0 ? totalHours / daysPresent : 0;
    const attPct          = mandatoryAll > 0
                            ? (mandatoryPresent / mandatoryAll * 100).toFixed(1)
                            : '0.0';

    // Weekly totals
    const weeklyHours = weekBounds.map(wb => {
      let wHrs = 0, wPresent = 0, wMandPres = 0;
      const wMandDays = wb.weekDates.filter(wd => !wd.isSunday).length;
      wb.weekDates.forEach(({ ds, isSunday }) => {
        const h = dailyData[ds];
        if (h !== null) { wHrs += h; wPresent++; if (!isSunday) wMandPres++; }
      });
      return { hours: wHrs, daysPresent: wPresent, mandatoryPresent: wMandPres, mandatoryDays: wMandDays };
    });

    return {
      id: s.id, name: s.name, team: s.team, role: s.role,
      dailyData, daysPresent, mandatoryPresent, mandatoryAbsent,
      totalHours, avgHoursPerDay, attPct, weeklyHours
    };
  });
}

// =============================================================================
// COLOUR HELPERS
// =============================================================================

/** Colour for per-person total-hours cell in the summary table. */
function hmCellMonthly(hours) {
  if (hours <= 0)   return { bg: '#fce7f3', txt: '0',              tc: '#e879a0', bold: false };
  if (hours < 40)   return { bg: '#fee2e2', txt: hours.toFixed(1), tc: '#dc2626', bold: false };
  if (hours < 80)   return { bg: '#fed7aa', txt: hours.toFixed(1), tc: '#9a3412', bold: false };
  if (hours < 120)  return { bg: '#fef08a', txt: hours.toFixed(1), tc: '#713f12', bold: false };
  if (hours < 160)  return { bg: '#bbf7d0', txt: hours.toFixed(1), tc: '#14532d', bold: false };
  return              { bg: '#4ade80',       txt: hours.toFixed(1), tc: '#052e16', bold: true  };
}

/** Colour for weekly hours cell in the heatmap (scaled for ~6 working days). */
function hmCellWeek(hours) {
  if (hours <= 0)  return { bg: '#fce7f3', txt: '0',              tc: '#e879a0', bold: false };
  if (hours < 10)  return { bg: '#fee2e2', txt: hours.toFixed(1), tc: '#dc2626', bold: false };
  if (hours < 20)  return { bg: '#fed7aa', txt: hours.toFixed(1), tc: '#9a3412', bold: false };
  if (hours < 30)  return { bg: '#fef08a', txt: hours.toFixed(1), tc: '#713f12', bold: false };
  if (hours < 40)  return { bg: '#bbf7d0', txt: hours.toFixed(1), tc: '#14532d', bold: false };
  return             { bg: '#4ade80',       txt: hours.toFixed(1), tc: '#052e16', bold: true  };
}

// =============================================================================
// HTML BUILDER
// =============================================================================

function buildMonthlyHTML(d) {
  const { today, tz, year, month, day, dim,
          monthDateStrs, allDateStrs, weekBounds,
          allStaff, staffData,
          totalStaff, activeStaff, mandatoryDays,
          totalHrsAll, avgAttPct, perfectStaff, avgHrsPerHead } = d;

  const fullMonthDays = getDaysInMonth(year, month);
  const isFullMonth   = dim === fullMonthDays;

  const monthLabel    = MONTH_NAMES_LONG[month - 1] + ' ' + year;
  // Range label: "Full Month" when last day, otherwise "1–15 May 2026"
  const rangeLabel    = isFullMonth
                        ? monthLabel + ' — Full Month'
                        : '1&#8211;' + day + ' ' + MONTH_NAMES_SHORT[month - 1] + ' ' + year;
  const dayLabel      = Utilities.formatDate(today, tz, 'EEEE, d MMMM yyyy');
  const timeLabel     = Utilities.formatDate(today, tz, 'h:mm a');
  const attPctNum     = parseFloat(avgAttPct);
  const attCol        = attPctNum >= 85 ? '#059669' : attPctNum >= 70 ? '#d97706' : '#dc2626';
  const sundaysInPeriod = allDateStrs.filter(ds => monthDateStrs[ds].isSunday).length;

  // ── Sort: team asc, then total hours desc ─────────────────────────────────
  const sorted = staffData.slice().sort((a, b) => {
    const t = parseInt(a.team) - parseInt(b.team);
    return t !== 0 ? t : b.totalHours - a.totalHours;
  });

  // ── Cell styles ───────────────────────────────────────────────────────────
  const TDM  = 'padding:10px 13px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;';
  const TDMH = 'padding:8px 10px;border-bottom:1px solid #fef3c7;font-size:12px;color:#374151;text-align:center;';

  // ── Micro-helpers ─────────────────────────────────────────────────────────
  const kpi = (val, sub, lbl, col) =>
    `<td width="33%" style="padding:5px" class="kpi-cell">
      <div style="background:#fff;border-radius:12px;border-top:3px solid ${col};padding:16px 8px 14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.12)" class="kpi-inner">
        <div style="font-size:24px;font-weight:900;color:${col};line-height:1;letter-spacing:-0.5px" class="kpi-value">${val}</div>
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin-top:6px;font-weight:700" class="kpi-sub">${sub}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;font-weight:500" class="kpi-lbl">${lbl}</div>
      </div></td>`;

  const sh = (text, grad) =>
    `<table cellpadding="0" cellspacing="0" style="margin-bottom:14px;width:100%"><tr>
      <td style="width:4px;border-radius:3px;background:${grad};vertical-align:middle">&thinsp;</td>
      <td style="padding-left:12px;font-size:15px;font-weight:800;color:#0f172a;vertical-align:middle" class="sec-title">${text}</td>
    </tr></table>`;

  const sc = inner =>
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:28px">${inner}</div>`;

  const scR = (inner, border) =>
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid ${border};margin-bottom:28px">${inner}</div>`;

  const th = (cols, tc, bg) =>
    `<tr style="background:${bg}">${cols.map((c, i) =>
      `<th style="padding:10px 13px;text-align:${i === 0 ? 'left' : 'center'};font-size:10px;color:${tc};letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap">${c}</th>`
    ).join('')}</tr>`;

  // ── Monthly badges for rank ────────────────────────────────────────────────
  const medalBg   = ['#f59e0b', '#94a3b8', '#c2732a', '#475569', '#475569'];
  const medalBord = ['#d97706', '#64748b', '#a0522d', '#334155', '#334155'];
  const medals = medalBg.map((bg, i) =>
    `<span style="display:inline-block;width:26px;height:26px;background:${bg};border:2px solid ${medalBord[i]};color:#fff;border-radius:50%;font-size:12px;font-weight:900;text-align:center;line-height:22px">${i + 1}</span>`
  );

  // ── 1. Monthly staff summary table ────────────────────────────────────────
  const summaryRows = sorted.map((s, i) => {
    const bg     = i % 2 === 0 ? '#fff' : '#fffbeb';
    const pctNum = parseFloat(s.attPct);
    const pctCol = pctNum >= 85 ? '#059669' : pctNum >= 70 ? '#d97706' : '#dc2626';
    return `<tr style="background:${bg}">
      <td style="${TDM}font-weight:700;color:#0f172a;white-space:nowrap">${s.name}</td>
      <td style="${TDM}text-align:center;color:#64748b;font-size:12px;white-space:nowrap">${tl(s.team)}</td>
      <td style="${TDM}text-align:center;font-weight:700;color:#059669">${s.mandatoryPresent}</td>
      <td style="${TDM}text-align:center;font-weight:${s.mandatoryAbsent > 0 ? '700' : '400'};color:${s.mandatoryAbsent > 0 ? '#dc2626' : '#94a3b8'}">${s.mandatoryAbsent > 0 ? s.mandatoryAbsent : '&#8212;'}</td>
      <td style="${TDM}text-align:center;font-size:14px;font-weight:900;color:${hc(s.avgHoursPerDay)}">${s.totalHours.toFixed(1)}</td>
      <td style="${TDM}text-align:center;color:#475569">${s.avgHoursPerDay.toFixed(1)}</td>
      <td style="${TDM}text-align:center;font-weight:700;color:${pctCol}">${s.attPct}%</td>
    </tr>`;
  }).join('');

  // ── 2. Weekly hours heatmap ───────────────────────────────────────────────
  const wkHdrRow =
    `<tr>` +
    `<th style="padding:10px 13px;text-align:left;font-size:10px;color:#fef3c7;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#451a03,#92400e)">STAFF MEMBER</th>` +
    `<th style="padding:10px 13px;text-align:center;font-size:10px;color:#fef3c7;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#451a03,#92400e)">ROLE</th>` +
    weekBounds.map(wb =>
      `<th style="padding:8px 10px;text-align:center;font-size:10px;color:#fef3c7;letter-spacing:1px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#451a03,#92400e)">${wb.label}<br><span style="font-size:8px;font-weight:400;letter-spacing:0;color:#fed7aa">${wb.dateRange}</span></th>`
    ).join('') +
    `<th style="padding:10px 13px;text-align:center;font-size:10px;color:#fef3c7;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,#451a03,#92400e)">TOTAL HRS</th>` +
    `</tr>`;

  const wkRows = sorted.map((s, i) => {
    const bg    = i % 2 === 0 ? '#ffffff' : '#fffbeb';
    const cells = s.weeklyHours.map(w => {
      if (w.daysPresent === 0) {
        return `<td style="${TDMH}background:#fce7f3;color:#e879a0;font-weight:600">0</td>`;
      }
      const c = hmCellWeek(w.hours);
      return `<td style="${TDMH}background:${c.bg};color:${c.tc};font-weight:${c.bold ? '800' : '600'}">${c.txt}</td>`;
    }).join('');
    const tc = hmCellMonthly(s.totalHours);
    return `<tr style="background:${bg}">
      <td style="${TDM}font-weight:700;color:#0f172a;white-space:nowrap">${s.name}</td>
      <td style="${TDM}text-align:center;color:#64748b;font-size:12px;white-space:nowrap">${tl(s.team)}</td>
      ${cells}
      <td style="${TDM}text-align:center;font-size:15px;font-weight:900;background:${tc.bg};color:${tc.tc}">${tc.txt}</td>
    </tr>`;
  }).join('');

  // ── 3. Team aggregate ─────────────────────────────────────────────────────
  const teamsAgg = {};
  staffData.forEach(s => {
    if (!teamsAgg[s.team]) teamsAgg[s.team] = { present: 0, absent: 0, hours: 0, count: 0 };
    teamsAgg[s.team].present += s.mandatoryPresent;
    teamsAgg[s.team].absent  += s.mandatoryAbsent;
    teamsAgg[s.team].hours   += s.totalHours;
    teamsAgg[s.team].count++;
  });
  const teamRows = Object.keys(teamsAgg).sort((a, b) => parseInt(a) - parseInt(b)).map((t, i) => {
    const ag      = teamsAgg[t];
    const maxSlots = ag.count * mandatoryDays;
    const attRate = maxSlots > 0 ? (ag.present / maxSlots * 100).toFixed(0) + '%' : '0%';
    const avgHpd  = ag.present > 0 ? (ag.hours / ag.present).toFixed(1) : '0.0';
    const bg      = i % 2 === 0 ? '#fff' : '#fffbeb';
    const rateCol = parseFloat(attRate) >= 85 ? '#059669' : parseFloat(attRate) >= 70 ? '#d97706' : '#dc2626';
    return `<tr style="background:${bg}">
      <td style="${TDM}font-weight:600;color:#0f172a">${tl(t)}</td>
      <td style="${TDM}text-align:center">${ag.count}</td>
      <td style="${TDM}text-align:center;font-weight:700;color:#059669">${ag.present}</td>
      <td style="${TDM}text-align:center;font-weight:${ag.absent > 0 ? '700' : '400'};color:${ag.absent > 0 ? '#dc2626' : '#94a3b8'}">${ag.absent > 0 ? ag.absent : '&#8212;'}</td>
      <td style="${TDM}text-align:center;color:#475569">${ag.hours.toFixed(1)} hrs</td>
      <td style="${TDM}text-align:center;font-weight:700;color:${rateCol}">${attRate}</td>
      <td style="${TDM}text-align:center;font-weight:600;color:${hc(parseFloat(avgHpd))}">${avgHpd} hrs</td>
    </tr>`;
  }).join('');

  // ── 4. Top performers (top 5 by total hours) ──────────────────────────────
  const topPerformers = staffData
    .filter(s => s.daysPresent > 0)
    .sort((a, b) => b.totalHours - a.totalHours || a.mandatoryAbsent - b.mandatoryAbsent)
    .slice(0, 5);

  const topRows = topPerformers.map((s, i) => {
    const bg     = i === 0 ? '#fefce8' : i % 2 === 0 ? '#fff' : '#fffbeb';
    const pctNum = parseFloat(s.attPct);
    const pctCol = pctNum >= 85 ? '#059669' : pctNum >= 70 ? '#d97706' : '#dc2626';
    return `<tr style="background:${bg}">
      <td style="${TDM}text-align:center">${medals[i]}</td>
      <td style="${TDM}font-weight:700;color:#0f172a">${s.name}</td>
      <td style="${TDM}text-align:center;color:#64748b;font-size:12px">${tl(s.team)}</td>
      <td style="${TDM}text-align:center;font-size:16px;font-weight:900;color:${hc(s.avgHoursPerDay)}">${s.totalHours.toFixed(1)}</td>
      <td style="${TDM}text-align:center;font-weight:700;color:#059669">${s.mandatoryPresent}/${mandatoryDays}</td>
      <td style="${TDM}text-align:center;font-weight:700;color:${pctCol}">${s.attPct}%</td>
    </tr>`;
  }).join('');

  // ── 5. Absence report (3+ mandatory absences) ─────────────────────────────
  const absThreshold = Math.max(3, Math.ceil(mandatoryDays * 0.25)); // 25% of working days
  const atRisk = staffData
    .filter(s => s.mandatoryAbsent >= absThreshold)
    .sort((a, b) => b.mandatoryAbsent - a.mandatoryAbsent);

  const absRows = atRisk.map((s, i) => {
    const bg  = i % 2 === 0 ? '#fff1f2' : '#fff5f6';
    const pct = (s.mandatoryAbsent / mandatoryDays * 100).toFixed(0);
    return `<tr style="background:${bg}">
      <td style="${TDA}font-weight:700;color:#0f172a">${s.name}</td>
      <td style="${TDA}text-align:center;color:#64748b;font-size:12px">${tl(s.team)}</td>
      <td style="${TDA}text-align:center;font-size:16px;font-weight:900;color:#dc2626">${s.mandatoryAbsent}</td>
      <td style="${TDA}text-align:center;font-weight:700;color:#059669">${s.mandatoryPresent}</td>
      <td style="${TDA}text-align:center;font-weight:700;color:#dc2626">${pct}%</td>
      <td style="${TDA}text-align:center">
        <span style="display:inline-block;padding:4px 12px;border-radius:20px;background:#ef4444;color:#fff;font-size:11px;font-weight:700">${s.mandatoryAbsent === mandatoryDays ? 'NO SHOWS' : 'HIGH ABSENCE'}</span>
      </td>
    </tr>`;
  }).join('');

  const absentSection = atRisk.length > 0
    ? sh(`Absence Report &nbsp;<small style="font-size:12px;font-weight:500;color:#64748b">${atRisk.length} staff with high absenteeism</small>`, 'linear-gradient(#ef4444,#dc2626)') +
      scR(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:440px;border-collapse:collapse">
        ${th(['STAFF MEMBER','TEAM','DAYS ABSENT','DAYS IN','ABSENT %','STATUS'], '#fecdd3', 'linear-gradient(135deg,#7f1d1d,#991b1b)')}
        ${absRows}
      </table>`, '#fecdd3')
    : `<div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #6ee7b7;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px">
        <div style="font-size:30px;margin-bottom:6px">&#10003;</div>
        <div style="font-size:15px;font-weight:800;color:#065f46">Excellent Attendance Month!</div>
        <div style="font-size:13px;color:#047857;margin-top:4px">No staff crossed the high-absence threshold this month.</div>
      </div>`;

  // ── 6. Monthly insights ────────────────────────────────────────────────────
  // Best single day (most staff present)
  let bestDayDs = '', bestDayCount = 0;
  allDateStrs.forEach(ds => {
    if (!monthDateStrs[ds].isSunday) {
      const cnt = (monthlyMap_ref(ds, staffData)).length;
      if (cnt > bestDayCount) { bestDayCount = cnt; bestDayDs = ds; }
    }
  });
  // Best week (most team hours)
  let bestWeekIdx = 0;
  weekBounds.forEach((wb, i) => {
    const wHrs = staffData.reduce((s, p) => s + p.weeklyHours[i].hours, 0);
    const bestHrs = staffData.reduce((s, p) => s + p.weeklyHours[bestWeekIdx].hours, 0);
    if (wHrs > bestHrs) bestWeekIdx = i;
  });
  const bestWeekHrs = staffData.reduce((s, p) => s + p.weeklyHours[bestWeekIdx].hours, 0);
  // Sunday volunteers — derived from staffData (monthlyMap not in scope here)
  const sundayWorkers = allDateStrs
    .filter(ds => monthDateStrs[ds].isSunday)
    .reduce((cnt, ds) => cnt + staffData.filter(s => s.dailyData[ds] !== null && s.dailyData[ds] !== undefined).length, 0);

  const insightCards = [
    { icon: '&#127775;', label: 'Best Day', value: bestDayDs ? bestDayDs.replace(/\s*\(.*?\)/, '') : '&#8212;', sub: bestDayCount + ' staff present', col: '#f59e0b' },
    { icon: '&#128200;', label: 'Best Week', value: weekBounds[bestWeekIdx] ? weekBounds[bestWeekIdx].label : '&#8212;', sub: bestWeekHrs.toFixed(0) + ' hrs combined', col: '#10b981' },
    { icon: '&#128081;', label: 'Perfect Attendance', value: perfectStaff, sub: 'zero mandatory absences', col: '#6366f1' },
    { icon: '&#9749;',   label: 'Sunday Volunteers', value: sundayWorkers, sub: 'shifts on holiday (optional)', col: '#0ea5e9' }
  ].map(ins =>
    `<td width="25%" style="padding:6px">
      <div style="background:#fff;border-radius:10px;border-left:4px solid ${ins.col};padding:14px 12px;box-shadow:0 2px 6px rgba(0,0,0,0.08)">
        <div style="font-size:20px;margin-bottom:6px">${ins.icon}</div>
        <div style="font-size:18px;font-weight:900;color:${ins.col};line-height:1">${ins.value}</div>
        <div style="font-size:10px;font-weight:700;color:#374151;margin-top:5px;text-transform:uppercase;letter-spacing:0.5px">${ins.label}</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px">${ins.sub}</div>
      </div>
    </td>`
  ).join('');

  // ── Weekly legend ──────────────────────────────────────────────────────────
  const wkLegend =
    `<table cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>` +
    [['#fce7f3','0 hrs'],['#fee2e2','&lt;10'],['#fed7aa','10&#8211;20'],['#fef08a','20&#8211;30'],['#bbf7d0','30&#8211;40'],['#4ade80','&#8805;40']].map(([bg, lbl]) =>
      `<td style="padding:2px 10px 2px 0;white-space:nowrap"><span style="display:inline-block;width:22px;height:14px;background:${bg};border-radius:3px;vertical-align:middle;margin-right:4px"></span><span style="font-size:11px;color:#64748b">${lbl} hrs/wk</span></td>`
    ).join('') +
    `</tr></table>`;

  // ── FINAL HTML ─────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${BOUTIQUE_NAME} &mdash; Monthly Attendance</title>
  <style>
    body { margin:0; padding:0; background:#0f172a; }
    @media only screen and (max-width:620px) {
      .ew   { padding:10px 6px !important; }
      .ehdr { padding:22px 18px 20px !important; }
      .etit { font-size:22px !important; }
      .esub { font-size:13px !important; margin-top:10px !important; }
      .ekpi { padding:16px 10px 18px !important; }
      .kpi-cell  { padding:3px !important; }
      .kpi-inner { padding:14px 5px 12px !important; }
      .kpi-value { font-size:19px !important; }
      .kpi-sub   { font-size:8px  !important; letter-spacing:0.8px !important; }
      .kpi-lbl   { font-size:10px !important; }
      .ebod  { padding:22px 14px 18px !important; }
      .sec-title { font-size:13px !important; }
      .efoot { padding:16px 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a">
<tr><td align="center" style="padding:24px 14px" class="ew">

  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:700px;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.6)">

    <!-- HEADER -->
    <tr>
      <td style="background:linear-gradient(145deg,#431407 0%,#9a3412 48%,#ea580c 100%);padding:34px 36px 28px" class="ehdr">
        <div style="display:inline-block;background:rgba(254,215,170,0.15);border:1px solid rgba(254,215,170,0.3);border-radius:6px;padding:4px 12px;font-size:9px;font-weight:700;color:#fed7aa;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">
          ${BOUTIQUE_NAME.toUpperCase()} &nbsp;&middot;&nbsp; MONTHLY PERFORMANCE INTELLIGENCE
        </div>
        <div style="color:#fff;font-size:28px;font-weight:900;line-height:1.1;letter-spacing:-0.5px" class="etit">Monthly Workforce</div>
        <div style="color:#fff;font-size:28px;font-weight:900;line-height:1.1;letter-spacing:-0.5px" class="etit">Report</div>
        <div style="color:#fed7aa;font-size:14px;margin-top:16px;font-weight:400" class="esub">
          ${rangeLabel} &nbsp;&middot;&nbsp; Generated ${timeLabel}
        </div>
      </td>
    </tr>

    <!-- KPI PULSE -->
    <tr>
      <td style="background:linear-gradient(180deg,#431407 0%,#1c0702 100%);padding:20px 22px 24px" class="ekpi">
        <div style="text-align:center;font-size:10px;font-weight:700;color:#fb923c;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">
          ${rangeLabel.toUpperCase()} &nbsp;&middot;&nbsp; ${mandatoryDays} WORKING DAYS (SUNDAYS EXCLUDED)
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${kpi(totalStaff,                     'ROSTER',      'Total Staff',        '#a78bfa')}
            ${kpi(activeStaff,                    'THIS MONTH',  'Active Staff',       '#34d399')}
            ${kpi(mandatoryDays,                  'WORKING',     'Mandatory Days',     '#38bdf8')}
          </tr>
          <tr>
            ${kpi(totalHrsAll.toFixed(0) + 'h',   'COMBINED',    'Team Hours',         '#fbbf24')}
            ${kpi(avgAttPct + '%',                 'EXCL. SUN',  'Attendance',         attCol)}
            ${kpi(perfectStaff,                   'ZERO ABSENT', 'Perfect Att.',       perfectStaff > 0 ? '#34d399' : '#94a3b8')}
          </tr>
        </table>
      </td>
    </tr>

    <!-- MONTH BANNER -->
    <tr>
      <td style="background:#fffbeb;border-bottom:1px solid #fde68a;padding:14px 30px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle">
            <span style="font-size:13px;font-weight:700;color:#92400e">&#128197; ${rangeLabel}</span>
            <span style="font-size:12px;color:#b45309;margin-left:8px">${dim} days covered &nbsp;&middot;&nbsp; ${sundaysInPeriod} Sunday${sundaysInPeriod !== 1 ? 's' : ''} (holiday) &nbsp;&middot;&nbsp; ${mandatoryDays} working days</span>
          </td>
          <td align="right" style="vertical-align:middle">
            <span style="font-size:12px;color:#92400e;font-weight:600">${totalStaff} staff &nbsp;&middot;&nbsp; ${weekBounds.length} weeks</span>
          </td>
        </tr></table>
      </td>
    </tr>

    <!-- MAIN BODY -->
    <tr>
      <td style="background:#ffffff;padding:30px 30px 22px" class="ebod">

        <!-- MONTHLY INSIGHTS -->
        ${sh('Monthly Highlights', 'linear-gradient(180deg,#f59e0b,#d97706)')}
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
          <tr>${insightCards}</tr>
        </table>

        <!-- STAFF SUMMARY -->
        ${sh(`Staff Monthly Summary &nbsp;<small style="font-size:12px;font-weight:500;color:#94a3b8">${totalStaff} members &middot; ${mandatoryDays} working days</small>`, 'linear-gradient(180deg,#ea580c,#c2410c)')}
        ${sc(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:500px;border-collapse:collapse">
          ${th(['STAFF MEMBER','ROLE','DAYS IN','DAYS ABSENT','TOTAL HRS','AVG HRS/DAY','ATT. %'], '#fef3c7', 'linear-gradient(135deg,#431407,#9a3412)')}
          ${summaryRows}
        </table>`)}

        <!-- WEEKLY HOURS HEATMAP -->
        ${sh('Weekly Hours Breakdown', 'linear-gradient(180deg,#f59e0b,#d97706)')}
        ${wkLegend}
        ${sc(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:520px;border-collapse:collapse">
          ${wkHdrRow}
          ${wkRows}
        </table>`)}

        <!-- TEAM PERFORMANCE -->
        ${sh('Team Performance', 'linear-gradient(180deg,#6366f1,#8b5cf6)')}
        ${sc(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:480px;border-collapse:collapse">
          ${th(['TEAM','STAFF','PRES. DAYS','ABS. DAYS','TOTAL HRS','ATT. RATE','AVG HRS/DAY'], '#c7d2fe', 'linear-gradient(135deg,#1e1b4b,#2d2a8a)')}
          ${teamRows}
        </table>`)}

        <!-- TOP PERFORMERS -->
        ${topPerformers.length > 0
          ? sh('Top Performers &mdash; ' + monthLabel, 'linear-gradient(180deg,#f59e0b,#d97706)') +
            sc(`<table width="100%" cellpadding="0" cellspacing="0" style="min-width:440px;border-collapse:collapse">
              ${th(['','STAFF MEMBER','ROLE','TOTAL HRS','DAYS IN','ATT. %'], '#fef3c7', 'linear-gradient(135deg,#78350f,#92400e)')}
              ${topRows}
            </table>`)
          : ''}

        <!-- ABSENCE REPORT -->
        ${absentSection}

      </td>
    </tr>

    <!-- FOOTER -->
    <tr>
      <td style="background:linear-gradient(135deg,#431407,#0f172a);padding:20px 30px" class="efoot">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle">
            <div style="color:#fb923c;font-size:12px;font-weight:700">${BOUTIQUE_NAME} &middot; Monthly Intelligence Report</div>
            <div style="color:#431407;font-size:11px;margin-top:3px">Auto-generated &middot; ${dayLabel}</div>
          </td>
          <td align="right" style="vertical-align:middle">
            <div style="color:#9a3412;font-size:11px">Sparsh_Salary_Auto V3</div>
            <div style="color:#431407;font-size:11px;margin-top:2px">Google Sheets + Apps Script</div>
          </td>
        </tr></table>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`;

  // Helper: get present staff count for a given date string (from staffData)
  function monthlyMap_ref(ds, sData) {
    return sData.filter(s => s.dailyData[ds] !== null && s.dailyData[ds] !== undefined);
  }
}
