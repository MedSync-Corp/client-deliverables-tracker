// script.js — adds week navigation; weekly model + per-week overrides + negatives + lifetime + started tags + partners view + recommendations modal
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';

/* ===== Utils ===== */
const fmt = (n) => Number(n || 0).toLocaleString();
const todayEST = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); d.setHours(0,0,0,0); return d; };
function mondayOf(date) { const d = new Date(date); const day = d.getDay(); const back = (day + 6) % 7; d.setDate(d.getDate() - back); d.setHours(0,0,0,0); return d; }
function fridayEndOf(monday) { const f = new Date(monday); f.setDate(f.getDate() + 5); f.setHours(23,59,59,999); return f; }
function priorMonday(monday) { const d = new Date(monday); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return d; }
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
  const k = map[s] || map.yellow;
  return {
    fill: `rgba(${k.r},${k.g},${k.b},${a})`,
    border: k.stroke
  };
}

/* ===== State ===== */
let __weekOffset = 0; // 0 = this week, -1 = last week, etc.
let __byClientChart;
let __clientWeekChart;

/* ===== Dom refs ===== */
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

function setLogDefaultDate() {
  if (!logForm) return;
  const dateInput = logForm.querySelector('input[name="occurred_on"]');
  if (!dateInput) return;
  // Only set default if empty so users can reuse a backdated day when logging multiple entries
  if (!dateInput.value) {
    const t = todayEST();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${d}`;
    dateInput.value = ymd;
    dateInput.max = ymd; // Prevent logging into the future
  }
}

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
  if (!clientForm) return {};
  return {
    qtyEl: clientForm.querySelector('[name="weekly_qty"]'),
    startEl: clientForm.querySelector('[name="start_week"]'),
    activeEl: clientForm.querySelector('[name="is_active_baseline"]')
  };
};
function openClientModalBlank() {
  if (!modal || !clientForm) return;
  modalTitle.textContent = 'Add Client';
  clientForm.reset();
  clientForm.dataset.clientId = '';
  addressesList.innerHTML = '';
  emrsList.innerHTML = '';
  modal.classList.remove('hidden');
}
function openClientModalById(clientId, row, baseline, addresses, emrs) {
  if (!modal || !clientForm) return;
  modalTitle.textContent = 'Edit Client';
  clientForm.dataset.clientId = clientId;
  clientForm.name.value = row.name || '';
  clientForm.total_lives.value = row.total_lives || '';
  clientForm.contact_name.value = row.contact_name || '';
  clientForm.contact_email.value = row.contact_email || '';
  clientForm.instructions.value = row.instructions || '';
  clientForm.sales_partner.value = row.sales_partner || '';
  const { qtyEl, startEl, activeEl } = weeklyEls();
  if (qtyEl && startEl && activeEl) {
    qtyEl.value = baseline?.weekly_qty || '';
    startEl.value = baseline?.start_week || '';
    activeEl.checked = !!baseline?.active;
  }
  addressesList.innerHTML = '';
  (addresses || []).forEach(addr => {
    const node = addrTpl.content.cloneNode(true);
    node.querySelector('[name="addr_line1"]').value = addr.line1 || '';
    node.querySelector('[name="addr_line2"]').value = addr.line2 || '';
    node.querySelector('[name="addr_city"]').value = addr.city || '';
    node.querySelector('[name="addr_state"]').value = addr.state || '';
    node.querySelector('[name="addr_zip"]').value = addr.zip || '';
    addressesList.appendChild(node);
  });
  emrsList.innerHTML = '';
  (emrs || []).forEach(e => {
    const node = emrTpl.content.cloneNode(true);
    node.querySelector('[name="emr_vendor"]').value = e.vendor || '';
    node.querySelector('[name="emr_details"]').value = e.details || '';
    emrsList.appendChild(node);
  });
  modal.classList.remove('hidden');
}
function closeClientModal() { modal?.classList.add('hidden'); }

/* ===== Address/EMR row add/remove ===== */
btnAddAddr?.addEventListener('click', () => {
  if (!addrTpl || !addressesList) return;
  addressesList.appendChild(addrTpl.content.cloneNode(true));
});
btnAddEmr?.addEventListener('click', () => {
  if (!emrTpl || !emrsList) return;
  emrsList.appendChild(emrTpl.content.cloneNode(true));
});
addressesList?.addEventListener('click', (e) => {
  if (e.target.matches('.btnRemoveAddr')) {
    e.target.closest('.grid')?.remove();
  }
});
emrsList?.addEventListener('click', (e) => {
  if (e.target.matches('.btnRemoveEmr')) {
    e.target.closest('.grid')?.remove();
  }
});

/* ===== Commitments model helpers ===== */
function pickBaselineForWeek(clientId, mondayISO, commitments) {
  const rows = (commitments || []).filter(r => r.client_fk === clientId && r.active && r.start_week <= mondayISO);
  if (!rows.length) return null;
  rows.sort((a, b) => a.start_week.localeCompare(b.start_week));
  return rows[rows.length - 1];
}
function overrideForWeek(clientId, mondayISO, overrides) {
  return (overrides || []).find(r => r.client_fk === clientId && r.week_start === mondayISO) || null;
}
function baseTargetFor(clientId, mondayISO, commitments, overrides) {
  const ov = overrideForWeek(clientId, mondayISO, overrides);
  if (ov) return ov.weekly_qty || 0;
  const baseline = pickBaselineForWeek(clientId, mondayISO, commitments);
  return baseline?.weekly_qty || 0;
}
function sumCompleted(clientId, startInclusive, endInclusive, completions) {
  const s = new Date(startInclusive);
  const e = new Date(endInclusive);
  return (completions || []).filter(c => c.client_fk === clientId).reduce((acc, c) => {
    const d = new Date(c.occurred_on);
    if (d >= s && d <= e) return acc + (c.qty_completed || 0);
    return acc;
  }, 0);
}
function isStarted(clientId, commitments, completions) {
  const hasCommit = (commitments || []).some(c => c.client_fk === clientId && c.active);
  const hasComps = (completions || []).some(c => c.client_fk === clientId);
  return hasCommit || hasComps;
}

/* ===== Dashboard core load ===== */
async function loadDashboard() {
  if (!dueBody) return;
  const supabase = await getSupabase();
  if (!supabase) {
    dueBody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`;
    return;
  }

  const [clientsRes, commitRes, overrideRes, compsRes] = await Promise.all([
    supabase.from('clients').select('id,name').order('name'),
    supabase.from('weekly_commitments').select('*'),
    supabase.from('weekly_overrides').select('*'),
    supabase.from('completions').select('*')
  ]);
  const clients = clientsRes.data || [];
  const commitments = commitRes.data || [];
  const overrides = overrideRes.data || [];
  const completions = compsRes.data || [];

  const today = todayEST();
  const thisMon = mondayOf(today);
  const selectedMon = addDays(thisMon, __weekOffset * 7);
  const selectedFri = fridayEndOf(selectedMon);
  const selectedMonISO = selectedMon.toISOString().slice(0,10);
  const priorMon = priorMonday(selectedMon);
  const priorMonISO = priorMon.toISOString().slice(0,10);
  const priorFri = fridayEndOf(priorMon);
  const priorFriISO = priorFri.toISOString();

  const humanLabel = selectedMon.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric'
  });
  const thisWeekLabel = thisMon.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  if (selectedMon.getTime() === thisMon.getTime()) {
    dueLabel.textContent = `Due This Week (Week of ${thisWeekLabel})`;
  } else {
    dueLabel.textContent = `Due Week of ${humanLabel}`;
  }

  const rows = clients.map(c => {
    const targetThis = baseTargetFor(c.id, selectedMonISO, commitments, overrides);
    if (!targetThis) {
      return {
        id: c.id,
        name: c.name,
        required: 0, remaining: 0, carryIn: 0, status: 'yellow',
        lifetime: sumCompleted(c.id, '1970-01-01T00:00:00Z', '9999-12-31T23:59:59Z', completions),
        targetThis: 0,
        started: isStarted(c.id, commitments, completions)
      };
    }
    const targetPrior = baseTargetFor(c.id, priorMonISO, commitments, overrides);
    const donePrior = sumCompleted(c.id, priorMonISO + 'T00:00:00Z', priorFriISO, completions);
    const priorRemaining = Math.max(0, (targetPrior || 0) - donePrior);
    const carryIn = priorRemaining;

    const doneThis = sumCompleted(c.id, selectedMonISO + 'T00:00:00Z', selectedFri.toISOString(), completions);
    const required = targetThis + carryIn;
    const remaining = Math.max(0, required - doneThis);
    const lifetime = sumCompleted(c.id, '1970-01-01T00:00:00Z', '9999-12-31T23:59:59Z', completions);

    const daysLeft = daysLeftThisWeekFromPerspective(selectedMon);
    const perDay = remaining / daysLeft;
    let status = 'yellow';
    if (perDay <= 0) status = 'green';
    else if (perDay > (targetThis / 5) * 1.4) status = 'red';

    return {
      id: c.id,
      name: c.name,
      required,
      remaining,
      carryIn,
      status,
      lifetime,
      targetThis,
      started: isStarted(c.id, commitments, completions)
    };
  });

  const filterContracted = document.getElementById('filterContracted');
  const onlyStarted = filterContracted?.checked;
  const filtered = onlyStarted ? rows.filter(r => r.started) : rows;

  const totalRequired = filtered.reduce((a, r) => a + (r.required || 0), 0);
  const totalRemaining = filtered.reduce((a, r) => a + (r.remaining || 0), 0);
  const totalDone = totalRequired - totalRemaining;
  const totalLifetime = filtered.reduce((a, r) => a + (r.lifetime || 0), 0);

  const k1 = document.querySelector('#kpiRequired [slot="value"]');
  const k2 = document.querySelector('#kpiCompleted [slot="value"]');
  const k3 = document.querySelector('#kpiRemaining [slot="value"]');
  const k4 = document.querySelector('#kpiLifetime [slot="value"]');
  if (k1) k1.textContent = fmt(totalRequired);
  if (k2) k2.textContent = fmt(totalDone);
  if (k3) k3.textContent = fmt(totalRemaining);
  if (k4) k4.textContent = fmt(totalLifetime);

  if (byClientTitle) {
    const base = 'This Week by Client';
    byClientTitle.textContent = onlyStarted ? `${base} (Started only)` : base;
  }

  if (filtered.length) {
    renderByClientChart(filtered);
    recModal?.setAttribute('data-rows', JSON.stringify(filtered));
    const days = Array.from({ length: 5 }, (_, i) => addDays(selectedMon, i));
    recModal?.setAttribute('data-days', JSON.stringify(days.map(d => d.toISOString().slice(0,10))));
  } else {
    if (__byClientChart) {
      __byClientChart.destroy();
      __byClientChart = null;
    }
  }

  renderDueThisWeek(filtered);
}

