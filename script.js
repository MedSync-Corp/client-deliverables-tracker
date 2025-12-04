// script.js — weekly model + clients CRUD + delete + addresses/EMRs + dashboard + client detail
import { getSupabase } from './supabaseClient.js';

const DEBUG = false; // set true to see console logs
const log = (...a) => { if (DEBUG) console.log('[DT]', ...a); };

/* =========================
 * Date & math utilities
 * =======================*/

// Always normalize to strict YYYY-MM-DD without timezone drift
function toISODateYMD(val) {
  if (!val) return '';
  const d = (val instanceof Date) ? val : new Date(String(val));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();               // 0 Sun … 6 Sat
  const back = (day + 6) % 7;           // how many days to go back to Monday
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d;
}

function fridayEndOf(monday) {
  const f = new Date(monday);
  f.setDate(f.getDate() + 5);           // Friday
  f.setHours(23, 59, 59, 999);
  return f;
}

function daysLeftThisWeek(today) {
  const dow = today.getDay();
  if (dow === 6 || dow === 0) return 5; // Sat/Sun => assume full week upcoming
  return Math.max(1, 6 - dow);          // Mon=1..Fri=5 -> days including today
}

function yScaleFor(values, pad = 0.08) {
  const nums = (values || []).map(v => +v || 0);
  const mx = Math.max(...nums, 0);
  if (mx <= 0) return { min: 0, max: 1, stepSize: 1 };
  const top = Math.ceil(mx * (1 + pad));
  const rough = top / 5;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(5, Math.ceil(rough / pow) * pow);
  return { min: 0, max: Math.ceil(top / step) * step, stepSize: step };
}

function statusColors(s, a = 0.72) {
  const map = {
    green:  { r: 34,  g:197, b: 94, stroke: '#16a34a' },
    yellow: { r:234, g:179, b:  8, stroke: '#d97706' },
    red:    { r:239, g: 68, b: 68, stroke: '#b91c1c' }
  };
  const k = map[s] || map.green;
  return {
    fill:  `rgba(${k.r},${k.g},${k.b},${a})`,
    hover: `rgba(${k.r},${k.g},${k.b},${Math.min(1, a + 0.15)})`,
    stroke: k.stroke
  };
}

const fmt = (n) => Number(n || 0).toLocaleString();

/* =========================
 * Dashboard DOM refs
 * =======================*/
const kpiTotal      = document.querySelector('#kpi-total');
const kpiCompleted  = document.querySelector('#kpi-completed');
const kpiRemaining  = document.querySelector('#kpi-remaining');
const dueBody       = document.querySelector('#dueThisWeekBody');

/* =========================
 * Global Log modal (index + client-detail)
 * =======================*/
const logModal      = document.getElementById('logModal');
const logForm       = document.getElementById('logForm');
const logClose      = document.getElementById('logClose');
const logCancel     = document.getElementById('logCancel');
const logClientName = document.getElementById('logClientName');

/* =========================
 * Clients page modal refs
 * =======================*/
const modal            = document.getElementById('clientModal');
const modalTitle       = document.getElementById('clientModalTitle');
const btnOpen          = document.getElementById('btnAddClient');
const btnClose         = document.getElementById('clientModalClose');
const btnCancel        = document.getElementById('clientCancel');
const clientForm       = document.getElementById('clientForm');
const addressesList    = document.getElementById('addressesList');
const emrsList         = document.getElementById('emrsList');
const addrTpl          = document.getElementById('addrRowTpl');
const emrTpl           = document.getElementById('emrRowTpl');
const btnAddAddr       = document.getElementById('btnAddAddr');
const btnAddEmr        = document.getElementById('btnAddEmr');
const clientsTableBody = document.getElementById('clientsBody');

/* =========================
 * Helpers for weekly inputs
 * =======================*/
function weeklyEls() {
  const qtyEl   = clientForm?.querySelector('[name="weekly_qty"], #weekly_qty');
  const startEl = clientForm?.querySelector('[name="start_week"], #start_week');
  return { qtyEl, startEl };
}

function setWeeklyInputValues({ weekly_qty, start_week }) {
  const { qtyEl, startEl } = weeklyEls();
  if (qtyEl)   qtyEl.value   = weekly_qty ?? '';
  if (startEl) startEl.value = start_week ? toISODateYMD(start_week) : '';
}

/* =========================
 * Clients modal helpers
 * =======================*/
