// script.js — weekly model + per-week overrides + negatives + lifetime + started tags
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';

/* ===== Utils ===== */
const fmt = (n) => Number(n || 0).toLocaleString();
const todayEST = () => {
  const d = new Date();
  // App is EST-based; JS Date is local in browser – acceptable for internal tool.
  d.setHours(0, 0, 0, 0);
  return d;
};
function mondayOf(date) { const d = new Date(date); const day = d.getDay(); const back = (day + 6) % 7; d.setDate(d.getDate() - back); d.setHours(0,0,0,0); return d; }
function fridayEndOf(monday) { const f = new Date(monday); f.setDate(f.getDate() + 5); f.setHours(23,59,59,999); return f; }
function priorMonday(monday) { const d = new Date(monday); d.setDate(d.getDate() - 7); return d; }
function daysLeftThisWeek(d) { const dow = d.getDay(); if (dow === 6 || dow === 0) return 5; return Math.max(1, 6 - dow); }
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
  const map = { green: { r: 34, g: 197, b: 94, stroke: '#16a34a' }, yellow: { r: 234, g: 179, b: 8, stroke: '#d97706' }, red: { r: 239, g: 68, b: 68, stroke: '#b91c1c' } };
  const k = map[s] || map.green;
  return { fill: `rgba(${k.r},${k.g},${k.b},${a})`, hover: `rgba(${k.r},${k.g},${k.b},${Math.min(1, a + 0.15)})`, stroke: k.stroke };
}

/* ===== Elements ===== */
// Dashboard
const kpiTotal = document.getElementById('kpi-total');
const kpiCompleted = document.getElementById('kpi-completed');
const kpiRemaining = document.getElementById('kpi-remaining');
const kpiLifetime = document.getElementById('kpi-lifetime');
const dueBody = document.getElementById('dueThisWeekBody');
// Shared Log modal
const logModal = document.getElementById('logModal');
const logForm = document.getElementById('logForm');
const logClose = document.getElementById('logClose');
const logCancel = document.getElementById('logCancel');
const logClientName = document.getElementById('logClientName');
// Clients page
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
  modalTitle.textContent = 'Add Client';
  clientForm.reset();
  clientForm.client_id.value = '';
  addressesList.innerHTML = ''; addAddressRow();
  emrsList.innerHTML = ''; addEmrRow();
  setWeeklyInputValues({ weekly_qty: '', start_week: '' }); // don’t auto-set today
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
  addressesList.innerHTML = ''; (addrs?.length ? addrs : [{}]).forEach(a => addAddressRow(a));
  emrsList.innerHTML = ''; (emrs?.length ? emrs : [{}]).forEach(e => addEmrRow(e));
  const active = commits?.[0] || null;
  // IMPORTANT: keep the original start week; do not auto-change
  setWeeklyInputValues(active ? { weekly_qty: active.weekly_qty, start_week: active.start_week } : { weekly_qty: '', start_week: '' });
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
    instructions: clientForm.instructions.value.trim() || null
  };

  // addresses + emrs from UI
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

  // rewrite addresses & emrs
  await supabase.from('client_addresses').delete().eq('client_fk', clientId);
  if (addrs.length) await supabase.from('client_addresses').insert(addrs.map(a => ({ client_fk: clientId, ...a })));
  await supabase.from('client_emrs').delete().eq('client_fk', clientId);
  if (emrs.length) await supabase.from('client_emrs').insert(emrs.map(e => ({ client_fk: clientId, ...e })));

  // baseline weekly commitment (only if changed)
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
function sumCompleted(rows, clientId, from, to) {
  return (rows || []).reduce((s, c) => {
    if (c.client_fk !== clientId) return s;
    const d = new Date(c.occurred_on);
    return (from && to) ? (d >= from && d <= to ? s + (c.qty_completed || 0) : s) : s + (c.qty_completed || 0);
  }, 0);
}
function isStarted(clientId, commits, completions) {
  const today = todayEST();
  const startedByCommit = (commits || []).some(r => r.client_fk === clientId && r.active && new Date(r.start_week) <= today);
  const startedByWork = (completions || []).some(c => c.client_fk === clientId);
  return startedByCommit || startedByWork;
}