/* ===== By-client chart ===== */
function renderByClientChart(rows) {
  const canvas = document.getElementById('byClientChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const labels = rows.map(r => r.name);
  const done = rows.map(r => Math.max(0, r.required - r.remaining));
  const remaining = rows.map(r => r.remaining);
  const total = rows.map((_, i) => done[i] + remaining[i]);
  const pctDone = rows.map((_, i) => total[i] ? (done[i] / total[i]) * 100 : 0);

  const yCfg = yScaleFor(total);

  if (__byClientChart) {
    __byClientChart.destroy();
  }

  __byClientChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Completed',
          data: done,
          backgroundColor: 'rgba(37,99,235,0.7)',
          borderColor: '#1d4ed8',
          borderWidth: 1,
          stack: 'combined'
        },
        {
          label: 'Remaining',
          data: remaining,
          backgroundColor: 'rgba(248,250,252,1)',
          borderColor: '#e5e7eb',
          borderWidth: 1,
          stack: 'combined'
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: {
            callback: (value) => fmt(value)
          },
          min: yCfg.min,
          max: yCfg.max
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const i = ctx.dataIndex;
              const d = done[i];
              const r = remaining[i];
              const total = d + r;
              const pct = total ? ((d / total) * 100).toFixed(1) : '0.0';
              return `${fmt(d)} completed of ${fmt(total)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

/* ===== Due This Week table ===== */
function renderDueThisWeek(rows) {
  if (!dueBody || !rows) return;
  dueBody.innerHTML = rows.map((r) => {
    const done = Math.max(0, r.required - r.remaining);
    return `<tr>
      <td class="px-4 py-2 text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${r.name}</a></td>
      <td class="px-4 py-2 text-sm">${fmt(r.required)}</td>
      <td class="px-4 py-2 text-sm">${fmt(done)}</td>
      <td class="px-4 py-2 text-sm">${fmt(r.remaining)}</td>
      <td class="px-4 py-2 text-sm"><status-badge status="${r.status}"></status-badge></td>
      <td class="px-4 py-2 text-sm text-right"><button class="px-2 py-1 rounded border text-xs" data-log="${r.id}" data-name="${r.name}">Log</button></td>
    </tr>`;
  }).join('');
  dueBody.onclick = (e) => {
    const b = e.target.closest('button[data-log]');
    if (!b) return;
    openLogModal(b.dataset.log, b.dataset.name);
  };
}

/* ===== Log modal (shared) ===== */
function openLogModal(clientId, name) {
  if (!logForm) return;
  logForm.client_id.value = clientId;
  if (logForm.qty) logForm.qty.value = '';
  if (logForm.note) logForm.note.value = '';
  if (logClientName) logClientName.textContent = name || '—';
  setLogDefaultDate();
  logModal?.classList.remove('hidden');
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
  let occurredISO;
  if (dateInput && dateInput.value) {
    const d = new Date(dateInput.value + 'T00:00:00');
    occurredISO = d.toISOString();
  } else {
    occurredISO = new Date().toISOString();
  }

  const payload = {
    client_fk: logForm.client_id.value,
    occurred_on: occurredISO,
    qty_completed: qty,
    note: logForm.note.value?.trim() || null
  };
  const { error } = await supabase.from('completions').insert(payload);
  if (error) { console.error(error); return alert('Failed to log completion.'); }
  closeLogModal(); await loadDashboard(); await loadClientDetail();
});

/* ===== Clients list ===== */
async function loadClientsList() {
  if (!clientsTableBody) return;
  const supabase = await getSupabase(); if (!supabase) { clientsTableBody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`; return; }

  const [{ data: clients }, { data: wk }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives,sales_partner').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('completions').select('client_fk')
  ]);

  const latestQty = (id) => {
    const rows = (wk || []).filter(r => r.client_fk === id && r.active);
    if (!rows.length) return 0;
    rows.sort((a, b) => new Date(b.start_week) - new Date(a.start_week));
    return rows[0].weekly_qty || 0;
  };

  const startedById = {};
  (comps || []).forEach(c => { startedById[c.client_fk] = true; });
  (wk || []).forEach(c => { if (c.active) startedById[c.client_fk] = true; });

  clientsTableBody.innerHTML = (clients || []).map(c => {
    const baseline = latestQty(c.id);
    const started = !!startedById[c.id];
    const startedTag = started ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-600/30">Started</span>` : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-500 border border-slate-200">Not started</span>`;
    const partner = c.sales_partner ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200">${c.sales_partner}</span>` : '';
    return `<tr>
      <td class="px-4 py-2 text-sm"><a href="./client-detail.html?id=${c.id}" class="text-indigo-600 hover:underline">${c.name}</a></td>
      <td class="px-4 py-2 text-sm">${c.total_lives ? fmt(c.total_lives) : '—'}</td>
      <td class="px-4 py-2 text-sm">${baseline ? fmt(baseline) : '—'}</td>
      <td class="px-4 py-2 text-sm space-x-2">${startedTag} ${partner}</td>
      <td class="px-4 py-2 text-right text-sm">
        <button class="px-2 py-1 rounded border text-xs" data-edit="${c.id}">Edit</button>
      </td>
    </tr>`;
  }).join('');

  clientsTableBody.onclick = async (e) => {
    const btn = e.target.closest('button[data-edit]');
    if (!btn) return;
    const id = Number(btn.dataset.edit);
    const supabase = await getSupabase(); if (!supabase) return;
    const [{ data: clientRow }, { data: addrRows }, { data: emrRows }, { data: wkRows }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('client_addresses').select('*').eq('client_fk', id),
      supabase.from('client_emrs').select('*').eq('client_fk', id),
      supabase.from('weekly_commitments').select('*').eq('client_fk', id)
    ]);
    const activeBaseline = (wkRows || []).filter(r => r.active).sort((a, b) => a.start_week.localeCompare(b.start_week)).pop() || null;
    openClientModalById(id, clientRow, activeBaseline, addrRows || [], emrRows || []);
  };
}