function openClientModalBlank() {
  if (!modal) return;
  modal.classList.remove('hidden');
  modalTitle.textContent = 'Add Client';
  clientForm.reset();
  clientForm.client_id.value = '';
  addressesList && (addressesList.innerHTML = '');
  emrsList && (emrsList.innerHTML = '');
  addAddressRow();
  addEmrRow();
  setWeeklyInputValues({ weekly_qty: '', start_week: '' });
}

function openClientModalPrefilled(client, addrs = [], emrs = [], activeCommit = null) {
  if (!modal) return;
  modal.classList.remove('hidden');
  modalTitle.textContent = 'Edit Client';

  clientForm.reset();
  clientForm.client_id.value     = client?.id || '';
  clientForm.name.value          = client?.name || '';
  clientForm.total_lives.value   = client?.total_lives || '';
  clientForm.contact_name.value  = client?.contact_name || '';
  clientForm.contact_email.value = client?.contact_email || '';
  clientForm.instructions.value  = client?.instructions || '';

  // Rows
  if (addressesList) {
    addressesList.innerHTML = '';
    (addrs.length ? addrs : [{}]).forEach(a => addAddressRow(a));
  }
  if (emrsList) {
    emrsList.innerHTML = '';
    (emrs.length ? emrs : [{}]).forEach(e => addEmrRow(e));
  }

  // Do NOT invent a date here. Only format if present.
  setWeeklyInputValues(
    activeCommit
      ? { weekly_qty: activeCommit.weekly_qty, start_week: activeCommit.start_week }
      : { weekly_qty: '', start_week: '' }
  );
}

const closeClientModal = () => modal?.classList.add('hidden');

function addAddressRow(a = {}) {
  if (!addrTpl || !addressesList) return;
  const node = addrTpl.content.cloneNode(true);
  const row  = node.querySelector('.grid');
  row.querySelector('[name=line1]').value = a.line1 || '';
  row.querySelector('[name=line2]').value = a.line2 || '';
  row.querySelector('[name=city]').value  = a.city  || '';
  row.querySelector('[name=state]').value = a.state || '';
  row.querySelector('[name=zip]').value   = a.zip   || '';
  row.querySelector('.remove').onclick = () => row.remove();
  addressesList.appendChild(node);
}

function addEmrRow(e = {}) {
  if (!emrTpl || !emrsList) return;
  const node = emrTpl.content.cloneNode(true);
  const row  = node.querySelector('.grid');
  row.querySelector('[name=vendor]').value  = e.vendor  || '';
  row.querySelector('[name=details]').value = e.details || '';
  row.querySelector('.remove').onclick = () => row.remove();
  emrsList.appendChild(node);
}

// Open/close/add buttons
btnOpen   ?.addEventListener('click', openClientModalBlank);
btnClose  ?.addEventListener('click', closeClientModal);
btnCancel ?.addEventListener('click', closeClientModal);
btnAddAddr?.addEventListener('click', () => addAddressRow());
btnAddEmr ?.addEventListener('click', () => addEmrRow());

async function openClientModalById(id) {
  const supabase = await getSupabase();
  if (!supabase) return alert('Supabase not configured.');

  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single();

  const [{ data: addrs }, { data: emrs }, { data: commits }] = await Promise.all([
    supabase.from('client_addresses').select('line1,line2,city,state,zip').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('client_emrs').select('vendor,details').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('weekly_commitments')
      .select('weekly_qty,start_week,active')
      .eq('client_fk', id)
      .eq('active', true)
      .order('start_week', { ascending: false })
      .limit(1)
  ]);

  openClientModalPrefilled(client, addrs || [], emrs || [], commits?.[0] || null);
}

/* =========================
 * Create/Update client (+ addresses & EMRs, + weekly commitment)
 * =======================*/
clientForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const supabase = await getSupabase();
  if (!supabase) return alert('Supabase not configured.');

  const payload = {
    name:          clientForm.name.value.trim(),
    total_lives:   Number(clientForm.total_lives.value || 0),
    contact_name:  clientForm.contact_name.value.trim()  || null,
    contact_email: clientForm.contact_email.value.trim() || null,
    instructions:  clientForm.instructions.value.trim()  || null
  };

  // Addresses from UI
  const addrs = addressesList
    ? [...addressesList.querySelectorAll('.grid')].map(r => {
        const line1 = r.querySelector('[name=line1]')?.value?.trim() || '';
        const line2 = r.querySelector('[name=line2]')?.value?.trim() || '';
        const city  = r.querySelector('[name=city]') ?.value?.trim() || '';
        const state = r.querySelector('[name=state]')?.value?.trim() || '';
        const zip   = r.querySelector('[name=zip]')  ?.value?.trim() || '';
        return { line1, line2, city, state, zip };
      }).filter(a => a.line1 || a.line2 || a.city || a.state || a.zip)
    : [];

  // EMRs from UI
  const emrs = emrsList
    ? [...emrsList.querySelectorAll('.grid')].map(r => {
        const vendor  = r.querySelector('[name=vendor]') ?.value?.trim() || '';
        const details = r.querySelector('[name=details]')?.value?.trim() || '';
        return { vendor, details };
      }).filter(e => e.vendor || e.details)
    : [];

  // Create or update client row
  let clientId = clientForm.client_id.value?.trim() || null;
  if (clientId) {
    const { error } = await supabase.from('clients').update(payload).eq('id', clientId);
    if (error) { console.error(error); return alert('Failed to update client.'); }
  } else {
    const { data: newRow, error } = await supabase.from('clients').insert(payload).select('id').single();
    if (error) { console.error(error); return alert('Failed to create client.'); }
    clientId = newRow.id;
  }

  // Replace addresses
  if (addressesList) {
    const { error: da } = await supabase.from('client_addresses').delete().eq('client_fk', clientId);
    if (da) { console.error(da); return alert('Failed to clear addresses.'); }
    if (addrs.length) {
      const { error: ia } = await supabase.from('client_addresses').insert(addrs.map(a => ({ client_fk: clientId, ...a })));
      if (ia) { console.error(ia); return alert('Failed to save addresses.'); }
    }
  }

  // Replace EMRs
  if (emrsList) {
    const { error: de } = await supabase.from('client_emrs').delete().eq('client_fk', clientId);
    if (de) { console.error(de); return alert('Failed to clear EMRs.'); }
    if (emrs.length) {
      const { error: ie } = await supabase.from('client_emrs').insert(emrs.map(e2 => ({ client_fk: clientId, ...e2 })));
      if (ie) { console.error(ie); return alert('Failed to save EMRs.'); }
    }
  }

  // Weekly commitment: only create a new active row if something actually changed.
  const { qtyEl, startEl } = weeklyEls();
  const inputQty   = qtyEl  ?.value?.trim();
  const inputStart = startEl?.value?.trim();   // should already be YYYY-MM-DD

  if (inputQty || inputStart) {
    const { data: existing } = await supabase
      .from('weekly_commitments')
      .select('weekly_qty,start_week,active')
      .eq('client_fk', clientId)
      .eq('active', true)
      .order('start_week', { ascending: false })
      .limit(1);

    const current  = existing?.[0] || null;
    let   newStart = inputStart || (current?.start_week ? String(current.start_week).slice(0,10) : null);

    // Only default “this Monday” for brand new clients with no date:
    if (!clientForm.client_id.value && !newStart) {
      newStart = toISODateYMD(mondayOf(new Date()));
    }

    const newQty = inputQty ? Number(inputQty) : (current?.weekly_qty ?? 0);

    const unchanged =
      current &&
      Number(current.weekly_qty) === newQty &&
      String(current.start_week).slice(0,10) === String(newStart).slice(0,10);

    if (!unchanged && newQty > 0 && newStart) {
      if (current) {
        const { error: deact } = await supabase
          .from('weekly_commitments')
          .update({ active: false })
          .eq('client_fk', clientId)
          .eq('active', true);
        if (deact) { console.error(deact); return alert('Failed to retire current commitment.'); }
      }
      const { error: insC } = await supabase.from('weekly_commitments').insert({
        client_fk: clientId,
        weekly_qty: newQty,
        start_week: newStart,
        active: true
      });
      if (insC) { console.error(insC); return alert('Failed to save weekly commitment.'); }
    }
  }

  closeClientModal();
  await loadClientsList();
  await loadDashboard(); // harmless if not on dashboard
  alert('Saved.');
});

/* =========================
 * Delete a client (plus children)
 * =======================*/
