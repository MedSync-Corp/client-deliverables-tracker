// script.js — dashboard + recommendations + weekly model + negatives + lifetime + started tags
import { getSupabase } from './supabaseClient.js';
import { requireAuth, wireLogoutButton } from './auth.js';

/* ===== Utilities ===== */
const fmt = (n) => Number(n || 0).toLocaleString();
function mondayOf(date){ const d=new Date(date); const day=d.getDay(); const back=(day+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-back); return d; }
function fridayEndOf(monday){ const f=new Date(monday); f.setDate(f.getDate()+5); f.setHours(23,59,59,999); return f; }
function priorMonday(monday){ const d=new Date(monday); d.setDate(d.getDate()-7); return d; }
function daysLeftThisWeek(today){ const dow=today.getDay(); if(dow===6||dow===0) return 5; return Math.max(1,6-dow); }
function yScaleFor(vals, pad=0.06){ const a=(vals||[]).map(v=>+v||0); const mx=Math.max(...a,0); if(mx<=0) return{min:0,max:1,stepSize:1}; const top=Math.ceil(mx*(1+pad)); const rough=top/5, pow=10**Math.floor(Math.log10(rough)); const step=Math.max(5,Math.ceil(rough/pow)*pow); return{min:0,max:Math.ceil(top/step)*step,stepSize:step}; }
function statusColors(s,a=0.72){ const map={green:{r:34,g:197,b:94,stroke:'#16a34a'},yellow:{r:234,g:179,b:8,stroke:'#d97706'},red:{r:239,g:68,b:68,stroke:'#b91c1c'}}; const k=map[s]||map.green; return{fill:`rgba(${k.r},${k.g},${k.b},${a})`,hover:`rgba(${k.r},${k.g},${k.b},${Math.min(1,a+0.15)})`,stroke:k.stroke}; }

/* ===== Elements ===== */
const kpiTotal     = document.getElementById('kpi-total');
const kpiCompleted = document.getElementById('kpi-completed');
const kpiRemaining = document.getElementById('kpi-remaining');
const kpiLifetime  = document.getElementById('kpi-lifetime');
const dueBody      = document.getElementById('dueThisWeekBody');

// Log modal
const logModal      = document.getElementById('logModal');
const logForm       = document.getElementById('logForm');
const logClose      = document.getElementById('logClose');
const logCancel     = document.getElementById('logCancel');
const logClientName = document.getElementById('logClientName');

/* ===== Data helpers (weekly) ===== */
function pickBaselineForWeek(commitRows, clientId, refMon){
  const rows=(commitRows||[]).filter(r=>r.client_fk===clientId && r.active && new Date(r.start_week)<=refMon)
                             .sort((a,b)=>new Date(b.start_week)-new Date(a.start_week));
  return rows[0]?.weekly_qty || 0;
}
function overrideForWeek(overrideRows, clientId, refMon){
  const hit=(overrideRows||[]).find(r => r.client_fk===clientId && String(r.week_start).slice(0,10)===refMon.toISOString().slice(0,10));
  return hit ? Number(hit.weekly_qty) : null;
}
function sumCompleted(rows, clientId, from, to){
  return (rows||[]).reduce((s,c)=>{
    if(c.client_fk!==clientId) return s;
    const d=new Date(c.occurred_on);
    return (from && to) ? (d>=from && d<=to ? s+(c.qty_completed||0) : s) : s+(c.qty_completed||0);
  },0);
}
function isStarted(clientId, commits, completions){
  const today=new Date();
  const startedByCommit=(commits||[]).some(r=>r.client_fk===clientId && r.active && new Date(r.start_week)<=today);
  const startedByWork=(completions||[]).some(c=>c.client_fk===clientId);
  return startedByCommit || startedByWork;
}

