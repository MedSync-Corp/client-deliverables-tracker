// script.js — adds week navigation; weekly model + per-week overrides + negatives + lifetime + started tags + partners view + recommendations modal
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';
import { toast } from './toast.js';

/* ===== Utils ===== */
const fmt = (n) => Number(n || 0).toLocaleString();

// Loading state helpers
function showLoading(elementId, message = 'Loading...') {
  const el = document.getElementById(elementId);
  if (el) {
    el.dataset.originalContent = el.innerHTML;
    el.innerHTML = `<tr><td colspan="10" class="py-8 text-center text-gray-500"><div class="flex items-center justify-center gap-2"><svg class="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>${message}</div></td></tr>`;
  }
}
function hideLoading(elementId) {
  const el = document.getElementById(elementId);
  if (el && el.dataset.originalContent) {
    el.innerHTML = el.dataset.originalContent;
    delete el.dataset.originalContent;
  }
}

// Use the same “New York day” concept as Staffing
const DASH_TZ = 'America/New_York';

// YYYY-MM-DD for a Date when viewed in New York time
function ymdEST(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DASH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);

  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

// Coerce a value into YYYY-MM-DD (works for Date or string)
function toYMD(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  const d = new Date(val);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Today in New York (as a Date at that day’s midnight)
const todayEST = () => {
  const ymd = ymdEST(new Date());
  return new Date(`${ymd}T00:00:00`);
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0,0,0,0);
  return d;
};

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const back = (day + 6) % 7;
  d.setDate(d.getDate() - back);
  d.setHours(0,0,0,0);
  return d;
}
function fridayEndOf(monday) {
  const f = new Date(monday);
  f.setDate(f.getDate() + 4);  // Monday + 4 = Friday
  f.setHours(23,59,59,999);
  return f;
}
function priorMonday(monday) {
  const d = new Date(monday);
  d.setDate(d.getDate() - 7);
  d.setHours(0,0,0,0);
  return d;
}

function daysLeftThisWeekFromPerspective(selectedMon) {
  const t = todayEST();
  const fri = fridayEndOf(selectedMon);
  if (t < selectedMon) return 5;                             // future week: assume full 5 weekdays
  if (t > fri) return 1;                                     // past: avoid divide-by-zero
  return Math.max(1, 6 - t.getDay());                        // current week: real remaining weekdays
}
function yScaleFor(values, pad = 0.15) {
  const nums = (values || []).map(v => +v || 0).filter(v => v > 0);
  if (!nums.length) return { min: 0, max: 100, stepSize: 20 };
  const mx = Math.max(...nums);
  const top = Math.ceil(mx * (1 + pad));
  
  // Choose a nice round step size based on the magnitude
  let step;
  if (top <= 50) step = 10;
  else if (top <= 100) step = 20;
  else if (top <= 250) step = 50;
  else if (top <= 500) step = 100;
  else if (top <= 1000) step = 200;
  else if (top <= 2500) step = 500;
  else step = Math.ceil(top / 5 / 100) * 100;
  
  const max = Math.ceil(top / step) * step;
  return { min: 0, max, stepSize: step };
}
function statusColors(s, a = 0.72) {
  const map = { green: { r:34,g:197,b:94, stroke:'#16a34a' }, yellow: { r:234,g:179,b:8, stroke:'#d97706' }, red: { r:239,g:68,b:68, stroke:'#b91c1c' } };
  const k = map[s] || map.green;
  return { fill:`rgba(${k.r},${k.g},${k.b},${a})`, hover:`rgba(${k.r},${k.g},${k.b},${Math.min(1,a+0.15)})`, stroke:k.stroke };
}
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday:'short', month:'2-digit', day:'2-digit' });
const shortDate = (d) => d.toLocaleDateString(undefined, { month:'short', day:'numeric' });

/* ===== Elements ===== */
const kpiTotal = document.getElementById('kpi-total');
const kpiCompleted = document.getElementById('kpi-completed');
const kpiRemaining = document.getElementById('kpi-remaining');
const kpiLifetime = document.getElementById('kpi-lifetime');

const dueBody = document.getElementById('dueThisWeekBody');
const dueLabel = document.getElementById('dueLabel');
const weekPrevBtn = document.getElementById('weekPrev');
const weekNextBtn = document.getElementById('weekNext');

const byClientTitle = document.getElementById('byClientTitle');

const logModal = document.getElementById('logModal');
const logForm = document.getElementById('logForm');
const logClose = document.getElementById('logClose');
const logCancel = document.getElementById('logCancel');
const logClientName = document.getElementById('logClientName');
const modal = document.getElementById('clientModal');

const modalTitle = document.getElementById('clientModalTitle');
const btnOpen = document.getElementById('btnAddClient');
const btnClose = document.getElementById('clientModalClose');
const btnCancel = document.getElementById('clientCancel');
const clientForm = document.getElementById('clientForm');
const addressesList = document.getElementById('addressesList');
const emrsList = document.getElementById('emrsList');
const addrTpl = document.getElementById('addrRowTpl');
const emrTpl = document.getElementById('emrRowTpl');
const btnAddAddr = document.getElementById('btnAddAddr');
const btnAddEmr = document.getElementById('btnAddEmr');
const clientsTableBody = document.getElementById('clientsBody');

/* ===== Recommendations modal elements ===== */
const btnRec = document.getElementById('btnRec');
const recModal = document.getElementById('recModal');
const recClose = document.getElementById('recClose');
const recHead = document.getElementById('recHead');
const recBody = document.getElementById('recBody');
const recFoot = document.getElementById('recFoot');
const recCapRow = document.getElementById('recCapRow');
const recExplain = document.getElementById('recExplain');

/* ===== Modal helpers (Clients) ===== */
const weeklyEls = () => {
  const qtyEl = clientForm?.querySelector('[name="weekly_qty"], #weekly_qty');
  const startEl = clientForm?.querySelector('[name="start_week"], #start_week');
  return { qtyEl, startEl };
};
function setWeeklyInputValues({ weekly_qty, start_week }) {
  const { qtyEl, startEl } = weeklyEls();
  if (qtyEl) qtyEl.value = weekly_qty ?? '';
  if (startEl) startEl.value = start_week ? String(start_week).slice(0, 10) : '';
}
function addAddressRow(a = {}) {
  if (!addrTpl || !addressesList) return;
  const frag = addrTpl.content.cloneNode(true);
  const row = frag.querySelector('.grid');
  row.querySelector('[name=line1]').value = a.line1 || '';
  row.querySelector('[name=line2]').value = a.line2 || '';
  row.querySelector('[name=city]').value = a.city || '';
  row.querySelector('[name=state]').value = a.state || '';
  row.querySelector('[name=zip]').value = a.zip || '';
  row.querySelector('.remove').onclick = () => row.remove();
  addressesList.appendChild(frag);
}
function addEmrRow(e = {}) {
  if (!emrTpl || !emrsList) return;
  const frag = emrTpl.content.cloneNode(true);
  const row = frag.querySelector('.grid');
  row.querySelector('[name=vendor]').value = e.vendor || '';
  row.querySelector('[name=details]').value = e.details || '';
  row.querySelector('.remove').onclick = () => row.remove();
  emrsList.appendChild(frag);
}
function openClientModalBlank() {
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modalTitle.textContent = 'Add Client';
  clientForm.reset();
  clientForm.client_id.value = '';
  addressesList.innerHTML = ''; addAddressRow();
  emrsList.innerHTML = ''; addEmrRow();
  setWeeklyInputValues({ weekly_qty: '', start_week: '' });
  hydratePartnerDatalist();
}
async function openClientModalById(id) {
  const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');
  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single();
  const [{ data: addrs }, { data: emrs }, { data: commits }] = await Promise.all([
    supabase.from('client_addresses').select('line1,line2,city,state,zip').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('client_emrs').select('vendor,details').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('weekly_commitments').select('weekly_qty,start_week,active').eq('client_fk', id).eq('active', true).order('start_week', { ascending: false }).limit(1)
  ]);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modalTitle.textContent = 'Edit Client';
  clientForm.reset();
  clientForm.client_id.value = client?.id || '';
  clientForm.name.value = client?.name || '';
  clientForm.acronym && (clientForm.acronym.value = client?.acronym || '');
  clientForm.total_lives.value = client?.total_lives || '';
  clientForm.contact_name.value = client?.contact_name || '';
  clientForm.contact_email.value = client?.contact_email || '';
  clientForm.instructions.value = client?.instructions || '';
  clientForm.sales_partner && (clientForm.sales_partner.value = client?.sales_partner || '');
  addressesList.innerHTML = ''; (addrs?.length ? addrs : [{}]).forEach(a => addAddressRow(a));
  emrsList.innerHTML = ''; (emrs?.length ? emrs : [{}]).forEach(e => addEmrRow(e));
  const active = commits?.[0] || null;
  setWeeklyInputValues(active ? { weekly_qty: active.weekly_qty, start_week: active.start_week } : { weekly_qty: '', start_week: '' });
  hydratePartnerDatalist();
}
const closeClientModal = () => { 
  modal?.classList.add('hidden'); 
  modal?.classList.remove('flex');
};
btnOpen?.addEventListener('click', openClientModalBlank);
btnClose?.addEventListener('click', closeClientModal);
btnCancel?.addEventListener('click', closeClientModal);
btnAddAddr?.addEventListener('click', () => addAddressRow());
btnAddEmr?.addEventListener('click', () => addEmrRow());

/* ===== Create/Update Client ===== */
clientForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');

  const payload = {
    name: clientForm.name.value.trim(),
    acronym: clientForm.acronym?.value?.trim() || null,
    total_lives: Number(clientForm.total_lives.value || 0),
    contact_name: clientForm.contact_name.value.trim() || null,
    contact_email: clientForm.contact_email.value.trim() || null,
    instructions: clientForm.instructions.value.trim() || null,
    sales_partner: clientForm.sales_partner?.value?.trim() || null
  };

  const addrs = addressesList ? [...addressesList.querySelectorAll('.grid')].map(r => ({
    line1: r.querySelector('[name=line1]')?.value?.trim() || '',
    line2: r.querySelector('[name=line2]')?.value?.trim() || '',
    city: r.querySelector('[name=city]')?.value?.trim() || '',
    state: r.querySelector('[name=state]')?.value?.trim() || '',
    zip: r.querySelector('[name=zip]')?.value?.trim() || ''
  })).filter(a => a.line1 || a.line2 || a.city || a.state || a.zip) : [];

  const emrs = emrsList ? [...emrsList.querySelectorAll('.grid')].map(r => ({
    vendor: r.querySelector('[name=vendor]')?.value?.trim() || '',
    details: r.querySelector('[name=details]')?.value?.trim() || ''
  })).filter(e => e.vendor || e.details) : [];

  let clientId = clientForm.client_id.value?.trim() || null;

  if (clientId) {
    const { error } = await supabase.from('clients').update(payload).eq('id', clientId);
    if (error) { console.error(error); return toast.error('Failed to update client.'); }
  } else {
    const { data: row, error } = await supabase.from('clients').insert(payload).select('id').single();
    if (error) { console.error(error); return toast.error('Failed to create client.'); }
    clientId = row.id;
  }

  await supabase.from('client_addresses').delete().eq('client_fk', clientId);
  if (addrs.length) await supabase.from('client_addresses').insert(addrs.map(a => ({ client_fk: clientId, ...a })));
  await supabase.from('client_emrs').delete().eq('client_fk', clientId);
  if (emrs.length) await supabase.from('client_emrs').insert(emrs.map(e => ({ client_fk: clientId, ...e })));

  const { qtyEl, startEl } = weeklyEls();
  const inputQty = qtyEl?.value?.trim();
  const inputStart = startEl?.value?.trim();

  if (inputQty || inputStart) {
    const { data: existing } = await supabase
      .from('weekly_commitments')
      .select('weekly_qty,start_week,active')
      .eq('client_fk', clientId)
      .eq('active', true)
      .order('start_week', { ascending: false })
      .limit(1);

    const current = existing?.[0] || null;
    const newQty = inputQty ? Number(inputQty) : (current?.weekly_qty ?? 0);
    let newStart = inputStart ? inputStart : (current?.start_week ? String(current.start_week).slice(0, 10) : null);
    
    // If quantity is changing and start date is before the current week, warn the user
    const qtyChanged = current && Number(current.weekly_qty) !== newQty;
    if (qtyChanged && newStart) {
      const currentWeekMon = mondayOf(todayEST());
      const currentWeekStr = currentWeekMon.toISOString().slice(0, 10);
      const newStartStr = String(newStart).slice(0, 10);
      
      // Only warn if start date is strictly before the current week's Monday
      if (newStartStr < currentWeekStr) {
        const useCurrentWeek = confirm(
          `You're changing the baseline with a start date in the past (${newStartStr}). ` +
          `This will affect historical weeks and may cause incorrect carryover.\n\n` +
          `Click OK to use the current week (${currentWeekStr}) instead.\n` +
          `Click Cancel to keep the past date (${newStartStr}).`
        );
        if (useCurrentWeek) {
          newStart = currentWeekStr;
        }
      }
    }

    const unchanged = current && Number(current.weekly_qty) === newQty &&
      String(current.start_week).slice(0, 10) === String(newStart).slice(0, 10);

    if (!unchanged && newQty > 0 && newStart) {
      if (current) await supabase.from('weekly_commitments').update({ active: false }).eq('client_fk', clientId).eq('active', true);
      const { error: insC } = await supabase.from('weekly_commitments').insert({
        client_fk: clientId, weekly_qty: newQty, start_week: newStart, active: true
      });
      if (insC) { console.error(insC); return toast.error('Failed to save weekly commitment.'); }
    }
  }

  closeClientModal();
  await loadClientsList();
  await loadDashboard();
  toast.success('Saved successfully');
});