/* ===== Client form submit ===== */
clientForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return alert('Supabase not configured.');
  const form = clientForm;
  const clientId = form.dataset.clientId ? Number(form.dataset.clientId) : null;
  const payload = {
    name: form.name.value.trim() || null,
    total_lives: form.total_lives.value ? Number(form.total_lives.value) : null,
    contact_name: form.contact_name.value.trim() || null,
    contact_email: form.contact_email.value.trim() || null,
    instructions: form.instructions.value.trim() || null,
    sales_partner: form.sales_partner.value.trim() || null
  };

  let id = clientId;
  if (clientId) {
    const { error } = await supabase.from('clients').update(payload).eq('id', clientId);
    if (error) { console.error(error); return alert('Failed to update client.'); }
  } else {
    const { data, error } = await supabase.from('clients').insert(payload).select('id').single();
    if (error) { console.error(error); return alert('Failed to create client.'); }
    id = data.id;
  }

  await supabase.from('client_addresses').delete().eq('client_fk', id);
  await supabase.from('client_emrs').delete().eq('client_fk', id);

  const addrs = addressesList ? [...addressesList.querySelectorAll('.grid')].map(row => ({
    line1: row.querySelector('[name="addr_line1"]').value.trim() || null,
    line2: row.querySelector('[name="addr_line2"]').value.trim() || null,
    city: row.querySelector('[name="addr_city"]').value.trim() || null,
    state: row.querySelector('[name="addr_state"]').value.trim() || null,
    zip: row.querySelector('[name="addr_zip"]').value.trim() || null
  })).filter(a => a.line1 || a.city || a.state || a.zip) : [];

  const emrs = emrsList ? [...emrsList.querySelectorAll('.grid')].map(row => ({
    vendor: row.querySelector('[name="emr_vendor"]').value.trim() || null,
    details: row.querySelector('[name="emr_details"]').value.trim() || null
  })).filter(e => e.vendor || e.details) : [];

  if (addrs.length) {
    await supabase.from('client_addresses').insert(addrs.map(a => ({ client_fk: id, ...a })));
  }
  if (emrs.length) {
    await supabase.from('client_emrs').insert(emrs.map(e => ({ client_fk: id, ...e })));
  }

  const { qtyEl, startEl, activeEl } = weeklyEls();
  if (qtyEl && startEl && activeEl) {
    const qty = qtyEl.value ? Number(qtyEl.value) : null;
    const start = startEl.value || null;
    const active = activeEl.checked;
    if (qty && start && active) {
      await supabase.from('weekly_commitments').update({ active: false }).eq('client_fk', id);
      await supabase.from('weekly_commitments').insert({
        client_fk: id,
        weekly_qty: qty,
        start_week: start,
        active: true
      });
    }
  }

  closeClientModal();
  await loadClientsList();
  await loadDashboard();
});
btnOpen?.addEventListener('click', openClientModalBlank);
btnClose?.addEventListener('click', closeClientModal);
btnCancel?.addEventListener('click', closeClientModal);

