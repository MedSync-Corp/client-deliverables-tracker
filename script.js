// script.js — adds week navigation; weekly model + per-week overrides + negatives + lifetime + started tags + partners view + recommendations modal
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton, getCurrentUser } from './auth.js';
import { toast } from './toast.js';

/* ===== Utils ===== */
const fmt = (n) => Number(n || 0).toLocaleString();

// Paginated fetch — Supabase/PostgREST caps each request at ~1000 rows. For
// tables that can exceed that (notably `completions`), a single .select()
// silently returns only the first 1000 rows, so newer rows are dropped from
// all-client aggregates. This loops with .range() until the full set is
// retrieved. `buildQuery` must return a FRESH query builder each call (builders
// are single-use) and should include a stable `.order()` (e.g. by id) so page
// boundaries don't skip or duplicate rows.
async function fetchAllRows(buildQuery, label = 'rows') {
  const PAGE = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) { console.error(`fetchAllRows(${label}) error:`, error); break; }
    const batch = data || [];
    all.push(...batch);
    if (batch.length < PAGE) break; // last page
    from += PAGE;
  }
  if (all.length > PAGE) console.info(`fetchAllRows(${label}): retrieved ${all.length} rows across ${Math.ceil(all.length / PAGE)} pages`);
  return all;
}

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
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday:'short', month:'2-digit', day:'2-digit' });
const shortDate = (d) => d.toLocaleDateString(undefined, { month:'short', day:'numeric' });

/* ===== Elements ===== */
const kpiTotal = document.getElementById('kpi-total');
const kpiCompleted = document.getElementById('kpi-completed');
const kpiRemaining = document.getElementById('kpi-remaining');
const kpiLifetime = document.getElementById('kpi-lifetime');

const dueLabel = document.getElementById('dueLabel');
const weekPrevBtn = document.getElementById('weekPrev');
const weekNextBtn = document.getElementById('weekNext');


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
  clientForm.reported_lives && (clientForm.reported_lives.value = client?.reported_lives || '');
  clientForm.first_roster_date && (clientForm.first_roster_date.value = client?.first_roster_date ? String(client.first_roster_date).slice(0, 10) : '');
  clientForm.ehr_access && (clientForm.ehr_access.checked = client?.ehr_access || false);
  clientForm.is_test && (clientForm.is_test.checked = client?.is_test || false);
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
    reported_lives: clientForm.reported_lives?.value ? Number(clientForm.reported_lives.value) : null,
    first_roster_date: clientForm.first_roster_date?.value || null,
    ehr_access: clientForm.ehr_access?.checked || false,
    is_test: clientForm.is_test?.checked || false,
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
  await loadPartnersPage(); // Reload partners page if on that page
  await loadClientDetail(); // Refresh client detail when editing from that page
  toast.success('Saved successfully');
});