/* ===== Delete client ===== */
async function handleDelete(clientId, clientName = 'this client') {
  if (!confirm(`Delete “${clientName}”? This removes the client and all related data.`)) return;
  const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');
  const tables = ['completions', 'client_addresses', 'client_emrs', 'weekly_commitments', 'weekly_overrides'];
  for (const t of tables) await supabase.from(t).delete().eq('client_fk', clientId);
  await supabase.from('clients').delete().eq('id', clientId);
  await loadClientsList(); await loadDashboard();
  toast.success('Client deleted');
}

/* ===== Shared calculations ===== */
// Pick the baseline that was in effect for a given week
// Logic: Find the commitment with the latest start_week that is <= the reference week
// We don't filter by 'active' because we need historical baselines for past weeks
function pickBaselineForWeek(commitRows, clientId, refMon) {
  const refDate = new Date(refMon);
  const rows = (commitRows || [])
    .filter(r => r.client_fk === clientId && r.active && new Date(r.start_week) <= refDate)
    .sort((a, b) => new Date(b.start_week) - new Date(a.start_week));
  return rows[0]?.weekly_qty || 0;
}
function overrideForWeek(overrideRows, clientId, refMon) {
  const hit = (overrideRows || []).find(r => r.client_fk === clientId && String(r.week_start).slice(0, 10) === refMon.toISOString().slice(0, 10));
  return hit ? Number(hit.weekly_qty) : null;
}
function baseTargetFor(ovr, wk, clientId, weekMon) {
  const base = pickBaselineForWeek(wk, clientId, weekMon);
  const o = overrideForWeek(ovr, clientId, weekMon);
  return (o ?? base) || 0;
}

// EST-aware completion sum (matches Staffing behavior)
function sumCompleted(rows, clientId, from, to) {
  const fromY = from ? toYMD(from) : null;
  const toY = to ? toYMD(to) : null;

  return (rows || []).reduce((sum, row) => {
    if (row.client_fk !== clientId) return sum;

    const dY = toYMD(row.occurred_on); // date from DB

    // If a window is provided, only count completions in that window
    if (fromY && toY) {
      if (!dY || dY < fromY || dY > toY) return sum;
    }

    return sum + (row.qty_completed || 0);
  }, 0);
}

function isStarted(clientId, commits, completions) {
  const today = todayEST();
  const startedByCommit = (commits || []).some(r => r.client_fk === clientId && r.active && new Date(r.start_week) <= today);
  const startedByWork = (completions || []).some(c => c.client_fk === clientId);
  return startedByCommit || startedByWork;
}

/* ===== Week navigation state ===== */
let __weekOffset = 0; // 0 = this week; 1 = next week; etc.

/* ===== Dashboard ===== */
let __rowsForRec = [];
window.__rowsForRec = __rowsForRec; // Expose for console debugging

async function loadDashboard() {
  if (!kpiTotal) return;
  showLoading('dueThisWeekBody', 'Loading dashboard...');
  
  const supabase = await getSupabase(); if (!supabase) return;

  const [{ data: clients }, { data: wk }, { data: ovr }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,acronym,total_lives,sales_partner,completed,paused').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    supabase.from('completions').select('client_fk,occurred_on,qty_completed')
  ]);

  const today = todayEST();
  const mon0 = mondayOf(today);                    // anchor (this week)
  const monSel = addDays(mon0, __weekOffset * 7);  // selected week
  const friSel = fridayEndOf(monSel);
  const lastMonSel = priorMonday(monSel);
  const lastFriSel = fridayEndOf(lastMonSel);

  // Header labels
  if (dueLabel) {
    dueLabel.textContent = (__weekOffset === 0)
      ? 'Due This Week'
      : `Due • Week of ${shortDate(monSel)}`;
  }
  if (byClientTitle) {
    byClientTitle.textContent = (__weekOffset === 0)
      ? 'This Week by Client'
      : `Week of ${shortDate(monSel)} by Client`;
  }

  const startedOnly = document.getElementById('filterContracted')?.checked ?? true;

  // Filter out completed and paused clients from dashboard
  const activeClients = (clients || []).filter(c => !c.completed && !c.paused);

  const rows = activeClients.filter(c => {
    return !startedOnly || isStarted(c.id, wk, comps);
  }).map(c => {
    // Get completions for the selected week
    const doneSel = sumCompleted(comps, c.id, monSel, friSel);
    
    // Get the base target for the selected week
    const baseSel = baseTargetFor(ovr, wk, c.id, monSel);
    
    // Calculate carry-in from the week before the selected week
    const baseLastSel = baseTargetFor(ovr, wk, c.id, lastMonSel);
    const doneLastSel = sumCompleted(comps, c.id, lastMonSel, lastFriSel);
    const carryInSel = Math.max(0, baseLastSel - doneLastSel);
    
    // For future weeks, we need to chain carry-forward from current week
    let requiredSel;
    if (__weekOffset > 0) {
      // Future week: chain forward assuming 0 completions in future
      const baseLast0 = baseTargetFor(ovr, wk, c.id, priorMonday(mon0));
      const doneLast0 = sumCompleted(comps, c.id, priorMonday(mon0), fridayEndOf(priorMonday(mon0)));
      const carry0 = Math.max(0, baseLast0 - doneLast0);
      
      const base0 = baseTargetFor(ovr, wk, c.id, mon0);
      const done0 = sumCompleted(comps, c.id, mon0, fridayEndOf(mon0));
      let requiredPrev = Math.max(0, base0 + carry0);
      let donePrev = done0;
      
      for (let step = 1; step <= __weekOffset; step++) {
        const monW = addDays(mon0, step * 7);
        const baseW = baseTargetFor(ovr, wk, c.id, monW);
        const carryW = Math.max(0, requiredPrev - donePrev);
        requiredPrev = Math.max(0, baseW + carryW);
        donePrev = 0; // assume 0 completions for future weeks
      }
      requiredSel = requiredPrev;
    } else {
      // Current or past week: use actual carry-in
      requiredSel = Math.max(0, baseSel + carryInSel);
    }

    const remaining = Math.max(0, requiredSel - doneSel);

    // Status calculation: per-day based on selected week perspective
    const needPerDay = remaining / Math.max(1, daysLeftThisWeekFromPerspective(monSel));
    const status = carryInSel > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

    const lifetime = sumCompleted(comps, c.id);
    return { id: c.id, name: c.name, acronym: c.acronym, required: requiredSel, remaining, doneThis: doneSel, carryIn: carryInSel, status, lifetime, targetThis: baseSel };
  });

  const totalReq = rows.reduce((s, r) => s + r.required, 0);
  const totalDone = rows.reduce((s, r) => s + r.doneThis, 0);
  const totalRem = rows.reduce((s, r) => s + r.remaining, 0);  // Sum individual remainings, not totalReq - totalDone
  const totalLifetime = (comps || []).reduce((s, c) => s + (c.qty_completed || 0), 0);

  kpiTotal?.setAttribute('value', fmt(totalReq));
  kpiCompleted?.setAttribute('value', fmt(totalDone));
  kpiRemaining?.setAttribute('value', fmt(totalRem));
  kpiLifetime?.setAttribute('value', fmt(totalLifetime));

  renderByClientChart(rows);
  renderDueThisWeek(rows);

  __rowsForRec = rows;
  window.__rowsForRec = rows; // Keep window copy in sync
}
function renderByClientChart(rows) {
  const labels = rows.map(r => r.name);
  const remains = rows.map(r => r.remaining ?? 0);
  const completes = rows.map(r => Math.max(0, (r.required ?? 0) - (r.remaining ?? 0)));
  const required = rows.map((r, i) => r.required ?? (remains[i] + completes[i]));
  const statuses = rows.map(r => r.status);

  const widthPx = Math.max(1100, labels.length * 140);
  const widthDiv = document.getElementById('chartWidth');
  const canvas = document.getElementById('byClientChart');
  if (widthDiv) widthDiv.style.width = widthPx + 'px';
  if (canvas) canvas.width = widthPx;
  if (!canvas || !window.Chart) return;

  const points = labels.map((name, i) => {
    const c = statusColors(statuses[i]);
    return { x: name, y: remains[i], completed: completes[i], target: required[i], color: c.fill, hover: c.hover, stroke: c.stroke };
  });
  const yCfg = yScaleFor(remains);

  if (window.__byClientChart) window.__byClientChart.destroy();
  window.__byClientChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Remaining', data: points, backgroundColor: (ctx) => ctx.raw.color, hoverBackgroundColor: (ctx) => ctx.raw.hover, borderColor: (ctx) => ctx.raw.stroke, borderWidth: 1.5, borderRadius: 10, borderSkipped: false, maxBarThickness: 44 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(17,24,39,0.9)', padding: 10,
          callbacks: {
            title: (items) => items[0].label,
            label: (ctx) => {
              const raw = ctx.raw || {};
              const rem = ctx.parsed.y ?? 0;
              const tgt = raw.target ?? (rem + (raw.completed ?? 0));
              const done = raw.completed ?? 0;
              const pct = tgt ? Math.round((done / tgt) * 100) : 0;
              return [
                `Remaining: ${fmt(rem)}`,
                `Completed: ${fmt(done)} of ${fmt(tgt)} (${pct}%)`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            autoSkip: false, maxRotation: 0,
            callback: (v) => { const s = String(labels[v]); return s.length > 18 ? s.slice(0, 18) + '…' : s; }
          }
        },
        y: { beginAtZero: true, min: yCfg.min, max: yCfg.max, ticks: { stepSize: yCfg.stepSize }, grid: { color: 'rgba(0,0,0,0.06)' } }
      }
    }
  });
}
// Dashboard sorting state
let __dashboardSort = { col: 'remaining', dir: 'desc' };
let __dashboardRows = [];