/* ===== Client detail page ===== */
async function loadClientDetail() {
  const nameEl = document.getElementById('clientName');
  if (!nameEl) return;
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('id') || '0');
  if (!id) return;
  const supabase = await getSupabase(); if (!supabase) return;

  const [
    { data: client },
    { data: addrs },
    { data: emrs },
    { data: commits },
    { data: overrides },
    { data: comps }
  ] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).single(),
    supabase.from('client_addresses').select('*').eq('client_fk', id),
    supabase.from('client_emrs').select('*').eq('client_fk', id),
    supabase.from('weekly_commitments').select('*').eq('client_fk', id),
    supabase.from('weekly_overrides').select('*').eq('client_fk', id),
    supabase.from('completions').select('*').eq('client_fk', id)
  ]);

  nameEl.textContent = client.name || 'Client';

  const metaLives = document.getElementById('clientLives');
  if (metaLives) metaLives.textContent = client.total_lives ? fmt(client.total_lives) : '—';
  const metaPartner = document.getElementById('clientPartner');
  if (metaPartner) metaPartner.textContent = client.sales_partner || '—';

  const addrList = document.getElementById('clientAddresses');
  if (addrList) {
    addrList.innerHTML = (addrs || []).map(a => `<div class="text-sm text-slate-700">
      <div>${a.line1 || ''}</div>
      <div>${a.line2 || ''}</div>
      <div>${[a.city, a.state, a.zip].filter(Boolean).join(', ')}</div>
    </div>`).join('') || '<p class="text-sm text-slate-400">No addresses on file.</p>';
  }

  const emrList = document.getElementById('clientEmrs');
  if (emrList) {
    emrList.innerHTML = (emrs || []).map(e => `<div class="text-sm text-slate-700">
      <div class="font-medium">${e.vendor || 'EMR'}</div>
      <div class="text-xs text-slate-500 whitespace-pre-line">${e.details || ''}</div>
    </div>`).join('') || '<p class="text-sm text-slate-400">No EMR details on file.</p>';
  }

  const today = todayEST();
  const thisMon = mondayOf(today);
  const lastMon = priorMonday(thisMon);
  const thisMonISO = thisMon.toISOString().slice(0,10);
  const lastMonISO = lastMon.toISOString().slice(0,10);
  const thisFri = fridayEndOf(thisMon);
  const lastFri = fridayEndOf(lastMon);

  const thisTarget = baseTargetFor(id, thisMonISO, commits || [], overrides || []);
  const lastTarget = baseTargetFor(id, lastMonISO, commits || [], overrides || []);

  const lastDone = sumCompleted(id, lastMonISO + 'T00:00:00Z', lastFri.toISOString(), comps || []);
  const lastRemaining = Math.max(0, (lastTarget || 0) - lastDone);

  const thisDone = sumCompleted(id, thisMonISO + 'T00:00:00Z', thisFri.toISOString(), comps || []);
  const carryIn = lastRemaining;
  const thisRequired = (thisTarget || 0) + carryIn;
  const thisRemaining = Math.max(0, thisRequired - thisDone);
  const lifetime = sumCompleted(id, '1970-01-01T00:00:00Z', '9999-12-31T23:59:59Z', comps || []);

  const daysLeft = daysLeftThisWeekFromPerspective(thisMon);
  const perDay = thisRemaining / daysLeft;
  let status = 'yellow';
  if (perDay <= 0) status = 'green';
  else if (perDay > (thisTarget / 5) * 1.4) status = 'red';

  document.getElementById('clientLifetime')?.setAttribute('value', fmt(lifetime));
  document.getElementById('clientThisRequired')?.setAttribute('value', fmt(thisRequired));
  document.getElementById('clientThisCompleted')?.setAttribute('value', fmt(thisDone));
  document.getElementById('clientThisRemaining')?.setAttribute('value', fmt(thisRemaining));
  const statusEl = document.getElementById('clientStatus');
  if (statusEl) statusEl.setAttribute('status', status);

  const chartCanvas = document.getElementById('clientWeekChart');
  if (chartCanvas) {
    const ctx = chartCanvas.getContext('2d');
    const labels = ['Last week', 'This week'];
    const doneData = [lastDone, thisDone];
    const remData = [lastRemaining, thisRemaining];
    const yCfg = yScaleFor(doneData.map((v,i)=>v+remData[i]));

    if (__clientWeekChart) __clientWeekChart.destroy();
    __clientWeekChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Completed', data: doneData, backgroundColor: 'rgba(37,99,235,0.7)', borderColor: '#1d4ed8', borderWidth: 1, stack: 'combined' },
          { label: 'Remaining', data: remData, backgroundColor: 'rgba(248,250,252,1)', borderColor: '#e5e7eb', borderWidth: 1, stack: 'combined' }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: { stacked: true },
          y: { stacked: true, min: yCfg.min, max: yCfg.max, ticks: { callback: (v) => fmt(v) } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  const tbody = document.getElementById('clientWeeklyTbody');
  if (tbody) {
    const rows = [
      {
        label: 'Last week',
        mon: lastMon,
        target: lastTarget,
        done: lastDone,
        remaining: lastRemaining,
        weekISO: lastMonISO
      },
      {
        label: 'This week',
        mon: thisMon,
        target: thisTarget,
        done: thisDone,
        remaining: thisRemaining,
        weekISO: thisMonISO
      }
    ];
    tbody.innerHTML = rows.map(r => {
      const Mon = r.mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `<tr>
        <td class="px-4 py-2 text-sm">${r.label}<div class="text-xs text-slate-500">Week of ${Mon}</div></td>
        <td class="px-4 py-2 text-sm">${r.target ? fmt(r.target) : '—'}</td>
        <td class="px-4 py-2 text-sm">${fmt(r.done)}</td>
        <td class="px-4 py-2 text-sm">${fmt(r.remaining)}</td>
        <td class="px-4 py-2 text-right text-sm">
          <button class="px-2 py-1 rounded border text-xs" data-override="${r.weekISO}">Edit target</button>
        </td>
      </tr>`;
    }).join('');

    tbody.onclick = (e) => {
      const btn = e.target.closest('button[data-override]');
      if (!btn) return;
      openOverrideModal(id, btn.dataset.override, overrides || [], commits || []);
    };
  }

  const logBtn = document.getElementById('btnLogCompletion');
  logBtn?.addEventListener('click', () => openLogModal(id, client.name));

  const deleteBtn = document.getElementById('btnDeleteClient');
  deleteBtn?.addEventListener('click', async () => {
    if (!confirm('Delete this client and all associated data? This cannot be undone.')) return;
    const supabase = await getSupabase(); if (!supabase) return;
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) { console.error(error); return alert('Failed to delete client.'); }
    window.location.href = './clients.html';
  });
}