/* ===== Delete client ===== */
async function handleDelete(clientId, clientName = 'this client') {
  const ok = await confirmDialog({
    title: 'Delete Client',
    message: `This permanently removes <span class="font-semibold">${clientName}</span> and ALL related data — completions, weekly targets, overrides, addresses, EMRs, and rollout plans. This cannot be undone.<br><br>Type the client name to confirm:`,
    confirmLabel: 'Delete permanently',
    confirmClass: 'bg-red-600 hover:bg-red-700',
    requireText: clientName
  });
  if (!ok) return;
  const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');
  // rollout_weeks cascade from rollout_plans via FK
  const tables = ['completions', 'client_addresses', 'client_emrs', 'weekly_commitments', 'weekly_overrides', 'rollout_plans'];
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

// Sum UTCs (Unable To Complete) for a client
function sumUTCs(completions, clientId) {
  return (completions || [])
    .filter(c => c.client_fk === clientId)
    .reduce((sum, c) => sum + (c.qty_utc || 0), 0);
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

  const [{ data: clients }, { data: wk }, { data: ovr }, comps, { data: plans }, { data: planWeeks }] = await Promise.all([
    supabase.from('clients').select('id,name,acronym,total_lives,sales_partner,status,is_test,completed,paused,pause_reason').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    fetchAllRows(() => supabase.from('completions').select('client_fk,occurred_on,qty_completed,qty_utc').order('id', { ascending: true }), 'dashboard completions'),
    supabase.from('rollout_plans').select('*').eq('status', 'active'),
    supabase.from('rollout_weeks').select('*')
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

  // Week-offset banner: every number on this page reflects the selected week,
  // so make it impossible to misread a navigated week as the current one.
  const offsetBanner = document.getElementById('weekOffsetBanner');
  if (offsetBanner) {
    offsetBanner.classList.toggle('hidden', __weekOffset === 0);
    offsetBanner.classList.toggle('flex', __weekOffset !== 0);
    if (__weekOffset !== 0) {
      const n = Math.abs(__weekOffset);
      document.getElementById('weekOffsetText').textContent =
        `Viewing week of ${shortDate(monSel)} (${n} week${n === 1 ? '' : 's'} ${__weekOffset > 0 ? 'ahead' : 'ago'}) — every number on this page is for that week.`;
    }
  }

  const startedOnly = document.getElementById('filterContracted')?.checked ?? true;

  // Only Active clients count toward dashboard targets/KPIs
  // (paused, awaiting patients, term, and contract complete are all excluded)
  const activeClients = (clients || []).filter(c => clientStatusValue(c) === 'active');

  // Live hint for how many active clients the "started only" toggle hides
  const hiddenHint = document.getElementById('hiddenCountHint');
  if (hiddenHint) {
    const notStartedCount = activeClients.filter(c => !isStarted(c.id, wk, comps)).length;
    hiddenHint.textContent = (startedOnly && notStartedCount)
      ? `(hiding ${notStartedCount} not-started)` : '';
  }

  const rows = activeClients.filter(c => {
    return !startedOnly || isStarted(c.id, wk, comps);
  }).map(c => {
    // Get completions for the selected week
    const doneSel = sumCompleted(comps, c.id, monSel, friSel);
    
    // Get the base target for the selected week
    const baseSel = baseTargetFor(ovr, wk, c.id, monSel);

    // Skip-week: an explicit 0-qty override marks the selected week as skipped
    const skipped = overrideForWeek(ovr, c.id, monSel) === 0;

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
    const plan = (plans || []).find(p => p.client_fk === c.id) || null;
    const planWks = plan ? (planWeeks || []).filter(w => w.plan_fk === plan.id) : [];

    // Weeks Left (display-only, no target math involved):
    // rollout clients show their plan's remaining weeks; steady-state clients
    // show ceil(total remaining lives ÷ effective weekly target).
    const lifetimeUTC = sumUTCs(comps, c.id);
    const totalRemaining = c.total_lives ? Math.max(0, c.total_lives - lifetime - lifetimeUTC) : null;
    const rolloutRemaining = plan ? rolloutProgress(plan, planWks).remaining : null;
    const weeksLeft = plan ? rolloutRemaining
      : (baseSel > 0 && totalRemaining != null) ? Math.ceil(totalRemaining / baseSel) : null;
    const weeksLeftSort = weeksLeft ?? Number.MAX_SAFE_INTEGER;

    // "day N of test week" hint for the test strip (weekdays since the
    // active baseline's start_week, inclusive)
    let testDayN = null;
    if (c.is_test) {
      const ac = (wk || []).filter(w => w.client_fk === c.id && w.active)
        .sort((a, b) => new Date(b.start_week) - new Date(a.start_week))[0];
      if (ac) {
        let n = 0;
        for (let d = new Date(String(ac.start_week).slice(0, 10) + 'T00:00:00'); d <= today; d.setDate(d.getDate() + 1)) {
          const dow = d.getDay();
          if (dow >= 1 && dow <= 5) n++;
        }
        if (n >= 1 && n <= 10) testDayN = n;
      }
    }

    return { id: c.id, name: c.name, acronym: c.acronym, required: requiredSel, remaining, doneThis: doneSel, carryIn: carryInSel, status, lifetime, targetThis: baseSel, skipped, isTest: !!c.is_test, plan, planWeeks: planWks, totalRemaining, weeksLeft, weeksLeftSort, testDayN };
  });

  const totalReq = rows.reduce((s, r) => s + r.required, 0);
  const totalDone = rows.reduce((s, r) => s + r.doneThis, 0);
  const totalRem = rows.reduce((s, r) => s + r.remaining, 0);  // Sum individual remainings, not totalReq - totalDone
  const totalLifetime = (comps || []).reduce((s, c) => s + (c.qty_completed || 0), 0);

  kpiTotal?.setAttribute('value', fmt(totalReq));
  kpiCompleted?.setAttribute('value', fmt(totalDone));
  kpiRemaining?.setAttribute('value', fmt(totalRem));
  kpiLifetime?.setAttribute('value', fmt(totalLifetime));

  // Test clients render in a pinned strip above Due This Week;
  // the strip collapses entirely when no test clients exist.
  const testRows = rows.filter(r => r.isTest);
  const mainRows = rows.filter(r => !r.isTest);
  const testSection = document.getElementById('testSection');
  if (testSection) testSection.classList.toggle('hidden', !testRows.length);
  if (testRows.length) renderDueThisWeek(testRows, 'test');
  renderDueThisWeek(mainRows, 'main');

  renderFinishBoard(mainRows, testRows);

  __rowsForRec = rows;
  window.__rowsForRec = rows; // Keep window copy in sync
}
/* Dashboard renders two parallel table sections from one dataset:
   'main' (active production) and 'test' (pinned test-client strip).
   Each section has its own sort state. */
const DUE_SECTIONS = {
  main: { bodyId: 'dueThisWeekBody' },
  test: { bodyId: 'testDueThisWeekBody' }
};

/* ===== Finish-week timeline board =====
   Client lifecycle left to right: Test column (every is_test client) then
   "This wk" / "+1 wk" ... "+5 wk" / "6+ wk" — each active-section client with
   a computable Weeks Left renders as a chip in the column matching that value.
   Pure HTML/CSS, display-only, no Chart.js. Test clients appear ONLY here and
   in the strip below; awaiting-patients and other non-due clients have no
   runway and are excluded. */
function renderFinishBoard(mainRows, testRows) {
  const el = document.getElementById('finishBoard');
  if (!el) return;

  const chipHTML = (r, mode) => {
    const label = r.acronym || (r.name.length > 12 ? r.name.slice(0, 12) + '…' : r.name);
    let tint = 'bg-gray-100 text-gray-800 hover:bg-gray-200';
    let suffix = '';
    let hint = `${r.weeksLeft} week${r.weeksLeft === 1 ? '' : 's'} of work left`;
    if (mode === 'test') {
      tint = 'bg-purple-100 text-purple-800 hover:bg-purple-200';
      hint = 'New-client test week' + (r.testDayN ? ` — day ${r.testDayN}` : '');
    } else if (r.plan) {
      tint = 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200';
      const p = rolloutProgress(r.plan, r.planWeeks);
      suffix = ` <span class="text-indigo-500 text-xs whitespace-nowrap">wk ${p.current} of ${p.total}</span>`;
      hint = `Mass-roster rollout — week ${p.current} of ${p.total}`;
    } else if (r.status === 'red') {
      tint = 'bg-red-100 text-red-700 hover:bg-red-200';
      hint += ' · carryover this week';
    }
    if (mode !== 'test' && !r.plan && r.weeksLeft >= 6) {
      suffix = ` <span class="opacity-60 text-xs">${r.weeksLeft}w</span>`;
    }
    return `<a href="./client-detail.html?id=${r.id}" title="${r.name} — ${hint}"
      class="block px-2.5 py-1.5 rounded-lg text-sm font-medium truncate ${tint}">${label}${suffix}</a>`;
  };

  const placed = mainRows.filter(r => r.weeksLeft != null);
  const colKey = (r) => (r.weeksLeft >= 6 ? '6plus' : r.weeksLeft);
  const byCol = {};
  placed.forEach(r => { (byCol[colKey(r)] = byCol[colKey(r)] || []).push(r); });
  // Within a column: carryover first, then alphabetical (6+ additionally by runway)
  const colSort = (a, b) => (a.status === 'red' ? 0 : 1) - (b.status === 'red' ? 0 : 1)
    || (a.weeksLeft - b.weeksLeft) || (a.acronym || a.name).localeCompare(b.acronym || b.name);

  const cols = [
    { key: 'test', label: 'Test', items: [...testRows].sort(colSort).map(r => chipHTML(r, 'test')) },
    ...[0, 1, 2, 3, 4, 5].map(n => ({
      key: n, label: n === 0 ? 'This wk' : `+${n} wk`,
      items: (byCol[n] || []).sort(colSort).map(r => chipHTML(r))
    })),
    { key: '6plus', label: '6+ wk', items: (byCol['6plus'] || []).sort(colSort).map(r => chipHTML(r)) }
  ];

  el.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 overflow-x-auto">
      <div class="grid grid-cols-8 gap-3 min-w-[900px]">
        ${cols.map(c => `
          <div>
            <div class="flex items-baseline gap-1.5 pb-1 mb-2 border-b ${c.key === 'test' ? 'border-purple-200' : 'border-gray-200'}">
              <span class="text-sm font-semibold ${c.key === 'test' ? 'text-purple-700' : 'text-gray-700'}">${c.label}</span>
              <span class="text-xs text-gray-400">${c.items.length}</span>
            </div>
            <div class="space-y-1.5">${c.items.length ? c.items.join('') : '<div class="text-center text-gray-300 py-1 select-none">—</div>'}</div>
          </div>`).join('')}
      </div>
      <p class="text-xs text-gray-500 mt-3">Client lifecycle, left to right: test week → weeks of work remaining. <span class="text-red-600 font-medium">Red</span> = carryover this week · <span class="text-indigo-600 font-medium">Indigo</span> = mass-roster rollout · click a client to open detail.</p>
    </div>`;
}

// Dashboard sorting state — one per section so sorting the test table
// doesn't reorder the active-production table (and vice versa)
let __dashboardSort = {
  main: { col: 'remaining', dir: 'desc' },
  test: { col: 'remaining', dir: 'desc' }
};
let __dashboardRows = { main: [], test: [] };

function renderDueThisWeek(rows, section = 'main') {
  const cfg = DUE_SECTIONS[section];
  const body = document.getElementById(cfg.bodyId);
  if (!body) return;
  // Skipped clients stay visible (with a badge) even when nothing is required,
  // so a skip reads as "skipped" rather than the client silently vanishing.
  __dashboardRows[section] = rows.filter(r => r.required > 0 || r.skipped);

  if (!__dashboardRows[section].length) {
    body.innerHTML = `<tr><td colspan="7" class="py-4 text-sm text-gray-500">No active commitments for this week.</td></tr>`;
    return;
  }

  renderDueThisWeekSorted(section);

  // Wire up sort headers (only once per section)
  const thead = body.closest('table')?.querySelector('thead');
  if (thead && !thead.dataset.sortWired) {
    thead.dataset.sortWired = 'true';
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const col = th.dataset.sort;
      const sort = __dashboardSort[section];
      if (sort.col === col) {
        sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sort.col = col;
        sort.dir = col === 'name' ? 'asc' : 'desc';
      }
      updateSortArrows(thead, section);
      renderDueThisWeekSorted(section);
    });
  }
}

function updateSortArrows(thead, section = 'main') {
  const sort = __dashboardSort[section];
  thead.querySelectorAll('th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.sort === sort.col) {
      arrow.textContent = sort.dir === 'asc' ? '↑' : '↓';
      arrow.classList.remove('text-gray-400');
      arrow.classList.add('text-gray-700');
    } else {
      arrow.textContent = '↕';
      arrow.classList.remove('text-gray-700');
      arrow.classList.add('text-gray-400');
    }
  });
}

function renderDueThisWeekSorted(section = 'main') {
  const cfg = DUE_SECTIONS[section];
  const body = document.getElementById(cfg.bodyId);
  if (!body) return;
  const sort = __dashboardSort[section];
  const statusOrder = { red: 0, yellow: 1, green: 2 };

  const sorted = [...__dashboardRows[section]].sort((a, b) => {
    let cmp = 0;
    switch (sort.col) {
      case 'name':
        cmp = (a.name || '').localeCompare(b.name || '');
        break;
      case 'required':
        cmp = (a.required || 0) - (b.required || 0);
        break;
      case 'remaining':
        cmp = (a.remaining || 0) - (b.remaining || 0);
        break;
      case 'weeksLeft':
        cmp = a.weeksLeftSort - b.weeksLeftSort;
        break;
      case 'status':
        cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
        break;
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  body.innerHTML = sorted.map(r => {
    const pct = r.required > 0 ? Math.min(100, Math.round((r.doneThis / r.required) * 100)) : 0;
    const displayName = r.acronym ? `${r.name} <span class="text-gray-500">(${r.acronym})</span>` : r.name;
    const logLabel = r.acronym || r.name;

    // Test strip extras: TEST badge and "day N of test week" hint
    const testBadge = section === 'test'
      ? ` <span class="text-xs text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded font-semibold">Test</span>${r.testDayN ? ` <span class="text-xs text-gray-400 whitespace-nowrap">day ${r.testDayN} of test week</span>` : ''}`
      : '';

    // Weeks Left: plain number (feeds the finish-week board and the sort).
    // Rollout clients show their plan's remaining weeks plus the compact
    // confirm affordance for the current week; the "wk X of Y" visualization
    // lives on the board above.
    let weeksLeftCell = '<span class="text-gray-400">—</span>';
    if (r.plan) {
      const prog = rolloutProgress(r.plan, r.planWeeks);
      weeksLeftCell = `<span title="Mass-roster rollout: week ${prog.current} of ${prog.total}">${fmt(r.weeksLeft)}</span>`;
      const cur = prog.ws.find(w => !w.confirmed);
      if (cur) {
        weeksLeftCell += ` <button class="px-1.5 py-0.5 rounded border border-indigo-300 text-indigo-700 text-xs hover:bg-indigo-50" data-rollout-confirm="${cur.id}" data-plan="${r.plan.id}" data-week="${cur.week_index}" data-name="${r.name}" title="Confirm rollout week ${cur.week_index} complete">✓ wk ${cur.week_index}</button>`;
      }
    } else if (r.weeksLeft != null) {
      weeksLeftCell = `<span title="${fmt(r.totalRemaining)} total remaining ÷ ${fmt(r.targetThis)}/wk target">${fmt(r.weeksLeft)}</span>`;
    }

    // Progress bar color based on status
    const barColor = r.status === 'green' ? 'bg-green-500' : (r.status === 'yellow' ? 'bg-yellow-500' : 'bg-red-500');

    // Check if this client hit zero this week (celebration!)
    const hitZero = r.remaining === 0 && r.required > 0;
    const remainingCell = hitZero
      ? `<span class="text-green-600 font-bold">🎉 Done!</span>`
      : (r.skipped && r.remaining === 0)
        ? `<span class="text-gray-400">—</span>`
        : `<span class="text-red-600 font-medium">${fmt(r.remaining)}</span>`;

    return `<tr>
      <td class="px-4 py-2 text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${displayName}</a>${testBadge}</td>
      <td class="px-4 py-2 text-sm">${fmt(r.required)}${r.skipped ? ` ${skippedBadgeHTML()}` : ''}</td>
      <td class="px-4 py-2 text-sm">
        <div class="flex items-center gap-2">
          <div class="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div class="${barColor} h-full rounded-full transition-all" style="width: ${pct}%"></div>
          </div>
          <span class="text-xs text-gray-500 w-12 text-right">${fmt(r.doneThis)}/${fmt(r.required)}</span>
        </div>
      </td>
      <td class="px-4 py-2 text-sm">${remainingCell}</td>
      <td class="px-4 py-2 text-sm">${weeksLeftCell}</td>
      <td class="px-4 py-2 text-sm"><status-badge status="${r.status}" title="Red = carry-in from last week, Yellow = >100/day still needed, Green = on pace"></status-badge></td>
      <td class="px-4 py-2 text-sm text-right"><button class="px-2 py-1 rounded bg-gray-900 text-white text-xs" data-log="${r.id}" data-name="${logLabel}">Log</button></td>
    </tr>`;
  }).join('');

  body.onclick = async (e) => {
    const rc = e.target.closest('button[data-rollout-confirm]');
    if (rc) { await withBusy(rc, () => confirmRolloutWeek(rc.dataset.rolloutConfirm, rc.dataset.plan, Number(rc.dataset.week), rc.dataset.name)); return; }
    const b = e.target.closest('button[data-log]');
    if (!b) return;
    openLogModal(b.dataset.log, b.dataset.name);
  };
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

  await withBusy(logForm.querySelector('button[type="submit"]'), async () => {
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
});

/* ===== Clients list ===== */
let __clientsCache = { clients: [], wk: [], comps: [] };
let __clientsSort = { col: 'name', dir: 'asc' };

async function loadClientsList() {
  if (!clientsTableBody) return;
  showLoading('clientsBody', 'Loading clients...');
  
  const supabase = await getSupabase(); if (!supabase) { clientsTableBody.innerHTML = `<tr><td class="py-4 px-4 text-sm text-gray-500">Connect Supabase (env.js).</td></tr>`; return; }

  const [{ data: clients }, { data: wk }, comps, { data: plans }, { data: planWeeks }] = await Promise.all([
    supabase.from('clients').select('id,name,acronym,total_lives,sales_partner,status,is_test,completed,paused,pause_reason').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    fetchAllRows(() => supabase.from('completions').select('client_fk,qty_completed,qty_utc').order('id', { ascending: true }), 'clients completions'),
    supabase.from('rollout_plans').select('*').eq('status', 'active'),
    supabase.from('rollout_weeks').select('*')
  ]);

  // Cache for filtering
  __clientsCache = { clients: clients || [], wk: wk || [], comps: comps || [], plans: plans || [], planWeeks: planWeeks || [] };

  // Store data for client report PDF generation
  window.__clientsReportData = { clients: clients || [], wk: wk || [], comps: comps || [] };

  // One-time status pre-filter from the URL (e.g. dashboard "Awaiting patients"
  // chip links to clients.html?status=awaiting_patients)
  const statusDropdown = document.getElementById('filterStatus');
  if (statusDropdown && !statusDropdown.dataset.urlApplied) {
    statusDropdown.dataset.urlApplied = 'true';
    const urlStatus = new URL(location.href).searchParams.get('status');
    if (urlStatus && [...statusDropdown.options].some(o => o.value === urlStatus)) {
      statusDropdown.value = urlStatus;
    }
  }

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

  // Searching matches across ALL clients regardless of the Show filter —
  // otherwise a search for a client outside the current filter silently
  // returns nothing. The rows carry status badges, so cross-status results
  // read fine. The Show filter applies only while the search box is empty.
  if (term) {
    return __clientsCache.clients.filter(c =>
      c.name.toLowerCase().includes(term) ||
      (c.acronym && c.acronym.toLowerCase().includes(term)) ||
      (c.sales_partner && c.sales_partner.toLowerCase().includes(term))
    );
  }

  let filtered = __clientsCache.clients;

  // Filter by status
  if (statusFilter === 'active') {
    filtered = filtered.filter(c => {
      const started = isStarted(c.id, __clientsCache.wk, __clientsCache.comps);
      return started && clientStatusValue(c) === 'active';
    });
  } else if (statusFilter === 'paused') {
    filtered = filtered.filter(c => isPausedStatus(clientStatusValue(c)));
  } else if (statusFilter === 'not_started') {
    filtered = filtered.filter(c => {
      const started = isStarted(c.id, __clientsCache.wk, __clientsCache.comps);
      return !started && clientStatusValue(c) === 'active';
    });
  } else if (statusFilter === 'all') {
    // everything
  } else {
    // Direct status match: awaiting_patients, term, contract_complete
    filtered = filtered.filter(c => clientStatusValue(c) === statusFilter);
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
    const sv = clientStatusValue(c);
    const terminal = isTerminalStatus(sv);
    const displayStatus = (sv === 'active' && !started) ? 'not_started' : sv;
    const statusTag = `<span class="ml-2">${getStatusBadgeHTML(displayStatus)}</span>`;
    const partnerChip = c.sales_partner ? `<span class="ml-2 text-xs text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">${c.sales_partner}</span>` : '';
    const testChip = c.is_test ? `<span class="ml-2 text-xs text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded font-semibold" title="Test client — shown in the pinned Test section on the dashboard">Test</span>` : '';
    const clientPlan = (__clientsCache.plans || []).find(p => p.client_fk === c.id);
    const rolloutChip = clientPlan ? `<span class="ml-2">${rolloutChipHTML(clientPlan, __clientsCache.planWeeks)}</span>` : '';

    // Status actions: terminal clients only offer Reactivate; everyone else gets
    // Pause/Resume plus the two terminal actions.
    let statusActions = '';
    if (terminal) {
      statusActions = `<button class="w-full text-left px-3 py-2 text-sm text-green-600 hover:bg-gray-100" data-reactivate="${c.id}" data-name="${c.name}">Reactivate</button>`;
    } else {
      if (isPausedStatus(sv)) {
        statusActions += `<button class="w-full text-left px-3 py-2 text-sm text-green-600 hover:bg-gray-100" data-resume="${c.id}">Resume</button>`;
      } else if (sv !== 'awaiting_patients') {
        statusActions += `<button class="w-full text-left px-3 py-2 text-sm text-amber-600 hover:bg-gray-100" data-pause="${c.id}">Pause</button>`;
      }
      statusActions += `<button class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-100" data-term="${c.id}" data-name="${c.name}">Mark Term</button>`;
      statusActions += `<button class="w-full text-left px-3 py-2 text-sm text-teal-700 hover:bg-gray-100" data-contract-complete="${c.id}" data-name="${c.name}">Contract Complete</button>`;
      if (!clientPlan) {
        statusActions += `<button class="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-gray-100" data-rollout="${c.id}">Rollout plan…</button>`;
      }
    }

    // Calculate values
    const done = totalCompleted(c.id);
    const utcs = totalUTCs(c.id);
    const totalLives = c.total_lives || 0;
    const remaining = Math.max(0, totalLives - done - utcs);
    const remainingDisplay = totalLives ? fmt(remaining) : '—';
    
    const tr = document.createElement('tr');
    tr.className = sv === 'awaiting_patients' ? 'bg-gray-50 text-gray-500'
      : terminal ? 'bg-gray-100 text-gray-500'
      : isPausedStatus(sv) ? 'bg-amber-50/30' : '';
    const muted = sv === 'awaiting_patients' || terminal;
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm">
        <a class="${muted ? 'text-gray-500 hover:underline' : 'text-indigo-600 hover:underline'}" href="./client-detail.html?id=${c.id}">${c.name}</a>
        ${partnerChip}
        ${statusTag}
        ${testChip}
        ${rolloutChip}
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
          <div class="actions-menu hidden absolute right-0 mt-1 w-44 bg-white border rounded-lg shadow-lg z-10">
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100" data-edit="${c.id}">Edit</button>
            ${statusActions}
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
      const menu = toggle.nextElementSibling;
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) {
        // Escape the table container's overflow clipping: position the menu
        // fixed at the button, flipping above it when the viewport is tight
        // below (e.g. a single-row search result).
        const r = toggle.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.margin = '0';
        menu.style.right = 'auto';
        menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
        const spaceBelow = window.innerHeight - r.bottom;
        menu.style.top = (spaceBelow >= menu.offsetHeight + 8
          ? r.bottom + 4
          : Math.max(8, r.top - menu.offsetHeight - 4)) + 'px';
      }
      e.stopPropagation();
      return;
    }
    
    const del = e.target.closest('button[data-delete]');
    if (del) { await handleDelete(del.dataset.delete, del.dataset.name); return; }
    const edit = e.target.closest('button[data-edit]');
    if (edit) { await openClientModalById(edit.dataset.edit); return; }
    const pause = e.target.closest('button[data-pause]');
    if (pause) { openPauseModal(pause.dataset.pause); return; }
    const resume = e.target.closest('button[data-resume]');
    if (resume) { await withBusy(resume, () => togglePauseClient(resume.dataset.resume, false)); return; }
    const term = e.target.closest('button[data-term]');
    if (term) { await withBusy(term, () => requestStatusChange(term.dataset.term, 'term', term.dataset.name)); return; }
    const contract = e.target.closest('button[data-contract-complete]');
    if (contract) { await withBusy(contract, () => requestStatusChange(contract.dataset.contractComplete, 'contract_complete', contract.dataset.name)); return; }
    const reactivate = e.target.closest('button[data-reactivate]');
    if (reactivate) { await withBusy(reactivate, () => requestStatusChange(reactivate.dataset.reactivate, 'active', reactivate.dataset.name)); return; }
    const rollout = e.target.closest('button[data-rollout]');
    if (rollout) {
      const client = __clientsCache.clients.find(cl => cl.id === rollout.dataset.rollout);
      if (client) openRolloutModal(client);
      return;
    }
  };
  
  // Close dropdowns when clicking outside or scrolling (menus are positioned
  // fixed, so they'd otherwise float detached from their row on scroll).
  // Registered once — renderClientsList re-runs on every mutation.
  if (!window.__actionsMenuCloserWired) {
    window.__actionsMenuCloserWired = true;
    const closeAllMenus = () => document.querySelectorAll('.actions-menu').forEach(m => m.classList.add('hidden'));
    document.addEventListener('click', closeAllMenus);
    window.addEventListener('scroll', closeAllMenus, true);
  }
}