function renderDueThisWeek(rows) {
  if (!dueBody) return;
  __dashboardRows = rows.filter(r => r.required > 0);
  
  if (!__dashboardRows.length) { 
    dueBody.innerHTML = `<tr><td colspan="6" class="py-4 text-sm text-gray-500">No active commitments for this week.</td></tr>`; 
    return; 
  }
  
  renderDueThisWeekSorted();
  
  // Wire up sort headers (only once)
  const thead = dueBody.closest('table')?.querySelector('thead');
  if (thead && !thead.dataset.sortWired) {
    thead.dataset.sortWired = 'true';
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const col = th.dataset.sort;
      if (__dashboardSort.col === col) {
        __dashboardSort.dir = __dashboardSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        __dashboardSort.col = col;
        __dashboardSort.dir = col === 'name' ? 'asc' : 'desc';
      }
      updateSortArrows(thead);
      renderDueThisWeekSorted();
    });
  }
}

function updateSortArrows(thead) {
  thead.querySelectorAll('th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.sort === __dashboardSort.col) {
      arrow.textContent = __dashboardSort.dir === 'asc' ? '↑' : '↓';
      arrow.classList.remove('text-gray-400');
      arrow.classList.add('text-gray-700');
    } else {
      arrow.textContent = '↕';
      arrow.classList.remove('text-gray-700');
      arrow.classList.add('text-gray-400');
    }
  });
}

function renderDueThisWeekSorted() {
  const statusOrder = { red: 0, yellow: 1, green: 2 };
  
  const sorted = [...__dashboardRows].sort((a, b) => {
    let cmp = 0;
    switch (__dashboardSort.col) {
      case 'name':
        cmp = (a.name || '').localeCompare(b.name || '');
        break;
      case 'required':
        cmp = (a.required || 0) - (b.required || 0);
        break;
      case 'remaining':
        cmp = (a.remaining || 0) - (b.remaining || 0);
        break;
      case 'status':
        cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
        break;
    }
    return __dashboardSort.dir === 'asc' ? cmp : -cmp;
  });

  dueBody.innerHTML = sorted.map(r => {
    const pct = r.required > 0 ? Math.min(100, Math.round((r.doneThis / r.required) * 100)) : 0;
    const displayName = r.acronym ? `${r.name} <span class="text-gray-500">(${r.acronym})</span>` : r.name;
    const logLabel = r.acronym || r.name;
    
    // Progress bar color based on status
    const barColor = r.status === 'green' ? 'bg-green-500' : (r.status === 'yellow' ? 'bg-yellow-500' : 'bg-red-500');
    
    // Check if this client hit zero this week (celebration!)
    const hitZero = r.remaining === 0 && r.required > 0;
    const remainingCell = hitZero 
      ? `<span class="text-green-600 font-bold">🎉 Done!</span>`
      : `<span class="text-red-600 font-medium">${fmt(r.remaining)}</span>`;
    
    return `<tr>
      <td class="px-4 py-2 text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${displayName}</a></td>
      <td class="px-4 py-2 text-sm">${fmt(r.required)}</td>
      <td class="px-4 py-2 text-sm">
        <div class="flex items-center gap-2">
          <div class="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div class="${barColor} h-full rounded-full transition-all" style="width: ${pct}%"></div>
          </div>
          <span class="text-xs text-gray-500 w-12 text-right">${fmt(r.doneThis)}/${fmt(r.required)}</span>
        </div>
      </td>
      <td class="px-4 py-2 text-sm">${remainingCell}</td>
      <td class="px-4 py-2 text-sm"><status-badge status="${r.status}"></status-badge></td>
      <td class="px-4 py-2 text-sm text-right"><button class="px-2 py-1 rounded bg-gray-900 text-white text-xs" data-log="${r.id}" data-name="${logLabel}">Log</button></td>
    </tr>`;
  }).join('');
  
  dueBody.onclick = (e) => { const b = e.target.closest('button[data-log]'); if (!b) return; openLogModal(b.dataset.log, b.dataset.name); };
}

/* ===== Log modal (shared) ===== */
function openLogModal(clientId, clientName) {
  const modal = document.getElementById('logModal');
  const form = document.getElementById('logForm');
  const logClientName = document.getElementById('logClientName');

  if (!modal || !form) return;

  form.client_id.value = clientId || '';
  form.qty.value = '';
  form.note.value = '';
  
  // Reset type toggle to "Completed"
  const completedRadio = form.querySelector('input[name="log_type"][value="completed"]');
  if (completedRadio) completedRadio.checked = true;

  if (logClientName) {
    logClientName.textContent = clientName || '—';
  }

  const dateInput = form.querySelector('input[name="occurred_on"]');
  if (dateInput) {
    const today = toYMD(new Date());
    dateInput.max = today;
    dateInput.value = today;  // Always reset to today when opening
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}
function closeLogModal() { 
  logModal?.classList.add('hidden'); 
  logModal?.classList.remove('flex');
}
logClose?.addEventListener('click', closeLogModal);
logCancel?.addEventListener('click', closeLogModal);
logForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');

  const qty = Number(logForm.qty.value || 0);
  if (!qty || qty === 0) return toast.warning('Enter a non-zero quantity.');
  
  // Get the log type (completed or utc)
  const logType = logForm.querySelector('input[name="log_type"]:checked')?.value || 'completed';
  const isUTC = logType === 'utc';
  
  const typeLabel = isUTC ? 'UTCs' : 'completed';
  if (qty < 0 && !confirm(`You are reducing ${typeLabel} by ${Math.abs(qty)}. Continue?`)) return;

  const dateInput = logForm.querySelector('input[name="occurred_on"]');

  // IMPORTANT: occurred_on is a DATE column in Supabase.
  // We should send a plain 'YYYY-MM-DD' string.
  const occurred_on = (dateInput && dateInput.value)
    ? dateInput.value              // use the chosen work date
    : ymdEST(new Date());          // fallback: today in NY as 'YYYY-MM-DD'

  const payload = {
    client_fk: logForm.client_id.value,
    occurred_on,                   // <-- DATE string, not ISO timestamp
    qty_completed: isUTC ? 0 : qty,
    qty_utc: isUTC ? qty : 0,
    note: logForm.note.value?.trim() || null
  };

  const { error } = await supabase.from('completions').insert(payload);
  if (error) {
    console.error(error);
    return toast.error(`Failed to log ${typeLabel}.`);
  }

  toast.success(`Logged ${qty} ${typeLabel}`);
  closeLogModal();
  await loadDashboard();
  await loadClientDetail();
  await loadClientsList();
});

/* ===== Clients list ===== */
let __clientsCache = { clients: [], wk: [], comps: [] };
let __clientsSort = { col: 'name', dir: 'asc' };

async function loadClientsList() {
  if (!clientsTableBody) return;
  showLoading('clientsBody', 'Loading clients...');
  
  const supabase = await getSupabase(); if (!supabase) { clientsTableBody.innerHTML = `<tr><td class="py-4 px-4 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`; return; }

  const [{ data: clients }, { data: wk }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,acronym,total_lives,sales_partner,completed,paused').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('completions').select('client_fk,qty_completed,qty_utc')
  ]);

  // Cache for filtering
  __clientsCache = { clients: clients || [], wk: wk || [], comps: comps || [] };

  // Store data for client report PDF generation
  window.__clientsReportData = { clients: clients || [], wk: wk || [], comps: comps || [] };

  renderClientsList(getCurrentFilteredClients());
  wireClientsSortHeaders();
  wireCompletedFilter();
  wireClientReportUI();
}

function wireClientsSortHeaders() {
  const thead = document.getElementById('clientsHead');
  if (!thead || thead.dataset.sortWired) return;
  thead.dataset.sortWired = 'true';
  
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const col = th.dataset.sort;
    if (__clientsSort.col === col) {
      __clientsSort.dir = __clientsSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      __clientsSort.col = col;
      __clientsSort.dir = col === 'name' || col === 'acronym' ? 'asc' : 'desc';
    }
    updateClientsSortArrows(thead);
    renderClientsList(getCurrentFilteredClients());
  });
}

function updateClientsSortArrows(thead) {
  thead.querySelectorAll('th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.sort === __clientsSort.col) {
      arrow.textContent = __clientsSort.dir === 'asc' ? '↑' : '↓';
      arrow.classList.remove('text-gray-400');
      arrow.classList.add('text-gray-700');
    } else {
      arrow.textContent = '↕';
      arrow.classList.remove('text-gray-700');
      arrow.classList.add('text-gray-400');
    }
  });
}

function wireCompletedFilter() {
  const dropdown = document.getElementById('filterStatus');
  if (!dropdown || dropdown.dataset.wired) return;
  dropdown.dataset.wired = 'true';
  dropdown.addEventListener('change', () => renderClientsList(getCurrentFilteredClients()));
}

function getCurrentFilteredClients() {
  const searchInput = document.getElementById('clientSearch');
  const statusFilter = document.getElementById('filterStatus')?.value || 'active';
  const term = searchInput?.value?.toLowerCase().trim() || '';
  
  let filtered = __clientsCache.clients;
  
  // Filter by completed status
  if (statusFilter === 'active') {
    // Active = started, not paused, not completed
    filtered = filtered.filter(c => {
      const started = isStarted(c.id, __clientsCache.wk, __clientsCache.comps);
      return started && !c.paused && !c.completed;
    });
  } else if (statusFilter === 'paused') {
    filtered = filtered.filter(c => c.paused && !c.completed);
  } else if (statusFilter === 'not_started') {
    filtered = filtered.filter(c => {
      const started = isStarted(c.id, __clientsCache.wk, __clientsCache.comps);
      return !started && !c.completed;
    });
  } else if (statusFilter === 'completed') {
    filtered = filtered.filter(c => c.completed);
  }
  // 'all' shows everything
  
  // Filter by search term
  if (term) {
    filtered = filtered.filter(c => 
      c.name.toLowerCase().includes(term) || 
      (c.acronym && c.acronym.toLowerCase().includes(term)) ||
      (c.sales_partner && c.sales_partner.toLowerCase().includes(term))
    );
  }
  
  return filtered;
}

