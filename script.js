// script.js — adds week navigation; weekly model + per-week overrides + negatives + lifetime + started tags + partners view + recommendations modal
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';

/* ===== Utils ===== */
const fmt = (n) => Number(n || 0).toLocaleString();

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
  f.setDate(f.getDate() + 5);
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
function yScaleFor(values, pad = 0.06) {
  const nums = (values || []).map(v => +v || 0);
  const mx = Math.max(...nums, 0);
  if (mx <= 0) return { min: 0, max: 1, stepSize: 1 };
  const top = Math.ceil(mx * (1 + pad));
  const rough = top / 5, pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(5, Math.ceil(rough / pow) * pow);
  return { min: 0, max: Math.ceil(top / step) * step, stepSize: step };
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
function setLogDefaultDate() {
  if (!logForm) return;
  const dateInput = logForm.querySelector('input[name="occurred_on"]');
  if (!dateInput) return;

  // Only set it if empty so you can reuse a backdated date for multiple logs
  if (!dateInput.value) {
    const t = todayEST();
    const year = t.getFullYear();
    const month = String(t.getMonth() + 1).padStart(2, '0');
    const day = String(t.getDate()).padStart(2, '0');
    const ymd = `${year}-${month}-${day}`;

    dateInput.value = ymd;
    dateInput.max = ymd; // prevent logging into the future
  }
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
  modalTitle.textContent = 'Add Client';
  clientForm.reset();
  clientForm.client_id.value = '';
  addressesList.innerHTML = ''; addAddressRow();
  emrsList.innerHTML = ''; addEmrRow();
  setWeeklyInputValues({ weekly_qty: '', start_week: '' });
  hydratePartnerDatalist();
}
async function openClientModalById(id) {
  const supabase = await getSupabase(); if (!supabase) return alert('Supabase not configured.');
  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single();
  const [{ data: addrs }, { data: emrs }, { data: commits }] = await Promise.all([
    supabase.from('client_addresses').select('line1,line2,city,state,zip').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('client_emrs').select('vendor,details').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('weekly_commitments').select('weekly_qty,start_week,active').eq('client_fk', id).order('start_week', { ascending: false }).limit(1)
  ]);
  if (!modal) return;
  modal.classList.remove('hidden');
  modalTitle.textContent = 'Edit Client';
  clientForm.reset();
  clientForm.client_id.value = client?.id || '';
  clientForm.name.value = client?.name || '';
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
const closeClientModal = () => modal?.classList.add('hidden');
btnOpen?.addEventListener('click', openClientModalBlank);
btnClose?.addEventListener('click', closeClientModal);
btnCancel?.addEventListener('click', closeClientModal);
btnAddAddr?.addEventListener('click', () => addAddressRow());
btnAddEmr?.addEventListener('click', () => addEmrRow());

/* ===== Create/Update Client ===== */
clientForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return alert('Supabase not configured.');

  const payload = {
    name: clientForm.name.value.trim(),
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
    if (error) { console.error(error); return alert('Failed to update client.'); }
  } else {
    const { data: row, error } = await supabase.from('clients').insert(payload).select('id').single();
    if (error) { console.error(error); return alert('Failed to create client.'); }
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
    const newStart = inputStart ? inputStart : (current?.start_week ? String(current.start_week).slice(0, 10) : null);

    const unchanged = current && Number(current.weekly_qty) === newQty &&
      String(current.start_week).slice(0, 10) === String(newStart).slice(0, 10);

    if (!unchanged && newQty > 0 && newStart) {
      if (current) await supabase.from('weekly_commitments').update({ active: false }).eq('client_fk', clientId).eq('active', true);
      const { error: insC } = await supabase.from('weekly_commitments').insert({
        client_fk: clientId, weekly_qty: newQty, start_week: newStart, active: true
      });
      if (insC) { console.error(insC); return alert('Failed to save weekly commitment.'); }
    }
  }

  closeClientModal();
  await loadClientsList();
  await loadDashboard();
  alert('Saved.');
});

/* ===== Delete client ===== */
async function handleDelete(clientId, clientName = 'this client') {
  if (!confirm(`Delete “${clientName}”? This removes the client and all related data.`)) return;
  const supabase = await getSupabase(); if (!supabase) return alert('Supabase not configured.');
  const tables = ['completions', 'client_addresses', 'client_emrs', 'weekly_commitments', 'weekly_overrides'];
  for (const t of tables) await supabase.from(t).delete().eq('client_fk', clientId);
  await supabase.from('clients').delete().eq('id', clientId);
  await loadClientsList(); await loadDashboard();
  alert('Client deleted.');
}

