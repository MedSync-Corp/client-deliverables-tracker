// script.js — dashboard + recommendation + weekly model + overrides + negatives + lifetime
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';

/* ========= utils ========= */
const fmt = (n) => Number(n || 0).toLocaleString();
const todayEST = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const mondayOf  = (date) => { const d=new Date(date); const day=d.getDay(); const back=(day+6)%7; d.setDate(d.getDate()-back); d.setHours(0,0,0,0); return d; };
const fridayEnd = (mon)   => { const f=new Date(mon); f.setDate(f.getDate()+5); f.setHours(23,59,59,999); return f; };
const priorMon  = (mon)   => { const d=new Date(mon); d.setDate(d.getDate()-7); return d; };
function daysLeftThisWeek(d){ const dow=d.getDay(); if(dow===6||dow===0) return 5; return Math.max(1,6-dow); }
function yScaleFor(values, pad=0.06){
  const nums=(values||[]).map(v=>+v||0); const mx=Math.max(...nums,0);
  if(mx<=0) return {min:0,max:1,stepSize:1};
  const top=Math.ceil(mx*(1+pad)); const rough=top/5; const pow=10**Math.floor(Math.log10(rough));
  const step=Math.max(5, Math.ceil(rough/pow)*pow);
  return {min:0, max:Math.ceil(top/step)*step, stepSize:step};
}
function statusColors(s,a=0.72){
  const map={green:{r:34,g:197,b:94,stroke:'#16a34a'},yellow:{r:234,g:179,b:8,stroke:'#d97706'},red:{r:239,g:68,b:68,stroke:'#b91c1c'}};
  const k=map[s]||map.green; return {fill:`rgba(${k.r},${k.g},${k.b},${a})`,hover:`rgba(${k.r},${k.g},${k.b},${Math.min(1,a+0.15)})`,stroke:k.stroke};
}

/* ========= shared selectors ========= */
const kpiTotal      = document.getElementById('kpi-total');
const kpiCompleted  = document.getElementById('kpi-completed');
const kpiRemaining  = document.getElementById('kpi-remaining');
const kpiLifetime   = document.getElementById('kpi-lifetime');
const dueBody       = document.getElementById('dueThisWeekBody');
const filterStarted = document.getElementById('filterContracted');
const recBtn        = document.getElementById('btnRecommend');
const recBox        = document.getElementById('recommendationBox');
const recClose      = document.getElementById('recClose');
const recBody       = document.getElementById('recBody');

/* Log modal */
const logModal = document.getElementById('logModal');
const logForm  = document.getElementById('logForm');
const logClose = document.getElementById('logClose');
const logCancel= document.getElementById('logCancel');
const logClientName = document.getElementById('logClientName');

/* Override modal */
const ovrModal   = document.getElementById('overrideModal');
const ovrForm    = document.getElementById('ovrForm');
const ovrCancel  = document.getElementById('ovrCancel');
const ovrClose   = document.getElementById('ovrClose');
const ovrWeekLbl = document.getElementById('ovrWeekLabel');

/* ========= helpers used across pages ========= */
function pickBaselineForWeek(commitRows, clientId, refMon){
  const rows=(commitRows||[])
    .filter(r=>r.client_fk===clientId && r.active && new Date(r.start_week)<=refMon)
    .sort((a,b)=>new Date(b.start_week)-new Date(a.start_week));
  return rows[0]?.weekly_qty || 0;
}
function overrideForWeek(overrideRows, clientId, refMon){
  const iso=refMon.toISOString().slice(0,10);
  const hit=(overrideRows||[]).find(r=>r.client_fk===clientId && String(r.week_start).slice(0,10)===iso);
  return hit ? Number(hit.weekly_qty) : null;
}
function sumCompleted(rows, clientId, from=null, to=null){
  return (rows||[]).reduce((s,c)=>{
    if(c.client_fk!==clientId) return s;
    const d=new Date(c.occurred_on);
    if(from && to) return (d>=from && d<=to) ? s + (c.qty_completed||0) : s;
    return s + (c.qty_completed||0);
  },0);
}
function isStarted(clientId, commits, completions){
  const today=todayEST();
  const startedByCommit=(commits||[]).some(r=>r.client_fk===clientId && r.active && new Date(r.start_week)<=today);
  const startedByWork=(completions||[]).some(c=>c.client_fk===clientId);
  return startedByCommit || startedByWork;
}