async function togglePauseClient(clientId, shouldPause, pauseReason = null) {
  const supabase = await getSupabase(); if (!supabase) return;

  const status = shouldPause
    ? (pauseReason === 'medsync' ? 'paused_medsync' : 'paused_client')
    : 'active';
  const { error } = await setClientStatus(clientId, status);
  if (error) {
    toast.error(error.message);
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

  toast.success(shouldPause ? 'Client paused' : 'Client resumed');
  await loadClientsList();
  await loadDashboard();
}

/* ===== Pause Reason Modal ===== */
let __pendingPauseClientId = null;

function openPauseModal(clientId) {
  __pendingPauseClientId = clientId;
  const modal = document.getElementById('pauseModal');
  if (!modal) return;

  // Reset radio buttons
  modal.querySelectorAll('input[name="pauseReason"]').forEach(r => r.checked = false);

  // Disable confirm button until a reason is selected
  const confirmBtn = document.getElementById('pauseModalConfirm');
  if (confirmBtn) confirmBtn.disabled = true;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closePauseModal() {
  __pendingPauseClientId = null;
  const modal = document.getElementById('pauseModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function wirePauseModal() {
  const modal = document.getElementById('pauseModal');
  if (!modal) return;

  const cancelBtn = document.getElementById('pauseModalCancel');
  const confirmBtn = document.getElementById('pauseModalConfirm');
  const radios = modal.querySelectorAll('input[name="pauseReason"]');

  cancelBtn?.addEventListener('click', closePauseModal);

  // Enable confirm button when a reason is selected
  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (confirmBtn) confirmBtn.disabled = false;
    });
  });

  confirmBtn?.addEventListener('click', async () => {
    const selectedReason = modal.querySelector('input[name="pauseReason"]:checked')?.value;
    if (!selectedReason || !__pendingPauseClientId) return;

    const clientId = __pendingPauseClientId; // Save before closing clears it
    await withBusy(confirmBtn, async () => {
      await togglePauseClient(clientId, true, selectedReason);
      closePauseModal();
      // Also refresh client detail if on that page
      await loadClientDetail();
    });
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePauseModal();
  });
}

function filterClients(searchTerm) {
  renderClientsList(getCurrentFilteredClients());
}