/* ===== Dashboard ===== */
async function loadDashboard(){
  if(!kpiTotal) return; // not on dashboard
  const supabase=await getSupabase(); if(!supabase) return;

  const [{data:clients},{data:wk},{data:ovr},{data:comps}] = await Promise.all([
    supabase.from('clients').select('id,name,total_lives').order('name'),
    supabase.from('weekly_commitments').select('client_fk,weekly_qty,start_week,active'),
    supabase.from('weekly_overrides').select('client_fk,week_start,weekly_qty'),
    supabase.from('completions').select('client_fk,occurred_on,qty_completed')
  ]);

  const today=new Date(); const mon=mondayOf(today); const fri=fridayEndOf(mon);
  const lastMon=priorMonday(mon); const lastFri=fridayEndOf(lastMon);

  const startedOnly = document.getElementById('filterContracted')?.checked ?? true;

  const rows=(clients||[]).filter(c => !startedOnly || isStarted(c.id, wk, comps)).map(c=>{
    const baseThis = pickBaselineForWeek(wk,c.id,mon);
    const baseLast = pickBaselineForWeek(wk,c.id,lastMon);
    const oThis = overrideForWeek(ovr,c.id,mon);
    const oLast = overrideForWeek(ovr,c.id,lastMon);
    const targetThis = oThis ?? baseThis;
    const targetLast = oLast ?? baseLast;

    const doneLast = sumCompleted(comps,c.id,lastMon,lastFri);
    const carryIn  = Math.max(0, targetLast - doneLast);
    const required = Math.max(0, targetThis + carryIn);

    const doneThis = sumCompleted(comps,c.id,mon,fri);
    const remaining = Math.max(0, required - doneThis);

    const needPerDay = remaining/Math.max(1,daysLeftThisWeek(today));
    const status = carryIn>0 ? 'red' : (needPerDay>100 ? 'yellow' : 'green');

    const lifetime = sumCompleted(comps,c.id);
    return { id:c.id, name:c.name, required, remaining, doneThis, carryIn, status, lifetime, targetThis };
  });

  // Expose for recommendations
  window.__dashRows = rows;

  const totalReq = rows.reduce((s,r)=>s+r.required,0);
  const totalDone = rows.reduce((s,r)=>s+r.doneThis,0);
  const totalRem = Math.max(0, totalReq-totalDone);
  const totalLifetime = (comps||[]).reduce((s,c)=>s+(c.qty_completed||0),0);

  kpiTotal?.setAttribute('value', fmt(totalReq));
  kpiCompleted?.setAttribute('value', fmt(totalDone));
  kpiRemaining?.setAttribute('value', fmt(totalRem));
  kpiLifetime?.setAttribute('value', fmt(totalLifetime));

  renderByClientChart(rows);
  renderDueThisWeek(rows);
}

function renderByClientChart(rows){
  const labels   = rows.map(r=>r.name);
  const remains  = rows.map(r=>r.remaining ?? 0);
  const completes= rows.map(r=>Math.max(0,(r.required ?? 0)-(r.remaining ?? 0)));
  const required = rows.map((r,i)=> r.required ?? (remains[i]+completes[i]));
  const statuses = rows.map(r=>r.status);

  const widthPx = Math.max(1100, labels.length * 140);
  const widthDiv = document.getElementById('chartWidth');
  const canvas   = document.getElementById('byClientChart');
  if (widthDiv) widthDiv.style.width = widthPx + 'px';
  if (canvas)   canvas.width = widthPx;
  if (!canvas || !window.Chart) return;

  const points = labels.map((name,i)=>{
    const c=statusColors(statuses[i]);
    return { x:name, y:remains[i], completed:completes[i], target:required[i], color:c.fill, hover:c.hover, stroke:c.stroke };
  });

  const yCfg = yScaleFor([...remains, ...required], 0.08);
  if (window.__byClientChart) window.__byClientChart.destroy();

  window.__byClientChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels,
      datasets:[{
        label:'Remaining',
        data: points,
        backgroundColor:      (ctx)=>ctx.raw.color,
        hoverBackgroundColor: (ctx)=>ctx.raw.hover,
        borderColor:          (ctx)=>ctx.raw.stroke,
        borderWidth: 1.5,
        borderRadius: 10,
        borderSkipped: false,
        maxBarThickness: 44
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'rgba(17,24,39,0.9)',
          padding:10,
          callbacks:{
            title:(items)=>items[0].label,
            label:(ctx)=>{
              const raw = ctx.raw || {};
              const rem = ctx.parsed.y ?? 0;
              const tgt = raw.target ?? (rem + (raw.completed ?? 0));
              const done = raw.completed ?? 0;
              const pct = tgt ? Math.round((done / tgt)*100) : 0;
              return [
                `Remaining: ${fmt(rem)}`,
                `Completed: ${fmt(done)} of ${fmt(tgt)} (${pct}%)`
              ];
            }
          }
        }
      },
      scales:{
        x:{
          ticks:{
            autoSkip:false,
            maxRotation:0,
            callback:(v)=>{ const s=String(labels[v]); return s.length>18 ? s.slice(0,18)+'…' : s; }
          }
        },
        y:{
          beginAtZero:true,
          min:yCfg.min, max:yCfg.max, ticks:{ stepSize:yCfg.stepSize },
          grid:{ color:'rgba(0,0,0,0.06)' }
        }
      }
    }
  });
}