/* ===== Weekly overrides modal ===== */
const overrideModal = document.getElementById('overrideModal');
const overrideForm = document.getElementById('overrideForm');
const overrideWeekLabel = document.getElementById('overrideWeekLabel');
let overrideClientId = null;
let overrideWeekISO = null;

function openOverrideModal(clientId, weekISO, overrides, commits) {
  overrideClientId = clientId;
  overrideWeekISO = weekISO;
  const mon = new Date(weekISO + 'T00:00:00');
  overrideWeekLabel.textContent = `Week of ${mon.toLocaleDateString(undefined, { month:'short', day:'numeric' })}`;
  const existing = (overrides || []).find(o => o.client_fk === clientId && o.week_start === weekISO);
  overrideForm.override_qty.value = existing?.weekly_qty || '';
  overrideForm.override_note.value = existing?.note || '';
  overrideModal?.classList.remove('hidden');
}
function closeOverrideModal() { overrideModal?.classList.add('hidden'); }
document.getElementById('overrideClose')?.addEventListener('click', closeOverrideModal);
document.getElementById('overrideCancel')?.addEventListener('click', closeOverrideModal);
overrideForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supabase = await getSupabase(); if (!supabase) return;
  const qty = overrideForm.override_qty.value ? Number(overrideForm.override_qty.value) : null;
  const note = overrideForm.override_note.value.trim() || null;
  if (!qty) return alert('Enter a weekly quantity.');
  const { data: existing, error: fetchErr } = await supabase.from('weekly_overrides')
    .select('*')
    .eq('client_fk', overrideClientId)
    .eq('week_start', overrideWeekISO)
    .maybeSingle();
  if (fetchErr) { console.error(fetchErr); return alert('Failed to check existing override.'); }
  if (existing) {
    const { error } = await supabase.from('weekly_overrides').update({ weekly_qty: qty, note }).eq('id', existing.id);
    if (error) { console.error(error); return alert('Failed to update override.'); }
  } else {
    const { error } = await supabase.from('weekly_overrides').insert({
      client_fk: overrideClientId,
      week_start: overrideWeekISO,
      weekly_qty: qty,
      note
    });
    if (error) { console.error(error); return alert('Failed to create override.'); }
  }
  closeOverrideModal();
  await loadDashboard();
  await loadClientDetail();
});