/* ===== Client detail (uses EST-aware sums now) ===== */
async function loadClientDetail() {
  const nameEl = document.getElementById('clientName'); if (!nameEl) return;
  const id = new URL(location.href).searchParams.get('id');
  const supabase = await getSupabase(); if (!supabase) return;

  const [{ data: client }, { data: addrs }, { data: emrs }, { data: wk }, { data: ovr }, { data: comps }, { data: rolloutPlans }] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).single(),
    supabase.from('client_addresses').select('*').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('client_emrs').select('*').eq('client_fk', id).order('id', { ascending: true }),
    supabase.from('weekly_commitments').select('*').eq('client_fk', id).order('start_week', { ascending: false }),
    supabase.from('weekly_overrides').select('*').eq('client_fk', id),
    supabase.from('completions').select('*').eq('client_fk', id),
    supabase.from('rollout_plans').select('*').eq('client_fk', id).order('created_at', { ascending: false })
  ]);
  const planIds = (rolloutPlans || []).map(p => p.id);
  const { data: rolloutWks } = planIds.length
    ? await supabase.from('rollout_weeks').select('*').in('plan_fk', planIds)
    : { data: [] };

  // Display name with acronym if available
  const displayName = client?.acronym ? `${client.name} (${client.acronym})` : (client?.name || 'Client');
  nameEl.textContent = displayName;
  
  const sv = clientStatusValue(client);

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

    const displayStatus = (sv === 'active' && !started) ? 'not_started' : sv;
    metaHtml += getStatusBadgeHTML(displayStatus);
    if (client?.is_test) {
      metaHtml += ' <span class="text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded text-xs" title="Test client — shown in the pinned Test section on the dashboard">Test</span>';
    }
    const activeRolloutPlan = (rolloutPlans || []).find(pl => pl.status === 'active');
    if (activeRolloutPlan) metaHtml += ` <span class="ml-1">${rolloutChipHTML(activeRolloutPlan, rolloutWks)}</span>`;
    meta.innerHTML = metaHtml;
  }

  renderRolloutCard(client, rolloutPlans || [], rolloutWks || []);
  const lifetime = (comps || []).reduce((s, c) => s + (c.qty_completed || 0), 0);
  const lifetimeUTCs = (comps || []).reduce((s, c) => s + (c.qty_utc || 0), 0);
  const lifetimeEl = document.getElementById('clientLifetime'); 
  if (lifetimeEl) lifetimeEl.textContent = `Lifetime: ${fmt(lifetime)} completed, ${fmt(lifetimeUTCs)} UTCs`;

  const contact = document.getElementById('contact');
  if (contact) contact.innerHTML = client?.contact_email ? `${client?.contact_name || ''} <a class="text-indigo-600 hover:underline" href="mailto:${client.contact_email}">${client.contact_email}</a>` : (client?.contact_name || '—');
  const notes = document.getElementById('notes'); if (notes) notes.textContent = client?.instructions || '—';
  const addrList = document.getElementById('addresses'); if (addrList) addrList.innerHTML = (addrs?.length ? addrs : []).map(a => `<li>${[a.line1, a.line2, a.city, a.state, a.zip].filter(Boolean).join(', ')}</li>`).join('') || '<li class="text-gray-500">—</li>';
  // EMR systems: the details field carries credentials (user IDs/passwords),
  // so it renders masked by default with a per-row show/hide toggle.
  // Display-only — storage is unchanged.
  const emrList = document.getElementById('emrs');
  if (emrList) {
    const emrRows = emrs?.length ? emrs : [];
    emrList.innerHTML = emrRows.map((e, i) => {
      if (!e.details) return `<li>${e.vendor || '—'}</li>`;
      return `<li>${e.vendor ? `${e.vendor} — ` : ''}<span data-emr-value="${i}">••••••••</span>
        <button type="button" class="text-xs text-indigo-600 hover:underline" data-emr-toggle="${i}">show</button></li>`;
    }).join('') || '<li class="text-gray-500">—</li>';
    emrList.onclick = (e) => {
      const btn = e.target.closest('button[data-emr-toggle]');
      if (!btn) return;
      const i = Number(btn.dataset.emrToggle);
      const span = emrList.querySelector(`[data-emr-value="${i}"]`);
      const revealed = btn.textContent === 'hide';
      span.textContent = revealed ? '••••••••' : (emrRows[i]?.details || '');
      btn.textContent = revealed ? 'show' : 'hide';
    };
  }

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

  const body = document.getElementById('clientWeekBody');
  if (body) {
    // Note text of the override row for a week (skip reasons live here)
    const ovrNoteFor = (weekMon) => (ovr || []).find(r =>
      String(r.week_start).slice(0, 10) === weekMon.toISOString().slice(0, 10))?.note || '';
    const rowHtml = (weekMon, base, ovrQty, tgt, done, rem) => {
      const fri2 = fridayEndOf(weekMon).toISOString().slice(0, 10);
      const ovrCell = ovrQty === 0
        ? skippedBadgeHTML(ovrNoteFor(weekMon))
        : ovrQty != null ? fmt(ovrQty) : '—';
      return `<tr>
        <td class="px-4 py-2 text-sm">${fri2}</td>
        <td class="px-4 py-2 text-sm">${base ? fmt(base) : '—'}</td>
        <td class="px-4 py-2 text-sm">${ovrCell}</td>
        <td class="px-4 py-2 text-sm">${fmt(tgt)}</td>
        <td class="px-4 py-2 text-sm">${fmt(done)}</td>
        <td class="px-4 py-2 text-sm">${fmt(rem)}</td>
        <td class="px-4 py-2 text-sm text-right">
          <button class="px-2 py-1 rounded border text-xs" data-ovr="${weekMon.toISOString().slice(0,10)}" data-target="${tgt}" data-has-ovr="${ovrQty != null ? 1 : 0}">Edit target</button>
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
      openOverrideModal(client.id, b.dataset.ovr, b.dataset.target, b.dataset.hasOvr === '1');
    };
  }

  const skipBtn = document.getElementById('skipWeekBtn');
  if (skipBtn) skipBtn.onclick = () => openSkipWeekModal(client);

  const logLabel = client?.acronym || client?.name || 'Client';
  const logBtn = document.getElementById('clientLogBtn'); if (logBtn) logBtn.onclick = () => openLogModal(id, logLabel);
  const delBtn = document.getElementById('clientDeleteBtn'); if (delBtn) delBtn.onclick = async () => { await handleDelete(id, client?.name || 'this client'); location.href = './clients.html'; };
  const editBtn = document.getElementById('clientEditBtn'); if (editBtn) editBtn.onclick = () => openClientModalById(id);

  // Consolidated "Change status" control: one dropdown offering only the valid
  // transitions for the current status. Every item routes through the exact
  // same flows as the old per-status buttons (pause-reason modal, confirm
  // modals, setClientStatus dual-write) — presentation consolidation only.
  const statusActions = document.getElementById('statusActions');
  if (statusActions) {
    const markAwaitingOrActive = async () => {
      const awaiting = sv === 'awaiting_patients';
      const newStatus = awaiting ? 'active' : 'awaiting_patients';
      const ok = await confirmDialog(awaiting ? {
        title: 'Mark Client Active',
        message: `Mark <span class="font-semibold">${client?.name || 'this client'}</span> as Active? They will count toward weekly targets again.`,
        confirmLabel: 'Mark Active', confirmClass: 'bg-green-600 hover:bg-green-700'
      } : {
        title: 'Mark Awaiting Patients',
        message: `Mark <span class="font-semibold">${client?.name || 'this client'}</span> as Awaiting Patients? All received patients are processed; the client stops counting toward weekly targets until the next roster arrives.`,
        confirmLabel: 'Mark Awaiting Patients', confirmClass: 'bg-blue-600 hover:bg-blue-700'
      });
      if (!ok) return;
      const { error } = await setClientStatus(id, newStatus);
      if (error) { console.error(error); return toast.error('Failed to update client status.'); }
      toast.success(awaiting ? 'Client marked Active' : 'Client marked Awaiting Patients');
      loadClientDetail();
    };

    const transitions = [];
    if (isTerminalStatus(sv)) {
      transitions.push({ label: 'Reactivate', cls: 'text-green-600', run: () => requestStatusChange(id, 'active', client?.name) });
    } else {
      if (isPausedStatus(sv)) {
        transitions.push({ label: 'Resume', cls: 'text-green-600', run: async () => {
          if (!confirm('Are you sure you want to resume this client?')) return;
          await togglePauseClient(id, false);
          await loadClientDetail();
        } });
      } else if (sv !== 'awaiting_patients') {
        // Awaiting-patients clients couldn't pause in the old UI either
        transitions.push({ label: 'Pause…', cls: 'text-amber-600', run: () => openPauseModal(id) });
      }
      transitions.push(sv === 'awaiting_patients'
        ? { label: 'Mark Active', cls: 'text-green-600', run: markAwaitingOrActive }
        : { label: 'Mark Awaiting Patients', cls: 'text-blue-600', run: markAwaitingOrActive });
      transitions.push({ label: 'Mark Term', cls: 'text-red-600', run: () => requestStatusChange(id, 'term', client?.name) });
      transitions.push({ label: 'Contract Complete', cls: 'text-teal-700', run: () => requestStatusChange(id, 'contract_complete', client?.name) });
    }

    statusActions.innerHTML = `
      <button id="statusMenuBtn" class="px-3 py-2 rounded border text-gray-700 hover:bg-gray-50">Change status ▾</button>
      <div id="statusMenu" class="hidden absolute left-0 top-full mt-1 w-56 bg-white border rounded-lg shadow-lg z-10">
        ${transitions.map((t, i) => `<button class="w-full text-left px-3 py-2 text-sm ${t.cls} hover:bg-gray-100" data-transition="${i}">${t.label}</button>`).join('')}
      </div>`;
    const menuBtn = document.getElementById('statusMenuBtn');
    const menu = document.getElementById('statusMenu');
    menuBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    menu.onclick = (e) => {
      const b = e.target.closest('button[data-transition]');
      if (!b) return;
      menu.classList.add('hidden');
      withBusy(menuBtn, () => transitions[Number(b.dataset.transition)].run());
    };
    if (!window.__statusMenuCloserWired) {
      window.__statusMenuCloserWired = true;
      document.addEventListener('click', () => document.getElementById('statusMenu')?.classList.add('hidden'));
    }
  }
}

/* ===== Override modal ===== */
const ovrModal = document.getElementById('overrideModal');
const ovrForm = document.getElementById('ovrForm');
const ovrCancel = document.getElementById('ovrCancel');
const ovrClose = document.getElementById('ovrClose');
const ovrWeekLabel = document.getElementById('ovrWeekLabel');
const ovrRemove = document.getElementById('ovrRemove');

function openOverrideModal(clientId, weekStartISO, currentTarget = '', hasOverride = false) {
  if (!ovrForm) return;
  ovrForm.client_id.value = clientId;
  ovrForm.week_start.value = weekStartISO;
  ovrForm.weekly_qty.value = currentTarget;
  ovrForm.note.value = '';
  if (ovrWeekLabel) ovrWeekLabel.textContent = weekStartISO;
  // "Remove override" only makes sense when an override row exists — it deletes
  // the row so the baseline applies again (this is also how a skip is undone).
  ovrRemove?.classList.toggle('hidden', !hasOverride);
  ovrModal?.classList.remove('hidden');
  ovrModal?.classList.add('flex');
}

ovrRemove?.addEventListener('click', async () => {
  const client_fk = ovrForm.client_id.value;
  const week_start = ovrForm.week_start.value;
  const ok = await confirmDialog({
    title: 'Remove override',
    message: `Remove the override for the week of <span class="font-semibold">${week_start}</span>? The baseline target applies to that week again (this also un-skips a skipped week).`,
    confirmLabel: 'Remove override', confirmClass: 'bg-red-600 hover:bg-red-700'
  });
  if (!ok) return;
  const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');
  const { error } = await supabase.from('weekly_overrides').delete().eq('client_fk', client_fk).eq('week_start', week_start);
  if (error) { console.error(error); return toast.error('Failed to remove override.'); }
  closeOverrideModal();
  toast.success('Override removed — baseline applies again');
  await loadDashboard();
  await loadClientDetail();
});
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

  const [{ data: clients }, { data: wk }, { data: ovr }, comps] = await Promise.all([
    supabase.from('clients').select('id,name,acronym,sales_partner,status,completed,paused,pause_reason,total_lives,reported_lives,first_roster_date,ehr_access').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    fetchAllRows(() => supabase.from('completions').select('client_fk,occurred_on,qty_completed,qty_utc').order('id', { ascending: true }), 'partners completions')
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

async function generatePartnerPDF(partnerName, reportType, selectedClientIds = null, includeStatus = true) {
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

  // Format date as MM/DD/YYYY
  const formatDateMMDDYYYY = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  };

  // Calculate completions and UTCs based on report type
  // Floor all values at zero to prevent negative numbers
  const rows = filteredClients.map(c => {
    const y2025 = Math.max(0, sumCompletedInRange(comps, c.id, start2025, end2025));
    const y2026 = Math.max(0, sumCompletedInRange(comps, c.id, start2026, end2026));
    const lifetime = Math.max(0, sumCompleted(comps, c.id)); // Total lifetime completions
    const status = getClientStatus(c, wk);
    const utcs = Math.max(0, sumUTCs(comps, c.id));
    return {
      name: c.name,
      reportedLives: Math.max(0, c.reported_lives || 0),
      firstRoster: c.first_roster_date,
      ehrAccess: c.ehr_access || false,
      eligibleLives: Math.max(0, c.total_lives || 0),
      utcs,
      status: STATUS_LABELS[status] || 'Unknown',
      y2025,
      y2026,
      total: y2025 + y2026,
      lifetime
    };
  });

  // Sort by appropriate column based on report type
  if (reportType === '2025') {
    rows.sort((a, b) => b.y2025 - a.y2025);
  } else if (reportType === '2026ytd') {
    rows.sort((a, b) => b.y2026 - a.y2026);
  } else if (reportType === 'total') {
    rows.sort((a, b) => b.lifetime - a.lifetime);
  } else {
    rows.sort((a, b) => b.total - a.total);
  }

  // Calculate totals row
  const totalReportedLives = rows.reduce((sum, r) => sum + r.reportedLives, 0);
  const totalEligibleLives = rows.reduce((sum, r) => sum + r.eligibleLives, 0);
  const totalUTCs = rows.reduce((sum, r) => sum + r.utcs, 0);
  const total2025 = rows.reduce((sum, r) => sum + r.y2025, 0);
  const total2026 = rows.reduce((sum, r) => sum + r.y2026, 0);
  const totalCombined = total2025 + total2026;
  const totalLifetime = rows.reduce((sum, r) => sum + r.lifetime, 0);

  // Create PDF in landscape orientation for more columns
  const doc = new jsPDF('l'); // 'l' for landscape
  const pageWidth = doc.internal.pageSize.getWidth();

  // Brand colors
  const purple = [112, 48, 160]; // #7030a0
  const blue = [54, 86, 184];   // #3656b8
  const cyan = [1, 167, 203];   // #01a7cb

  let yPos = 12;

  // Try to add logo
  const logoDataURL = await loadLogoAsDataURL();
  if (logoDataURL) {
    const logoWidth = 50;
    const logoHeight = 20;
    doc.addImage(logoDataURL, 'PNG', (pageWidth - logoWidth) / 2, yPos, logoWidth, logoHeight);
    yPos += logoHeight + 8;
  }

  // Title
  doc.setFontSize(18);
  doc.setTextColor(purple[0], purple[1], purple[2]);
  doc.text('Partner Completion Report', pageWidth / 2, yPos, { align: 'center' });
  yPos += 10;

  // Partner name
  doc.setFontSize(12);
  doc.setTextColor(blue[0], blue[1], blue[2]);
  doc.text(partnerName, pageWidth / 2, yPos, { align: 'center' });
  yPos += 6;

  // Report date
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  const reportDate = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(`Generated: ${reportDate}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 6;

  // Report type subtitle
  doc.setFontSize(10);
  doc.setTextColor(cyan[0], cyan[1], cyan[2]);
  let reportSubtitle = '';
  if (reportType === '2025') {
    reportSubtitle = '2025 Completions Report';
  } else if (reportType === '2026ytd') {
    reportSubtitle = '2026 Year to Date Report';
  } else if (reportType === 'total') {
    reportSubtitle = 'Total Completions Report';
  } else {
    reportSubtitle = '2025 & 2026 YTD Combined Report';
  }
  doc.text(reportSubtitle, pageWidth / 2, yPos, { align: 'center' });
  yPos += 10;

  // Build table columns: Client Name, Reported Lives, First Roster, EHR Access, Eligible Lives to Date, UTCs, [year columns]
  const head = [['Client Name', 'Reported Lives', 'First Roster', 'EHR Access', 'Eligible Lives to Date', 'UTCs']];
  if (includeStatus) head[0].push('Status');
  if (reportType === '2025') {
    head[0].push('2025 Complete');
  } else if (reportType === '2026ytd') {
    head[0].push('2026 YTD');
  } else if (reportType === 'total') {
    head[0].push('Total Complete');
  } else {
    head[0].push('2025 Complete', '2026 YTD', 'Total Complete');
  }

  // Column indices for styling
  const statusColIndex = includeStatus ? 6 : -1;
  const numericColStart = includeStatus ? 7 : 6;

  const body = rows.map(r => {
    const row = [
      r.name,
      r.reportedLives > 0 ? fmt(r.reportedLives) : '—',
      formatDateMMDDYYYY(r.firstRoster),
      r.ehrAccess ? 'Yes' : 'No',
      fmt(r.eligibleLives),
      fmt(r.utcs)
    ];
    if (includeStatus) row.push(r.status);
    if (reportType === '2025') {
      row.push(fmt(r.y2025));
    } else if (reportType === '2026ytd') {
      row.push(fmt(r.y2026));
    } else if (reportType === 'total') {
      row.push(fmt(r.lifetime));
    } else {
      row.push(fmt(r.y2025), fmt(r.y2026), fmt(r.total));
    }
    return row;
  });

  // Add totals row
  const totalsRow = [
    'TOTAL',
    fmt(totalReportedLives),
    '', // No total for First Roster
    '', // No total for EHR Access
    fmt(totalEligibleLives),
    fmt(totalUTCs)
  ];
  if (includeStatus) totalsRow.push('');
  if (reportType === '2025') {
    totalsRow.push(fmt(total2025));
  } else if (reportType === '2026ytd') {
    totalsRow.push(fmt(total2026));
  } else if (reportType === 'total') {
    totalsRow.push(fmt(totalLifetime));
  } else {
    totalsRow.push(fmt(total2025), fmt(total2026), fmt(totalCombined));
  }
  body.push(totalsRow);

  // Draw table with smaller font to fit all columns
  doc.autoTable({
    startY: yPos,
    head: head,
    body: body,
    theme: 'striped',
    styles: {
      fontSize: 8,
      cellPadding: 2
    },
    headStyles: {
      fillColor: purple,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
      fontSize: 8
    },
    bodyStyles: {
      textColor: [50, 50, 50]
    },
    alternateRowStyles: {
      fillColor: [245, 245, 250]
    },
    columnStyles: {
      0: { cellWidth: 'auto' },  // Client Name - auto width
      1: { cellWidth: 22, halign: 'right' }, // Reported Lives
      2: { cellWidth: 24 }, // First Roster
      3: { cellWidth: 18, halign: 'center' }, // EHR Access
      4: { cellWidth: 28, halign: 'right' }, // Eligible Lives to Date
      5: { cellWidth: 16, halign: 'right' }  // UTCs
    },
    didParseCell: function(data) {
      // Style the totals row
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [230, 230, 240];
      }
      // Right-align numeric completion columns
      if (data.column.index >= numericColStart) {
        data.cell.styles.halign = 'right';
      }
      // Color code and center the status column (if included)
      if (statusColIndex >= 0 && data.column.index === statusColIndex && data.row.index < body.length - 1 && data.section === 'body') {
        data.cell.styles.halign = 'center';
        data.cell.styles.fontStyle = 'bold';
        const statusText = String(data.cell.raw || '');
        if (statusText === 'Active') {
          data.cell.styles.textColor = [21, 128, 61]; // green-700
        } else if (statusText.startsWith('Paused')) {
          data.cell.styles.textColor = [180, 83, 9]; // amber-700
        } else if (statusText === 'Awaiting Patients') {
          data.cell.styles.textColor = [29, 78, 216]; // blue-700
        } else if (statusText === 'Term') {
          data.cell.styles.textColor = [185, 28, 28]; // red-700
        } else if (statusText === 'Contract Complete') {
          data.cell.styles.textColor = [15, 118, 110]; // teal-700
        } else {
          data.cell.styles.textColor = [75, 85, 99]; // gray-600
        }
      }
    },
    margin: { left: 14, right: 14 }
  });

  // Column Definitions legend
  let legendY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(8);
  doc.setTextColor(purple[0], purple[1], purple[2]);
  doc.text('Column Definitions:', 14, legendY);
  legendY += 5;

  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  const definitions = [
    ['Reported Lives', 'Total patient population reported by the client'],
    ['First Roster', 'Date MedSync received the first patient roster'],
    ['EHR Access', 'Whether MedSync has access to the client\'s EHR system'],
    ['Eligible Lives to Date', 'Cumulative number of patients eligible for RECAP processing received to date'],
    ['UTCs', 'Unable to Complete - patients where records could not be retrieved']
  ];

  // Add status definitions if status column is included (canonical operations wording)
  if (includeStatus) {
    definitions.push(
      ['Status: Active', STATUS_DEFINITIONS.active],
      ['Status: Awaiting Patients', STATUS_DEFINITIONS.awaiting_patients],
      ['Status: Paused (Client / MedSync)', 'RECAP processing is temporarily on hold; the label shows who initiated the pause'],
      ['Status: Term', STATUS_DEFINITIONS.term],
      ['Status: Contract Complete', STATUS_DEFINITIONS.contract_complete],
      ['Status: Not Started', STATUS_DEFINITIONS.not_started]
    );
  }

  // Add report-type specific definitions
  if (reportType === '2025') {
    definitions.push(['2025 Complete', 'RECAPs completed in calendar year 2025']);
  } else if (reportType === '2026ytd') {
    definitions.push(['2026 YTD', 'RECAPs completed in 2026 year-to-date']);
  } else if (reportType === 'total') {
    definitions.push(['Total Complete', 'Sum of all RECAP completions']);
  } else {
    definitions.push(['2025 Complete', 'RECAPs completed in calendar year 2025']);
    definitions.push(['2026 YTD', 'RECAPs completed in 2026 year-to-date']);
    definitions.push(['Total Complete', 'Sum of all RECAP completions']);
  }

  // Render definitions in two columns
  const colWidth = (pageWidth - 28) / 2;
  const leftDefs = definitions.slice(0, Math.ceil(definitions.length / 2));
  const rightDefs = definitions.slice(Math.ceil(definitions.length / 2));

  leftDefs.forEach((def, i) => {
    doc.setFont(undefined, 'bold');
    doc.text(`${def[0]}: `, 14, legendY + (i * 4));
    const boldWidth = doc.getTextWidth(`${def[0]}: `);
    doc.setFont(undefined, 'normal');
    doc.text(def[1], 14 + boldWidth, legendY + (i * 4));
  });

  rightDefs.forEach((def, i) => {
    doc.setFont(undefined, 'bold');
    doc.text(`${def[0]}: `, 14 + colWidth, legendY + (i * 4));
    const boldWidth = doc.getTextWidth(`${def[0]}: `);
    doc.setFont(undefined, 'normal');
    doc.text(def[1], 14 + colWidth + boldWidth, legendY + (i * 4));
  });

  const maxRows = Math.max(leftDefs.length, rightDefs.length);
  legendY += maxRows * 4 + 8;

  // Disclaimer at bottom
  doc.setFontSize(7);
  doc.setTextColor(128, 128, 128);
  const disclaimer = 'RECAP completions reported here do not indicate that services have been billed or that revenue has been received. This report is for informational purposes only.';
  const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 28);
  doc.text(disclaimerLines, pageWidth / 2, legendY, { align: 'center' });

  // Save the PDF
  const filename = `${partnerName.replace(/[^a-z0-9]/gi, '_')}_completion_report_${ymdEST(today)}.pdf`;
  doc.save(filename);
  toast.success('PDF report downloaded');
}