function renderClientsList(clients) {
  if (!clientsTableBody) return;
  const { wk, comps } = __clientsCache;
  
  const latestQty = (id) => {
    const rows = (wk || []).filter(r => r.client_fk === id && r.active).sort((a, b) => new Date(b.start_week) - new Date(a.start_week));
    return rows[0]?.weekly_qty || 0;
  };
  
  // Calculate total completed for a client
  const totalCompleted = (id) => {
    return (comps || []).filter(c => c.client_fk === id).reduce((sum, c) => sum + (c.qty_completed || 0), 0);
  };
  
  // Calculate total UTCs for a client
  const totalUTCs = (id) => {
    return (comps || []).filter(c => c.client_fk === id).reduce((sum, c) => sum + (c.qty_utc || 0), 0);
  };
  
  // Calculate total remaining for a client: Total Lives - Completed - UTCs
  const totalRemaining = (c) => {
    const totalLives = c.total_lives || 0;
    if (!totalLives) return -1; // For sorting, treat no total_lives as lowest
    return Math.max(0, totalLives - totalCompleted(c.id) - totalUTCs(c.id));
  };

  if (!clients.length) {
    clientsTableBody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-gray-500">No clients found.</td></tr>`;
    return;
  }

  // Sort clients
  const sorted = [...clients].sort((a, b) => {
    let cmp = 0;
    switch (__clientsSort.col) {
      case 'name':
        cmp = (a.name || '').localeCompare(b.name || '');
        break;
      case 'acronym':
        cmp = (a.acronym || '').localeCompare(b.acronym || '');
        break;
      case 'total_lives':
        cmp = (a.total_lives || 0) - (b.total_lives || 0);
        break;
      case 'completed_count':
        cmp = totalCompleted(a.id) - totalCompleted(b.id);
        break;
      case 'utc_count':
        cmp = totalUTCs(a.id) - totalUTCs(b.id);
        break;
      case 'total_remaining':
        cmp = totalRemaining(a) - totalRemaining(b);
        break;
      case 'baseline':
        cmp = latestQty(a.id) - latestQty(b.id);
        break;
    }
    return __clientsSort.dir === 'asc' ? cmp : -cmp;
  });

  clientsTableBody.innerHTML = '';
  sorted.forEach(c => {
    const started = isStarted(c.id, wk, comps);
    // Show status tag based on state
    let statusTag;
    if (c.completed) {
      statusTag = `<span class="ml-2 text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">Completed</span>`;
    } else if (c.paused) {
      statusTag = `<span class="ml-2 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Paused</span>`;
    } else if (started) {
      statusTag = `<span class="ml-2 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Active</span>`;
    } else {
      statusTag = `<span class="ml-2 text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">Not Started</span>`;
    }
    const partnerChip = c.sales_partner ? `<span class="ml-2 text-xs text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">${c.sales_partner}</span>` : '';
    
    // Pause/Resume button
    let pauseAction = '';
    if (!c.completed) {
      if (c.paused) {
        pauseAction = `<button class="w-full text-left px-3 py-2 text-sm text-green-600 hover:bg-gray-100" data-resume="${c.id}">Resume</button>`;
      } else {
        pauseAction = `<button class="w-full text-left px-3 py-2 text-sm text-amber-600 hover:bg-gray-100" data-pause="${c.id}">Pause</button>`;
      }
    }
    
    // Calculate values
    const done = totalCompleted(c.id);
    const utcs = totalUTCs(c.id);
    const totalLives = c.total_lives || 0;
    const remaining = Math.max(0, totalLives - done - utcs);
    const remainingDisplay = totalLives ? fmt(remaining) : '—';
    
    const tr = document.createElement('tr');
    tr.className = c.completed ? 'bg-gray-50 text-gray-500' : (c.paused ? 'bg-amber-50/30' : '');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm">
        <a class="${c.completed ? 'text-gray-500 hover:underline' : 'text-indigo-600 hover:underline'}" href="./client-detail.html?id=${c.id}">${c.name}</a>
        ${partnerChip}
        ${statusTag}
      </td>
      <td class="px-4 py-2 text-sm">${c.acronym || '—'}</td>
      <td class="px-4 py-2 text-sm">${totalLives ? fmt(totalLives) : '—'}</td>
      <td class="px-4 py-2 text-sm">${done ? fmt(done) : '—'}</td>
      <td class="px-4 py-2 text-sm">${utcs ? fmt(utcs) : '—'}</td>
      <td class="px-4 py-2 text-sm">${remainingDisplay}</td>
      <td class="px-4 py-2 text-sm">${latestQty(c.id) ? fmt(latestQty(c.id)) + '/wk' : '—'}</td>
      <td class="px-4 py-2 text-sm text-right">
        <div class="relative inline-block">
          <button class="px-2 py-1 rounded border text-sm hover:bg-gray-50 actions-toggle" data-client="${c.id}">⋮</button>
          <div class="actions-menu hidden absolute right-0 mt-1 w-32 bg-white border rounded-lg shadow-lg z-10">
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100" data-edit="${c.id}">Edit</button>
            ${pauseAction}
            <button class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-100" data-delete="${c.id}" data-name="${c.name}">Delete</button>
          </div>
        </div>
      </td>`;
    clientsTableBody.appendChild(tr);
  });

  // Handle dropdown toggle
  clientsTableBody.onclick = async (e) => {
    // Toggle dropdown menu
    const toggle = e.target.closest('.actions-toggle');
    if (toggle) {
      // Close all other menus first
      document.querySelectorAll('.actions-menu').forEach(m => {
        if (m !== toggle.nextElementSibling) m.classList.add('hidden');
      });
      toggle.nextElementSibling.classList.toggle('hidden');
      e.stopPropagation();
      return;
    }
    
    const del = e.target.closest('button[data-delete]');
    if (del) { await handleDelete(del.dataset.delete, del.dataset.name); return; }
    const edit = e.target.closest('button[data-edit]');
    if (edit) { await openClientModalById(edit.dataset.edit); return; }
    const pause = e.target.closest('button[data-pause]');
    if (pause) { await togglePauseClient(pause.dataset.pause, true); return; }
    const resume = e.target.closest('button[data-resume]');
    if (resume) { await togglePauseClient(resume.dataset.resume, false); return; }
  };
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.actions-menu').forEach(m => m.classList.add('hidden'));
  });
}

async function togglePauseClient(clientId, shouldPause) {
  const supabase = await getSupabase(); if (!supabase) return;
  
  // Update the paused status
  const { error } = await supabase.from('clients').update({ paused: shouldPause }).eq('id', clientId);
  if (error) {
    showToast(error.message, 'error');
    return;
  }
  
  // When resuming, update the baseline's start_week to current week so there's no carryover from paused period
  if (!shouldPause) {
    const currentWeekMon = mondayOf(todayEST()).toISOString().slice(0, 10);
    await supabase
      .from('weekly_commitments')
      .update({ start_week: currentWeekMon })
      .eq('client_fk', clientId)
      .eq('active', true);
  }
  
  showToast(shouldPause ? 'Client paused' : 'Client resumed', 'success');
  loadClientsList();
  loadDashboard();
}

function filterClients(searchTerm) {
  renderClientsList(getCurrentFilteredClients());
}

/* ===== Client detail (uses EST-aware sums now) ===== */
async function loadClientDetail() {
  const nameEl = document.getElementById('clientName'); if (!nameEl) return;
  const id = new URL(location.href).searchParams.get('id');
  const supabase = await getSupabase(); if (!supabase) return;

  const [{ data: client }, { data: addrs }, { data: emrs }, { data: wk }, { data: ovr }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).single(),
    supabase.from('client_addresses').select('*').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('client_emrs').select('*').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('weekly_commitments').select('*').eq('client_fk', id).order('start_week', { ascending: false }),
    supabase.from('weekly_overrides').select('*').eq('client_fk', id),
    supabase.from('completions').select('*').eq('client_fk', id)
  ]);

  // Display name with acronym if available
  const displayName = client?.acronym ? `${client.name} (${client.acronym})` : (client?.name || 'Client');
  nameEl.textContent = displayName;
  
  const meta = document.getElementById('clientMeta');
  if (meta) {
    const started = isStarted(client.id, wk, comps);
    const lifetimeCompleted = (comps || []).reduce((s, c) => s + (c.qty_completed || 0), 0);
    const lifetimeUTCs = (comps || []).reduce((s, c) => s + (c.qty_utc || 0), 0);
    const totalLives = client?.total_lives || 0;
    const totalRemaining = Math.max(0, totalLives - lifetimeCompleted - lifetimeUTCs);
    
    let metaHtml = '';
    if (totalLives) {
      metaHtml += `Lives: ${fmt(totalLives)} — Completed: ${fmt(lifetimeCompleted)} — UTCs: ${fmt(lifetimeUTCs)} — Remaining: ${fmt(totalRemaining)} — `;
    }
    
    // Show status based on state
    if (client?.completed) {
      metaHtml += '<span class="text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded text-xs">Completed</span>';
    } else if (client?.paused) {
      metaHtml += '<span class="text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded text-xs">Paused</span>';
    } else if (started) {
      metaHtml += '<span class="text-green-700 bg-green-100 px-1.5 py-0.5 rounded text-xs">Active</span>';
    } else {
      metaHtml += '<span class="text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded text-xs">Not Started</span>';
    }
    meta.innerHTML = metaHtml;
  }
  const lifetime = (comps || []).reduce((s, c) => s + (c.qty_completed || 0), 0);
  const lifetimeUTCs = (comps || []).reduce((s, c) => s + (c.qty_utc || 0), 0);
  const lifetimeEl = document.getElementById('clientLifetime'); 
  if (lifetimeEl) lifetimeEl.textContent = `Lifetime: ${fmt(lifetime)} completed, ${fmt(lifetimeUTCs)} UTCs`;

  const contact = document.getElementById('contact');
  if (contact) contact.innerHTML = client?.contact_email ? `${client?.contact_name || ''} <a class="text-indigo-600 hover:underline" href="mailto:${client.contact_email}">${client.contact_email}</a>` : (client?.contact_name || '—');
  const notes = document.getElementById('notes'); if (notes) notes.textContent = client?.instructions || '—';
  const addrList = document.getElementById('addresses'); if (addrList) addrList.innerHTML = (addrs?.length ? addrs : []).map(a => `<li>${[a.line1, a.line2, a.city, a.state, a.zip].filter(Boolean).join(', ')}</li>`).join('') || '<li class="text-gray-500">—</li>';
  const emrList = document.getElementById('emrs'); if (emrList) emrList.innerHTML = (emrs?.length ? emrs : []).map(e => `<li>${[e.vendor, e.details].filter(Boolean).join(' — ')}</li>`).join('') || '<li class="text-gray-500">—</li>';

  const today = todayEST();
  const mon = mondayOf(today);
  const fri = fridayEndOf(mon);
  const lastMon = priorMonday(mon);
  const lastFri = fridayEndOf(lastMon);

  // Get pure baseline (from weekly_commitments) - NOT including overrides
  const pureBaseThis = pickBaselineForWeek(wk, client.id, mon);
  const pureBaseLast = pickBaselineForWeek(wk, client.id, lastMon);
  
  // Get overrides (if any)
  const ovrThis = overrideForWeek(ovr, client.id, mon);
  const ovrLast = overrideForWeek(ovr, client.id, lastMon);
  
  // Final target = override if exists, else baseline
  const targetThis = ovrThis ?? pureBaseThis;
  const targetLast = ovrLast ?? pureBaseLast;

  const doneLast = sumCompleted(comps, client.id, lastMon, lastFri);
  const carryIn = Math.max(0, targetLast - doneLast);
  const required = Math.max(0, targetThis + carryIn);
  const doneThis = sumCompleted(comps, client.id, mon, fri);
  const remaining = Math.max(0, required - doneThis);
  const needPerDay = remaining / Math.max(1, daysLeftThisWeekFromPerspective(mon));
  const status = carryIn > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

  const setTxt = (id2, v) => { const el = document.getElementById(id2); if (el) el.textContent = v; };
  setTxt('wkQty', pureBaseThis ? fmt(pureBaseThis) + '/wk' : '—');
  setTxt('startWeek', (wk?.find(w => w.active)?.start_week) ? String(wk.find(w => w.active).start_week).slice(0, 10) : '—');
  setTxt('carryIn', fmt(carryIn)); setTxt('required', fmt(required)); setTxt('done', fmt(doneThis)); setTxt('remaining', fmt(remaining));
  document.getElementById('clientStatus')?.setAttribute('status', status);

  const canv = document.getElementById('clientWeekChart');
  if (canv && window.Chart) {
    const colors = statusColors(status);
    const yCfg = yScaleFor([required], 0.08);
    if (window.__clientChart) window.__clientChart.destroy();
    const point = { x: 'This week', y: remaining, completed: doneThis, target: required, color: colors.fill, hover: colors.hover, stroke: colors.stroke };
    window.__clientChart = new Chart(canv.getContext('2d'), {
      type: 'bar',
      data: { labels: ['This week'], datasets: [{ label: 'Remaining', data: [point], backgroundColor: (ctx) => ctx.raw.color, hoverBackgroundColor: (ctx) => ctx.raw.hover, borderColor: (ctx) => ctx.raw.stroke, borderWidth: 1.5, borderRadius: 12, borderSkipped: false, maxBarThickness: 56 }] },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17,24,39,0.9)', padding: 10,
            callbacks: {
              title: () => 'This week',
              label: (ctx2) => {
                const raw = ctx2.raw || {};
                const rem = ctx2.parsed.y ?? 0;
                const tgt = raw.target ?? (rem + (raw.completed ?? 0));
                const done = raw.completed ?? 0;
                const pct = tgt ? Math.round((done / tgt) * 100) : 0;
                return [`Remaining: ${fmt(rem)}`, `Completed: ${fmt(done)} of ${fmt(tgt)} (${pct}%)`];
              }
            }
          }
        },
        scales: { y: { beginAtZero: true, min: yCfg.min, max: yCfg.max, ticks: { stepSize: yCfg.stepSize } }, x: { ticks: { maxRotation: 0 } } }
      }
    });
  }

  const body = document.getElementById('clientWeekBody');
  if (body) {
    const rowHtml = (weekMon, base, ovrQty, tgt, done, rem) => {
      const fri2 = fridayEndOf(weekMon).toISOString().slice(0, 10);
      return `<tr>
        <td class="px-4 py-2 text-sm">${fri2}</td>
        <td class="px-4 py-2 text-sm">${base ? fmt(base) : '—'}</td>
        <td class="px-4 py-2 text-sm">${ovrQty != null ? fmt(ovrQty) : '—'}</td>
        <td class="px-4 py-2 text-sm">${fmt(tgt)}</td>
        <td class="px-4 py-2 text-sm">${fmt(done)}</td>
        <td class="px-4 py-2 text-sm">${fmt(rem)}</td>
        <td class="px-4 py-2 text-sm text-right">
          <button class="px-2 py-1 rounded border text-xs" data-ovr="${weekMon.toISOString().slice(0,10)}" data-target="${tgt}">Edit target</button>
        </td>
      </tr>`;
    };
    const remLast = Math.max(0, targetLast - doneLast);
    body.innerHTML = [
      rowHtml(lastMon, pureBaseLast, ovrLast ?? null, targetLast, doneLast, remLast),
      rowHtml(mon, pureBaseThis, ovrThis ?? null, required, doneThis, remaining)
    ].join('');

    body.onclick = (e) => {
      const b = e.target.closest('button[data-ovr]'); if (!b) return;
      openOverrideModal(client.id, b.dataset.ovr, b.dataset.target);
    };
  }

  const logLabel = client?.acronym || client?.name || 'Client';
  const logBtn = document.getElementById('clientLogBtn'); if (logBtn) logBtn.onclick = () => openLogModal(id, logLabel);
  const delBtn = document.getElementById('clientDeleteBtn'); if (delBtn) delBtn.onclick = async () => { await handleDelete(id, client?.name || 'this client'); location.href = './clients.html'; };
  
  // Pause button - toggle paused status
  const pauseBtn = document.getElementById('clientPauseBtn');
  if (pauseBtn) {
    // Update button text based on current status
    if (client?.paused) {
      pauseBtn.textContent = 'Resume';
      pauseBtn.classList.remove('border-amber-600', 'text-amber-600', 'hover:bg-amber-50');
      pauseBtn.classList.add('border-green-600', 'text-green-600', 'hover:bg-green-50');
    }
    // Hide pause button if completed
    if (client?.completed) {
      pauseBtn.style.display = 'none';
    }
    pauseBtn.onclick = async () => {
      const newStatus = !client?.paused;
      const action = newStatus ? 'pause this client' : 'resume this client';
      if (!confirm(`Are you sure you want to ${action}?`)) return;
      
      const supabase = await getSupabase();
      if (!supabase) return toast.error('Supabase not configured.');
      
      const { error } = await supabase.from('clients').update({ paused: newStatus }).eq('id', id);
      if (error) {
        console.error(error);
        return toast.error('Failed to update client status.');
      }
      
      // When resuming, update the baseline's start_week to current week so there's no carryover from paused period
      if (!newStatus) {
        const currentWeekMon = mondayOf(todayEST()).toISOString().slice(0, 10);
        await supabase
          .from('weekly_commitments')
          .update({ start_week: currentWeekMon })
          .eq('client_fk', id)
          .eq('active', true);
      }
      
      toast.success(newStatus ? 'Client paused' : 'Client resumed');
      loadClientDetail(); // Refresh the page
    };
  }
  
  // Complete button - toggle completed status
  const completeBtn = document.getElementById('clientCompleteBtn');
  if (completeBtn) {
    // Update button text based on current status
    if (client?.completed) {
      completeBtn.textContent = 'Mark Active';
      completeBtn.classList.remove('border-green-600', 'text-green-600', 'hover:bg-green-50');
      completeBtn.classList.add('border-gray-600', 'text-gray-600', 'hover:bg-gray-50');
    }
    completeBtn.onclick = async () => {
      const newStatus = !client?.completed;
      const action = newStatus ? 'mark this client as completed' : 'reactivate this client';
      if (!confirm(`Are you sure you want to ${action}?`)) return;
      
      const supabase = await getSupabase();
      if (!supabase) return toast.error('Supabase not configured.');
      
      // When marking as completed, also unpause
      const updates = { completed: newStatus };
      if (newStatus) updates.paused = false;
      
      const { error } = await supabase.from('clients').update(updates).eq('id', id);
      if (error) {
        console.error(error);
        return toast.error('Failed to update client status.');
      }
      
      toast.success(newStatus ? 'Client marked as completed' : 'Client reactivated');
      loadClientDetail(); // Refresh the page
    };
  }
}

/* ===== Override modal ===== */
const ovrModal = document.getElementById('overrideModal');
const ovrForm = document.getElementById('ovrForm');
const ovrCancel = document.getElementById('ovrCancel');
const ovrClose = document.getElementById('ovrClose');
const ovrWeekLabel = document.getElementById('ovrWeekLabel');

function openOverrideModal(clientId, weekStartISO, currentTarget = '') {
  if (!ovrForm) return;
  ovrForm.client_id.value = clientId;
  ovrForm.week_start.value = weekStartISO;
  ovrForm.weekly_qty.value = currentTarget;
  ovrForm.note.value = '';
  if (ovrWeekLabel) ovrWeekLabel.textContent = weekStartISO;
  ovrModal?.classList.remove('hidden');
  ovrModal?.classList.add('flex');
}
function closeOverrideModal() { 
  ovrModal?.classList.add('hidden'); 
  ovrModal?.classList.remove('flex');
}
ovrCancel?.addEventListener('click', closeOverrideModal);
ovrClose?.addEventListener('click', closeOverrideModal);

ovrForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');
  const client_fk = ovrForm.client_id.value;
  const week_start = ovrForm.week_start.value;
  const weekly_qty = Number(ovrForm.weekly_qty.value || 0);
  const note = ovrForm.note.value?.trim() || null;
  if (weekly_qty < 0) return toast.warning('Weekly target cannot be negative.');
  const { data: existing } = await supabase.from('weekly_overrides').select('id').eq('client_fk', client_fk).eq('week_start', week_start).limit(1);
  if (existing && existing.length) {
    await supabase.from('weekly_overrides').update({ weekly_qty, note }).eq('id', existing[0].id);
  } else {
    await supabase.from('weekly_overrides').insert({ client_fk, week_start, weekly_qty, note });
  }
  closeOverrideModal();
  await loadDashboard();
  await loadClientDetail();
});

/* ===== Partners (read-only) ===== */
async function hydratePartnerDatalist() {
  const list = document.getElementById('partnerList');
  if (!list) return;
  const supabase = await getSupabase(); if (!supabase) return;
  const { data } = await supabase.from('clients').select('sales_partner');
  const names = Array.from(new Set((data || []).map(r => r.sales_partner).filter(Boolean))).sort();
  list.innerHTML = names.map(n => `<option value="${n}"></option>`).join('');
}

async function loadPartnersPage() {
  const tableBody = document.getElementById('partnersBody');
  const tabsWrap = document.getElementById('partnersTabsWrap');
  const tabs = document.getElementById('partnersTabs');
  if (!tableBody || !tabsWrap || !tabs) return;

  showLoading('partnersBody', 'Loading partners...');

  const supabase = await getSupabase(); if (!supabase) return;

  const [{ data: clients }, { data: wk }, { data: ovr }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,acronym,sales_partner,completed,paused').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    supabase.from('completions').select('client_fk,occurred_on,qty_completed')
  ]);

  const today = todayEST();
  const mon = mondayOf(today);
  const fri = fridayEndOf(mon);

  const partners = Array.from(new Set((clients || []).map(c => c.sales_partner).filter(Boolean))).sort();
  tabs.innerHTML = partners.map(p =>
    `<button data-partner="${p}" class="px-3 py-1.5 rounded-lg border text-sm bg-white">${p}</button>`
  ).join('');

  tabsWrap.onclick = (e) => {
    const btn = e.target.closest('button[data-partner]');
    if (!btn) return;
    setActiveTab(btn.dataset.partner);
    render(btn.dataset.partner);
  };

  function setActiveTab(key) {
    [...tabsWrap.querySelectorAll('button[data-partner], button[data-partner="__all__"]')].forEach(b => {
      const active = b.dataset.partner === key;
      b.className = `px-3 py-1.5 rounded-lg border text-sm ${active ? 'bg-purple-600 text-white border-purple-600' : 'bg-white'}`;
    });
  }

  function render(partnerKey) {
    const filtered = (clients || []).filter(c =>
      partnerKey === '__all__' ? Boolean(c.sales_partner) : c.sales_partner === partnerKey
    );

    if (!filtered.length) {
      tableBody.innerHTML = `<tr><td colspan="3" class="px-4 py-6 text-sm text-gray-500">No clients for this partner yet.</td></tr>`;
      return;
    }

    const rows = filtered.map(c => {
      const completedThisWeek = sumCompleted(comps, c.id, mon, fri);
      const lifetime = sumCompleted(comps, c.id);
      return { id: c.id, name: c.name, completedThisWeek, lifetime };
    }).sort((a,b) => b.completedThisWeek - a.completedThisWeek);

    tableBody.innerHTML = rows.map(r => `
      <tr>
        <td class="px-4 py-2 text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${r.name}</a></td>
        <td class="px-4 py-2 text-sm">${fmt(r.completedThisWeek)}</td>
        <td class="px-4 py-2 text-sm">${fmt(r.lifetime)}</td>
      </tr>
    `).join('');
  }

  const urlKey = new URL(location.href).searchParams.get('p');
  const initial = urlKey && partners.includes(urlKey) ? urlKey : '__all__';
  setActiveTab(initial);
  render(initial);

  // Populate report partner dropdown
  const reportSelect = document.getElementById('reportPartnerSelect');
  if (reportSelect) {
    reportSelect.innerHTML = '<option value="">Select a partner...</option>' +
      partners.map(p => `<option value="${p}">${p}</option>`).join('');
  }

  // Store data for PDF generation (include wk for status determination)
  window.__partnersData = { clients, comps, partners, wk };
}

/* ===== Partner PDF Report Generation ===== */
function sumCompletedInMonth(comps, clientId, year, month) {
  // month is 0-indexed (0 = January)
  const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endOfMonth = new Date(year, month + 1, 0); // Last day of month
  const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endOfMonth.getDate()).padStart(2, '0')}`;

  return (comps || []).reduce((sum, row) => {
    if (row.client_fk !== clientId) return sum;
    const dY = toYMD(row.occurred_on);
    if (!dY || dY < startOfMonth || dY > endStr) return sum;
    return sum + (row.qty_completed || 0);
  }, 0);
}

function sumCompletedInRange(comps, clientId, startDate, endDate) {
  return (comps || []).reduce((sum, row) => {
    if (row.client_fk !== clientId) return sum;
    const dY = toYMD(row.occurred_on);
    if (!dY || dY < startDate || dY > endDate) return sum;
    return sum + (row.qty_completed || 0);
  }, 0);
}

async function loadLogoAsDataURL() {
  try {
    const response = await fetch('./medsync-logo-horizontal.svg');
    const svgText = await response.text();

    // Create a canvas to render SVG
    const img = new Image();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    return new Promise((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Set canvas size proportional to logo (aspect ratio ~2.5:1)
        canvas.width = 500;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = url;
    });
  } catch (err) {
    console.error('Failed to load logo:', err);
    return null;
  }
}

async function generatePartnerPDF(partnerName, reportType, selectedClientIds = null) {
  const { jsPDF } = window.jspdf;
  const data = window.__partnersData;
  if (!data) { toast.error('Data not loaded. Please refresh the page.'); return; }

  const { clients, comps, wk } = data;

  // Filter clients for this partner
  let filteredClients = (clients || []).filter(c => c.sales_partner === partnerName);

  // Filter to only selected clients if specified
  if (selectedClientIds && selectedClientIds.length > 0) {
    const selectedSet = new Set(selectedClientIds);
    filteredClients = filteredClients.filter(c => selectedSet.has(c.id));
  }

  if (!filteredClients.length) {
    toast.warning('No clients selected for this report.');
    return;
  }

  // Date ranges for year-based filtering
  const today = todayEST();
  const todayYMD = ymdEST(today);
  const start2025 = '2025-01-01';
  const end2025 = '2025-12-31';
  const start2026 = '2026-01-01';
  const end2026 = todayYMD; // today for YTD

  // Status labels for PDF display
  const statusLabels = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    not_started: 'Not Started'
  };

  // Calculate completions based on report type
  const rows = filteredClients.map(c => {
    const y2025 = sumCompletedInRange(comps, c.id, start2025, end2025);
    const y2026 = sumCompletedInRange(comps, c.id, start2026, end2026);
    const total = y2025 + y2026;
    const status = getClientStatus(c, wk);
    return { name: c.name, status: statusLabels[status] || 'Unknown', y2025, y2026, total };
  });

  // Sort by appropriate column based on report type
  if (reportType === '2025') {
    rows.sort((a, b) => b.y2025 - a.y2025);
  } else if (reportType === '2026ytd') {
    rows.sort((a, b) => b.y2026 - a.y2026);
  } else {
    rows.sort((a, b) => b.total - a.total);
  }

  // Calculate totals row
  const total2025 = rows.reduce((sum, r) => sum + r.y2025, 0);
  const total2026 = rows.reduce((sum, r) => sum + r.y2026, 0);
  const totalCombined = total2025 + total2026;

  // Create PDF
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Brand colors
  const purple = [112, 48, 160]; // #7030a0
  const blue = [54, 86, 184];   // #3656b8
  const cyan = [1, 167, 203];   // #01a7cb

  let yPos = 15;

  // Try to add logo
  const logoDataURL = await loadLogoAsDataURL();
  if (logoDataURL) {
    const logoWidth = 60;
    const logoHeight = 24;
    doc.addImage(logoDataURL, 'PNG', (pageWidth - logoWidth) / 2, yPos, logoWidth, logoHeight);
    yPos += logoHeight + 10;
  }

  // Title
  doc.setFontSize(20);
  doc.setTextColor(purple[0], purple[1], purple[2]);
  doc.text('Partner Completion Report', pageWidth / 2, yPos, { align: 'center' });
  yPos += 12;

  // Partner name
  doc.setFontSize(14);
  doc.setTextColor(blue[0], blue[1], blue[2]);
  doc.text(partnerName, pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  // Report date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  const reportDate = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(`Generated: ${reportDate}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  // Report type subtitle
  doc.setFontSize(11);
  doc.setTextColor(cyan[0], cyan[1], cyan[2]);
  let reportSubtitle = '';
  if (reportType === '2025') {
    reportSubtitle = '2025 Completions Report';
  } else if (reportType === '2026ytd') {
    reportSubtitle = '2026 Year to Date Report';
  } else {
    reportSubtitle = '2025 & 2026 YTD Combined Report';
  }
  doc.text(reportSubtitle, pageWidth / 2, yPos, { align: 'center' });
  yPos += 12;

  // Build table columns based on report type
  const head = [['Client Name', 'Status']];
  if (reportType === '2025') {
    head[0].push('2025 Complete');
  } else if (reportType === '2026ytd') {
    head[0].push('2026 YTD');
  } else {
    head[0].push('2025 Complete', '2026 YTD', 'Total Complete');
  }

  const body = rows.map(r => {
    const row = [r.name, r.status];
    if (reportType === '2025') {
      row.push(fmt(r.y2025));
    } else if (reportType === '2026ytd') {
      row.push(fmt(r.y2026));
    } else {
      row.push(fmt(r.y2025), fmt(r.y2026), fmt(r.total));
    }
    return row;
  });

  // Add totals row
  const totalsRow = ['TOTAL', ''];
  if (reportType === '2025') {
    totalsRow.push(fmt(total2025));
  } else if (reportType === '2026ytd') {
    totalsRow.push(fmt(total2026));
  } else {
    totalsRow.push(fmt(total2025), fmt(total2026), fmt(totalCombined));
  }
  body.push(totalsRow);

  // Draw table
  doc.autoTable({
    startY: yPos,
    head: head,
    body: body,
    theme: 'striped',
    headStyles: {
      fillColor: purple,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left'
    },
    bodyStyles: {
      textColor: [50, 50, 50]
    },
    alternateRowStyles: {
      fillColor: [245, 245, 250]
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 28 }
    },
    didParseCell: function(data) {
      // Style the totals row
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [230, 230, 240];
      }
      // Right-align numeric columns (all except first two)
      if (data.column.index >= 2) {
        data.cell.styles.halign = 'right';
      }
      // Center the status column
      if (data.column.index === 1 && data.row.index < body.length - 1) {
        data.cell.styles.halign = 'center';
      }
    },
    margin: { left: 20, right: 20 }
  });

  // Disclaimer at bottom
  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  const disclaimer = 'RECAP completions reported here do not indicate that services have been billed or that revenue has been received. This report is for informational purposes only.';
  const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 40);
  doc.text(disclaimerLines, pageWidth / 2, finalY, { align: 'center' });

  // Save the PDF
  const filename = `${partnerName.replace(/[^a-z0-9]/gi, '_')}_completion_report_${ymdEST(today)}.pdf`;
  doc.save(filename);
  toast.success('PDF report downloaded');
}