async function handleDelete(clientId, clientName = 'this client') {
  if (!confirm(`Delete “${clientName}”? This removes the client and all related data (addresses, EMRs, commitments, completions).`)) return;

  const supabase = await getSupabase();
  if (!supabase) return alert('Supabase not configured.');

  // Delete children first (safe even if DB has ON DELETE CASCADE)
  for (const t of ['completions', 'client_addresses', 'client_emrs', 'weekly_commitments']) {
    const { error } = await supabase.from(t).delete().eq('client_fk', clientId);
    if (error) { console.error(error); alert(`Failed to delete from ${t}: ${error.message}`); return; }
  }

  const { error: delClientErr } = await supabase.from('clients').delete().eq('id', clientId);
  if (delClientErr) { console.error(delClientErr); alert(`Failed to delete client: ${delClientErr.message}`); return; }

  await loadClientsList();
  await loadDashboard();
  alert('Client deleted.');
}

/* =========================
 * Dashboard aggregation
 * =======================*/
function pickActiveQtyForWeek(wkRows, clientId, refDate) {
  const rows = (wkRows || [])
    .filter(r => r.client_fk === clientId && r.active && new Date(r.start_week) <= refDate)
    .sort((a, b) => new Date(b.start_week) - new Date(a.start_week));
  return rows[0]?.weekly_qty || 0;
}

// “Started” means there exists any commitment with start_week <= now
function isStarted(wkRows, clientId, refDate) {
  return (wkRows || []).some(r => r.client_fk === clientId && new Date(r.start_week) <= refDate);
}

async function loadDashboard() {
  if (!kpiTotal) return; // not on dashboard

  const supabase = await getSupabase();
  if (!supabase) {
    kpiTotal.setAttribute('value', '—');
    kpiCompleted.setAttribute('value', '—');
    kpiRemaining.setAttribute('value', '—');
    return;
  }

  const [{ data: clients }, { data: wk }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives').order('name'),
    supabase.from('weekly_commitments').select('id,client_fk,weekly_qty,start_week,active'),
    supabase.from('completions').select('client_fk,occurred_on,qty_completed')
  ]);

  const today   = new Date();
  const mon     = mondayOf(today);
  const fri     = fridayEndOf(mon);
  const lastMon = new Date(mon); lastMon.setDate(lastMon.getDate() - 7);
  const lastFri = fridayEndOf(lastMon);

  // Filter: show Started only?
  const startedOnly = document.getElementById('filterContracted')?.checked ?? true;

  const completedFor = (clientId, from, to) => (comps || []).reduce((s, c) => {
    if (c.client_fk !== clientId) return s;
    const d = new Date(c.occurred_on);
    return (d >= from && d <= to) ? s + (c.qty_completed || 0) : s;
  }, 0);

  const rows = (clients || [])
    .filter(c => !startedOnly || isStarted(wk, c.id, today))
    .map(c => {
      const qtyThis = pickActiveQtyForWeek(wk, c.id, mon);
      const qtyLast = pickActiveQtyForWeek(wk, c.id, lastMon);

      const doneLast  = completedFor(c.id, lastMon, lastFri);
      const carryIn   = qtyLast - doneLast;
      const required  = Math.max(0, qtyThis + carryIn);

      const doneThis  = completedFor(c.id, mon, fri);
      const remaining = Math.max(0, required - doneThis);

      const needPerDay = remaining / Math.max(1, daysLeftThisWeek(today));
      const status = carryIn > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

      return { id: c.id, name: c.name, required, remaining, doneThis, carryIn, status };
    });

  const totalReq = rows.reduce((s, r) => s + r.required,   0);
  const totalDone= rows.reduce((s, r) => s + r.doneThis,   0);
  const totalRem = Math.max(0, totalReq - totalDone);

  kpiTotal    .setAttribute('value', fmt(totalReq));
  kpiCompleted.setAttribute('value', fmt(totalDone));
  kpiRemaining.setAttribute('value', fmt(totalRem));

  renderByClientChart(rows);
  renderDueThisWeek(rows);
}