async function generatePartnerSpreadsheet(partnerName, reportType, selectedClientIds = null, includeStatus = true) {
  if (!window.ExcelJS) { toast.error('Spreadsheet library not loaded. Please refresh.'); return; }

  const data = window.__partnersData;
  if (!data) { toast.error('Data not loaded. Please refresh the page.'); return; }

  const { clients, comps, wk } = data;

  // Filter clients for this partner
  let filteredClients = (clients || []).filter(c => c.sales_partner === partnerName);
  if (selectedClientIds && selectedClientIds.length > 0) {
    const selectedSet = new Set(selectedClientIds);
    filteredClients = filteredClients.filter(c => selectedSet.has(c.id));
  }
  if (!filteredClients.length) {
    toast.warning('No clients selected for this report.');
    return;
  }

  // Date ranges
  const today = todayEST();
  const todayYMD = ymdEST(today);
  const start2025 = '2025-01-01';
  const end2025 = '2025-12-31';
  const start2026 = '2026-01-01';
  const end2026 = todayYMD;

  const formatDateMMDDYYYY = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  };

  // Build row data (same logic as PDF)
  const rows = filteredClients.map(c => {
    const y2025 = Math.max(0, sumCompletedInRange(comps, c.id, start2025, end2025));
    const y2026 = Math.max(0, sumCompletedInRange(comps, c.id, start2026, end2026));
    const lifetime = Math.max(0, sumCompleted(comps, c.id));
    const status = getClientStatus(c, wk);
    const utcs = Math.max(0, sumUTCs(comps, c.id));
    return {
      name: c.name,
      reportedLives: Math.max(0, c.reported_lives || 0),
      firstRoster: c.first_roster_date,
      ehrAccess: c.ehr_access || false,
      eligibleLives: Math.max(0, c.total_lives || 0),
      utcs,
      status: STATUS_LABELS[status] || 'Unknown',
      y2025, y2026,
      total: y2025 + y2026,
      lifetime
    };
  });

  // Sort
  if (reportType === '2025') rows.sort((a, b) => b.y2025 - a.y2025);
  else if (reportType === '2026ytd') rows.sort((a, b) => b.y2026 - a.y2026);
  else if (reportType === 'total') rows.sort((a, b) => b.lifetime - a.lifetime);
  else rows.sort((a, b) => b.total - a.total);

  // Report subtitle
  let reportSubtitle = '';
  if (reportType === '2025') reportSubtitle = '2025 Completions Report';
  else if (reportType === '2026ytd') reportSubtitle = '2026 Year to Date Report';
  else if (reportType === 'total') reportSubtitle = 'Total Completions Report';
  else reportSubtitle = '2025 & 2026 YTD Combined Report';

  const reportDate = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Brand colors
  const purple = 'FF7030A0';
  const blue = 'FF3656B8';
  const cyan = 'FF01A7CB';
  const white = 'FFFFFFFF';
  const lightPurple = 'FFF5F5FA';
  const totalsGray = 'FFE6E6F0';
  const gray = 'FF646464';

  // Build column headers
  const headers = ['Client Name', 'Reported Lives', 'First Roster', 'EHR Access', 'Eligible Lives to Date', 'UTCs'];
  if (includeStatus) headers.push('Status');
  if (reportType === '2025') headers.push('2025 Complete');
  else if (reportType === '2026ytd') headers.push('2026 YTD');
  else if (reportType === 'total') headers.push('Total Complete');
  else headers.push('2025 Complete', '2026 YTD', 'Total Complete');

  const colCount = headers.length;
  const statusColIndex = includeStatus ? 7 : -1;

  // Create workbook and worksheet
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Partner Report');

  // Column widths
  const colWidths = [32, 16, 16, 14, 22, 10];
  if (includeStatus) colWidths.push(18);
  if (reportType === 'combined') colWidths.push(16, 14, 16);
  else colWidths.push(16);
  ws.columns = colWidths.map(w => ({ width: w }));

  // --- Branding header rows ---
  const lastColLetter = String.fromCharCode(64 + colCount);

  // Row 1: Title
  ws.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = 'Partner Completion Report';
  titleCell.font = { size: 16, bold: true, color: { argb: purple } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // Row 2: Partner name
  ws.mergeCells(`A2:${lastColLetter}2`);
  const partnerCell = ws.getCell('A2');
  partnerCell.value = partnerName;
  partnerCell.font = { size: 13, bold: true, color: { argb: blue } };
  partnerCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 22;

  // Row 3: Report date
  ws.mergeCells(`A3:${lastColLetter}3`);
  const dateCell = ws.getCell('A3');
  dateCell.value = `Generated: ${reportDate}`;
  dateCell.font = { size: 9, color: { argb: gray } };
  dateCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 4: Subtitle
  ws.mergeCells(`A4:${lastColLetter}4`);
  const subtitleCell = ws.getCell('A4');
  subtitleCell.value = reportSubtitle;
  subtitleCell.font = { size: 11, bold: true, color: { argb: cyan } };
  subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(4).height = 20;

  // Row 5: blank spacer
  ws.getRow(5).height = 8;

  // --- Row 6: Column headers ---
  const headerRow = ws.getRow(6);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: white }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: purple } };
    cell.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: purple } }
    };
  });
  headerRow.height = 22;

  // --- Data rows ---
  const dataStartRow = 7;
  rows.forEach((r, idx) => {
    const rowData = [
      r.name,
      r.reportedLives || '',
      formatDateMMDDYYYY(r.firstRoster),
      r.ehrAccess ? 'Yes' : 'No',
      r.eligibleLives,
      r.utcs
    ];
    if (includeStatus) rowData.push(r.status);
    if (reportType === '2025') rowData.push(r.y2025);
    else if (reportType === '2026ytd') rowData.push(r.y2026);
    else if (reportType === 'total') rowData.push(r.lifetime);
    else rowData.push(r.y2025, r.y2026, r.total);

    const excelRow = ws.getRow(dataStartRow + idx);
    rowData.forEach((val, ci) => {
      const cell = excelRow.getCell(ci + 1);
      cell.value = val;
      cell.font = { size: 10, color: { argb: 'FF323232' } };
      cell.alignment = { horizontal: ci === 0 ? 'left' : (ci === 3 ? 'center' : 'right'), vertical: 'middle' };

      // Alternating row fill
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightPurple } };
      }

      // Status column color coding
      if (includeStatus && ci + 1 === statusColIndex) {
        const label = String(val || '');
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { size: 10, bold: true, color: { argb:
          label === 'Active' ? 'FF15803D' :
          label.startsWith('Paused') ? 'FFB45309' :
          label === 'Awaiting Patients' ? 'FF1D4ED8' :
          label === 'Term' ? 'FFB91C1C' :
          label === 'Contract Complete' ? 'FF0F766E' : 'FF4B5563'
        }};
      }
    });
  });

  // --- Totals row ---
  const totalsRowNum = dataStartRow + rows.length;
  const totalReportedLives = rows.reduce((sum, r) => sum + r.reportedLives, 0);
  const totalEligibleLives = rows.reduce((sum, r) => sum + r.eligibleLives, 0);
  const totalUTCs = rows.reduce((sum, r) => sum + r.utcs, 0);
  const totalsData = ['TOTAL', totalReportedLives, '', '', totalEligibleLives, totalUTCs];
  if (includeStatus) totalsData.push('');
  if (reportType === '2025') totalsData.push(rows.reduce((s, r) => s + r.y2025, 0));
  else if (reportType === '2026ytd') totalsData.push(rows.reduce((s, r) => s + r.y2026, 0));
  else if (reportType === 'total') totalsData.push(rows.reduce((s, r) => s + r.lifetime, 0));
  else {
    const t2025 = rows.reduce((s, r) => s + r.y2025, 0);
    const t2026 = rows.reduce((s, r) => s + r.y2026, 0);
    totalsData.push(t2025, t2026, t2025 + t2026);
  }

  const excelTotalsRow = ws.getRow(totalsRowNum);
  totalsData.forEach((val, ci) => {
    const cell = excelTotalsRow.getCell(ci + 1);
    cell.value = val;
    cell.font = { size: 10, bold: true, color: { argb: 'FF323232' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: totalsGray } };
    cell.alignment = { horizontal: ci === 0 ? 'left' : 'right', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: purple } },
      bottom: { style: 'thin', color: { argb: purple } }
    };
  });

  // --- Legend section ---
  let legendRow = totalsRowNum + 2;
  const legendTitleCell = ws.getCell(`A${legendRow}`);
  legendTitleCell.value = 'Column Definitions';
  legendTitleCell.font = { size: 10, bold: true, color: { argb: purple } };
  legendRow++;

  const definitions = [
    ['Reported Lives', 'Total patient population reported by the client'],
    ['First Roster', 'Date MedSync received the first patient roster'],
    ['EHR Access', "Whether MedSync has access to the client's EHR system"],
    ['Eligible Lives to Date', 'Cumulative number of patients eligible for RECAP processing received to date'],
    ['UTCs', 'Unable to Complete - patients where records could not be retrieved']
  ];
  if (includeStatus) {
    definitions.push(
      ['Status: Active', STATUS_DEFINITIONS.active],
      ['Status: Awaiting Patients', STATUS_DEFINITIONS.awaiting_patients],
      ['Status: Paused (Client / MedSync)', 'RECAP processing is temporarily on hold; the label shows who initiated the pause'],
      ['Status: Term', STATUS_DEFINITIONS.term],
      ['Status: Contract Complete', STATUS_DEFINITIONS.contract_complete],
      ['Status: Not Started', STATUS_DEFINITIONS.not_started]
    );
  }
  if (reportType === '2025') definitions.push(['2025 Complete', 'RECAPs completed in calendar year 2025']);
  else if (reportType === '2026ytd') definitions.push(['2026 YTD', 'RECAPs completed in 2026 year-to-date']);
  else if (reportType === 'total') definitions.push(['Total Complete', 'Sum of all RECAP completions']);
  else {
    definitions.push(['2025 Complete', 'RECAPs completed in calendar year 2025']);
    definitions.push(['2026 YTD', 'RECAPs completed in 2026 year-to-date']);
    definitions.push(['Total Complete', 'Sum of all RECAP completions']);
  }

  definitions.forEach(d => {
    const termCell = ws.getCell(`A${legendRow}`);
    termCell.value = d[0];
    termCell.font = { size: 9, bold: true, color: { argb: 'FF323232' } };
    const defCell = ws.getCell(`B${legendRow}`);
    defCell.value = d[1];
    defCell.font = { size: 9, color: { argb: gray } };
    // Merge definition across remaining columns so long text is visible
    if (colCount > 2) ws.mergeCells(`B${legendRow}:${lastColLetter}${legendRow}`);
    legendRow++;
  });

  // Disclaimer
  legendRow++;
  ws.mergeCells(`A${legendRow}:${lastColLetter}${legendRow}`);
  const disclaimerCell = ws.getCell(`A${legendRow}`);
  disclaimerCell.value = 'RECAP completions reported here do not indicate that services have been billed or that revenue has been received. This report is for informational purposes only.';
  disclaimerCell.font = { size: 8, italic: true, color: { argb: 'FF808080' } };
  disclaimerCell.alignment = { horizontal: 'center', wrapText: true };
  ws.getRow(legendRow).height = 30;

  // --- Write file ---
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${partnerName.replace(/[^a-z0-9]/gi, '_')}_completion_report_${ymdEST(today)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Spreadsheet downloaded');
}