/* ========= dashboard ========= */
let __rowsCache = []; // so the recommendation can use it without refetch

async function loadDashboard(){
  if(!kpiTotal) return; // not on this page
  const supabase=await getSupabase(); if(!supabase) return;

  const [{data:clients},{data:wk},{data:ovr},{data:comps}] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    supabase.from('completions').select('client_fk,occurred_on,qty_completed')
  ]);

  const today=todayEST(); const mon=mondayOf(today); const fri=fridayEnd(mon);
  const lastMon=priorMon(mon); const lastFri=fridayEnd(lastMon);

  const startedOnly = filterStarted?.checked ?? true;

  const rows=(clients||[])
    .filter(c => !startedOnly || isStarted(c.id, wk, comps))
    .map(c=>{
      const baseThis=pickBaselineForWeek(wk,c.id,mon);
      const baseLast=pickBaselineForWeek(wk,c.id,lastMon);
      const oThis=overrideForWeek(ovr,c.id,mon);
      const oLast=overrideForWeek(ovr,c.id,lastMon);

      const targetThis = oThis ?? baseThis;
      const targetLast = oLast ?? baseLast;

      const doneLast = sumCompleted(comps, c.id, lastMon, lastFri);
      const carryIn  = Math.max(0, targetLast - doneLast);
      const required = Math.max(0, targetThis + carryIn);

      const doneThis = sumCompleted(comps, c.id, mon, fri);
      const remaining= Math.max(0, required - doneThis);

      const needPerDay = remaining / Math.max(1, daysLeftThisWeek(today));
      const status = carryIn>0 ? 'red' : (needPerDay>100 ? 'yellow' : 'green');

      const lifetime = sumCompleted(comps, c.id);

      return { id:c.id, name:c.name, required, remaining, doneThis, carryIn, status, lifetime, targetThis };
    });

  __rowsCache = rows; // store for recommendation

  const totalReq  = rows.reduce((s,r)=>s+r.required,0);
  const totalDone = rows.reduce((s,r)=>s+r.doneThis,0);
  const totalRem  = Math.max(0, totalReq-totalDone);
  const totalLife = (comps||[]).reduce((s,c)=>s+(c.qty_completed||0),0);

  kpiTotal.setAttribute('value', fmt(totalReq));
  kpiCompleted.setAttribute('value', fmt(totalDone));
  kpiRemaining.setAttribute('value', fmt(totalRem));
  kpiLifetime.setAttribute('value', fmt(totalLife));

  renderByClientChart(rows);
  renderDueThisWeek(rows);
}