/* ===== Dashboard ===== */
async function loadDashboard() {
  if (!kpiTotal) return; // not on dashboard
  const supabase = await getSupabase(); if (!supabase) return;

  const [{ data: clients }, { data: wk }, { data: ovr }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    supabase.from('completions').select('client_fk,occurred_on,qty_completed')
  ]);

  const today = todayEST(); const mon = mondayOf(today); const fri = fridayEndOf(mon);
  const lastMon = priorMonday(mon); const lastFri = fridayEndOf(lastMon);

  const startedOnly = document.getElementById('filterContracted')?.checked ?? true;

  const rows = (clients || []).filter(c => {
    return !startedOnly || isStarted(c.id, wk, comps);
  }).map(c => {
    const baseThis = pickBaselineForWeek(wk, c.id, mon);
    const baseLast = pickBaselineForWeek(wk, c.id, lastMon);
    const oThis = overrideForWeek(ovr, c.id, mon);
    const oLast = overrideForWeek(ovr, c.id, lastMon);
    const targetThis = oThis ?? baseThis;
    const targetLast = oLast ?? baseLast;

    const doneLast = sumCompleted(comps, c.id, lastMon, lastFri);
    const carryIn = Math.max(0, targetLast - doneLast); // positive shortfall only
    const required = Math.max(0, targetThis + carryIn);

    const doneThis = sumCompleted(comps, c.id, mon, fri);
    const remaining = Math.max(0, required - doneThis);

    const needPerDay = remaining / Math.max(1, daysLeftThisWeek(today));
    const status = carryIn > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

    const lifetime = sumCompleted(comps, c.id); // all-time
    return { id: c.id, name: c.name, required, remaining, doneThis, carryIn, status, lifetime, targetThis };
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
  if (!items.length) { dueBody.innerHTML = `<tr><td colspan="6" class="py-4 text-sm text-gray-500">No active commitments this week.</td></tr>`; return; }
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

/* ===== Log modal (shared) — allows negatives ===== */
function openLogModal(clientId, name) { if (!logForm) return; logForm.client_id.value = clientId; logForm.qty.value = ''; logForm.note.value = ''; if (logClientName) logClientName.textContent = name || '—'; logModal?.classList.remove('hidden'); }
function closeLogModal() { logModal?.classList.add('hidden'); }
logClose?.addEventListener('click', closeLogModal);
logCancel?.addEventListener('click', closeLogModal);
logForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return alert('Supabase not configured.');
  const qty = Number(logForm.qty.value || 0);
  if (!qty || qty === 0) return alert('Enter a non-zero quantity.');
  if (qty < 0 && !confirm(`You are reducing completed by ${Math.abs(qty)}. Continue?`)) return;
  const payload = { client_fk: logForm.client_id.value, occurred_on: new Date().toISOString(), qty_completed: qty, note: logForm.note.value?.trim() || null };
  const { error } = await supabase.from('completions').insert(payload);
  if (error) { console.error(error); return alert('Failed to log completion.'); }
  closeLogModal(); await loadDashboard(); await loadClientDetail();
});