/* ===== Client status model =====
   clients.status is the source of truth:
     active | paused_client | paused_medsync | awaiting_patients | term | contract_complete
   "not_started" is derived (active with no active commitment) and never stored.
   The legacy booleans (completed / paused / pause_reason) are dual-written on every
   status change because the COO Dashboard CRM sync reads them by column name —
   never write one without the other. */

const STATUS_LABELS = {
  active: 'Active',
  paused_client: 'Paused (Client)',
  paused_medsync: 'Paused (MedSync)',
  awaiting_patients: 'Awaiting Patients',
  term: 'Term',
  contract_complete: 'Contract Complete',
  not_started: 'Not Started'
};

// Canonical status definitions (operations wording, Braelee 2026-07-01).
// Used for in-app tooltips/legends AND the PDF/XLSX report legends.
const STATUS_DEFINITIONS = {
  active: 'Client is currently in production with ongoing RECAP processing',
  paused_client: 'RECAP processing temporarily on hold at the client’s request',
  paused_medsync: 'RECAP processing temporarily on hold by MedSync',
  awaiting_patients: 'Completed current roster and waiting on the next',
  term: 'Contract terminated due to issue',
  contract_complete: 'Contract services executed and completed',
  not_started: 'Client is signed and in onboarding; RECAP processing has not yet begun'
};

const isPausedStatus = (s) => s === 'paused_client' || s === 'paused_medsync';
const isTerminalStatus = (s) => s === 'term' || s === 'contract_complete';

// Stored status, with legacy-boolean fallback for rows that predate the status column.
function clientStatusValue(client) {
  if (client.status) return client.status;
  console.warn(`Client ${client.name || client.id} has no status value; deriving from legacy booleans.`);
  if (client.paused) return client.pause_reason === 'medsync' ? 'paused_medsync' : 'paused_client';
  if (client.completed) return 'awaiting_patients';
  return 'active';
}

// Legacy boolean columns that must accompany each status (external CRM sync reads these).
function legacyFieldsFor(status) {
  switch (status) {
    case 'paused_client':     return { paused: true,  pause_reason: 'client',  completed: false };
    case 'paused_medsync':    return { paused: true,  pause_reason: 'medsync', completed: false };
    case 'awaiting_patients': return { paused: false, pause_reason: null,      completed: true };
    case 'term':
    case 'contract_complete': return { paused: false, pause_reason: null,      completed: true };
    default:                  return { paused: false, pause_reason: null,      completed: false }; // active
  }
}

// The single write path for client status: status + legacy booleans together.
async function setClientStatus(clientId, status) {
  const supabase = await getSupabase();
  if (!supabase) return { error: new Error('Supabase not configured') };
  return supabase.from('clients').update({ status, ...legacyFieldsFor(status) }).eq('id', clientId);
}

function getClientStatus(client, wk) {
  const status = clientStatusValue(client);
  if (status === 'active') {
    // An active client with no active commitment hasn't started yet
    const hasCommitment = (wk || []).some(w => w.client_fk === client.id && w.active);
    if (!hasCommitment) return 'not_started';
  }
  return status;
}

/* ===== Skip week (Build 6) =====
   A skipped week is a normal weekly_overrides row with qty 0 — target math is
   untouched, the 0 simply flows through baseTargetFor(). Renders as a
   "Skipped" badge instead of a bare 0. The baseline resumes automatically the
   following week because overrides are single-week by design. Carry-in owed
   from the week BEFORE the skip still applies during the skipped week (a skip
   zeroes the week's new target; it does not erase what was already owed).
   Undo = "Remove override" in the Edit-target modal. */

function skippedBadgeHTML(note = '') {
  const title = note || 'Week skipped — target overridden to 0. Baseline resumes next week.';
  return `<span class="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-medium whitespace-nowrap" title="${title}">Skipped</span>`;
}

// Upsert a 0-qty override for one week for the given clients.
// UNIQUE (client_fk, week_start) makes the upsert safe to re-run.
async function skipWeekForClients(clientIds, weekStartYMD, reason) {
  const supabase = await getSupabase();
  if (!supabase) { toast.error('Supabase not configured.'); return false; }
  const note = reason ? `Skipped: ${reason}` : 'Skipped';
  const rows = clientIds.map(id => ({ client_fk: id, week_start: weekStartYMD, weekly_qty: 0, note }));
  const { error } = await supabase.from('weekly_overrides').upsert(rows, { onConflict: 'client_fk,week_start' });
  if (error) { console.error(error); toast.error(`Failed to skip week: ${error.message}`); return false; }
  return true;
}

function openSkipWeekModal(client) {
  const mon = mondayOf(todayEST());
  const nextMon = addDays(mon, 7);
  const ymd = (d) => d.toISOString().slice(0, 10);

  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
  wrap.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-md">
      <div class="p-5 border-b">
        <h3 class="text-lg font-semibold">Skip a week — ${client.name}</h3>
        <p class="text-xs text-gray-500 mt-1">For holidays or client-requested skips. Different from Pause: a skip covers exactly one week and the baseline resumes automatically.</p>
      </div>
      <div class="p-5 space-y-4">
        <div class="space-y-2">
          <label class="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" name="skipWeek" value="${ymd(mon)}" checked class="text-amber-600 focus:ring-amber-500" />
            <span class="text-sm">This week <span class="text-gray-500">(week of ${shortDate(mon)})</span></span>
          </label>
          <label class="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" name="skipWeek" value="${ymd(nextMon)}" class="text-amber-600 focus:ring-amber-500" />
            <span class="text-sm">Next week <span class="text-gray-500">(week of ${shortDate(nextMon)})</span></span>
          </label>
        </div>
        <div>
          <label class="block text-sm mb-1">Reason (optional)</label>
          <input name="skipReason" type="text" placeholder="e.g., July 4th holiday" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <label class="flex items-start gap-3 p-3 border border-amber-200 bg-amber-50/50 rounded-lg cursor-pointer">
          <input type="checkbox" name="skipAll" class="mt-0.5 rounded text-amber-600 focus:ring-amber-500" />
          <span class="text-sm">Apply to <b>all active clients</b> (holiday skip) — you'll confirm the exact count next.</span>
        </label>
        <div class="bg-gray-50 border rounded-lg p-3 text-xs text-gray-600 space-y-1">
          <p>• The skipped week's target becomes <b>0</b> and shows a <b>Skipped</b> badge.</p>
          <p>• Carry-in already owed from the prior week <b>still applies during the skipped week</b> — a skip does not erase what was owed.</p>
          <p>• The baseline resumes automatically the following week; nothing to un-skip.</p>
          <p>• Undo: Weekly Targets → Edit target → Remove override.</p>
        </div>
      </div>
      <div class="p-5 border-t flex justify-end gap-2">
        <button type="button" data-cancel class="px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
        <button type="button" data-save class="px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700">Skip week</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-cancel]').onclick = close;
  wrap.querySelector('[data-save]').onclick = async () => {
    const saveBtn = wrap.querySelector('[data-save]');
    await withBusy(saveBtn, async () => {
      const weekYMD = wrap.querySelector('input[name="skipWeek"]:checked')?.value;
      const reason = wrap.querySelector('input[name="skipReason"]')?.value?.trim() || null;
      const applyAll = wrap.querySelector('input[name="skipAll"]')?.checked;
      if (!weekYMD) return;

      let ids = [client.id];
      if (applyAll) {
        const supabase = await getSupabase(); if (!supabase) return toast.error('Supabase not configured.');
        const { data: actives, error } = await supabase.from('clients').select('id').eq('status', 'active');
        if (error) { console.error(error); return toast.error('Failed to load active clients.'); }
        ids = (actives || []).map(r => r.id);
        const ok = await confirmDialog({
          title: 'Skip week for ALL active clients',
          message: `Set the week of <span class="font-semibold">${weekYMD}</span> to a 0 target for <span class="font-semibold">${ids.length} active clients</span>? Paused, awaiting, term, and contract-complete clients are not touched.`,
          confirmLabel: `Skip for ${ids.length} clients`, confirmClass: 'bg-amber-600 hover:bg-amber-700'
        });
        if (!ok) return;
      }

      const done = await skipWeekForClients(ids, weekYMD, reason);
      if (!done) return;
      close();
      toast.success(applyAll
        ? `Week of ${weekYMD} skipped for ${ids.length} active clients`
        : `Week of ${weekYMD} skipped for ${client.name}`);
      await loadDashboard();
      await loadClientDetail();
    });
  };
}