function getClientStatus(client, wk) {
  // Determine client status based on completed, paused, and whether they have a commitment
  if (client.completed) return 'completed';
  if (client.paused) return 'paused';
  // Check if client has started (has an active commitment)
  const hasCommitment = (wk || []).some(w => w.client_fk === client.id && w.active);
  if (!hasCommitment) return 'not_started';
  return 'active';
}

function getStatusBadgeHTML(status) {
  const styles = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-amber-100 text-amber-700',
    completed: 'bg-blue-100 text-blue-700',
    not_started: 'bg-gray-100 text-gray-600'
  };
  const labels = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    not_started: 'Not Started'
  };
  return `<span class="text-xs px-2 py-0.5 rounded-full ${styles[status] || styles.not_started}">${labels[status] || 'Unknown'}</span>`;
}

/* ===== Client PDF Report Generation (Clients Page) ===== */
async function generateClientPDF(selectedClientIds, includePartner, includeMonthly, includeLifetime) {
  const { jsPDF } = window.jspdf;
  const data = window.__clientsReportData;
  if (!data) { toast.error('Data not loaded. Please refresh the page.'); return; }

  const { clients, comps } = data;

  // Filter to selected clients
  const selectedSet = new Set(selectedClientIds);
  const filteredClients = (clients || []).filter(c => selectedSet.has(c.id));

  if (!filteredClients.length) {
    toast.warning('No clients selected for this report.');
    return;
  }

  // Calculate totals
  const today = todayEST();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const rows = filteredClients.map(c => {
    const monthly = sumCompletedInMonth(comps, c.id, currentYear, currentMonth);
    const lifetime = sumCompleted(comps, c.id);
    return {
      name: c.name,
      partner: c.sales_partner || 'Unassigned',
      monthly,
      lifetime
    };
  }).sort((a, b) => b.lifetime - a.lifetime);

  // Calculate totals row
  const totalMonthly = rows.reduce((sum, r) => sum + r.monthly, 0);
  const totalLifetime = rows.reduce((sum, r) => sum + r.lifetime, 0);

  // Create PDF
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Brand colors
  const purple = [112, 48, 160]; // #7030a0
  const blue = [54, 86, 184];   // #3656b8
  const cyan = [1, 167, 203];   // #01a7cb

  let yPos = 15;

  // Try to add logo
  const logoDataURL = await loadLogoAsDataURL();
  if (logoDataURL) {
    const logoWidth = 60;
    const logoHeight = 24;
    doc.addImage(logoDataURL, 'PNG', (pageWidth - logoWidth) / 2, yPos, logoWidth, logoHeight);
    yPos += logoHeight + 10;
  }

  // Title
  doc.setFontSize(20);
  doc.setTextColor(purple[0], purple[1], purple[2]);
  doc.text('Client Completion Report', pageWidth / 2, yPos, { align: 'center' });
  yPos += 12;

  // Subtitle
  doc.setFontSize(14);
  doc.setTextColor(blue[0], blue[1], blue[2]);
  doc.text('All Clients', pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  // Report date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  const reportDate = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(`Generated: ${reportDate}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  // Year to date note
  doc.setFontSize(11);
  doc.setTextColor(cyan[0], cyan[1], cyan[2]);
  doc.text(`${currentYear} Year to Date Report`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 12;

  // Build table columns based on toggles
  const head = [['Client Name']];
  if (includePartner) head[0].push('Partner');
  if (includeMonthly) head[0].push(`Monthly (${monthName})`);
  if (includeLifetime) head[0].push('Lifetime Total');

  const body = rows.map(r => {
    const row = [r.name];
    if (includePartner) row.push(r.partner);
    if (includeMonthly) row.push(fmt(r.monthly));
    if (includeLifetime) row.push(fmt(r.lifetime));
    return row;
  });

  // Add totals row
  const totalsRow = ['TOTAL'];
  if (includePartner) totalsRow.push('');
  if (includeMonthly) totalsRow.push(fmt(totalMonthly));
  if (includeLifetime) totalsRow.push(fmt(totalLifetime));
  body.push(totalsRow);

  // Draw table
  doc.autoTable({
    startY: yPos,
    head: head,
    body: body,
    theme: 'striped',
    headStyles: {
      fillColor: purple,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left'
    },
    bodyStyles: {
      textColor: [50, 50, 50]
    },
    alternateRowStyles: {
      fillColor: [245, 245, 250]
    },
    columnStyles: {
      0: { cellWidth: 'auto' }
    },
    didParseCell: function(data) {
      // Style the totals row
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [230, 230, 240];
      }
      // Right-align numeric columns (skip Client Name and Partner columns)
      const firstNumericCol = includePartner ? 2 : 1;
      if (data.column.index >= firstNumericCol) {
        data.cell.styles.halign = 'right';
      }
    },
    margin: { left: 20, right: 20 }
  });

  // Disclaimer at bottom
  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  const disclaimer = 'RECAP completions reported here do not indicate that services have been billed or that revenue has been received. This report is for informational purposes only.';
  const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 40);
  doc.text(disclaimerLines, pageWidth / 2, finalY, { align: 'center' });

  // Save the PDF
  const filename = `all_clients_completion_report_${ymdEST(today)}.pdf`;
  doc.save(filename);
  toast.success('PDF report downloaded');
}