function renderDueThisWeek(rows){
  if(!dueBody) return;
  const items = rows.filter(r=>r.required>0).sort((a,b)=>b.remaining-a.remaining);
  if(!items.length){
    dueBody.innerHTML = `<tr><td colspan="6" class="py-4 text-sm text-gray-500">No active commitments this week.</td></tr>`;
    return;
  }
  dueBody.innerHTML = items.map(r=>{
    const done = Math.max(0, r.required - r.remaining);
    return `<tr>
      <td class="px-4 py-2 text-sm"><a class="text-indigo-600 hover:underline" href="./client-detail.html?id=${r.id}">${r.name}</a></td>
      <td class="px-4 py-2 text-sm">${fmt(r.required)}</td>
      <td class="px-4 py-2 text-sm">${fmt(done)}</td>
      <td class="px-4 py-2 text-sm">${fmt(r.remaining)}</td>
      <td class="px-4 py-2 text-sm"><status-badge status="${r.status}"></status-badge></td>
      <td class="px-4 py-2 text-sm text-right">
        <button class="px-2 py-1 rounded bg-gray-900 text-white text-xs" data-log="${r.id}" data-name="${r.name}">Log</button>
      </td>
    </tr>`;
  }).join('');
  dueBody.onclick = (e)=>{
    const b=e.target.closest('button[data-log]'); if(!b) return;
    openLogModal(b.dataset.log, b.dataset.name);
  };
}

/* ===== Log modal (shared) — allows negatives ===== */
function openLogModal(clientId,name){
  if(!logForm) return;
  logForm.client_id.value=clientId;
  logForm.qty.value='';
  logForm.note.value='';
  if (logClientName) logClientName.textContent = name || '—';
  logModal?.classList.remove('hidden');
}
function closeLogModal(){ logModal?.classList.add('hidden'); }
logClose?.addEventListener('click', closeLogModal);
logCancel?.addEventListener('click', closeLogModal);

logForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const supabase=await getSupabase(); if(!supabase) return alert('Supabase not configured.');
  const qty=Number(logForm.qty.value||0);
  if(!qty || qty===0) return alert('Enter a non-zero quantity.');
  if(qty<0 && !confirm(`You are reducing completed by ${Math.abs(qty)}. Continue?`)) return;
  const payload={ client_fk: logForm.client_id.value, occurred_on:new Date().toISOString(), qty_completed: qty, note: logForm.note.value?.trim()||null };
  const { error } = await supabase.from('completions').insert(payload);
  if(error){ console.error(error); return alert('Failed to log completion.'); }
  closeLogModal();
  await loadDashboard(); // refresh dashboard rows & KPIs
});

/* ===== Recommendations ===== */

// Weekdays remaining this week (Mon–Fri), starting today (skip weekend)
function weekdaysRemaining(today){
  const d=new Date(today);
  const out=[];
  const dow=d.getDay();
  if(dow===6) d.setDate(d.getDate()+2);
  else if(dow===0) d.setDate(d.getDate()+1);
  while(d.getDay()>=1 && d.getDay()<=5){
    out.push(new Date(d));
    d.setDate(d.getDate()+1);
  }
  return out;
}

// Evenly split each client's remaining across days (front-load remainders)
function evenSplitPlan(rows, days){
  return rows.map(r=>{
    let rem=Math.max(0, Number(r.remaining||0));
    const n=days.length;
    const base=n?Math.floor(rem/n):0;
    let extra=n?(rem % n):0;
    const perDay = days.map(()=>{
      const add = extra>0 ? 1 : 0;
      if(extra>0) extra--;
      const q = base + add;
      rem -= q;
      return q;
    });
    return { id:r.id, name:r.name, perDay };
  });
}

// Capacity apportionment using Largest Remainder Method (no over-assign)
function capacityPlan(rows, days, capacityPerDay){
  const byIdx = rows.map(r=>({ id:r.id, name:r.name, left:Math.max(0,Number(r.remaining||0)) }));
  const plan  = rows.map(r=>({ id:r.id, name:r.name, perDay:Array(days.length).fill(0) }));

  for(let d=0; d<days.length; d++){
    const totalLeft = byIdx.reduce((s,r)=>s+r.left,0);
    if(totalLeft===0) continue;

    const cap = Math.max(0, Number(capacityPerDay||0));
    if(!cap){
      const daysLeftIncl = days.length - d;
      byIdx.forEach((r,i)=>{
        const q = Math.ceil(r.left/daysLeftIncl);
        const use = Math.min(q, r.left);
        plan[i].perDay[d]=use;
        r.left -= use;
      });
      continue;
    }

    const shares = byIdx.map(r => cap*(r.left/totalLeft));
    const floors = shares.map(x => Math.floor(x));
    let assigned = floors.reduce((s,x)=>s+x,0);
    let leftover = cap - assigned;

    floors.forEach((q,i)=>{
      const use = Math.min(q, byIdx[i].left);
      plan[i].perDay[d] = use;
      byIdx[i].left -= use;
    });

    const remainders = shares.map((x,i)=>({i, frac:x-Math.floor(x)})).sort((a,b)=>b.frac-a.frac);
    for(const r of remainders){
      if(leftover<=0) break;
      if(byIdx[r.i].left<=0) continue;
      plan[r.i].perDay[d]+=1;
      byIdx[r.i].left -= 1;
      leftover -= 1;
    }
  }
  return plan;
}

