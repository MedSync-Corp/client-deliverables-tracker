// staffing.js — EST-bucketed SPH, persistent staff snapshots, 8h/day
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';
import { toast } from './toast.js';

/* ===== Constants & utils ===== */
const HOURS_PER_DAY = 8;                 // Always 8h/day
const STAFF_TZ = 'America/New_York';     // Force EST/EDT for all day buckets

const fmt = (n) => Number(n ?? 0).toLocaleString();
const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

// YYYY-MM-DD string for a Date when viewed in EST
function ymdEST(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STAFF_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

// “MM/DD” label from YYYY-MM-DD
const mdLabelFromYMD = (ymd) => `${ymd.slice(5,7)}/${ymd.slice(8,10)}`;

// Check if a YYYY-MM-DD date is a weekend
function isWeekend(ymd) {
  const d = new Date(ymd + 'T12:00:00'); // noon to avoid timezone issues
  const day = d.getDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/* ===== Elements ===== */
const kYesterday = document.getElementById('kpi-sph-yesterday');
const kL7 = document.getElementById('kpi-sph-l7');
const kL30 = document.getElementById('kpi-sph-l30');
const tblBody = document.getElementById('sphTableBody');
const chartCanvas = document.getElementById('sphChart');

// Current staff setting form
const staffSettingForm = document.getElementById('staffSettingForm');
const setEffDate = document.getElementById('setEffDate');
const setStaffCount = document.getElementById('setStaffCount');
const setNote = document.getElementById('setNote');

// Active pill
const activeStaffPill = document.getElementById('activeStaffPill');
const activeStaffCount = document.getElementById('activeStaffCount');
const activeStaffSince = document.getElementById('activeStaffSince');

// Planner
const btnOpenPlanner = document.getElementById('btnOpenPlanner');
const capModal = document.getElementById('capModal');
const capClose = document.getElementById('capClose');
const capClose2 = document.getElementById('capClose2');
const capDemand = document.getElementById('capDemand');
const capDays = document.getElementById('capDays');
const capCustomDaysWrap = document.getElementById('capCustomDaysWrap');
const capHrsPer = document.getElementById('capHrsPer');
const capUtil = document.getElementById('capUtil');
const capAuto = document.getElementById('capAuto');
const capStaff = document.getElementById('capStaff');
const capStaffNote = document.getElementById('capStaffNote');
const capAssume = document.getElementById('capAssume');
const capCopy = document.getElementById('capCopy');

/* ===== Data access ===== */
async function fetchData(daysBack = 60) {
  const supabase = await getSupabase();
  if (!supabase) return { comps: [], snaps: [] };

  // Completions (wide window; we bucket to EST locally)
  const since = new Date(Date.now() - daysBack * 86400000);
  const { data: comps, error: compErr } = await supabase
    .from('completions')
    .select('occurred_on,qty_completed')
    .gte('occurred_on', since.toISOString())
    .order('occurred_on', { ascending: true });
  if (compErr) console.error('COMPLETIONS_ERR', compErr);

  // Staff snapshots up to "today (EST)"
  const { data: snaps, error: snapErr } = await supabase
    .from('staffing_snapshots')
    .select('id,effective_date,staff_count,note')
    .lte('effective_date', ymdEST(new Date()))
    .order('effective_date', { ascending: true });
  if (snapErr) console.error('SNAPSHOTS_ERR', snapErr);

  return { comps: comps || [], snaps: snaps || [] };
}

// Bucket completions by EST day
function groupCompletionsByESTDay(comps) {
  const map = new Map(); // 'YYYY-MM-DD' -> total qty
  for (const c of comps) {
    // occurred_on is a DATE (YYYY-MM-DD string), not a timestamp
    // Just use it directly - no timezone conversion needed
    const key = String(c.occurred_on).slice(0, 10);
    map.set(key, (map.get(key) || 0) + Number(c.qty_completed || 0));
  }
  return map;
}

// Latest staff count whose effective_date <= dateYMD
function staffCountForDate(dateYMD, snapsSorted) {
  let chosen = 0;
  for (let i = 0; i < snapsSorted.length; i++) {
    if (snapsSorted[i].effective_date <= dateYMD) chosen = Number(snapsSorted[i].staff_count || 0);
    else break;
  }
  return chosen;
}

// Build last N EST days of data (ascending)
function buildDailySeriesEST(compsMap, snapsSorted, days = 30) {
  const datesYMD = [];
  const completed = [], staff = [], hours = [], sph = [], weekend = [], skipped = [];

  for (let i = days - 1; i >= 0; i--) {
    const ymd = ymdEST(new Date(Date.now() - i * 86400000));
    const c = Number(compsMap.get(ymd) || 0);
    const s = staffCountForDate(ymd, snapsSorted);
    const h = s * HOURS_PER_DAY;
    const isWknd = isWeekend(ymd);
    
    // Skip weekend only if no completions were logged (team didn't work)
    // If there are completions on a weekend, count it toward SPH
    const shouldSkip = isWknd && c === 0;

    datesYMD.push(ymd);
    completed.push(c);
    staff.push(s);
    hours.push(h);
    sph.push(!shouldSkip && h > 0 ? c / h : null);
    weekend.push(isWknd);
    skipped.push(shouldSkip);
  }
  return { datesYMD, completed, staff, hours, sph, weekend, skipped };
}

/* ===== Renderers ===== */
function renderTable(datesYMD, completed, staff, hours, sph, weekend, skipped) {
  if (!tblBody) return;
  tblBody.innerHTML = datesYMD.map((ymd, i) => {
    const isWknd = weekend?.[i];
    const isSkipped = skipped?.[i];
    const workedWeekend = isWknd && !isSkipped;
    
    // Skipped weekends are grayed out, worked weekends get a special highlight
    const rowClass = isSkipped ? 'bg-gray-50 text-gray-400' : (workedWeekend ? 'bg-blue-50' : '');
    const wkndLabel = isSkipped ? ' <span class="text-xs text-gray-400">(wknd)</span>' : 
                      (workedWeekend ? ' <span class="text-xs text-blue-600">(wknd worked)</span>' : '');
    
    return `
    <tr class="${rowClass}">
      <td class="px-4 py-2">${ymd}${wkndLabel}</td>
      <td class="px-4 py-2 text-right">${fmt(completed[i])}</td>
      <td class="px-4 py-2 text-right">${isSkipped ? '—' : fmt(staff[i])}</td>
      <td class="px-4 py-2 text-right">${isSkipped ? '—' : fmt(hours[i])}</td>
      <td class="px-4 py-2 text-right">${sph[i] == null ? '—' : round(sph[i], 2)}</td>
    </tr>`;
  }).reverse().join('');
}

function renderKPIs(datesYMD, sph, skipped) {
  // Find the most recent day with SPH data (skip only non-worked weekends)
  let lastWorkdayIdx = -1;
  for (let i = datesYMD.length - 1; i >= 0; i--) {
    if (!skipped?.[i] && sph[i] != null) {
      lastWorkdayIdx = i;
      break;
    }
  }
  const ySPH = lastWorkdayIdx >= 0 ? sph[lastWorkdayIdx] : null;
  kYesterday?.setAttribute('value', ySPH == null ? '—' : String(round(ySPH, 2)));

  // Filter out skipped days (non-worked weekends) from averages
  const l7 = sph.slice(-7).filter((v, i) => v != null);
  const l30 = sph.filter(v => v != null);
  kL7?.setAttribute('value', l7.length ? String(round(l7.reduce((a,b)=>a+b,0)/l7.length, 2)) : '—');
  kL30?.setAttribute('value', l30.length ? String(round(l30.reduce((a,b)=>a+b,0)/l30.length, 2)) : '—');
}

function renderChart(datesYMD, sph) {
  if (!chartCanvas || !window.Chart) return;
  const labels = datesYMD.map(mdLabelFromYMD);
  const data = sph.map(v => (v == null ? null : round(v, 2)));
  const maxY = Math.max(...data.filter(v => v != null), 0);
  const yMax = maxY > 0 ? Math.ceil(maxY * 1.15) : 1;

  if (window.__sphChart) window.__sphChart.destroy();
  window.__sphChart = new Chart(chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'SPH (EST)',
        data,
        spanGaps: true,
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, suggestedMax: yMax, grid: { color: 'rgba(0,0,0,0.06)' } },
        x: { ticks: { maxRotation: 0, autoSkip: true } }
      }
    }
  });
}