function wireClientReportUI() {
  const btnGenerate = document.getElementById('btnGenerateClientPDF');
  const partnerCheckbox = document.getElementById('reportIncludePartnerCol');
  const monthlyCheckbox = document.getElementById('reportIncludeMonthlyCol');
  const lifetimeCheckbox = document.getElementById('reportIncludeLifetimeCol');
  const validationMsg = document.getElementById('reportClientValidation');
  const clientChecklist = document.getElementById('reportClientChecklist');
  const clientSelectionCount = document.getElementById('reportClientCount');
  const btnSelectAll = document.getElementById('btnReportSelectAll');
  const btnDeselectAll = document.getElementById('btnReportDeselectAll');

  if (!btnGenerate) return;

  const data = window.__clientsReportData;
  if (!data) return;

  const { clients, wk } = data;

  // Update selection count display
  const updateSelectionCount = () => {
    const checkboxes = clientChecklist?.querySelectorAll('input[type="checkbox"]') || [];
    const total = checkboxes.length;
    const checked = Array.from(checkboxes).filter(cb => cb.checked).length;
    if (clientSelectionCount) {
      clientSelectionCount.textContent = `${checked} of ${total} clients selected`;
    }
  };

  // Get unique partners for grouping
  const partners = Array.from(new Set((clients || []).map(c => c.sales_partner).filter(Boolean))).sort();

  // Build checklist grouped by partner
  let html = '';

  // First, clients with partners (grouped)
  for (const partner of partners) {
    const partnerClients = (clients || []).filter(c => c.sales_partner === partner);
    if (!partnerClients.length) continue;

    html += `<div class="text-xs font-semibold text-gray-500 px-2 py-1 bg-gray-100 sticky top-0 border-b">${partner}</div>`;
    html += partnerClients.map(c => {
      const status = getClientStatus(c, wk);
      const shouldCheck = status !== 'paused';
      return `
        <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-white rounded px-2 py-1">
          <input type="checkbox" value="${c.id}" class="rounded text-purple-600 focus:ring-purple-500" ${shouldCheck ? 'checked' : ''} />
          <span class="flex-1">${c.name}</span>
          ${getStatusBadgeHTML(status)}
        </label>
      `;
    }).join('');
  }

  // Then, clients without partners
  const unassignedClients = (clients || []).filter(c => !c.sales_partner);
  if (unassignedClients.length) {
    html += `<div class="text-xs font-semibold text-gray-500 px-2 py-1 bg-gray-100 sticky top-0 border-b">Unassigned</div>`;
    html += unassignedClients.map(c => {
      const status = getClientStatus(c, wk);
      const shouldCheck = status !== 'paused';
      return `
        <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-white rounded px-2 py-1">
          <input type="checkbox" value="${c.id}" class="rounded text-purple-600 focus:ring-purple-500" ${shouldCheck ? 'checked' : ''} />
          <span class="flex-1">${c.name}</span>
          ${getStatusBadgeHTML(status)}
        </label>
      `;
    }).join('');
  }

  if (clientChecklist) clientChecklist.innerHTML = html;
  updateSelectionCount();

  // Wire up change events for count update
  clientChecklist?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      updateSelectionCount();
      validateForm();
    });
  });

  // Select All / Deselect All
  btnSelectAll?.addEventListener('click', () => {
    clientChecklist?.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateSelectionCount();
    validateForm();
  });

  btnDeselectAll?.addEventListener('click', () => {
    clientChecklist?.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateSelectionCount();
    validateForm();
  });

  // Get selected client IDs
  const getSelectedClientIds = () => {
    const checkboxes = clientChecklist?.querySelectorAll('input[type="checkbox"]:checked') || [];
    return Array.from(checkboxes).map(cb => cb.value);
  };

  // Validation function
  const validateForm = () => {
    const atLeastOneColumn = monthlyCheckbox?.checked || lifetimeCheckbox?.checked;
    const selectedClients = getSelectedClientIds();
    const atLeastOneClient = selectedClients.length > 0;

    let errorMsg = '';
    if (!atLeastOneColumn && !atLeastOneClient) {
      errorMsg = 'Please select at least one column and one client.';
    } else if (!atLeastOneColumn) {
      errorMsg = 'Please select at least one column to include.';
    } else if (!atLeastOneClient) {
      errorMsg = 'Please select at least one client to include.';
    }

    if (validationMsg) {
      validationMsg.textContent = errorMsg;
      validationMsg.classList.toggle('hidden', !errorMsg);
    }

    btnGenerate.disabled = !atLeastOneColumn || !atLeastOneClient;
  };

  // Wire up validation on change
  partnerCheckbox?.addEventListener('change', validateForm);
  monthlyCheckbox?.addEventListener('change', validateForm);
  lifetimeCheckbox?.addEventListener('change', validateForm);

  // Initial validation
  validateForm();

  // Generate button click
  btnGenerate.addEventListener('click', async () => {
    const includePartner = partnerCheckbox?.checked;
    const includeMonthly = monthlyCheckbox?.checked;
    const includeLifetime = lifetimeCheckbox?.checked;
    const selectedClientIds = getSelectedClientIds();

    if (!includeMonthly && !includeLifetime) {
      toast.warning('Please select at least one column to include.');
      return;
    }

    if (!selectedClientIds.length) {
      toast.warning('Please select at least one client to include.');
      return;
    }

    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Generating...';

    try {
      await generateClientPDF(selectedClientIds, includePartner, includeMonthly, includeLifetime);
    } catch (err) {
      console.error('PDF generation failed:', err);
      toast.error('Failed to generate PDF.');
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'Generate PDF Report';
    }
  });
}