function renderByClientChart(rows) {
  const labels    = rows.map(r => r.name);
  const remains   = rows.map(r => r.remaining ?? 0);
  const completes = rows.map((r, i) => Math.max(0, (r.required ?? 0) - (r.remaining ?? 0)));
  const required  = rows.map((r, i) => r.required ?? (remains[i] + completes[i]));
  const statuses  = rows.map(r => r.status);

  // Make the canvas wide enough so x-labels don't collide
  const widthPx  = Math.max(1100, labels.length * 140);
  const widthDiv = document.getElementById('chartWidth');
  const canvas   = document.getElementById('byClientChart');
  if (widthDiv) widthDiv.style.width = widthPx + 'px';
  if (canvas)   canvas.width = widthPx;

  if (!canvas || !window.Chart) return;

  // Raw data objects per bar for tooltip (completed/target)
  const points = labels.map((name, i) => {
    const c = statusColors(statuses[i]);
    return {
      x: name,
      y: remains[i],
      completed: completes[i],
      target: required[i],
      color:  c.fill,
      hover:  c.hover,
      stroke: c.stroke
    };
  });

  const yCfg = yScaleFor([...remains, ...required], 0.08);

  if (window.__byClientChart) window.__byClientChart.destroy();

  window.__byClientChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Remaining',
        data: points,
        backgroundColor:      (ctx) => ctx.raw.color,
        hoverBackgroundColor: (ctx) => ctx.raw.hover,
        borderColor:          (ctx) => ctx.raw.stroke,
        borderWidth: 1.5,
        borderRadius: 10,
        borderSkipped: false,
        maxBarThickness: 44
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(17,24,39,0.9)',
          padding: 10,
          callbacks: {
            title: (items) => items[0].label,
            label: (ctx) => {
              const raw  = ctx.raw || {};
              const rem  = ctx.parsed.y ?? 0;
              const tgt  = raw.target ?? (rem + (raw.completed ?? 0));
              const done = raw.completed ?? 0;
              const pct  = tgt ? Math.round((done / tgt) * 100) : 0;
              return [
                `Remaining: ${Number(rem).toLocaleString()}`,
                `Completed: ${Number(done).toLocaleString()} of ${Number(tgt).toLocaleString()} (${pct}%)`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            callback: (v) => {
              const s = String(labels[v]);
              return s.length > 18 ? s.slice(0, 18) + '…' : s;
            }
          }
        },
        y: {
          beginAtZero: true,
          min:  yCfg.min,
          max:  yCfg.max,
          ticks:{ stepSize: yCfg.stepSize },
          grid: { color: 'rgba(0,0,0,0.06)' }
        }
      }
    }
  });
}

function renderDueThisWeek(rows) {
  if (!dueBody) return;
  const items = rows.filter(r => r.required > 0).sort((a, b) => b.remaining - a.remaining);
  if (!items.length) {
    dueBody.innerHTML = `<tr><td colspan="6" class="py-4 text-sm text-gray-500">No active commitments this week.</td></tr>`;
    return;
  }
  dueBody.innerHTML = items.map(r => {
    const done = Math.max(0, r.required - r.remaining);
    return `<tr>
      <td class="text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${r.name}</a></td>
      <td class="text-sm">${fmt(r.required)}</td>
      <td class="text-sm">${fmt(done)}</td>
      <td class="text-sm">${fmt(r.remaining)}</td>
      <td class="text-sm"><status-badge status="${r.status}"></status-badge></td>
      <td class="text-sm"><button class="px-2 py-1 rounded bg-gray-900 text-white text-xs" data-log="${r.id}" data-name="${r.name}">Log</button></td>
    </tr>`;
  }).join('');

  dueBody.onclick = (e) => {
    const b = e.target.closest('button[data-log]');
    if (!b) return;
    openLogModal(b.dataset.log, b.dataset.name);
  };
}

/* =========================
 * Log modal
 * =======================*/
function openLogModal(clientId, name) {
  if (!logForm) return;
  logForm.client_id.value = clientId;
  logForm.qty.value = '';
  logForm.note.value = '';
  if (logClientName) logClientName.textContent = name || '—';
  logModal?.classList.remove('hidden');
}
function closeLogModal() { logModal?.classList.add('hidden'); }

logClose ?.addEventListener('click', closeLogModal);
logCancel?.addEventListener('click', closeLogModal);

// Allow negative numbers to correct mistakes
logForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase();
  if (!supabase) return alert('Supabase not configured.');

  const qty = Number(logForm.qty.value);
  if (!qty || !Number.isFinite(qty)) return alert('Enter a valid quantity (positive or negative).');

  const payload = {
    client_fk:   logForm.client_id.value,
    occurred_on: new Date().toISOString(),
    qty_completed: qty,
    note: logForm.note.value?.trim() || null
  };

  const { error } = await supabase.from('completions').insert(payload);
  if (error) { console.error(error); return alert('Failed to log completion.'); }

  closeLogModal();
  await loadDashboard();
  await loadClientDetail();
});