function renderActiveStaffPill(snapsSorted) {
  if (!activeStaffPill) return;
  if (!snapsSorted.length) { activeStaffPill.classList.add('hidden'); return; }
  const latest = snapsSorted[snapsSorted.length - 1];
  activeStaffCount.textContent = fmt(latest.staff_count ?? 0);
  activeStaffSince.textContent = latest.effective_date; // already YYYY-MM-DD
  activeStaffPill.classList.remove('hidden');
}

/* ===== Save snapshot (current staff) ===== */
async function saveStaffSnapshot(effective_date, staff_count, note) {
  const supabase = await getSupabase(); if (!supabase) return;

  const { data: existing, error: selErr } = await supabase
    .from('staffing_snapshots')
    .select('id')
    .eq('effective_date', effective_date)
    .limit(1);
  if (selErr) { console.error('SNAP_SELECT_ERR', selErr); throw selErr; }

  if (existing && existing.length) {
    const { error: updErr } = await supabase
      .from('staffing_snapshots')
      .update({ staff_count, note: note || null })
      .eq('id', existing[0].id);
    if (updErr) { console.error('SNAP_UPDATE_ERR', updErr); throw updErr; }
  } else {
    const { error: insErr } = await supabase
      .from('staffing_snapshots')
      .insert({ effective_date, staff_count, note: note || null });
    if (insErr) { console.error('SNAP_INSERT_ERR', insErr); throw insErr; }
  }
}