function wirePartnerReportUI() {
  const btnGenerate = document.getElementById('btnGeneratePDF');
  const partnerSelect = document.getElementById('reportPartnerSelect');
  const reportTypeSelect = document.getElementById('reportTypeSelect');
  const validationMsg = document.getElementById('reportValidation');
  const clientSelectionWrap = document.getElementById('clientSelectionWrap');
  const clientChecklist = document.getElementById('clientChecklist');
  const clientSelectionCount = document.getElementById('clientSelectionCount');
  const btnSelectAll = document.getElementById('btnSelectAll');
  const btnDeselectAll = document.getElementById('btnDeselectAll');

  if (!btnGenerate) return;

  // Update selection count display
  const updateSelectionCount = () => {
    const checkboxes = clientChecklist?.querySelectorAll('input[type="checkbox"]') || [];
    const total = checkboxes.length;
    const checked = Array.from(checkboxes).filter(cb => cb.checked).length;
    if (clientSelectionCount) {
      clientSelectionCount.textContent = `${checked} of ${total} clients selected`;
    }
  };

  // Populate client checklist for selected partner
  const populateClientList = (partnerName) => {
    const data = window.__partnersData;
    if (!data || !partnerName) {
      clientSelectionWrap?.classList.add('hidden');
      return;
    }

    const { clients, wk } = data;
    const filteredClients = (clients || []).filter(c => c.sales_partner === partnerName);

    if (!filteredClients.length) {
      clientSelectionWrap?.classList.add('hidden');
      return;
    }

    // Build checklist with status badges
    // Pre-check Active and Completed, uncheck Paused
    const html = filteredClients.map(c => {
      const status = getClientStatus(c, wk);
      const shouldCheck = status !== 'paused';
      return `
        <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-white rounded px-2 py-1">
          <input type="checkbox" value="${c.id}" class="rounded text-purple-600 focus:ring-purple-500" ${shouldCheck ? 'checked' : ''} />
          <span class="flex-1">${c.name}</span>
          ${getStatusBadgeHTML(status)}
        </label>
      `;
    }).join('');

    if (clientChecklist) clientChecklist.innerHTML = html;
    clientSelectionWrap?.classList.remove('hidden');
    updateSelectionCount();

    // Wire up change events for count update
    clientChecklist?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        updateSelectionCount();
        validateForm();
      });
    });
  };

  // Select All / Deselect All
  btnSelectAll?.addEventListener('click', () => {
    clientChecklist?.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateSelectionCount();
    validateForm();
  });

  btnDeselectAll?.addEventListener('click', () => {
    clientChecklist?.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateSelectionCount();
    validateForm();
  });

  // Get selected client IDs
  const getSelectedClientIds = () => {
    const checkboxes = clientChecklist?.querySelectorAll('input[type="checkbox"]:checked') || [];
    return Array.from(checkboxes).map(cb => cb.value);
  };

  // Validation function
  const validateForm = () => {
    const partnerSelected = partnerSelect?.value;
    const reportTypeSelected = reportTypeSelect?.value;
    const selectedClients = getSelectedClientIds();
    const atLeastOneClient = selectedClients.length > 0;

    let errorMsg = '';
    if (!reportTypeSelected && !atLeastOneClient) {
      errorMsg = 'Please select a report type and at least one client.';
    } else if (!reportTypeSelected) {
      errorMsg = 'Please select a report type.';
    } else if (partnerSelected && !atLeastOneClient) {
      errorMsg = 'Please select at least one client to include.';
    }

    if (validationMsg) {
      validationMsg.textContent = errorMsg;
      validationMsg.classList.toggle('hidden', !errorMsg);
    }

    btnGenerate.disabled = !partnerSelected || !reportTypeSelected || !atLeastOneClient;
  };

  // Wire up partner selection to populate client list
  partnerSelect?.addEventListener('change', () => {
    populateClientList(partnerSelect.value);
    validateForm();
  });

  // Wire up validation on report type change
  reportTypeSelect?.addEventListener('change', validateForm);

  // Initial validation
  validateForm();

  // Generate button click
  btnGenerate.addEventListener('click', async () => {
    const partner = partnerSelect?.value;
    const reportType = reportTypeSelect?.value;
    const selectedClientIds = getSelectedClientIds();

    if (!partner) {
      toast.warning('Please select a partner.');
      return;
    }

    if (!reportType) {
      toast.warning('Please select a report type.');
      return;
    }

    if (!selectedClientIds.length) {
      toast.warning('Please select at least one client to include.');
      return;
    }

    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Generating...';

    try {
      await generatePartnerPDF(partner, reportType, selectedClientIds);
    } catch (err) {
      console.error('PDF generation failed:', err);
      toast.error('Failed to generate PDF.');
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'Generate PDF Report';
    }
  });
}