function renderByClientChart(rows){
  const labels = rows.map(r=>r.name);
  const remains= rows.map(r=>r.remaining ?? 0);
  const completes = rows.map(r => Math.max(0,(r.required??0)-(r.remaining??0)));
  const required  = rows.map((r,i)=> r.required ?? (remains[i] + completes[i]));
  const statuses  = rows.map(r=>r.status);

  const widthPx = Math.max(1100, labels.length * 140);
  const wrap = document.getElementById('chartWidth');
  const canvas = document.getElementById('byClientChart');
  if(wrap) wrap.style.width = widthPx+'px';
  if(canvas) canvas.width = widthPx;
  if(!canvas || !window.Chart) return;

  const pts = labels.map((name,i)=>{
    const c=statusColors(statuses[i]);
    return { x:name, y:remains[i], completed: completes[i], target: required[i], color:c.fill, hover:c.hover, stroke:c.stroke };
  });
  const yCfg = yScaleFor([...remains, ...required], 0.08);

  if(window.__byClientChart) window.__byClientChart.destroy();
  window.__byClientChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{ labels, datasets:[{
      label:'Remaining',
      data:pts,
      backgroundColor:(ctx)=>ctx.raw.color,
      hoverBackgroundColor:(ctx)=>ctx.raw.hover,
      borderColor:(ctx)=>ctx.raw.stroke,
      borderWidth:1.5, borderRadius:10, borderSkipped:false, maxBarThickness:44
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'rgba(17,24,39,0.9)', padding:10,
          callbacks:{
            title:(items)=>items[0].label,
            label:(ctx)=>{
              const raw=ctx.raw||{};
              const rem=ctx.parsed.y ?? 0;
              const tgt=raw.target ?? (rem + (raw.completed ?? 0));
              const done=raw.completed ?? 0;
              const pct=tgt ? Math.round((done/tgt)*100) : 0;
              return [`Remaining: ${fmt(rem)}`, `Completed: ${fmt(done)} of ${fmt(tgt)} (${pct}%)`];
            }
          }
        }
      },
      scales:{
        x:{ ticks:{ autoSkip:false, maxRotation:0, callback:(v)=>{ const s=String(labels[v]); return s.length>18?s.slice(0,18)+'…':s; } } },
        y:{ beginAtZero:true, min:yCfg.min, max:yCfg.max, ticks:{stepSize:yCfg.stepSize}, grid:{color:'rgba(0,0,0,0.06)'} }
      }
    }
  });
}

function renderDueThisWeek(rows){
  if(!dueBody) return;
  const items=rows.filter(r=>r.required>0).sort((a,b)=>b.remaining-a.remaining);
  if(!items.length){
    dueBody.innerHTML = `<tr><td class="px-4 py-4 text-sm text-gray-500" colspan="6">No active commitments this week.</td></tr>`;
    return;
  }
  dueBody.innerHTML = items.map(r=>{
    const done=Math.max(0, r.required - r.remaining);
    return `<tr>
      <td class="px-4 py-2 text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${r.name}</a></td>
      <td class="px-4 py-2 text-sm">${fmt(r.required)}</td>
      <td class="px-4 py-2 text-sm">${fmt(done)}</td>
      <td class="px-4 py-2 text-sm">${fmt(r.remaining)}</td>
      <td class="px-4 py-2 text-sm"><status-badge status="${r.status}"></status-badge></td>
      <td class="px-4 py-2 text-sm text-right"><button class="px-2 py-1 rounded bg-gray-900 text-white text-xs" data-log="${r.id}" data-name="${r.name}">Log</button></td>
    </tr>`;
  }).join('');
  dueBody.onclick=(e)=>{ const b=e.target.closest('button[data-log]'); if(!b) return; openLogModal(b.dataset.log,b.dataset.name); };
}

/* ========= recommendation ========= */
function buildRecommendationTable(rows){
  const today = todayEST();
  const dow = today.getDay();               // 0 Sun ... 6 Sat
  const days = ['Mon','Tue','Wed','Thu','Fri'];
  const startIdx = Math.min(Math.max(dow-1, 0), 4); // 0..4 (Mon..Fri). If weekend, start Monday.

  const workdays = days.slice(startIdx);    // remaining days this week
  if(workdays.length === 0){
    return `<p class="text-sm text-gray-600">It’s the weekend — no workdays left this week.</p>`;
  }

  // Fair split for each client across remaining days
  const plan = rows
    .filter(r => r.remaining > 0)
    .map(r=>{
      const per = Math.floor(r.remaining / workdays.length);
      let left = r.remaining - per*workdays.length;
      const daily = workdays.map(()=> per + (left>0 ? (left--,1) : 0));
      return { name:r.name, remaining:r.remaining, daily };
    });

  if(!plan.length){
    return `<p class="text-sm text-gray-600">Nothing remaining — all targets met 🎉</p>`;
  }

  const header = `<thead class="text-xs uppercase text-gray-500 border-b">
    <tr><th class="px-3 py-2">Client</th><th class="px-3 py-2">Remaining</th>
    ${workdays.map(d=>`<th class="px-3 py-2">${d}</th>`).join('')}
    </tr></thead>`;

  const body = `<tbody>${plan.map(p=>{
    return `<tr>
      <td class="px-3 py-2 text-sm">${p.name}</td>
      <td class="px-3 py-2 text-sm">${fmt(p.remaining)}</td>
      ${p.daily.map(v=>`<td class="px-3 py-2 text-sm">${fmt(v)}</td>`).join('')}
    </tr>`;
  }).join('')}</tbody>`;

  return `<table class="min-w-full text-left">${header}${body}</table>`;
}