/* ===== Partners (read-only) ===== */
async function loadPartnersPage() {
  const container = document.getElementById('partnersBody');
  const tabsWrap = document.getElementById('partnersTabsWrap');
  const tabsEl = document.getElementById('partnersTabs');
  if (!container) return;
  const supabase = await getSupabase(); if (!supabase) { container.innerHTML = `<tr><td colspan="3" class="px-4 py-6 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`; return; }

  const [{ data: clients }, { data: comps }] = await Promise.all([
    supabase.from('clients').select('id,name,sales_partner').order('name'),
    supabase.from('completions').select('*')
  ]);

  const today = todayEST();
  const mon = mondayOf(today);
  const fri = fridayEndOf(mon);
  const monISO = mon.toISOString();

  const thisWeekByClient = {};
  const lifetimeByClient = {};
  (comps || []).forEach(c => {
    const d = new Date(c.occurred_on);
    if (!lifetimeByClient[c.client_fk]) lifetimeByClient[c.client_fk] = 0;
    lifetimeByClient[c.client_fk] += c.qty_completed || 0;
    if (d >= mon && d <= fri) {
      if (!thisWeekByClient[c.client_fk]) thisWeekByClient[c.client_fk] = 0;
      thisWeekByClient[c.client_fk] += c.qty_completed || 0;
    }
  });

  const partners = {};
  (clients || []).forEach(c => {
    const key = c.sales_partner || 'Unassigned';
    if (!partners[key]) partners[key] = [];
    partners[key].push({
      id: c.id,
      name: c.name,
      thisWeek: thisWeekByClient[c.id] || 0,
      lifetime: lifetimeByClient[c.id] || 0
    });
  });

  const keys = Object.keys(partners).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });

  let activePartner = 'All partners';
  function renderTable(filterKey) {
    const rows = keys.flatMap(k => {
      if (filterKey && k !== filterKey) return [];
      return partners[k].map(row => ({
        partner: k,
        ...row
      }));
    });
    if (!rows.length) {
      container.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-sm text-gray-500">No data.</td></tr>`;
      return;
    }
    container.innerHTML = rows.map(r => `
      <tr>
        <td class="px-4 py-2 text-sm">${r.partner}</td>
        <td class="px-4 py-2 text-sm"><a href="./client-detail.html?id=${r.id}" class="text-indigo-600 hover:underline">${r.name}</a></td>
        <td class="px-4 py-2 text-sm">${fmt(r.thisWeek)}</td>
        <td class="px-4 py-2 text-sm">${fmt(r.lifetime)}</td>
      </tr>
    `).join('');
  }

  if (tabsWrap && tabsEl) {
    tabsWrap.classList.remove('hidden');
    tabsEl.innerHTML = '';
    const makeTab = (label) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className = 'px-3 py-1 rounded-full text-xs border';
      if (label === activePartner) {
        btn.classList.add('bg-gray-900', 'text-white', 'border-gray-900');
      } else {
        btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
      }
      btn.addEventListener('click', () => {
        activePartner = label;
        tabsEl.querySelectorAll('button').forEach(b => b.className = 'px-3 py-1 rounded-full text-xs border bg-white text-gray-700 border-gray-300');
        btn.className = 'px-3 py-1 rounded-full text-xs border bg-gray-900 text-white border-gray-900';
        renderTable(label === 'All partners' ? null : label);
      });
      return btn;
    };
    tabsEl.appendChild(makeTab('All partners'));
    keys.forEach(k => tabsEl.appendChild(makeTab(k)));
  }

  renderTable(null);
}