/* ===== Recommendations ===== */
function remainingWeekdaysRange(today) {
  const mon = mondayOf(today);
  const all = Array.from({ length: 5 }, (_, i) => addDays(mon, i));
  const rem = all.filter(d => d.getTime() >= today.getTime());
  if (rem.length) return rem;
  const nextMon = addDays(mon, 7);
  return Array.from({ length: 5 }, (_, i) => addDays(nextMon, i));
}
function allocatePlan(rows, days, {
  scenario = 'even',
  dayCapacity = null,
  statusWeights = { red:1.3, yellow:1.0, green:0.8 },
  carryInBoost = 0.25,
  vipBoost = 0.2,
  step = 10,
  perClientDayCeilingPct = 0.4,
  clientMeta = {}
} = {}) {
  const nDays = days.length;
  if (!nDays) return { slots: [], totals: [] };

  const dayW = (() => {
    if (scenario === 'frontload') return [0.28,0.24,0.20,0.16,0.12].slice(0, nDays);
    return Array(nDays).fill(1 / nDays);
  })();

  const clientW = rows.map(r => {
    const m = clientMeta[r.id] || {};
    const sw = statusWeights[(m.status||'yellow')] ?? 1.0;
    const extra = (m.carryIn ? carryInBoost : 0) + (m.vip ? vipBoost : 0);
    const complexity = m.complexity || 1.0;
    return Math.max(0.01, (sw + extra) / complexity);
  });

  const weeklyTotals = rows.map(r => Math.max(0, Number(r.remaining || 0)));
  const perClientDayCap = rows.map((r, i) => Math.ceil(weeklyTotals[i] * perClientDayCeilingPct));

  let desiredDayTotals = dayW.map(w => Math.round(w * weeklyTotals.reduce((a,b)=>a+b,0)));

  let cap = (scenario === 'capacity' && dayCapacity && dayCapacity.length === nDays) ? dayCapacity.slice() : null;
  if (cap) desiredDayTotals = desiredDayTotals.map((d, i) => Math.min(d, cap[i]));

  const slots = rows.map(() => Array(nDays).fill(0));
  const remaining = weeklyTotals.slice();

  for (let d = 0; d < nDays; d++) {
    let dayLeft = desiredDayTotals[d];
    if (!dayLeft) continue;

    for (let pass = 0; pass < 3 && dayLeft > 0; pass++) {
      const weightsActive = rows.map((r, i) => remaining[i] > 0 ? clientW[i] : 0);
      const sumW = weightsActive.reduce((a,b)=>a+b,0) || 1;

      for (let i = 0; i < rows.length && dayLeft > 0; i++) {
        if (remaining[i] <= 0) continue;
        const want = Math.min(
          Math.ceil((weightsActive[i]/sumW) * dayLeft),
          remaining[i],
          perClientDayCap[i]
        );
        if (want <= 0) continue;
        const rounded = Math.max(step, Math.round(want/step)*step);
        const give = Math.min(rounded, remaining[i], perClientDayCap[i], dayLeft);
        if (give <= 0) continue;

        slots[i][d] += give;
        remaining[i] -= give;
        dayLeft -= give;
      }
    }
  }

  for (let i = 0; i < rows.length; i++) {
    let rem = remaining[i];
    for (let d = 0; d < nDays && rem > 0; d++) {
      const room = (cap ? cap[d] - slots.reduce((s,row)=>s+row[d],0) : Infinity);
      const can = Math.min(rem, perClientDayCap[i], room);
      const give = Math.max(0, Math.round(can/step)*step);
      if (give > 0) { slots[i][d] += give; rem -= give; }
    }
  }

  const totals = Array(nDays).fill(0).map((_, d) => slots.reduce((s,row)=>s+row[d],0));
  return { slots, totals };
}
const SCENARIOS = {
  even: { title: 'Even Split', desc: 'Distributes remaining work evenly across the remaining weekdays. Ignores risk/complexity and the capacity row.' },
  risk: { title: 'Risk-Weighted', desc: 'Prioritizes clients with carry-in and “red” status, then yellow, then green. Useful when SLAs/denials risk is high.' },
  frontload: { title: 'Front-Loaded', desc: 'Intentionally front-loads earlier in the week to build buffer for late-week surprises or staffing gaps.' },
  capacity: { title: 'Capacity-Aware', desc: 'Honors per-day capacity limits you enter above. If caps are too low, some work may remain unallocated.' }
};
function renderScenarioExplainer(active = 'even') {
  if (!recExplain) return;
  const cards = Object.entries(SCENARIOS).map(([key, s]) => {
    const activeCls = key === active ? 'border-indigo-600 bg-indigo-50/50' : 'border-gray-200 bg-white';
    return `
      <div class="rounded-lg border ${activeCls} p-3">
        <div class="font-medium">${s.title}</div>
        <div class="text-sm text-gray-600 mt-1">${s.desc}</div>
      </div>`;
  }).join('');
  recExplain.innerHTML = `
    <div class="text-xs text-gray-500">What each scenario does</div>
    <div class="grid sm:grid-cols-2 gap-3">${cards}</div>
    <div class="text-xs text-gray-500 pt-2">
      Notes: allocations round to 10s; per-client/day is capped at ~40% of that client’s weekly remaining; never exceeds a client’s weekly remaining.
    </div>
  `;
}

/* ===== Recommendations modal wiring (unchanged behavior; uses current week) ===== */
function openRecModal() {
  if (!recModal) return;
  const rows = (__rowsForRec || []).filter(r => r.required > 0);
  if (!rows.length) { toast.info('No active commitments this week.'); return; }

  const days = remainingWeekdaysRange(todayEST());

  recCapRow.innerHTML = days.map((d, i) => `
    <div>
      <label class="block text-xs text-gray-600 mb-1">${dayLabel(d)}</label>
      <input type="number" inputmode="numeric" min="0" step="10"
        class="w-full border rounded-lg px-2 py-1" id="recCap${i}" placeholder="e.g., 200" />
    </div>
  `).join('');

  recHead.innerHTML = [
    `<th class="px-4 py-2 text-left text-xs font-semibold text-gray-600">Client</th>`,
    ...days.map(d => `<th class="px-2 py-2 text-right text-xs font-semibold text-gray-600">${dayLabel(d)}</th>`),
    `<th class="px-3 py-2 text-right text-xs font-semibold text-gray-600">Weekly</th>`
  ].join('');

  recBody.innerHTML = '';
  recFoot.innerHTML = '';

  recModal.dataset.days = JSON.stringify(days.map(d => d.toISOString().slice(0,10)));
  recModal.dataset.rows = JSON.stringify(rows);

  recModal.classList.remove('hidden');
  recModal.classList.add('flex');
  runRecommendations();
  renderScenarioExplainer(getRecScenario());
}
function closeRecModal() { 
  recModal?.classList.add('hidden'); 
  recModal?.classList.remove('flex');
}
function getRecScenario() {
  const el = document.querySelector('input[name="recScenario"]:checked');
  return el ? el.value : 'even';
}
function getCapacities() {
  const daysISO = JSON.parse(recModal.dataset.days || '[]');
  return daysISO.map((_, i) => {
    const v = document.getElementById(`recCap${i}`)?.value?.trim();
    return v ? Math.max(0, Number(v)) : 0;
  });
}
function runRecommendations() {
  if (!recModal) return;
  const rows = JSON.parse(recModal.dataset.rows || '[]');
  const daysISO = JSON.parse(recModal.dataset.days || '[]');
  const days = daysISO.map(s => new Date(s+'T00:00:00'));
  const scenario = getRecScenario();

  const clientMeta = {};
  rows.forEach(r => { clientMeta[r.id] = { status: r.status, carryIn: (r.carryIn || 0) > 0, vip: false, complexity: 1.0 }; });

  const caps = getCapacities();
  const dayCapacity = (scenario === 'capacity') ? caps : null;

  const { slots, totals } = allocatePlan(
    rows.map(r => ({ id: r.id, name: r.name, remaining: r.remaining })),
    days,
    { scenario, clientMeta, dayCapacity }
  );

  recBody.innerHTML = rows.map((r, i) => {
    const weekSum = slots[i].reduce((a,b)=>a+b,0);
    const cells = slots[i].map(v => `<td class="px-2 py-2 text-right">${fmt(v)}</td>`).join('');
    return `<tr>
      <td class="px-4 py-2">${r.name}</td>
      ${cells}
      <td class="px-3 py-2 text-right font-medium">${fmt(weekSum)}</td>
    </tr>`;
  }).join('');

  const grand = totals.reduce((a,b)=>a+b,0);
  recFoot.innerHTML = `
    <tr>
      <td class="px-4 py-2 text-right">Totals</td>
      ${totals.map(t => `<td class="px-2 py-2 text-right">${fmt(t)}</td>`).join('')}
      <td class="px-3 py-2 text-right">${fmt(grand)}</td>
    </tr>
  `;
}

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', async () => {
  try { await requireAuth(); } catch { return; }
  wireLogoutButton();
  document.getElementById('filterContracted')?.addEventListener('change', loadDashboard);

  // Week navigation
  weekPrevBtn?.addEventListener('click', () => { __weekOffset -= 1; loadDashboard(); });
  weekNextBtn?.addEventListener('click', () => { __weekOffset += 1; loadDashboard(); });

  // Client search
  const clientSearch = document.getElementById('clientSearch');
  clientSearch?.addEventListener('input', (e) => filterClients(e.target.value));

  // Initial loads
  loadDashboard();
  loadClientsList();
  loadClientDetail();
  loadPartnersPage();
  wirePartnerReportUI();
  hydratePartnerDatalist();

  // Open/close Recommendations modal
  btnRec?.addEventListener('click', openRecModal);
  recClose?.addEventListener('click', closeRecModal);

  // Live updates: scenario change & capacity inputs
  document.querySelectorAll('input[name="recScenario"]').forEach(r =>
    r.addEventListener('change', () => { runRecommendations(); renderScenarioExplainer(getRecScenario()); })
  );
  recCapRow?.addEventListener('input', (e) => {
    if (e.target && e.target.matches('input[type="number"]')) runRecommendations();
  });

  // Copy/Download CSV
  document.getElementById('recCopy')?.addEventListener('click', () => {
    const rows = JSON.parse(recModal.dataset.rows || '[]');
    const daysISO = JSON.parse(recModal.dataset.days || '[]');
    const days = daysISO.map(s => new Date(s+'T00:00:00'));
    const scenario = getRecScenario();
    const caps = getCapacities();
    const clientMeta = {}; rows.forEach(r => { clientMeta[r.id] = { status:r.status, carryIn:(r.carryIn||0) > 0 }; });
    const { slots } = allocatePlan(rows.map(r => ({ id:r.id, name:r.name, remaining:r.remaining })), days, { scenario, clientMeta, dayCapacity:(scenario==='capacity'?caps:null) });
    const header = ['Client', ...days.map(d => dayLabel(d)), 'Weekly Total'];
    const lines = [header.join(',')];
    rows.forEach((r, i) => {
      const weekSum = slots[i].reduce((a,b)=>a+b,0);
      lines.push([r.name, ...slots[i], weekSum].join(','));
    });
    const csv = lines.join('\n');
    navigator.clipboard.writeText(csv).then(() => toast.success('Copied to clipboard'));
  });

  document.getElementById('recDownload')?.addEventListener('click', () => {
    const rows = JSON.parse(recModal.dataset.rows || '[]');
    const daysISO = JSON.parse(recModal.dataset.days || '[]');
    const days = daysISO.map(s => new Date(s+'T00:00:00'));
    const scenario = getRecScenario();
    const caps = getCapacities();
    const clientMeta = {}; rows.forEach(r => { clientMeta[r.id] = { status:r.status, carryIn:(r.carryIn||0) > 0 }; });
    const { slots } = allocatePlan(rows.map(r => ({ id:r.id, name:r.name, remaining:r.remaining })), days, { scenario, clientMeta, dayCapacity:(scenario==='capacity'?caps:null) });
    const header = ['Client', ...days.map(d => dayLabel(d)), 'Weekly Total'];
    const lines = [header.join(',')];
    rows.forEach((r, i) => {
      const weekSum = slots[i].reduce((a,b)=>a+b,0);
      lines.push([r.name, ...slots[i], weekSum].join(','));
    });
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `recommendations_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
});