recBtn?.addEventListener('click', ()=>{
  if(!__rowsCache.length){
    recBody.innerHTML = `<p class="text-sm text-gray-600">No data to recommend yet.</p>`;
  }else{
    recBody.innerHTML = buildRecommendationTable(__rowsCache);
  }
  recBox?.classList.remove('hidden');
});
recClose?.addEventListener('click', ()=> recBox?.classList.add('hidden'));

/* ========= log modal ========= */
function openLogModal(clientId, name){
  if(!logForm) return;
  logForm.client_id.value = clientId;
  logForm.qty.value = '';
  logForm.note.value = '';
  if(logClientName) logClientName.textContent = name || '—';
  logModal?.classList.remove('hidden');
}
function closeLogModal(){ logModal?.classList.add('hidden'); }
logClose?.addEventListener('click', closeLogModal);
logCancel?.addEventListener('click', closeLogModal);

logForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const supabase=await getSupabase(); if(!supabase) return alert('Supabase not configured.');
  const qty = Number(logForm.qty.value || 0);
  if(!qty || qty === 0) return alert('Enter a non-zero quantity.');
  if(qty < 0 && !confirm(`You are reducing completed by ${Math.abs(qty)}. Continue?`)) return;
  const payload = {
    client_fk: logForm.client_id.value,
    occurred_on: new Date().toISOString(),
    qty_completed: qty,
    note: logForm.note.value?.trim() || null
  };
  const { error } = await supabase.from('completions').insert(payload);
  if(error){ console.error(error); return alert('Failed to log completion.'); }
  closeLogModal();
  await loadDashboard();
});

/* ========= override modal (used on client-detail page) ========= */
function openOverrideModal(clientId, weekStartISO){
  if(!ovrForm) return;
  ovrForm.client_id.value = clientId;
  ovrForm.week_start.value = weekStartISO;
  ovrForm.weekly_qty.value = '';
  ovrForm.note.value = '';
  if(ovrWeekLbl) ovrWeekLbl.textContent = weekStartISO;
  ovrModal?.classList.remove('hidden');
}
function closeOverrideModal(){ ovrModal?.classList.add('hidden'); }
ovrCancel?.addEventListener('click', closeOverrideModal);
ovrClose?.addEventListener('click', closeOverrideModal);

ovrForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const supabase=await getSupabase(); if(!supabase) return alert('Supabase not configured.');
  const client_fk = ovrForm.client_id.value;
  const week_start= ovrForm.week_start.value;
  const weekly_qty= Number(ovrForm.weekly_qty.value || 0);
  const note = ovrForm.note.value?.trim() || null;
  if(weekly_qty < 0) return alert('Weekly target cannot be negative.');

  const { data: existing } = await supabase
    .from('weekly_overrides')
    .select('id')
    .eq('client_fk', client_fk)
    .eq('week_start', week_start)
    .limit(1);

  if(existing && existing.length){
    await supabase.from('weekly_overrides').update({ weekly_qty, note }).eq('id', existing[0].id);
  }else{
    await supabase.from('weekly_overrides').insert({ client_fk, week_start, weekly_qty, note });
  }
  closeOverrideModal();
  await loadDashboard();
});

/* ========= boot ========= */
window.addEventListener('DOMContentLoaded', async ()=>{
  try { await requireAuth(); } catch { return; }
  wireLogoutButton();

  filterStarted?.addEventListener('change', loadDashboard);
  await loadDashboard();

  // expose some helpers for inline buttons on other pages if needed
  window.openLogModal = openLogModal;
  window.openOverrideModal = openOverrideModal;
});