/* ===== Partner datalist ===== */
async function hydratePartnerDatalist() {
  const list = document.getElementById('partnersList');
  if (!list) return;
  const supabase = await getSupabase(); if (!supabase) return;
  const { data, error } = await supabase.from('clients').select('sales_partner').not('sales_partner', 'is', null);
  if (error) { console.error(error); return; }
  const uniq = [...new Set((data || []).map(r => (r.sales_partner || '').trim()).filter(Boolean))].sort();
  list.innerHTML = uniq.map(v => `<option value="${v}"></option>`).join('');
}

/* ===== Recommendations logic (capacity planner, allocator, CSV) ===== */
function remainingWeekdaysRange(today) {
  const base = mondayOf(today);
  return Array.from({ length: 5 }, (_, i) => addDays(base, i)).filter(d => d >= today);
}
function allocatePlan(rows, days, {
  scenario = 'even',
  clientMeta = {},
  dayCapacity = null
} = {}) {
  const nDays = days.length;
  const nClients = rows.length;
  const totals = Array(nDays).fill(0);
  const slots = rows.map(() => Array(nDays).fill(0));
  const remaining = rows.map(r => r.remaining || 0);
  const maxPerClientDay = rows.map(r => (r.remaining || 0) * 0.4 || 0);

  const weighted = rows.map((r, i) => {
    const meta = clientMeta[r.id] || {};
    const baseWeight = (remaining[i] || 0) > 0 ? 1 : 0;
    let w = baseWeight;
    if (meta.status === 'red') w *= 1.4;
    if (meta.carryIn) w *= 1.2;
    if (meta.vip) w *= 1.2;
    w *= meta.complexity || 1.0;
    return { idx: i, weight: w };
  });

  const basis = (scenario === 'risk' || scenario === 'capacity') ? weighted.filter(w => w.weight > 0) : rows.map((r, i) => ({ idx: i, weight: 1 }));
  if (basis.length === 0) return { slots, totals };

  const assignments = [];
  for (let d = 0; d < nDays; d++) {
    basis.forEach(b => {
      for (let k = 0; k < 10; k++) {
        assignments.push({ dayIdx: d, clientIdx: b.idx, weight: b.weight });
      }
    });
  }

  if (scenario === 'front') {
    assignments.sort((a, b) => a.dayIdx - b.dayIdx);
  } else if (scenario === 'risk') {
    assignments.sort((a, b) => b.weight - a.weight);
  } else if (scenario === 'capacity') {
    assignments.sort((a, b) => {
      if (a.dayIdx !== b.dayIdx) return a.dayIdx - b.dayIdx;
      return b.weight - a.weight;
    });
  }

  const grand = remaining.reduce((a,b)=>a+b,0);
  const avgPerDay = grand / Math.max(1, nDays);
  const targetPerDay = days.map((_, d) => {
    const cap = dayCapacity ? (dayCapacity[d] || 0) : null;
    if (cap != null && cap > 0) return cap;
    return avgPerDay * (1 + (d === 0 ? 0.1 : -0.05));
  });

  assignments.forEach(assign => {
    const i = assign.clientIdx;
    const d = assign.dayIdx;
    if (remaining[i] <= 0) return;
    const capForClientDay = maxPerClientDay[i];
    const capForDay = targetPerDay[d];
    if (capForDay != null && totals[d] >= capForDay) return;

    const chunk = 10;
    if (remaining[i] < chunk) return;
    if (capForClientDay && slots[i][d] + chunk > capForClientDay) return;

    remaining[i] -= chunk;
    slots[i][d] += chunk;
    totals[d] += chunk;
  });

  return { slots, totals };
}
function renderScenarioExplainer(active = 'even') {
  if (!recExplain) return;
  let text = '';
  if (active === 'even') text = 'Even: distributes remaining volume evenly across weekdays for each client.';
  else if (active === 'risk') text = 'Risk-weighted: prioritizes red/carry-in clients first while staying within per-day caps.';
  else if (active === 'front') text = 'Front-loaded: pushes more work into earlier days in the week to build a buffer.';
  else if (active === 'capacity') text = 'Capacity-aware: uses your per-day capacity inputs to avoid overloading any single day.';
  recExplain.textContent = text;
}
function openRecModal() {
  if (!recModal) return;
  recModal.classList.remove('hidden');
  renderScenarioExplainer(getRecScenario());
  runRecommendations();
}
function closeRecModal() { recModal?.classList.add('hidden'); }
function getRecScenario() {
  const checked = document.querySelector('input[name="recScenario"]:checked');
  return checked ? checked.value : 'even';
}
function getCapacities() {
  if (!recCapRow) return null;
  const inputs = recCapRow.querySelectorAll('input[type="number"]');
  return Array.from(inputs).map(i => i.value ? Number(i.value) : null);
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

  const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
  const headerRow = document.getElementById('recHeadRow');
  if (headerRow) {
    headerRow.innerHTML = `
      <th class="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
      ${days.map(d => `<th class="px-2 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">${dayLabel(d)}</th>`).join('')}
      <th class="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Weekly total</th>
    `;
  }

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

  return { rows, days, slots, totals };
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

  // Copy CSV
  document.getElementById('recCopy')?.addEventListener('click', () => {
    const { rows, days, slots } = runRecommendations();
    if (!rows || !days || !slots) return;
    const dayLabel = (d) => d.toISOString().slice(0,10);
    const header = ['Client', ...days.map(d => dayLabel(d)), 'Weekly Total'];
    const lines = [header.join(',')];
    rows.forEach((r, i) => {
      const weekSum = slots[i].reduce((a,b)=>a+b,0);
      lines.push([r.name, ...slots[i], weekSum].join(','));
    });
    const csv = lines.join('\n');
    navigator.clipboard.writeText(csv).then(() => alert('Copied CSV to clipboard.'));
  });

  // Download CSV
  document.getElementById('recDownload')?.addEventListener('click', () => {
    const { rows, days, slots } = runRecommendations();
    if (!rows || !days || !slots) return;
    const dayLabel = (d) => d.toISOString().slice(0,10);
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
