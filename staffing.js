// staffing.js — new tab only; no changes to existing pages/components
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';

/* ===== Utils ===== */
const fmt = (n) => Number(n ?? 0).toLocaleString();
const round = (n, d=2) => Number.isFinite(n) ? Number(n.toFixed(d)) : null;
const todayLocal = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(d.getDate()+n); x.setHours(0,0,0,0); return x; };
const ymdLocal = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const dayLabel = (d) => d.toLocaleDateString(undefined, { month:'2-digit', day:'2-digit' });
const mean = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a,b)=>a-b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos), rest = pos - base;
  return s[base] + (s[Math.min(base+1, s.length-1)] - s[base]) * rest;
};

/* ===== Elements ===== */
const kYesterday = document.getElementById('kpi-sph-yesterday');
const kL7 = document.getElementById('kpi-sph-l7');
const kL30 = document.getElementById('kpi-sph-l30');
const tblBody = document.getElementById('sphTableBody');
const chartCanvas = document.getElementById('sphChart');

const staffingForm = document.getElementById('staffingForm');
const staffDate = document.getElementById('staffDate');
const staffHours = document.getElementById('staffHours');
const staffNote = document.getElementById('staffNote');

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
async function fetchData(daysBack=60) {
  const supabase = await getSupabase(); if (!supabase) return { comps: [], staffing: [] };

  // Pull completions for the past N days
  const start = addDays(todayLocal(), -daysBack);
  const { data: comps } = await supabase
    .from('completions')
    .select('occurred_on,qty_completed')
    .gte('occurred_on', new Date(start.getTime() - 1).toISOString())
    .order('occurred_on', { ascending: true });

  // Pull staffing rows for the past N days
  const { data: staffing } = await supabase
    .from('daily_staffing')
    .select('id,date,total_staff_hours,note')
    .gte('date', ymdLocal(start))
    .order('date', { ascending: true });

  return { comps: comps || [], staffing: staffing || [] };
}

function groupCompletionsByLocalDay(comps) {
  const map = new Map();
  for (const c of comps) {
    const d = new Date(c.occurred_on);
    d.setHours(0,0,0,0);
    const key = ymdLocal(d);
    map.set(key, (map.get(key) || 0) + Number(c.qty_completed || 0));
  }
  return map; // key: 'YYYY-MM-DD' -> total completed (can be negative)
}

function staffingMap(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.date, Number(r.total_staff_hours || 0));
  return map; // key: 'YYYY-MM-DD' -> hours
}

function buildDailySeries(compsMap, staffMap, days=30) {
  const end = todayLocal();
  const start = addDays(end, -days+1);
  const dates = [];
  const completed = [];
  const hours = [];
  const sph = [];

  for (let i=0; i<days; i++) {
    const d = addDays(start, i);
    const key = ymdLocal(d);
    const c = Number(compsMap.get(key) || 0);
    const h = Number(staffMap.get(key) || 0);
    dates.push(d);
    completed.push(c);
    hours.push(h);
    sph.push(h > 0 ? c / h : null);
  }
  return { dates, completed, hours, sph };
}

/* ===== Renderers ===== */
function renderTable(dates, completed, hours, sph) {
  if (!tblBody) return;
  tblBody.innerHTML = dates.map((d, i) => `
    <tr>
      <td class="px-4 py-2">${ymdLocal(d)}</td>
      <td class="px-4 py-2 text-right">${fmt(completed[i])}</td>
      <td class="px-4 py-2 text-right">${fmt(hours[i])}</td>
      <td class="px-4 py-2 text-right">${sph[i] == null ? '—' : round(sph[i], 2)}</td>
    </tr>
  `).reverse().join(''); // most recent first
}

function renderKPIs(dates, completed, hours, sph) {
  // Yesterday
  const yIdx = dates.length - 2; // yesterday relative to today index at end-1
  const ySPH = yIdx >= 0 ? sph[yIdx] : null;
  kYesterday?.setAttribute('value', ySPH == null ? '—' : String(round(ySPH,2)));

  // L7 avg (only days with hours)
  const sphL7 = sph.slice(-7).filter(v => v != null);
  const l7 = mean(sphL7);
  kL7?.setAttribute('value', l7 == null ? '—' : String(round(l7,2)));

  // L30 avg
  const sphL30 = sph.filter(v => v != null);
  const l30 = mean(sphL30);
  kL30?.setAttribute('value', l30 == null ? '—' : String(round(l30,2)));
}

function renderChart(dates, sph) {
  if (!chartCanvas || !window.Chart) return;

  const labels = dates.map(d => dayLabel(d));
  const data = sph.map(v => (v == null ? null : round(v,2)));

  const maxY = Math.max(...data.filter(v => v != null), 0);
  const yMax = maxY > 0 ? Math.ceil(maxY * 1.15) : 1;

  if (window.__sphChart) window.__sphChart.destroy();
  window.__sphChart = new Chart(chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'SPH',
        data,
        spanGaps: true,
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, suggestedMax: yMax, grid: { color: 'rgba(0,0,0,0.06)' } },
        x: { ticks: { maxRotation: 0, autoSkip: true } }
      }
    }
  });
}

