// staffing.js — uses 8h/day automatically and a persistent "current staff" setting with effective dates.
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';

/* ===== Constants & utils ===== */
const HOURS_PER_DAY = 8; // Always assume 8-hour days
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

// Current staff setting
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
async function fetchData(daysBack=60) {
  const supabase = await getSupabase(); if (!supabase) return { comps: [], snaps: [] };

  // Completions
  const start = addDays(todayLocal(), -daysBack);
  const { data: comps } = await supabase
    .from('completions')
    .select('occurred_on,qty_completed')
    .gte('occurred_on', new Date(start.getTime() - 1).toISOString())
    .order('occurred_on', { ascending: true });

  // Staffing snapshots (effective staff counts)
  const { data: snaps } = await supabase
    .from('staffing_snapshots')
    .select('id,effective_date,staff_count,note')
    .lte('effective_date', ymdLocal(todayLocal()))
    .order('effective_date', { ascending: true });

  return { comps: comps || [], snaps: snaps || [] };
}

function groupCompletionsByLocalDay(comps) {
  const map = new Map();
  for (const c of comps) {
    const d = new Date(c.occurred_on);
    d.setHours(0,0,0,0);
    const key = ymdLocal(d);
    map.set(key, (map.get(key) || 0) + Number(c.qty_completed || 0));
  }
  return map; // key: 'YYYY-MM-DD' -> total completed (may include negatives)
}

function staffCountForDate(dateYMD, snapsSorted) {
  // Return the staff_count from the latest snapshot with effective_date <= dateYMD
  let chosen = 0;
  for (let i = 0; i < snapsSorted.length; i++) {
    if (snapsSorted[i].effective_date <= dateYMD) chosen = Number(snapsSorted[i].staff_count || 0);
    else break;
  }
  return chosen;
}

function buildDailySeries(compsMap, snapsSorted, days=30) {
  const end = todayLocal();
  const start = addDays(end, -days+1);
  const dates = [], completed = [], staff = [], hours = [], sph = [];

  for (let i=0; i<days; i++) {
    const d = addDays(start, i);
    const key = ymdLocal(d);
    const c = Number(compsMap.get(key) || 0);
    const s = staffCountForDate(key, snapsSorted);
    const h = s * HOURS_PER_DAY;

    dates.push(d);
    completed.push(c);
    staff.push(s);
    hours.push(h);
    sph.push(h > 0 ? c / h : null);
  }
  return { dates, completed, staff, hours, sph };
}

/* ===== Renderers ===== */
function renderTable(dates, completed, staff, hours, sph) {
  if (!tblBody) return;
  tblBody.innerHTML = dates.map((d, i) => `
    <tr>
      <td class="px-4 py-2">${ymdLocal(d)}</td>
      <td class="px-4 py-2 text-right">${fmt(completed[i])}</td>
      <td class="px-4 py-2 text-right">${fmt(staff[i])}</td>
      <td class="px-4 py-2 text-right">${fmt(hours[i])}</td>
      <td class="px-4 py-2 text-right">${sph[i] == null ? '—' : round(sph[i], 2)}</td>
    </tr>
  `).reverse().join(''); // most recent first
}

function renderKPIs(dates, sph) {
  const yIdx = dates.length - 2; // yesterday
  const ySPH = yIdx >= 0 ? sph[yIdx] : null;
  kYesterday?.setAttribute('value', ySPH == null ? '—' : String(round(ySPH,2)));

  const l7 = mean(sph.slice(-7).filter(v => v != null));
  kL7?.setAttribute('value', l7 == null ? '—' : String(round(l7,2)));

  const l30 = mean(sph.filter(v => v != null));
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
  activeStaffSince.textContent = latest.effective_date;
  activeStaffPill.classList.remove('hidden');
}

/* ===== Save snapshot (current staff) ===== */
async function saveStaffSnapshot(effective_date, staff_count, note) {
  const supabase = await getSupabase(); if (!supabase) return;
  // If there is already a snapshot for the same effective_date, update it; else insert.
  const { data: existing } = await supabase
    .from('staffing_snapshots')
    .select('id')
    .eq('effective_date', effective_date)
    .limit(1);

  if (existing && existing.length) {
    await supabase.from('staffing_snapshots').update({ staff_count, note: note || null }).eq('id', existing[0].id);
  } else {
    await supabase.from('staffing_snapshots').insert({ effective_date, staff_count, note: note || null });
  }
}

/* ===== Capacity Planner (unchanged logic) ===== */
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
function openPlanner(metrics) { capModal?.classList.remove('hidden'); recalcPlanner(metrics); }
function closePlanner() { capModal?.classList.add('hidden'); }
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

  // Defaults for the setting form
  if (setEffDate) setEffDate.value = ymdLocal(todayLocal());

  const supabase = await getSupabase(); if (!supabase) return;

  // Initial load
  const initial = await fetchData(60);
  const compsMap = groupCompletionsByLocalDay(initial.comps);
  const snapsSorted = (initial.snaps || []).sort((a,b) => (a.effective_date < b.effective_date ? -1 : 1));

  // Render active pill
  renderActiveStaffPill(snapsSorted);

  // Build series (last 30 days)
  const series = buildDailySeries(compsMap, snapsSorted, 30);
  renderKPIs(series.dates, series.sph);
  renderChart(series.dates, series.sph);
  renderTable(series.dates, series.completed, series.staff, series.hours, series.sph);

  const metrics = computeMetrics(series.sph);

  // Save snapshot (current staff)
  staffSettingForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eff = setEffDate.value;
    const cnt = Number(setStaffCount.value || 0);
    const note = setNote.value?.trim() || null;
    if (!eff) return alert('Please choose an effective date.');
    if (!(cnt >= 0)) return alert('Enter a staff count ≥ 0.');
    await saveStaffSnapshot(eff, cnt, note);

    // Refresh
    const fresh = await fetchData(60);
    const freshSnaps = (fresh.snaps || []).sort((a,b) => (a.effective_date < b.effective_date ? -1 : 1));
    renderActiveStaffPill(freshSnaps);

    const compsMap2 = groupCompletionsByLocalDay(fresh.comps);
    const s2 = buildDailySeries(compsMap2, freshSnaps, 30);
    renderKPIs(s2.dates, s2.sph);
    renderChart(s2.dates, s2.sph);
    renderTable(s2.dates, s2.completed, s2.staff, s2.hours, s2.sph);

    // Clear only the note; keep values so you can adjust quickly
    setNote.value = '';
    alert('Saved.');
  });

  // Planner wiring
  btnOpenPlanner?.addEventListener('click', () => openPlanner(metrics));
  capClose?.addEventListener('click', closePlanner);
  capClose2?.addEventListener('click', closePlanner);

  // Planner inputs
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
    const days = (() => {
      const val = (document.querySelector('input[name="capPeriod"]:checked')?.value) || 'week';
      if (val === 'week') return 5;
      if (val === 'month') return 22;
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