function getStatusBadgeHTML(status) {
  const styles = {
    active: 'bg-green-100 text-green-700',
    paused_client: 'bg-amber-100 text-amber-700',
    paused_medsync: 'bg-amber-100 text-amber-700',
    awaiting_patients: 'bg-blue-100 text-blue-700',
    term: 'bg-red-100 text-red-800',
    contract_complete: 'bg-teal-100 text-teal-800',
    not_started: 'bg-gray-100 text-gray-600'
  };
  return `<span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${styles[status] || styles.not_started}" title="${STATUS_DEFINITIONS[status] || ''}">${STATUS_LABELS[status] || 'Unknown'}</span>`;
}

// Lightweight promise-based confirm modal (shared by clients list and client detail).
// Pass requireText to demand the user type an exact string (e.g. the client name)
// before the confirm button enables — used for destructive actions.
function confirmDialog({ title, message, confirmLabel = 'Confirm', confirmClass = 'bg-gray-900 hover:bg-gray-800', requireText = null }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
    const requireHTML = requireText ? `
      <div class="px-5 pb-5">
        <input data-require type="text" placeholder="${requireText}" autocomplete="off"
               class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
      </div>` : '';
    wrap.innerHTML = `
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div class="p-5 border-b"><h3 class="text-lg font-semibold">${title}</h3></div>
        <div class="p-5 text-sm text-gray-600">${message}</div>
        ${requireHTML}
        <div class="p-5 border-t flex justify-end gap-2">
          <button type="button" data-cancel class="px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
          <button type="button" data-confirm class="px-4 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed ${confirmClass}" ${requireText ? 'disabled' : ''}>${confirmLabel}</button>
        </div>
      </div>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
    wrap.querySelector('[data-cancel]').onclick = () => done(false);
    const confirmBtn = wrap.querySelector('[data-confirm]');
    confirmBtn.onclick = () => { if (!confirmBtn.disabled) done(true); };
    if (requireText) {
      wrap.querySelector('[data-require]').addEventListener('input', (e) => {
        confirmBtn.disabled = e.target.value.trim() !== requireText;
      });
    }
    document.body.appendChild(wrap);
  });
}

// Disable a control (busy style) while its async action runs, so a double-click
// can't fire the same mutation twice before the refetch re-renders the page.
async function withBusy(btn, fn) {
  if (!btn) return fn();
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.classList.add('opacity-50', 'cursor-wait');
  try {
    return await fn();
  } finally {
    delete btn.dataset.busy;
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-wait');
  }
}

// Confirm-then-apply for the Term / Contract Complete / Reactivate actions.
async function requestStatusChange(clientId, status, clientName) {
  const name = clientName || 'this client';
  const prompts = {
    term: {
      title: 'Mark Client as Term',
      message: `Mark <span class="font-semibold">${name}</span> as terminated? They will stop counting toward weekly targets but remain visible on reports.`,
      confirmLabel: 'Mark Term', confirmClass: 'bg-red-600 hover:bg-red-700'
    },
    contract_complete: {
      title: 'Mark Contract Complete',
      message: `Mark <span class="font-semibold">${name}</span> as Contract Complete? No more rosters are expected. They will stop counting toward weekly targets but remain visible on reports.`,
      confirmLabel: 'Contract Complete', confirmClass: 'bg-teal-600 hover:bg-teal-700'
    },
    active: {
      title: 'Reactivate Client',
      message: `Reactivate <span class="font-semibold">${name}</span>? They will count toward weekly targets again, starting this week.`,
      confirmLabel: 'Reactivate', confirmClass: 'bg-green-600 hover:bg-green-700'
    }
  };
  const p = prompts[status];
  if (!p || !(await confirmDialog(p))) return false;

  const { error } = await setClientStatus(clientId, status);
  if (error) { console.error(error); toast.error('Failed to update client status.'); return false; }

  // Reactivating a dormant client: move the baseline start to this week so the
  // paused/terminated period doesn't create a huge carry-in (same as Resume).
  if (status === 'active') {
    const supabase = await getSupabase();
    const currentWeekMon = mondayOf(todayEST()).toISOString().slice(0, 10);
    await supabase.from('weekly_commitments')
      .update({ start_week: currentWeekMon })
      .eq('client_fk', clientId)
      .eq('active', true);
  }

  toast.success(`Client marked ${STATUS_LABELS[status]}`);
  await loadClientsList();
  await loadDashboard();
  await loadClientDetail();
  return true;
}

/* ===== Mass-roster rollout plans =====
   After a client's initial test files, the remaining population is delivered
   over N ordinal weeks. Weeks are NOT calendar-anchored: the current week is
   the lowest unconfirmed week_index and advances only when someone confirms
   the prior week complete. Weekly target math is untouched — a plan writes
   the baseline commitment exactly once, at creation. */

function rolloutProgress(plan, weeks) {
  const ws = (weeks || []).filter(w => w.plan_fk === plan.id).sort((a, b) => a.week_index - b.week_index);
  const confirmed = ws.filter(w => w.confirmed).length;
  const current = ws.find(w => !w.confirmed)?.week_index ?? ws.length;
  return { ws, confirmed, current, total: ws.length, remaining: ws.length - confirmed, complete: ws.length > 0 && confirmed === ws.length };
}

function rolloutChipHTML(plan, weeks) {
  const p = rolloutProgress(plan, weeks);
  if (plan.status === 'completed' || p.complete) {
    return `<span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap" title="Mass-roster rollout finished — all ${p.total} weeks confirmed complete">Rollout complete</span>`;
  }
  return `<span class="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 whitespace-nowrap" title="Mass-roster rollout: week ${p.current} of ${p.total}, ${p.remaining} week${p.remaining === 1 ? '' : 's'} remaining. Advances only when a week is confirmed complete — never on a date.">Week ${p.current} of ${p.total}</span>`;
}

// Split the post-test population across weeks: every week gets
// ceil(remaining/weeks); the final week absorbs the rounding difference
// (e.g. 100 pop, 5 test, 3 weeks -> 32 / 32 / 31).
function rolloutWeekQtys(totalPopulation, testFilesQty, weeksPlanned) {
  const remainingPop = Math.max(0, totalPopulation - testFilesQty);
  const weeklyQty = Math.ceil(remainingPop / weeksPlanned);
  const qtys = [];
  for (let i = 1; i <= weeksPlanned; i++) {
    qtys.push(i < weeksPlanned ? weeklyQty : Math.max(0, remainingPop - weeklyQty * (weeksPlanned - 1)));
  }
  return { weeklyQty, qtys, remainingPop };
}

function openRolloutModal(client) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
  wrap.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
      <div class="p-5 border-b">
        <h3 class="text-lg font-semibold">Create Rollout Plan — ${client.name}</h3>
        <p class="text-xs text-gray-500 mt-1">Divides the remaining population over ordinal weeks. Weeks advance only when confirmed complete, never on a date.</p>
      </div>
      <div class="p-5 space-y-3">
        <div>
          <label class="block text-sm mb-1">Total population</label>
          <input name="rp_pop" type="number" step="1" min="1" value="${client.total_lives || ''}" class="w-full border rounded-lg px-3 py-2" />
          <p class="text-xs text-gray-500 mt-1">Pre-filled from Total Lives; edit if the roster differs.</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm mb-1">Test files already sent</label>
            <input name="rp_test" type="number" step="1" min="0" value="5" class="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm mb-1">Weeks planned</label>
            <input name="rp_weeks" type="number" step="1" min="1" value="3" class="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>
        <div>
          <label class="block text-sm mb-1">Note (optional)</label>
          <input name="rp_note" type="text" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm space-y-1">
          <div class="font-medium text-indigo-900">Saving this plan will:</div>
          <ul class="list-disc pl-5 text-indigo-900" data-effects></ul>
        </div>
        <p data-rp-error class="text-sm text-red-600 h-4"></p>
      </div>
      <div class="p-5 border-t flex justify-end gap-2">
        <button type="button" data-cancel class="px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
        <button type="button" data-save class="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Create Plan</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const q = (sel) => wrap.querySelector(sel);
  const readInputs = () => ({
    totalPopulation: Number(q('[name=rp_pop]').value || 0),
    testFilesQty: Number(q('[name=rp_test]').value || 0),
    weeksPlanned: Number(q('[name=rp_weeks]').value || 0),
    note: q('[name=rp_note]').value.trim() || null
  });
  const recompute = () => {
    const { totalPopulation, testFilesQty, weeksPlanned } = readInputs();
    const box = q('[data-effects]');
    if (!(totalPopulation > 0) || !(weeksPlanned >= 1) || testFilesQty < 0 || testFilesQty >= totalPopulation) {
      box.innerHTML = '<li>Enter a population, test files, and weeks to see the plan.</li>';
      return null;
    }
    const { weeklyQty, qtys } = rolloutWeekQtys(totalPopulation, testFilesQty, weeksPlanned);
    box.innerHTML = `
      <li>Create a ${weeksPlanned}-week delivery plan: ${qtys.map(n => fmt(n)).join(' / ')}</li>
      <li>Set the weekly baseline commitment to <b>${fmt(weeklyQty)}/wk</b> starting this week</li>
      <li>Clear the client's <b>Test</b> flag (test week over, rollout starting)</li>`;
    return { weeklyQty, qtys };
  };
  ['rp_pop', 'rp_test', 'rp_weeks'].forEach(n => q(`[name=${n}]`).addEventListener('input', recompute));
  recompute();

  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  q('[data-cancel]').onclick = close;
  q('[data-save]').onclick = async () => {
    const inputs = readInputs();
    const computed = recompute();
    const err = q('[data-rp-error]');
    if (!computed) { err.textContent = 'Check the population, test files, and weeks values.'; return; }
    q('[data-save]').disabled = true;
    const ok = await createRolloutPlan(client.id, inputs, computed);
    if (ok) close(); else q('[data-save]').disabled = false;
  };
}

async function createRolloutPlan(clientId, { totalPopulation, testFilesQty, weeksPlanned, note }, { weeklyQty, qtys }) {
  const supabase = await getSupabase(); if (!supabase) { toast.error('Supabase not configured.'); return false; }

  const { data: plan, error } = await supabase.from('rollout_plans').insert({
    client_fk: clientId,
    total_population: totalPopulation,
    test_files_qty: testFilesQty,
    weeks_planned: weeksPlanned,
    weekly_qty: weeklyQty,
    note
  }).select('id').single();
  if (error) {
    console.error(error);
    toast.error(error.message.includes('rollout_plans_one_active_per_client')
      ? 'This client already has an active rollout plan.'
      : 'Failed to create rollout plan.');
    return false;
  }

  const { error: weeksErr } = await supabase.from('rollout_weeks').insert(
    qtys.map((qty, i) => ({ plan_fk: plan.id, week_index: i + 1, qty }))
  );
  if (weeksErr) { console.error(weeksErr); toast.error('Failed to create rollout weeks.'); return false; }

  // Baseline commitment: same pattern as the client form / Resume —
  // retire the old active row, start a new one this week.
  const currentWeekMon = mondayOf(todayEST()).toISOString().slice(0, 10);
  await supabase.from('weekly_commitments').update({ active: false }).eq('client_fk', clientId).eq('active', true);
  await supabase.from('weekly_commitments').insert({ client_fk: clientId, weekly_qty: weeklyQty, start_week: currentWeekMon, active: true });

  // Test week is over once the mass rollout starts
  await supabase.from('clients').update({ is_test: false }).eq('id', clientId);

  toast.success(`Rollout plan created — ${fmt(weeklyQty)}/wk over ${weeksPlanned} weeks`);
  await loadClientsList();
  await loadDashboard();
  await loadClientDetail();
  return true;
}

async function confirmRolloutWeek(weekId, planId, weekIndex, clientName) {
  const supabase = await getSupabase(); if (!supabase) return;
  const { data: siblings } = await supabase.from('rollout_weeks').select('id,confirmed').eq('plan_fk', planId);
  const unconfirmed = (siblings || []).filter(w => !w.confirmed);
  const isFinal = unconfirmed.length === 1 && unconfirmed[0].id === weekId;

  const ok = await confirmDialog({
    title: `Confirm Week ${weekIndex} Complete`,
    message: isFinal
      ? `Confirm week ${weekIndex} complete for <span class="font-semibold">${clientName}</span>? This is the final week — the rollout will be marked complete. (Client status is not changed; decide separately what the client becomes.)`
      : `Confirm week ${weekIndex} complete for <span class="font-semibold">${clientName}</span>? Week ${weekIndex + 1} becomes the current week.`,
    confirmLabel: `Confirm Week ${weekIndex}`, confirmClass: 'bg-indigo-600 hover:bg-indigo-700'
  });
  if (!ok) return;

  const user = await getCurrentUser();
  const { error } = await supabase.from('rollout_weeks').update({
    confirmed: true,
    confirmed_at: new Date().toISOString(),
    confirmed_by: user?.email || null
  }).eq('id', weekId);
  if (error) { console.error(error); toast.error('Failed to confirm week.'); return; }

  if (isFinal) await supabase.from('rollout_plans').update({ status: 'completed' }).eq('id', planId);

  toast.success(isFinal ? 'Final week confirmed — rollout complete' : `Week ${weekIndex} confirmed`);
  await loadClientsList();
  await loadDashboard();
  await loadClientDetail();
}