/* ===== Clients list ===== */
async function loadClientsList() {
  if (!clientsTableBody) return;
  const supabase = await getSupabase(); if (!supabase) { clientsTableBody.innerHTML = `<tr><td class="py-4 px-4 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`; return; }

  const [{ data: clients }, { data: wk }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives').order('name'),
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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm">
        <a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${c.id}">${c.name}</a>
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

/* ===== Client detail ===== */
async function loadClientDetail() {
  const nameEl = document.getElementById('clientName'); if (!nameEl) return; // not on detail
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

  // Profile
  const contact = document.getElementById('contact');
  if (contact) contact.innerHTML = client?.contact_email ? `${client?.contact_name || ''} <a class="text-indigo-600 hover:underline" href="mailto:${client.contact_email}">${client.contact_email}</a>` : (client?.contact_name || '—');
  const notes = document.getElementById('notes'); if (notes) notes.textContent = client?.instructions || '—';
  const addrList = document.getElementById('addresses'); if (addrList) addrList.innerHTML = (addrs?.length ? addrs : []).map(a => `<li>${[a.line1, a.line2, a.city, a.state, a.zip].filter(Boolean).join(', ')}</li>`).join('') || '<li class="text-gray-500">—</li>';
  const emrList = document.getElementById('emrs'); if (emrList) emrList.innerHTML = (emrs?.length ? emrs : []).map(e => `<li>${[e.vendor, e.details].filter(Boolean).join(' — ')}</li>`).join('') || '<li class="text-gray-500">—</li>';

  // Weeks: last week + this week
  const today = todayEST(); const mon = mondayOf(today); const fri = fridayEndOf(mon);
  const lastMon = priorMonday(mon); const lastFri = fridayEndOf(lastMon);

  const baseThis = pickBaselineForWeek(wk, client.id, mon);
  const baseLast = pickBaselineForWeek(wk, client.id, lastMon);
  const oThis = overrideForWeek(ovr, client.id, mon);
  const oLast = overrideForWeek(ovr, client.id, lastMon);
  const targetThis = oThis ?? baseThis;
  const targetLast = oLast ?? baseLast;

  const doneLast = (comps || []).reduce((s, c) => { const d = new Date(c.occurred_on); return (d >= lastMon && d <= lastFri) ? s + (c.qty_completed || 0) : s; }, 0);
  const carryIn = Math.max(0, targetLast - doneLast);
  const required = Math.max(0, targetThis + carryIn);
  const doneThis = (comps || []).reduce((s, c) => { const d = new Date(c.occurred_on); return (d >= mon && d <= fri) ? s + (c.qty_completed || 0) : s; }, 0);
  const remaining = Math.max(0, required - doneThis);
  const needPerDay = remaining / Math.max(1, daysLeftThisWeek(today));
  const status = carryIn > 0 ? 'red' : (needPerDay > 100 ? 'yellow' : 'green');

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('wkQty', baseThis ? fmt(baseThis) + '/wk' : '—');
  setTxt('startWeek', (wk?.find(w => w.active)?.start_week) ? String(wk.find(w => w.active).start_week).slice(0, 10) : '—');
  setTxt('carryIn', fmt(carryIn)); setTxt('required', fmt(required)); setTxt('done', fmt(doneThis)); setTxt('remaining', fmt(remaining));
  document.getElementById('clientStatus')?.setAttribute('status', status);

  // Chart
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
              label: (ctx) => {
                const raw = ctx.raw || {};
                const rem = ctx.parsed.y ?? 0;
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

  // Weekly rows (last + this week)
  const body = document.getElementById('clientWeekBody');
  if (body) {
    const rowHtml = (weekMon, base, ovrQty, tgt, done, rem) => {
      const fri = fridayEndOf(weekMon).toISOString().slice(0, 10);
      return `<tr>
        <td class="px-4 py-2 text-sm">${fri}</td>
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
    const doneLastShown = doneLast;
    const remLast = Math.max(0, targetLast - doneLastShown); // no carry-in considered for last week row
    body.innerHTML = [
      rowHtml(lastMon, baseLast, oLast ?? null, targetLast, doneLastShown, remLast),
      rowHtml(mon, baseThis, oThis ?? null, required, doneThis, remaining)
    ].join('');

    body.onclick = (e) => {
      const b = e.target.closest('button[data-ovr]'); if (!b) return;
      openOverrideModal(client.id, b.dataset.ovr);
    };
  }

  // log + delete buttons
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
  const week_start = ovrForm.week_start.value; // Monday yyyy-mm-dd
  const weekly_qty = Number(ovrForm.weekly_qty.value || 0);
  const note = ovrForm.note.value?.trim() || null;
  if (weekly_qty < 0) return alert('Weekly target cannot be negative.');
  // upsert by (client_fk, week_start)
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

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', async () => {
  try { await requireAuth(); } catch { return; }
  wireLogoutButton();

  document.getElementById('filterContracted')?.addEventListener('change', loadDashboard);

  // Safe to call; functions no-op on pages without elements
  loadDashboard();
  loadClientsList();
  loadClientDetail();

  // expose for inline
  window.openLogModal = openLogModal;
});