/* ===== Capacity Planner helpers ===== */
const mean = (arr) => (arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null);
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a,b)=>a-b);
  const pos = (s.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return s[base] + (s[Math.min(base + 1, s.length - 1)] - s[base]) * rest;
};
function computeMetrics(sphSeries) {
  const l7 = sphSeries.slice(-7).filter(v => v != null);
  const l30 = sphSeries.filter(v => v != null);
  return {
    l7avg: mean(l7),
    l7p90: l7.length ? quantile(l7, 0.90) : null,
    l30avg: mean(l30),
    l30p25: l30.length ? quantile(l30, 0.25) : null
  };
}
function pickBaselineSPH(metrics) {
  const mode = (document.querySelector('input[name="capSph"]:checked')?.value) || 'base';
  if (mode === 'conservative') return metrics.l30p25 ?? metrics.l7avg ?? metrics.l30avg ?? 0;
  if (mode === 'optimistic')  return metrics.l7p90  ?? metrics.l7avg ?? metrics.l30avg ?? 0;
  return metrics.l7avg ?? metrics.l30avg ?? 0;
}
function activePeriodDays() {
  const val = (document.querySelector('input[name="capPeriod"]:checked')?.value) || 'week';
  if (val === 'week') return 5;
  if (val === 'month') return 22;
  const n = Number(capDays.value || 0);
  return Math.max(1, Math.floor(n));
}
function recalcPlanner(metrics) {
  const demand = Number(capDemand.value || 0);
  const days = activePeriodDays();
  const hrsPer = Number(capHrsPer.value || 8);
  const util = Math.max(0, Math.min(100, Number(capUtil.value || 85))) / 100;
  const auto = Math.max(0, Math.min(100, Number(capAuto.value || 0))) / 100;

  const baseSPH = pickBaselineSPH(metrics) || 0;
  const effSPH = baseSPH * util * (1 + auto);
  const denom = effSPH * hrsPer * days;
  const staffNeeded = denom > 0 ? Math.ceil(demand / denom) : 0;

  capStaff.textContent = staffNeeded ? String(staffNeeded) : '—';
  capStaffNote.innerHTML = staffNeeded
    ? `<span class="text-gray-600 text-sm">Covers ${fmt(demand)} summaries across ${days} working day(s) at ~${round(effSPH,2)} SPH effective (EST).</span>`
    : `<span class="text-gray-600 text-sm">Enter demand and ensure SPH/inputs are valid.</span>`;

  capAssume.innerHTML = `
    <div>Baseline SPH: <span class="font-medium">${baseSPH ? round(baseSPH,2) : '—'}</span></div>
    <div>Utilization: <span class="font-medium">${Math.round(util*100)}%</span>; Automation: <span class="font-medium">${Math.round(auto*100)}%</span></div>
    <div>Hours/staff/day: <span class="font-medium">${hrsPer}</span>; Working days: <span class="font-medium">${days}</span></div>
  `;
}
function openPlanner(metrics) { 
  capModal?.classList.remove('hidden'); 
  capModal?.classList.add('flex');
  recalcPlanner(metrics); 
}
function closePlanner() { 
  capModal?.classList.add('hidden'); 
  capModal?.classList.remove('flex');
}

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', async () => {
  try { await requireAuth(); } catch { return; }
  wireLogoutButton();

  // Default Effective Date = today (EST)
  if (setEffDate) setEffDate.value = ymdEST(new Date());

  const supabase = await getSupabase(); if (!supabase) return;

  // Initial load
  const initial = await fetchData(60);
  const compsMap = groupCompletionsByESTDay(initial.comps);
  const snapsSorted = (initial.snaps || []).sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));

  // Pre-fill staff count with latest snapshot (convenience)
  if (snapsSorted.length && setStaffCount) {
    setStaffCount.value = Number(snapsSorted[snapsSorted.length - 1].staff_count || 0);
  }

  renderActiveStaffPill(snapsSorted);

  const series = buildDailySeriesEST(compsMap, snapsSorted, 30);
  renderKPIs(series.datesYMD, series.sph, series.skipped);
  renderChart(series.datesYMD, series.sph);
  renderTable(series.datesYMD, series.completed, series.staff, series.hours, series.sph, series.weekend, series.skipped);

  let metrics = computeMetrics(series.sph);

  // Save snapshot
  staffSettingForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eff = setEffDate.value;                 // already YYYY-MM-DD (EST)
    const cnt = Number(setStaffCount.value || 0);
    const note = setNote.value?.trim() || null;
    if (!eff) return toast.warning('Please choose an effective date.');
    if (!(cnt >= 0)) return toast.warning('Enter a staff count ≥ 0.');

    try { await saveStaffSnapshot(eff, cnt, note); }
    catch { return; }

    // Refresh from source after save
    const fresh = await fetchData(60);
    const freshSnaps = (fresh.snaps || []).sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));
    renderActiveStaffPill(freshSnaps);

    const comps2 = groupCompletionsByESTDay(fresh.comps);
    const s2 = buildDailySeriesEST(comps2, freshSnaps, 30);
    renderKPIs(s2.datesYMD, s2.sph, s2.skipped);
    renderChart(s2.datesYMD, s2.sph);
    renderTable(s2.datesYMD, s2.completed, s2.staff, s2.hours, s2.sph, s2.weekend, s2.skipped);

    metrics = computeMetrics(s2.sph);
    setNote.value = '';
    toast.success('Saved successfully');
  });

  // Planner wiring
  btnOpenPlanner?.addEventListener('click', () => openPlanner(metrics));
  capClose?.addEventListener('click', closePlanner);
  capClose2?.addEventListener('click', closePlanner);

  document.querySelectorAll('input[name="capPeriod"]').forEach(r =>
    r.addEventListener('change', (e) => {
      capCustomDaysWrap.classList.toggle('hidden', e.target.value !== 'custom');
      recalcPlanner(metrics);
    })
  );
  document.querySelectorAll('input[name="capSph"]').forEach(r =>
    r.addEventListener('change', () => recalcPlanner(metrics))
  );
  [capDemand, capDays, capHrsPer, capUtil, capAuto].forEach(el =>
    el?.addEventListener('input', () => recalcPlanner(metrics))
  );

  capCopy?.addEventListener('click', () => {
    const demand = Number(capDemand.value || 0);
    const days = (() => {
      const v = (document.querySelector('input[name="capPeriod"]:checked')?.value) || 'week';
      if (v === 'week') return 5;
      if (v === 'month') return 22;
      const n = Number(capDays.value || 0);
      return Math.max(1, Math.floor(n));
    })();
    const hrsPer = Number(capHrsPer.value || 8);
    const util = Math.max(0, Math.min(100, Number(capUtil.value || 85))) / 100;
    const auto = Math.max(0, Math.min(100, Number(capAuto.value || 0))) / 100;
    const baseSPH = metrics.l7avg ?? metrics.l30avg ?? 0;
    const effSPH = baseSPH * util * (1 + auto);
    const denom = effSPH * hrsPer * days;
    const staffNeeded = denom > 0 ? Math.ceil(demand / denom) : 0;

    const txt = [
      `Capacity Plan (EST)`,
      `Demand: ${demand}`,
      `Working days: ${days}`,
      `Baseline SPH: ${round(baseSPH,2)}`,
      `Utilization: ${Math.round(util*100)}%`,
      `Automation: ${Math.round(auto*100)}%`,
      `Hours/staff/day: ${hrsPer}`,
      `Effective SPH: ${round(effSPH,2)}`,
      `Required staff: ${staffNeeded}`
    ].join('\n');

    navigator.clipboard.writeText(txt).then(() => toast.success('Copied to clipboard'));
  });
});
