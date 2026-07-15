// reconcile.js — Bulk production reconciliation (Build 6)
// Operators enter TRUE lifetime totals per client; the system writes one
// correction row per changed client into `completions`, dated the FIRST of a
// chosen cutover month (default July 2026). Past months' reporting is
// untouched; deltas may be negative for over-logged clients.
// Standalone page module — intentionally does not import from script.js.
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton, getCurrentUser } from './auth.js';
import { toast } from './toast.js';

const fmt = (n) => Number(n || 0).toLocaleString();
const NOTE_PREFIX = 'Reconciliation adjustment';
const TZ = 'America/New_York';

/* ===== Date helpers (same conventions as script.js) ===== */
function ymdEST(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
}
const todayEST = () => new Date(`${ymdEST(new Date())}T00:00:00`);
function mondayOf(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// A correction dated inside the prior or current work week WOULD leak into
// the dashboard's weekly sums / carry-in window. July 1 is safely in the past
// today, but the month selector is generic, so guard it.
function dateTouchesLiveWeeks(ymd) {
  const mon = mondayOf(todayEST());
  const prevMonY = addDays(mon, -7).toISOString().slice(0, 10);
  const friY = addDays(mon, 4).toISOString().slice(0, 10);
  return ymd >= prevMonY && ymd <= friY;
}

/* ===== Paginated fetch (PostgREST caps ~1000 rows/request) ===== */
async function fetchAllRows(buildQuery, label = 'rows') {
  const PAGE = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) { console.error(`fetchAllRows(${label}) error:`, error); break; }
    const batch = data || [];
    all.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/* ===== Status badge (display-only copy of script.js labels) ===== */
const STATUS_LABELS = {
  active: 'Active', paused_client: 'Paused (Client)', paused_medsync: 'Paused (MedSync)',
  awaiting_patients: 'Awaiting Patients', term: 'Term', contract_complete: 'Contract Complete'
};
const STATUS_STYLES = {
  active: 'bg-green-100 text-green-700', paused_client: 'bg-amber-100 text-amber-700',
  paused_medsync: 'bg-amber-100 text-amber-700', awaiting_patients: 'bg-blue-100 text-blue-700',
  term: 'bg-red-100 text-red-800', contract_complete: 'bg-teal-100 text-teal-800'
};
const statusBadge = (s) =>
  `<span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLES[s] || 'bg-gray-100 text-gray-600'}">${STATUS_LABELS[s] || s || 'Unknown'}</span>`;

/* ===== Confirm modal (copy of script.js confirmDialog, incl. type-to-confirm) ===== */
function confirmDialog({ title, message, confirmLabel = 'Confirm', confirmClass = 'bg-gray-900 hover:bg-gray-800', requireText = null }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
    const requireHTML = requireText ? `
      <div class="px-5 pb-5">
        <input data-require type="text" placeholder="Type ${requireText} to confirm" autocomplete="off"
               class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
      </div>` : '';
    wrap.innerHTML = `
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
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

/* ===== State ===== */
let __clients = [];          // [{id, name, acronym, status}]
let __totals = new Map();    // clientId -> { completed, utc }
let __adjustments = [];      // completion rows whose note is a reconciliation tag

/* ===== Data ===== */
async function fetchData() {
  const supabase = await getSupabase();
  if (!supabase) { toast.error('Supabase not configured.'); return false; }

  const [{ data: clients }, comps] = await Promise.all([
    supabase.from('clients').select('id,name,acronym,status').order('name'),
    fetchAllRows(() => supabase.from('completions')
      .select('id,client_fk,occurred_on,qty_completed,qty_utc,note,inserted_at')
      .order('id', { ascending: true }), 'reconcile completions')
  ]);

  __clients = clients || [];
  __totals = new Map();
  for (const c of __clients) __totals.set(c.id, { completed: 0, utc: 0 });
  __adjustments = [];
  for (const row of comps) {
    const t = __totals.get(row.client_fk);
    if (t) { t.completed += row.qty_completed || 0; t.utc += row.qty_utc || 0; }
    if (row.note && row.note.startsWith(NOTE_PREFIX)) __adjustments.push(row);
  }
  return true;
}

/* ===== Table ===== */
function renderTable() {
  const body = document.getElementById('reconBody');
  if (!body) return;
  body.innerHTML = __clients.map(c => {
    const t = __totals.get(c.id) || { completed: 0, utc: 0 };
    const label = c.acronym ? `${c.name} <span class="text-gray-400">(${c.acronym})</span>` : c.name;
    return `<tr data-row="${c.id}">
      <td class="px-4 py-2 text-sm whitespace-nowrap">${label} <span class="ml-1">${statusBadge(c.status)}</span></td>
      <td class="px-4 py-2 text-sm text-right tabular-nums">${fmt(t.completed)}</td>
      <td class="px-2 py-1"><input type="number" min="0" step="1" inputmode="numeric" data-actual-completed="${c.id}"
        class="w-28 border rounded-lg px-2 py-1 text-right text-sm" placeholder="—" /></td>
      <td class="px-4 py-2 text-sm text-right tabular-nums font-medium" data-delta-completed="${c.id}"><span class="text-gray-300">—</span></td>
      <td class="px-4 py-2 text-sm text-right tabular-nums">${fmt(t.utc)}</td>
      <td class="px-2 py-1"><input type="number" min="0" step="1" inputmode="numeric" data-actual-utc="${c.id}"
        class="w-24 border rounded-lg px-2 py-1 text-right text-sm" placeholder="—" /></td>
      <td class="px-4 py-2 text-sm text-right tabular-nums font-medium" data-delta-utc="${c.id}"><span class="text-gray-300">—</span></td>
    </tr>`;
  }).join('');

  body.oninput = () => refreshDeltas();
  refreshDeltas();
}

// Read one metric's input for a client: null = untouched, NaN = invalid
function readActual(kind, clientId) {
  const el = document.querySelector(`input[data-actual-${kind}="${clientId}"]`);
  const raw = el?.value?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

// Collect per-client changes. Returns { changes, invalid } where each change is
// { client, deltaCompleted, deltaUTC } and zero-delta rows are dropped.
function collectChanges() {
  const changes = [];
  let invalid = 0;
  for (const c of __clients) {
    const t = __totals.get(c.id) || { completed: 0, utc: 0 };
    const aC = readActual('completed', c.id);
    const aU = readActual('utc', c.id);
    if (Number.isNaN(aC) || Number.isNaN(aU)) { invalid++; continue; }
    if (aC === null && aU === null) continue;
    const deltaCompleted = aC === null ? 0 : aC - t.completed;
    const deltaUTC = aU === null ? 0 : aU - t.utc;
    if (deltaCompleted === 0 && deltaUTC === 0) continue;
    changes.push({ client: c, deltaCompleted, deltaUTC });
  }
  return { changes, invalid };
}

const deltaHTML = (d) => d === 0
  ? `<span class="text-gray-400">0</span>`
  : d > 0
    ? `<span class="text-green-700">+${fmt(d)}</span>`
    : `<span class="text-red-600">−${fmt(Math.abs(d))}</span>`;

function refreshDeltas() {
  let changed = 0, netC = 0, netU = 0, invalid = 0;
  for (const c of __clients) {
    const t = __totals.get(c.id) || { completed: 0, utc: 0 };
    const aC = readActual('completed', c.id);
    const aU = readActual('utc', c.id);
    const cellC = document.querySelector(`[data-delta-completed="${c.id}"]`);
    const cellU = document.querySelector(`[data-delta-utc="${c.id}"]`);
    if (Number.isNaN(aC) || Number.isNaN(aU)) {
      invalid++;
      const bad = `<span class="text-red-600 text-xs">invalid</span>`;
      if (cellC) cellC.innerHTML = Number.isNaN(aC) ? bad : '<span class="text-gray-300">—</span>';
      if (cellU) cellU.innerHTML = Number.isNaN(aU) ? bad : '<span class="text-gray-300">—</span>';
      continue;
    }
    const dC = aC === null ? null : aC - t.completed;
    const dU = aU === null ? null : aU - t.utc;
    if (cellC) cellC.innerHTML = dC === null ? '<span class="text-gray-300">—</span>' : deltaHTML(dC);
    if (cellU) cellU.innerHTML = dU === null ? '<span class="text-gray-300">—</span>' : deltaHTML(dU);
    if ((dC ?? 0) !== 0 || (dU ?? 0) !== 0) { changed++; netC += dC ?? 0; netU += dU ?? 0; }
  }

  const summary = document.getElementById('reconSummary');
  const applyBtn = document.getElementById('reconApply');
  if (summary) {
    summary.innerHTML = invalid
      ? `<span class="text-red-600">${invalid} row${invalid === 1 ? ' has an' : 's have'} invalid value${invalid === 1 ? '' : 's'} — actual totals must be whole numbers ≥ 0.</span>`
      : changed
        ? `${changed} client${changed === 1 ? '' : 's'} changed · net completed ${deltaHTML(netC)} · net UTCs ${deltaHTML(netU)}`
        : 'No changes yet — filled rows with a non-zero delta will be written.';
  }
  if (applyBtn) applyBtn.disabled = !!invalid || !changed;
}

/* ===== Apply ===== */
function selectedMonthYMD() {
  const v = document.getElementById('reconMonth')?.value; // 'YYYY-MM'
  return /^\d{4}-\d{2}$/.test(v || '') ? `${v}-01` : null;
}

function monthLabel(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

async function applyReconciliation() {
  const { changes, invalid } = collectChanges();
  if (invalid) return toast.warning('Fix the invalid rows first (whole numbers ≥ 0).');
  if (!changes.length) return toast.info('No changes to apply.');
  const occurred_on = selectedMonthYMD();
  if (!occurred_on) return toast.warning('Pick the month to assign corrections to.');

  const netC = changes.reduce((s, ch) => s + ch.deltaCompleted, 0);
  const netU = changes.reduce((s, ch) => s + ch.deltaUTC, 0);
  const liveWarning = dateTouchesLiveWeeks(occurred_on)
    ? `<p class="mt-3 text-red-600 font-semibold">⚠ ${occurred_on} falls inside the current or prior work week — these corrections WILL change this week's progress and carry-in math. Pick an earlier month unless that is intended.</p>`
    : '';

  const listHTML = changes.map(ch => {
    const parts = [];
    if (ch.deltaCompleted !== 0) parts.push(`completed ${deltaHTML(ch.deltaCompleted)}`);
    if (ch.deltaUTC !== 0) parts.push(`UTCs ${deltaHTML(ch.deltaUTC)}`);
    return `<li><span class="font-medium">${ch.client.name}</span>: ${parts.join(' · ')}</li>`;
  }).join('');

  const ok = await confirmDialog({
    title: `Apply ${changes.length} correction${changes.length === 1 ? '' : 's'}?`,
    message: `
      <p>Each changed client gets ONE adjustment row in completions, dated <span class="font-semibold">${occurred_on}</span> (${monthLabel(occurred_on)}), tagged "${NOTE_PREFIX}".</p>
      <ul class="list-disc pl-5 mt-3 space-y-1 max-h-60 overflow-y-auto">${listHTML}</ul>
      <p class="mt-3">Net delta: completed ${deltaHTML(netC)} · UTCs ${deltaHTML(netU)}</p>
      ${liveWarning}`,
    confirmLabel: 'Apply corrections', confirmClass: 'bg-indigo-600 hover:bg-indigo-700'
  });
  if (!ok) return;

  const supabase = await getSupabase();
  if (!supabase) return toast.error('Supabase not configured.');
  const user = await getCurrentUser();
  const email = user?.email || 'unknown';
  const note = `${NOTE_PREFIX} ${ymdEST(new Date())} by ${email}`;

  const rows = changes.map(ch => ({
    client_fk: ch.client.id,
    occurred_on,
    qty_completed: ch.deltaCompleted,
    qty_utc: ch.deltaUTC,
    note,
    inserted_by: email
  }));

  const btn = document.getElementById('reconApply');
  btn.disabled = true;
  const { error } = await supabase.from('completions').insert(rows);
  if (error) {
    console.error(error);
    btn.disabled = false;
    return toast.error(`Failed to write corrections: ${error.message}`);
  }
  toast.success(`Applied ${rows.length} correction${rows.length === 1 ? '' : 's'} dated ${occurred_on}`);
  await loadReconcile();
}

/* ===== Recent reconciliations (grouped by note tag + assigned date) ===== */
function renderRecent() {
  const wrap = document.getElementById('reconRecent');
  if (!wrap) return;
  if (!__adjustments.length) {
    wrap.innerHTML = `<p class="text-sm text-gray-500">No reconciliation adjustments recorded yet.</p>`;
    return;
  }
  const groups = new Map();
  for (const row of __adjustments) {
    const key = `${row.note}|${String(row.occurred_on).slice(0, 10)}`;
    if (!groups.has(key)) groups.set(key, { note: row.note, occurred_on: String(row.occurred_on).slice(0, 10), rows: [] });
    groups.get(key).rows.push(row);
  }
  const batches = [...groups.values()].sort((a, b) => (b.note > a.note ? 1 : -1));

  wrap.innerHTML = `
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50"><tr>
        <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600">Batch</th>
        <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600">Assigned to</th>
        <th class="px-4 py-2 text-right text-xs font-semibold text-gray-600">Clients</th>
        <th class="px-4 py-2 text-right text-xs font-semibold text-gray-600">Net completed</th>
        <th class="px-4 py-2 text-right text-xs font-semibold text-gray-600">Net UTCs</th>
        <th class="px-4 py-2"></th>
      </tr></thead>
      <tbody class="divide-y divide-gray-100">
        ${batches.map((b, i) => {
          const netC = b.rows.reduce((s, r) => s + (r.qty_completed || 0), 0);
          const netU = b.rows.reduce((s, r) => s + (r.qty_utc || 0), 0);
          return `<tr>
            <td class="px-4 py-2 text-sm">${b.note}</td>
            <td class="px-4 py-2 text-sm">${b.occurred_on}</td>
            <td class="px-4 py-2 text-sm text-right">${b.rows.length}</td>
            <td class="px-4 py-2 text-sm text-right">${deltaHTML(netC)}</td>
            <td class="px-4 py-2 text-sm text-right">${deltaHTML(netU)}</td>
            <td class="px-4 py-2 text-sm text-right">
              <button class="px-2 py-1 rounded border border-red-300 text-red-600 text-xs hover:bg-red-50" data-undo="${i}">Undo batch</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  wrap.onclick = async (e) => {
    const btn = e.target.closest('button[data-undo]');
    if (!btn) return;
    const batch = batches[Number(btn.dataset.undo)];
    const ok = await confirmDialog({
      title: 'Undo reconciliation batch',
      message: `Delete all <span class="font-semibold">${batch.rows.length}</span> adjustment rows from "<span class="font-semibold">${batch.note}</span>" (assigned to ${batch.occurred_on})? Lifetime totals return to their pre-adjustment values.`,
      confirmLabel: 'Undo batch', confirmClass: 'bg-red-600 hover:bg-red-700',
      requireText: 'UNDO'
    });
    if (!ok) return;
    const supabase = await getSupabase();
    if (!supabase) return toast.error('Supabase not configured.');
    const ids = batch.rows.map(r => r.id);
    const { error } = await supabase.from('completions').delete().in('id', ids);
    if (error) { console.error(error); return toast.error(`Failed to undo batch: ${error.message}`); }
    toast.success(`Undid ${ids.length} adjustment row${ids.length === 1 ? '' : 's'}`);
    await loadReconcile();
  };
}

/* ===== Boot ===== */
async function loadReconcile() {
  if (!(await fetchData())) return;
  renderTable();
  renderRecent();
}

window.addEventListener('DOMContentLoaded', async () => {
  try { await requireAuth(); } catch { return; }
  wireLogoutButton();
  document.getElementById('reconApply')?.addEventListener('click', applyReconciliation);
  document.getElementById('reconMonth')?.addEventListener('change', () => {
    const ymd = selectedMonthYMD();
    const warn = document.getElementById('reconMonthWarn');
    if (warn) warn.classList.toggle('hidden', !ymd || !dateTouchesLiveWeeks(ymd));
  });
  await loadReconcile();
});