/* ===== Save staffing ===== */
async function saveStaffingRow(dateYMD, hoursVal, noteVal) {
  const supabase = await getSupabase(); if (!supabase) return;
  // Upsert (manual): if exists -> update, else insert
  const { data: existing } = await supabase
    .from('daily_staffing')
    .select('id')
    .eq('date', dateYMD)
    .limit(1);

  if (existing && existing.length) {
    await supabase.from('daily_staffing').update({ total_staff_hours: hoursVal, note: noteVal || null }).eq('id', existing[0].id);
  } else {
    await supabase.from('daily_staffing').insert({ date: dateYMD, total_staff_hours: hoursVal, note: noteVal || null });
  }
}

/* ===== Capacity Planner ===== */
function activePeriodDays() {
  const val = (document.querySelector('input[name="capPeriod"]:checked')?.value) || 'week';
  if (val === 'week') return 5;
  if (val === 'month') return 22;
  const n = Number(capDays.value || 0);
  return Math.max(1, Math.floor(n));
}
function pickBaselineSPH(metrics) {
  const mode = (document.querySelector('input[name="capSph"]:checked')?.value) || 'base';
  if (mode === 'conservative') return metrics.l30p25 ?? metrics.l7avg ?? metrics.l30avg ?? 0;
  if (mode === 'optimistic')  return metrics.l7p90  ?? metrics.l7avg ?? metrics.l30avg ?? 0;
  return metrics.l7avg ?? metrics.l30avg ?? 0;
}
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
function openPlanner(metrics) {
  capModal?.classList.remove('hidden');
  recalcPlanner(metrics);
}
function closePlanner() {
  capModal?.classList.add('hidden');
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
    ? `<span class="text-gray-600 text-sm">Covers ${fmt(demand)} summaries across ${days} working day(s) at ~${round(effSPH,2)} SPH effective.</span>`
    : `<span class="text-gray-600 text-sm">Enter demand and ensure SPH/inputs are valid.</span>`;

  capAssume.innerHTML = `
    <div>Baseline SPH: <span class="font-medium">${baseSPH ? round(baseSPH,2) : '—'}</span></div>
    <div>Utilization: <span class="font-medium">${Math.round(util*100)}%</span>; Automation: <span class="font-medium">${Math.round(auto*100)}%</span></div>
    <div>Hours/staff/day: <span class="font-medium">${hrsPer}</span>; Working days: <span class="font-medium">${days}</span></div>
  `;
}

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', async () => {
  try { await requireAuth(); } catch { return; }
  wireLogoutButton();

  // Default date to today
  if (staffDate) staffDate.value = ymdLocal(todayLocal());

  // Load & render
  const supabase = await getSupabase(); if (!supabase) return;
  const { comps, staffing } = await fetchData(60);
  const compsMap = groupCompletionsByLocalDay(comps);
  const staffMap = staffingMap(staffing);
  const { dates, completed, hours, sph } = buildDailySeries(compsMap, staffMap, 30);

  renderKPIs(dates, completed, hours, sph);
  renderChart(dates, sph);
  renderTable(dates, completed, hours, sph);

  const metrics = computeMetrics(sph);

  // Save staffing row
  staffingForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateYMD = staffDate.value;
    const hrs = Number(staffHours.value || 0);
    const note = staffNote.value?.trim() || null;
    if (!dateYMD) return alert('Please select a date.');
    if (!(hrs > 0)) return alert('Enter total staff hours > 0.');

    await saveStaffingRow(dateYMD, hrs, note);

    // Refresh minimal pieces
    const fresh = await fetchData(60);
    const freshMap = groupCompletionsByLocalDay(fresh.comps);
    const freshStaff = staffingMap(fresh.staffing);
    const series = buildDailySeries(freshMap, freshStaff, 30);

    renderKPIs(series.dates, series.completed, series.hours, series.sph);
    renderChart(series.dates, series.sph);
    renderTable(series.dates, series.completed, series.hours, series.sph);

    // Clear hours/note (keep date)
    staffHours.value = '';
    staffNote.value = '';
    alert('Saved.');
  });

  // Planner wiring
  btnOpenPlanner?.addEventListener('click', () => openPlanner(metrics));
  capClose?.addEventListener('click', closePlanner);
  capClose2?.addEventListener('click', closePlanner);

  // Inputs that change results
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

  // Copy summary
  capCopy?.addEventListener('click', () => {
    const demand = Number(capDemand.value || 0);
    const days = activePeriodDays();
    const hrsPer = Number(capHrsPer.value || 8);
    const util = Math.max(0, Math.min(100, Number(capUtil.value || 85))) / 100;
    const auto = Math.max(0, Math.min(100, Number(capAuto.value || 0))) / 100;
    const baseSPH = pickBaselineSPH(metrics) || 0;
    const effSPH = baseSPH * util * (1 + auto);
    const denom = effSPH * hrsPer * days;
    const staffNeeded = denom > 0 ? Math.ceil(demand / denom) : 0;

    const txt = [
      `Capacity Plan`,
      `Demand: ${demand}`,
      `Working days: ${days}`,
      `Baseline SPH: ${round(baseSPH,2)}`,
      `Utilization: ${Math.round(util*100)}%`,
      `Automation: ${Math.round(auto*100)}%`,
      `Hours/staff/day: ${hrsPer}`,
      `Effective SPH: ${round(effSPH,2)}`,
      `Required staff: ${staffNeeded}`
    ].join('\n');

    navigator.clipboard.writeText(txt).then(() => alert('Summary copied to clipboard.'));
  });
});