/* =========================
 * Clients list page
 * =======================*/
async function loadClientsList() {
  if (!clientsTableBody) return; // not on clients page

  const supabase = await getSupabase();
  if (!supabase) {
    clientsTableBody.innerHTML = `<tr><td class="py-4 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`;
    return;
  }

  const [{ data: clients }, { data: wk }] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active')
  ]);

  const today = new Date();
  const latestQty = (id) => {
    const rows = (wk || [])
      .filter(r => r.client_fk === id && r.active)
      .sort((a, b) => new Date(b.start_week) - new Date(a.start_week));
    return rows[0]?.weekly_qty || 0;
  };
  const startedBadge = (id) =>
    (wk || []).some(r => r.client_fk === id && new Date(r.start_week) <= today)
      ? '<span class="ml-2 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Started</span>'
      : '<span class="ml-2 text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">Not started</span>';

  clientsTableBody.innerHTML = '';
  (clients || []).forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-sm">
        <a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${c.id}">${c.name}</a>
        ${startedBadge(c.id)}
      </td>
      <td class="text-sm">${c.total_lives ?? '—'}</td>
      <td class="text-sm">${latestQty(c.id) ? fmt(latestQty(c.id)) + '/wk' : '—'}</td>
      <td class="text-sm">
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

/* =========================
 * Client detail page
 * =======================*/