function renderRecsModal(rows, perDayCap){
  const head = document.getElementById('recsHead');
  const body = document.getElementById('recsBody');
  const foot = document.getElementById('recsFoot');

  const days = weekdaysRemaining(new Date());
  const fmtDay = d => d.toLocaleDateString('en-US', { weekday:'short', month:'numeric', day:'numeric' });

  if(!days.length){
    head.innerHTML = '';
    body.innerHTML = `<tr><td class="py-6 text-center text-gray-500">No work days remaining this week.</td></tr>`;
    foot.innerHTML = '';
    return;
  }

  const plan = (perDayCap && Number(perDayCap)>0) ? capacityPlan(rows, days, Number(perDayCap)) : evenSplitPlan(rows, days);

  head.innerHTML = `<tr>
    <th class="text-left px-3 py-2">Client</th>
    ${days.map(d=>`<th class="text-right px-3 py-2">${fmtDay(d)}</th>`).join('')}
    <th class="text-right px-3 py-2">Total</th>
  </tr>`;

  body.innerHTML = plan.map(row=>{
    const total=row.perDay.reduce((s,q)=>s+q,0);
    return `<tr>
      <td class="px-3 py-1.5">${row.name}</td>
      ${row.perDay.map(q=>`<td class="px-3 py-1.5 text-right">${q}</td>`).join('')}
      <td class="px-3 py-1.5 text-right font-medium">${total}</td>
    </tr>`;
  }).join('');

  const colTotals = days.map((_,c)=> plan.reduce((s,r)=>s+r.perDay[c],0));
  const grand = colTotals.reduce((s,x)=>s+x,0);
  foot.innerHTML = `<tr class="border-t">
    <td class="px-3 py-2 font-semibold text-right">Totals</td>
    ${colTotals.map(t=>`<td class="px-3 py-2 text-right font-semibold">${t}</td>`).join('')}
    <td class="px-3 py-2 text-right font-semibold">${grand}</td>
  </tr>`;

  // CSV copy
  const copyBtn = document.getElementById('copyCsvBtn');
  copyBtn.onclick = () => {
    const header = ['Client', ...days.map(fmtDay), 'Total'];
    const rowsCsv = plan.map(r=>{
      const total=r.perDay.reduce((s,q)=>s+q,0);
      return [r.name, ...r.perDay, total];
    });
    const csv = [header, ...rowsCsv].map(arr => arr.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    navigator.clipboard.writeText(csv).then(()=> alert('Recommendations copied to clipboard as CSV.'))
      .catch(()=> alert('Copy failed'));
  };
}

// Wire modal open/close
(function wireRecs(){
  const btn    = document.getElementById('runRecsBtn');
  const modal  = document.getElementById('recsModal');
  const close  = document.getElementById('recsClose');
  const cancel = document.getElementById('recsCancel');
  const recalc = document.getElementById('recsRecalc');
  const capInp = document.getElementById('capacityPerDay');

  if(!btn || !modal) return;

  btn.addEventListener('click', ()=>{
    const rows = (window.__dashRows || []).filter(r=>r.required>0);
    if(!rows.length){ alert('No active commitments this week.'); return; }
    modal.classList.remove('hidden');
    renderRecsModal(rows, capInp?.value);
  });
  close?.addEventListener('click', ()=> modal.classList.add('hidden'));
  cancel?.addEventListener('click', ()=> modal.classList.add('hidden'));
  recalc?.addEventListener('click', ()=>{
    const rows = (window.__dashRows || []).filter(r=>r.required>0);
    renderRecsModal(rows, capInp?.value);
  });
})();

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', async ()=>{
  try { await requireAuth(); } catch { return; }
  wireLogoutButton();

  document.getElementById('filterContracted')?.addEventListener('change', loadDashboard);

  loadDashboard();

  // expose for inline usage elsewhere
  window.openLogModal = openLogModal;
});