/* ===== Shared calculations ===== */
function pickBaselineForWeek(commitRows, clientId, refMon) {
  const rows = (commitRows || []).filter(r => r.client_fk === clientId && r.active && new Date(r.start_week) <= refMon)
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

async function loadDashboard() {
  if (!kpiTotal) return;
  const supabase = await getSupabase(); if (!supabase) return;

  const [{ data: clients }, { data: wk }, { data: ovr }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives,sales_partner').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    supabase.from('completions').select('client_fk,occurred_on,qty_completed')
  ]);

  // Debug: see recent completions in console
  console.log('Dashboard completions (sample):', (comps || []).slice(-5));

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
      ? 'This Week by Client (Remaining — tooltip shows completed %)'
      : `Week of ${shortDate(monSel)} by Client (Remaining — tooltip shows completed %)`;
  }

  const startedOnly = document.getElementById('filterContracted')?.checked ?? true;

  const rows = (clients || []).filter(c => {
    return !startedOnly || isStarted(c.id, wk, comps);
  }).map(c => {
    // --- Compute "required" for selected week with carry chain forward ---
    const baseLast0 = baseTargetFor(ovr, wk, c.id, priorMonday(mon0));
    const doneLast0 = sumCompleted(comps, c.id, priorMonday(mon0), fridayEndOf(priorMonday(mon0)));
    const carry0 = Math.max(0, baseLast0 - doneLast0);

    const base0 = baseTargetFor(ovr, wk, c.id, mon0);
    let requiredPrev = Math.max(0, base0 + carry0); // required for w=0
    let donePrev = sumCompleted(comps, c.id, mon0, fridayEndOf(mon0)); // actual work this week

    if (__weekOffset > 0) {
      for (let step = 1; step <= __weekOffset; step++) {
        const monW = addDays(mon0, step * 7);
        const baseW = baseTargetFor(ovr, wk, c.id, monW);
        const carryW = Math.max(0, requiredPrev - (step === 1 ? donePrev : 0)); // assume 0 completions for future weeks
        const requiredW = Math.max(0, baseW + carryW);
        requiredPrev = requiredW;
        donePrev = 0;
      }
    }

    const requiredSel = requiredPrev;
    const doneSel = (__weekOffset === 0)
      ? sumCompleted(comps, c.id, mon0, fridayEndOf(mon0))
      : 0;

    const remaining = Math.max(0, requiredSel - doneSel);

    // Status calculation: per-day based on selected week perspective
    const needPerDay = remaining / Math.max(1, daysLeftThisWeekFromPerspective(monSel));
    const carryInIndicator = Math.max(0, baseTargetFor(ovr, wk, c.id, lastMonSel) - sumCompleted(comps, c.id, lastMonSel, lastFriSel));
    const status = carryInIndicator > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

    const lifetime = sumCompleted(comps, c.id);
    return { id: c.id, name: c.name, required: requiredSel, remaining, doneThis: doneSel, carryIn: carryInIndicator, status, lifetime, targetThis: baseTargetFor(ovr, wk, c.id, monSel) };
  });

  const totalReq = rows.reduce((s, r) => s + r.required, 0);
  const totalDone = rows.reduce((s, r) => s + r.doneThis, 0);
  const totalRem = Math.max(0, totalReq - totalDone);
  const totalLifetime = (comps || []).reduce((s, c) => s + (c.qty_completed || 0), 0);

  kpiTotal?.setAttribute('value', fmt(totalReq));
  kpiCompleted?.setAttribute('value', fmt(totalDone));
  kpiRemaining?.setAttribute('value', fmt(totalRem));
  kpiLifetime?.setAttribute('value', fmt(totalLifetime));

  renderByClientChart(rows);
  renderDueThisWeek(rows);

  __rowsForRec = rows;
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
  const yCfg = yScaleFor([...remains, ...required], 0.08);

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
function renderDueThisWeek(rows) {
  if (!dueBody) return;
  const items = rows.filter(r => r.required > 0).sort((a, b) => b.remaining - a.remaining);
  if (!items.length) { dueBody.innerHTML = `<tr><td colspan="6" class="py-4 text-sm text-gray-500">No active commitments for this week.</td></tr>`; return; }
  dueBody.innerHTML = items.map(r => {
    const done = Math.max(0, r.required - r.remaining);
    return `<tr>
      <td class="px-4 py-2 text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${r.name}</a></td>
      <td class="px-4 py-2 text-sm">${fmt(r.required)}</td>
      <td class="px-4 py-2 text-sm">${fmt(done)}</td>
      <td class="px-4 py-2 text-sm">${fmt(r.remaining)}</td>
      <td class="px-4 py-2 text-sm"><status-badge status="${r.status}"></status-badge></td>
      <td class="px-4 py-2 text-sm text-right"><button class="px-2 py-1 rounded bg-gray-900 text-white text-xs" data-log="${r.id}" data-name="${r.name}">Log</button></td>
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
}
function closeLogModal() { logModal?.classList.add('hidden'); }
logClose?.addEventListener('click', closeLogModal);
logCancel?.addEventListener('click', closeLogModal);
logForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return alert('Supabase not configured.');

  const qty = Number(logForm.qty.value || 0);
  if (!qty || qty === 0) return alert('Enter a non-zero quantity.');
  if (qty < 0 && !confirm(`You are reducing completed by ${Math.abs(qty)}. Continue?`)) return;

  const dateInput = logForm.querySelector('input[name="occurred_on"]');

  // IMPORTANT: occurred_on is a DATE column in Supabase.
  // We should send a plain 'YYYY-MM-DD' string.
  const occurred_on = (dateInput && dateInput.value)
    ? dateInput.value              // use the chosen work date
    : ymdEST(new Date());          // fallback: today in NY as 'YYYY-MM-DD'

  const payload = {
    client_fk: logForm.client_id.value,
    occurred_on,                   // <-- DATE string, not ISO timestamp
    qty_completed: qty,
    note: logForm.note.value?.trim() || null
  };

  const { error } = await supabase.from('completions').insert(payload);
  if (error) {
    console.error(error);
    return alert('Failed to log completion.');
  }

  closeLogModal();
  await loadDashboard();
  await loadClientDetail();
});

/* ===== Clients list ===== */
async function loadClientsList() {
  if (!clientsTableBody) return;
  const supabase = await getSupabase(); if (!supabase) { clientsTableBody.innerHTML = `<tr><td class="py-4 px-4 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`; return; }

  const [{ data: clients }, { data: wk }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives,sales_partner').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('completions').select('client_fk')
  ]);

  const latestQty = (id) => {
    const rows = (wk || []).filter(r => r.client_fk === id && r.active).sort((a, b) => new Date(b.start_week) - new Date(a.start_week));
    return rows[0]?.weekly_qty || 0;
  };

  clientsTableBody.innerHTML = '';
  (clients || []).forEach(c => {
    const started = isStarted(c.id, wk, comps);
    const tag = started ? `<span class="ml-2 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Started</span>`
                        : `<span class="ml-2 text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">Not Started</span>`;
    const partnerChip = c.sales_partner ? `<span class="ml-2 text-xs text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">${c.sales_partner}</span>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm">
        <a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${c.id}">${c.name}</a>
        ${partnerChip}
        ${tag}
      </td>
      <td class="px-4 py-2 text-sm">${c.total_lives ?? '—'}</td>
      <td class="px-4 py-2 text-sm">${latestQty(c.id) ? fmt(latestQty(c.id)) + '/wk' : '—'}</td>
      <td class="px-4 py-2 text-sm text-right">
        <button class="px-2 py-1 rounded border text-sm mr-2" data-edit="${c.id}">Edit</button>
        <button class="px-2 py-1 rounded border text-sm text-red-600 hover:bg-red-50" data-delete="${c.id}" data-name="${c.name}">Delete</button>
      </td>`;
    clientsTableBody.appendChild(tr);
  });

  clientsTableBody.onclick = async (e) => {
    const del = e.target.closest('button[data-delete]');
    if (del) { await handleDelete(del.dataset.delete, del.dataset.name); return; }
    const edit = e.target.closest('button[data-edit]');
    if (edit) { await openClientModalById(edit.dataset.edit); return; }
  };
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

  nameEl.textContent = client?.name || 'Client';
  const meta = document.getElementById('clientMeta');
  if (meta) {
    const started = isStarted(client.id, wk, comps);
    meta.innerHTML = `${client.total_lives ? `Lives: ${fmt(client.total_lives)} — ` : ''}${started ? '<span class="text-green-700 bg-green-100 px-1.5 py-0.5 rounded text-xs">Started</span>' : '<span class="text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded text-xs">Not Started</span>'}`;
  }
  const lifetime = (comps || []).reduce((s, c) => s + (c.qty_completed || 0), 0);
  const lifetimeEl = document.getElementById('clientLifetime'); if (lifetimeEl) lifetimeEl.textContent = `Lifetime completed: ${fmt(lifetime)}`;

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

  const baseThis = baseTargetFor(ovr, wk, client.id, mon);
  const baseLast = baseTargetFor(ovr, wk, client.id, lastMon);

  const doneLast = sumCompleted(comps, client.id, lastMon, lastFri);
  const carryIn = Math.max(0, baseLast - doneLast);
  const required = Math.max(0, baseThis + carryIn);
  const doneThis = sumCompleted(comps, client.id, mon, fri);
  const remaining = Math.max(0, required - doneThis);
  const needPerDay = remaining / Math.max(1, daysLeftThisWeekFromPerspective(mon));
  const status = carryIn > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

  const setTxt = (id2, v) => { const el = document.getElementById(id2); if (el) el.textContent = v; };
  setTxt('wkQty', baseThis ? fmt(baseThis) + '/wk' : '—');
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
          <button class="px-2 py-1 rounded border text-xs" data-ovr="${weekMon.toISOString().slice(0,10)}">Edit target</button>
        </td>
      </tr>`;
    };
    const oThis = overrideForWeek(ovr, client.id, mon);
    const oLast = overrideForWeek(ovr, client.id, lastMon);
    const remLast = Math.max(0, (baseLast) - doneLast);
    body.innerHTML = [
      rowHtml(lastMon, baseLast, oLast ?? null, baseLast, doneLast, remLast),
      rowHtml(mon, baseThis, oThis ?? null, required, doneThis, remaining)
    ].join('');

    body.onclick = (e) => {
      const b = e.target.closest('button[data-ovr]'); if (!b) return;
      openOverrideModal(client.id, b.dataset.ovr);
    };
  }

  const logBtn = document.getElementById('clientLogBtn'); if (logBtn) logBtn.onclick = () => openLogModal(id, client?.name || 'Client');
  const delBtn = document.getElementById('clientDeleteBtn'); if (delBtn) delBtn.onclick = async () => { await handleDelete(id, client?.name || 'this client'); location.href = './clients.html'; };
}

/* ===== Override modal ===== */
const ovrModal = document.getElementById('overrideModal');
const ovrForm = document.getElementById('ovrForm');
const ovrCancel = document.getElementById('ovrCancel');
const ovrClose = document.getElementById('ovrClose');
const ovrWeekLabel = document.getElementById('ovrWeekLabel');

function openOverrideModal(clientId, weekStartISO) {
  if (!ovrForm) return;
  ovrForm.client_id.value = clientId;
  ovrForm.week_start.value = weekStartISO;
  ovrForm.weekly_qty.value = '';
  ovrForm.note.value = '';
  if (ovrWeekLabel) ovrWeekLabel.textContent = weekStartISO;
  ovrModal?.classList.remove('hidden');
}
function closeOverrideModal() { ovrModal?.classList.add('hidden'); }
ovrCancel?.addEventListener('click', closeOverrideModal);
ovrClose?.addEventListener('click', closeOverrideModal);

ovrForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return alert('Supabase not configured.');
  const client_fk = ovrForm.client_id.value;
  const week_start = ovrForm.week_start.value;
  const weekly_qty = Number(ovrForm.weekly_qty.value || 0);
  const note = ovrForm.note.value?.trim() || null;
  if (weekly_qty < 0) return alert('Weekly target cannot be negative.');
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

  const supabase = await getSupabase(); if (!supabase) return;

  const [{ data: clients }, { data: wk }, { data: ovr }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,sales_partner').order('name'),
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
  if (!rows.length) { alert('No active commitments this week.'); return; }

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
  runRecommendations();
  renderScenarioExplainer(getRecScenario());
}
function closeRecModal() { recModal?.classList.add('hidden'); }
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
  setLogDefaultDate();
  document.getElementById('filterContracted')?.addEventListener('change', loadDashboard);

  // Week navigation
  weekPrevBtn?.addEventListener('click', () => { __weekOffset -= 1; loadDashboard(); });
  weekNextBtn?.addEventListener('click', () => { __weekOffset += 1; loadDashboard(); });

  // Initial loads
  loadDashboard();
  loadClientsList();
  loadClientDetail();
  loadPartnersPage();
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
    navigator.clipboard.writeText(csv).then(() => alert('Copied CSV to clipboard.'));
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