async function unconfirmRolloutWeek(weekId, planId, weekIndex, clientName) {
  const ok = await confirmDialog({
    title: `Un-confirm Week ${weekIndex}`,
    message: `Mark week ${weekIndex} for <span class="font-semibold">${clientName}</span> as NOT complete again? The rollout moves back to week ${weekIndex} and its confirmation record is cleared.`,
    confirmLabel: 'Un-confirm', confirmClass: 'bg-amber-600 hover:bg-amber-700'
  });
  if (!ok) return;
  const supabase = await getSupabase(); if (!supabase) return;
  const { error } = await supabase.from('rollout_weeks').update({ confirmed: false, confirmed_at: null, confirmed_by: null }).eq('id', weekId);
  if (error) { console.error(error); toast.error('Failed to un-confirm week.'); return; }
  // A completed plan with a re-opened week is active again
  await supabase.from('rollout_plans').update({ status: 'active' }).eq('id', planId).eq('status', 'completed');
  toast.success(`Week ${weekIndex} un-confirmed`);
  await loadClientsList();
  await loadDashboard();
  await loadClientDetail();
}

async function editRolloutWeekQty(weekId, weekIndex, currentQty) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
  wrap.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-sm">
      <div class="p-5 border-b"><h3 class="text-lg font-semibold">Edit Week ${weekIndex} Quantity</h3></div>
      <div class="p-5">
        <input name="rw_qty" type="number" step="1" min="0" value="${currentQty}" class="w-full border rounded-lg px-3 py-2" />
        <p class="text-xs text-gray-500 mt-1">Adjusts this rollout week's planned quantity. The weekly baseline commitment is unchanged.</p>
      </div>
      <div class="p-5 border-t flex justify-end gap-2">
        <button type="button" data-cancel class="px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
        <button type="button" data-save class="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800">Save</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-cancel]').onclick = close;
  wrap.querySelector('[data-save]').onclick = async () => {
    const qty = Number(wrap.querySelector('[name=rw_qty]').value);
    if (!(qty >= 0)) return;
    const supabase = await getSupabase(); if (!supabase) return;
    const { error } = await supabase.from('rollout_weeks').update({ qty }).eq('id', weekId).eq('confirmed', false);
    if (error) { console.error(error); toast.error('Failed to update week quantity.'); return; }
    close();
    toast.success(`Week ${weekIndex} set to ${fmt(qty)}`);
    await loadClientDetail();
    await loadDashboard();
  };
}

async function cancelRolloutPlan(planId, clientName) {
  const ok = await confirmDialog({
    title: 'Cancel Rollout Plan',
    message: `Cancel the active rollout plan for <span class="font-semibold">${clientName}</span>? The plan and its history are kept, but the Week X of Y tracking stops. The weekly baseline commitment is NOT changed.`,
    confirmLabel: 'Cancel Plan', confirmClass: 'bg-red-600 hover:bg-red-700'
  });
  if (!ok) return;
  const supabase = await getSupabase(); if (!supabase) return;
  const { error } = await supabase.from('rollout_plans').update({ status: 'canceled' }).eq('id', planId);
  if (error) { console.error(error); toast.error('Failed to cancel plan.'); return; }
  toast.success('Rollout plan canceled');
  await loadClientsList();
  await loadDashboard();
  await loadClientDetail();
}

function renderRolloutCard(client, plans, weeks) {
  const el = document.getElementById('rolloutSection');
  if (!el) return;
  const titleHTML = `<h2 class="font-semibold" title="Mass-roster delivery: remaining population divided over ordinal weeks. The current week advances only when confirmed complete — never on a date.">Mass-Roster Rollout</h2>`;
  const active = (plans || []).find(p => p.status === 'active');
  const latest = (plans || [])[0];

  if (!active) {
    const createBtn = `<button id="rolloutCreateBtn" class="px-3 py-2 rounded border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-sm">Create rollout plan</button>`;
    let body;
    if (latest?.status === 'completed') {
      const p = rolloutProgress(latest, weeks);
      body = `<div class="flex items-center justify-between">
        <p class="text-sm text-gray-600"><span class="text-green-700 bg-green-100 px-2 py-0.5 rounded-full text-xs">Rollout complete</span>
        <span class="ml-2">${p.total} weeks delivered (${fmt(latest.total_population - latest.test_files_qty)} after ${fmt(latest.test_files_qty)} test files). Client status is unchanged — set it above when decided.</span></p>
        ${createBtn}</div>`;
    } else {
      const canceledNote = latest?.status === 'canceled' ? `<span class="text-xs text-gray-400 ml-2">(previous plan canceled)</span>` : '';
      body = `<div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">No rollout plan. Small clients can skip this entirely.${canceledNote}</p>
        ${createBtn}</div>`;
    }
    el.innerHTML = `<div class="flex items-center justify-between mb-2">${titleHTML}</div>${body}`;
    document.getElementById('rolloutCreateBtn')?.addEventListener('click', () => openRolloutModal(client));
    return;
  }

  const p = rolloutProgress(active, weeks);
  const rowsHTML = p.ws.map(w => {
    const isCurrent = !w.confirmed && w.week_index === p.current;
    const confirmedCell = w.confirmed
      ? `<span class="text-green-700">✓ ${String(w.confirmed_at).slice(0, 10)}</span> <span class="text-gray-400 text-xs">${w.confirmed_by || ''}</span>
         <button class="ml-2 text-xs text-amber-600 hover:underline" data-unconfirm="${w.id}" data-week="${w.week_index}">un-confirm</button>`
      : isCurrent
        ? `<button class="px-2 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-700" data-confirm-week="${w.id}" data-week="${w.week_index}">Confirm week ${w.week_index} complete</button>`
        : `<span class="text-gray-400 text-xs">pending</span>`;
    const qtyCell = w.confirmed
      ? fmt(w.qty)
      : `${fmt(w.qty)} <button class="text-xs text-indigo-600 hover:underline" data-edit-qty="${w.id}" data-week="${w.week_index}" data-qty="${w.qty}">edit</button>`;
    return `<tr class="${isCurrent ? 'bg-indigo-50/50' : ''}">
      <td class="px-3 py-2 text-sm">Week ${w.week_index}${isCurrent ? ' <span class="text-xs text-indigo-600 font-medium">(current)</span>' : ''}</td>
      <td class="px-3 py-2 text-sm">${qtyCell}</td>
      <td class="px-3 py-2 text-sm">${confirmedCell}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">${titleHTML}${rolloutChipHTML(active, weeks)}</div>
      <button id="rolloutCancelBtn" class="text-xs text-red-600 hover:underline">Cancel plan</button>
    </div>
    <p class="text-xs text-gray-500 mb-2">${fmt(active.total_population)} population − ${fmt(active.test_files_qty)} test files = ${fmt(active.total_population - active.test_files_qty)} over ${active.weeks_planned} weeks · baseline set to ${fmt(active.weekly_qty)}/wk at creation${active.note ? ` · ${active.note}` : ''}</p>
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50"><tr>
        <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600">Week</th>
        <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600">Planned Qty</th>
        <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600">Confirmed</th>
      </tr></thead>
      <tbody class="divide-y divide-gray-100">${rowsHTML}</tbody>
    </table>`;

  const cancelBtn = document.getElementById('rolloutCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => withBusy(cancelBtn, () => cancelRolloutPlan(active.id, client.name)));
  el.onclick = async (e) => {
    const cw = e.target.closest('button[data-confirm-week]');
    if (cw) { await withBusy(cw, () => confirmRolloutWeek(cw.dataset.confirmWeek, active.id, Number(cw.dataset.week), client.name)); return; }
    const uc = e.target.closest('button[data-unconfirm]');
    if (uc) { await withBusy(uc, () => unconfirmRolloutWeek(uc.dataset.unconfirm, active.id, Number(uc.dataset.week), client.name)); return; }
    const eq = e.target.closest('button[data-edit-qty]');
    if (eq) { await editRolloutWeekQty(eq.dataset.editQty, Number(eq.dataset.week), Number(eq.dataset.qty)); return; }
  };
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
      const shouldCheck = !isPausedStatus(status); // Term & Contract Complete stay on reports, so they stay pre-checked
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
      const shouldCheck = !isPausedStatus(status); // Term & Contract Complete stay on reports, so they stay pre-checked
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
  const btnGenerateXLSX = document.getElementById('btnGenerateXLSX');
  const partnerSelect = document.getElementById('reportPartnerSelect');
  const reportTypeSelect = document.getElementById('reportTypeSelect');
  const includeStatusCheckbox = document.getElementById('reportIncludeStatus');
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

    // Build checklist with status badges and edit buttons
    // Pre-check Active and Completed, uncheck Paused
    const html = filteredClients.map(c => {
      const status = getClientStatus(c, wk);
      const shouldCheck = !isPausedStatus(status); // Term & Contract Complete stay on reports, so they stay pre-checked
      return `
        <div class="flex items-center gap-2 text-sm hover:bg-white rounded px-2 py-1">
          <label class="flex items-center gap-2 flex-1 cursor-pointer">
            <input type="checkbox" value="${c.id}" class="rounded text-purple-600 focus:ring-purple-500" ${shouldCheck ? 'checked' : ''} />
            <span class="flex-1">${c.name}</span>
            ${getStatusBadgeHTML(status)}
          </label>
          <button type="button" class="edit-client-btn text-gray-400 hover:text-purple-600 p-1" data-id="${c.id}" title="Edit client">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
          </button>
        </div>
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

    // Wire up edit buttons
    clientChecklist?.querySelectorAll('.edit-client-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const clientId = btn.dataset.id;
        if (clientId && typeof openClientModalById === 'function') {
          await openClientModalById(clientId);
        }
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

    const disableButtons = !partnerSelected || !reportTypeSelected || !atLeastOneClient;
    btnGenerate.disabled = disableButtons;
    if (btnGenerateXLSX) btnGenerateXLSX.disabled = disableButtons;

    // Always say WHY the buttons are disabled — the red message above only
    // covers some cases (e.g. it stays silent when no partner is chosen).
    const helper = document.getElementById('reportHelper');
    if (helper) {
      if (disableButtons) {
        const missing = [];
        if (!partnerSelected) missing.push('a partner');
        if (!reportTypeSelected) missing.push('a report type');
        if (!atLeastOneClient) missing.push('at least one client');
        helper.textContent = `To generate, select ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
      } else {
        helper.textContent = `Ready — the report will include ${selectedClients.length} client${selectedClients.length === 1 ? '' : 's'}.`;
      }
    }
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
    const includeStatus = includeStatusCheckbox?.checked ?? true;
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
      await generatePartnerPDF(partner, reportType, selectedClientIds, includeStatus);
    } catch (err) {
      console.error('PDF generation failed:', err);
      toast.error('Failed to generate PDF.');
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'Generate PDF';
    }
  });

  // Spreadsheet button click
  btnGenerateXLSX?.addEventListener('click', async () => {
    const partner = partnerSelect?.value;
    const reportType = reportTypeSelect?.value;
    const includeStatus = includeStatusCheckbox?.checked ?? true;
    const selectedClientIds = getSelectedClientIds();

    if (!partner) { toast.warning('Please select a partner.'); return; }
    if (!reportType) { toast.warning('Please select a report type.'); return; }
    if (!selectedClientIds.length) { toast.warning('Please select at least one client to include.'); return; }

    btnGenerateXLSX.disabled = true;
    btnGenerateXLSX.textContent = 'Generating...';

    try {
      await generatePartnerSpreadsheet(partner, reportType, selectedClientIds, includeStatus);
    } catch (err) {
      console.error('Spreadsheet generation failed:', err);
      toast.error('Failed to generate spreadsheet.');
    } finally {
      btnGenerateXLSX.disabled = false;
      btnGenerateXLSX.textContent = 'Generate Spreadsheet';
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
  document.getElementById('weekOffsetReset')?.addEventListener('click', () => { __weekOffset = 0; loadDashboard(); });

  // Client search
  const clientSearch = document.getElementById('clientSearch');
  clientSearch?.addEventListener('input', (e) => filterClients(e.target.value));

  // Initial loads
  loadDashboard();
  loadClientsList();
  loadClientDetail();
  loadPartnersPage();
  wirePartnerReportUI();
  wirePauseModal();
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