async function loadClientDetail() {
  const nameEl = document.getElementById('clientName');
  if (!nameEl) return; // not on detail page

  const id       = new URL(location.href).searchParams.get('id');
  const supabase = await getSupabase();
  if (!supabase) return;

  const [{ data: client }, { data: addrs }, { data: emrs }, { data: wk }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).single(),
    supabase.from('client_addresses').select('*').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('client_emrs').select('*').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('weekly_commitments').select('*').eq('client_fk', id).order('start_week', { ascending: false }),
    supabase.from('completions').select('*').eq('client_fk', id)
  ]);

  // Header
  nameEl.textContent = client?.name || 'Client';
  const meta = document.getElementById('clientMeta');
  if (meta) meta.textContent = client ? `Lives: ${client.total_lives?.toLocaleString?.() || client.total_lives || '—'}` : '';

  // Delete button
  const delBtn = document.getElementById('clientDeleteBtn');
  if (delBtn) delBtn.onclick = async () => { await handleDelete(id, client?.name || 'this client'); location.href = './clients.html'; };

  // Contact & notes
  const contact = document.getElementById('contact');
  if (contact) {
    contact.innerHTML = client?.contact_email
      ? `${client?.contact_name || ''} <a class="text-indigo-600 hover:underline" href="mailto:${client.contact_email}">${client.contact_email}</a>`
      : (client?.contact_name || '—');
  }
  const notes = document.getElementById('notes');
  if (notes) notes.textContent = client?.instructions || '—';

  // Addresses & EMRs
  const addrList = document.getElementById('addresses');
  if (addrList) addrList.innerHTML =
    (addrs?.length ? addrs : []).map(a => `<li>${[a.line1, a.line2, a.city, a.state, a.zip].filter(Boolean).join(', ')}</li>`).join('')
    || '<li class="text-gray-500">—</li>';

  const emrList = document.getElementById('emrs');
  if (emrList) emrList.innerHTML =
    (emrs?.length ? emrs : []).map(e => `<li>${[e.vendor, e.details].filter(Boolean).join(' — ')}</li>`).join('')
    || '<li class="text-gray-500">—</li>';

  // Weekly math for this client
  const today   = new Date();
  const mon     = mondayOf(today);
  const fri     = fridayEndOf(mon);
  const lastMon = new Date(mon); lastMon.setDate(lastMon.getDate() - 7);
  const lastFri = fridayEndOf(lastMon);

  const pickActive = (ref) =>
    (wk || []).filter(r => r.active && new Date(r.start_week) <= ref)
              .sort((a, b) => new Date(b.start_week) - new Date(a.start_week))[0] || null;

  const activeThis = pickActive(mon);
  const activeLast = pickActive(lastMon);
  const weeklyQty  = activeThis?.weekly_qty || 0;

  const doneFor = (from, to) => (comps || []).reduce((s, c) => {
    const d = new Date(c.occurred_on);
    return (d >= from && d <= to) ? s + (c.qty_completed || 0) : s;
  }, 0);

  const doneLast = doneFor(lastMon, lastFri);
  const carryIn  = (activeLast?.weekly_qty || 0) - doneLast;
  const required = Math.max(0, weeklyQty + carryIn);
  const doneThis = doneFor(mon, fri);
  const remaining = Math.max(0, required - doneThis);

  const needPerDay = remaining / Math.max(1, daysLeftThisWeek(today));
  const status = carryIn > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

  const setTxt = (id2, v) => { const el = document.getElementById(id2); if (el) el.textContent = v; };
  setTxt('wkQty', weeklyQty ? weeklyQty.toLocaleString() + '/wk' : '—');
  setTxt('startWeek', activeThis?.start_week ? toISODateYMD(activeThis.start_week) : '—');
  setTxt('carryIn', fmt(carryIn));
  setTxt('required', fmt(required));
  setTxt('done', fmt(doneThis));
  setTxt('remaining', fmt(remaining));

  document.getElementById('clientStatus')?.setAttribute('status', status);

  const logBtn = document.getElementById('clientLogBtn');
  if (logBtn) logBtn.onclick = () => openLogModal(id, client?.name || 'Client');

  const body = document.getElementById('clientWeekBody');
  if (body) {
    if (weeklyQty === 0 && carryIn === 0) {
      body.innerHTML = `<tr><td colspan="8" class="py-4 text-sm text-gray-500">No active commitment.</td></tr>`;
    } else {
      body.innerHTML = `<tr>
        <td class="text-sm">${toISODateYMD(fri)}</td>
        <td class="text-sm">${fmt(weeklyQty)}</td>
        <td class="text-sm">${fmt(carryIn)}</td>
        <td class="text-sm">${fmt(required)}</td>
        <td class="text-sm">${fmt(doneThis)}</td>
        <td class="text-sm">${fmt(remaining)}</td>
        <td class="text-sm"><status-badge status="${status}"></status-badge></td>
        <td class="text-sm"><button class="px-2 py-1 rounded bg-gray-900 text-white text-xs" onclick="openLogModal('${id}','${(client?.name || 'Client').replace(/'/g, '&#39;')}')">Log</button></td>
      </tr>`;
    }
  }

  // Client detail mini chart (Remaining only, tooltip shows Completed & Target)
  const canv = document.getElementById('clientWeekChart');
  if (canv && window.Chart) {
    const colors = statusColors(status);
    const yCfg   = yScaleFor([required], 0.08);

    if (window.__clientChart) window.__clientChart.destroy();

    const point = {
      x: 'This week',
      y: remaining,
      completed: doneThis,
      target: required,
      color:  colors.fill,
      hover:  colors.hover,
      stroke: colors.stroke
    };

    window.__clientChart = new Chart(canv.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['This week'],
        datasets: [{
          label: 'Remaining',
          data: [point],
          backgroundColor:      (ctx) => ctx.raw.color,
          hoverBackgroundColor: (ctx) => ctx.raw.hover,
          borderColor:          (ctx) => ctx.raw.stroke,
          borderWidth: 1.5,
          borderRadius: 12,
          borderSkipped: false,
          maxBarThickness: 56
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17,24,39,0.9)',
            padding: 10,
            callbacks: {
              title: () => 'This week',
              label: (ctx) => {
                const raw  = ctx.raw || {};
                const rem  = ctx.parsed.y ?? 0;
                const tgt  = raw.target ?? (rem + (raw.completed ?? 0));
                const done = raw.completed ?? 0;
                const pct  = tgt ? Math.round((done / tgt) * 100) : 0;
                return [
                  `Remaining: ${Number(rem).toLocaleString()}`,
                  `Completed: ${Number(done).toLocaleString()} of ${Number(tgt).toLocaleString()} (${pct}%)`
                ];
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            min: yCfg.min,
            max: yCfg.max,
            ticks: { stepSize: yCfg.stepSize }
          },
          x: { ticks: { maxRotation: 0 } }
        }
      }
    });
  }
}

/* =========================
 * Boot
 * =======================*/
window.addEventListener('DOMContentLoaded', () => {
  // Dashboard filter (“Started only”)
  document.getElementById('filterContracted')?.addEventListener('change', loadDashboard);

  loadDashboard();     // if on index
  loadClientsList();   // if on clients page
  loadClientDetail();  // if on client-detail

  // expose log modal for inline onclick
  window.openLogModal = openLogModal;
});
