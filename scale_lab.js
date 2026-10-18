
<script>
/* ThermaLoop Scale & Economics Lab — synthetic, constraint-aware extension. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const labels=['scDaily','scPeak','scHeadroom','scSpare','scOffPrice','scPeakPrice','scSolar','scHeatRate','scHeatBuyer','scGpuCapex','scThermalCapex','scProjectCapex','scSoftwareOpex','scDays','scLatencyLimit','scRemote','scLongShare','scContext','scVram','scWeights','scKv','scConcurrent','scBatch','scDeadline','scBaseLatency','scFault'];
let current=null;
const val=id=>+$(id).value;
const money=(x,dec=0)=>Number.isFinite(x)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:dec,minimumFractionDigits:dec}).format(x):'—';
const num=(x,dec=0)=>Number.isFinite(x)?new Intl.NumberFormat('en-US',{maximumFractionDigits:dec}).format(x):'—';
const pct=x=>num(x,1)+'%';
const frac=x=>clamp(x,0,100)/100;
const status=(key,ok,title,msg,kind)=>`<article class="scale-constraint${ok?'':' fail'}"><strong>${title}</strong><div class="status">${ok?'PASS':'CHECK'} · ${key}</div><p>${msg}</p></article>`;
function read(){return Object.fromEntries(labels.map(id=>[id.slice(2),val(id)]))}
function hourWeight(h){let v=.69+.23*Math.cos((h-13)/12*Math.PI)+.40*Math.exp(-Math.pow((h-17)/4,2))+.23*Math.exp(-Math.pow((h-9)/3,2));return Math.max(.16,v)}
function hourlyProfile(daily,batchFrac){const w=Array.from({length:24},(_,h)=>hourWeight(h)),s=w.reduce((a,b)=>a+b,0);let interactive=w.map(q=>daily*(1-batchFrac)*q/s);let batch=w.map(q=>daily*batchFrac*q/s);return {interactive,batch,before:w.map((q,i)=>interactive[i]+batch[i])}}
function hourlyRates(c){return Array.from({length:24},(_,h)=>{let peak=h>=16&&h<=21;const tariff=peak?c.PeakPrice:c.OffPrice;const sun=Math.max(0,Math.sin(Math.PI*(h-6)/13));const solar=frac(c.Solar)*sun;return {tariff,solar,eff:tariff*(1-solar)}})}
function calculate(){const e=window.ThermaCompare?.getExperiment?.();if(!e)return null;const c=read(),before=e.before,after=e.after;
const daily=Math.max(1,c.Daily),peak=Math.max(1,c.Peak),reserve=frac(c.Headroom),spare=c.Spare>0?1:0,days=clamp(c.Days,1,366),batchFrac=frac(c.Batch),longFrac=frac(c.LongShare);
const contextMultiplier=1+longFrac*Math.max(0,c.Context/8192-1)*.45;
const vramNeed=c.Weights+c.Kv*(c.Context/1000)*c.Concurrent;
const vramPass=vramNeed<=c.Vram || longFrac<1e-7;
const effectivePeak=daily/24*peak;
const maxPods=6000;
function size(result){const original=Math.max(1,result.done),rate=original/Math.max(1,contextMultiplier);let operating=1,lat=Infinity,peakLoad=1;
 for(let i=1;i<=maxPods;i++){
  const availRate=rate*Math.max(.05,1-reserve)*i;
  const rho=effectivePeak/Math.max(1,availRate);
  const contextPenalty=1+longFrac*Math.sqrt(Math.max(0,c.Context/8192-1))*.3;
  const queuing=Math.min(.975,Math.max(0,rho));
  const latProxy=Math.max(0,c.Remote)+c.BaseLatency*contextPenalty*(1+1.8*queuing/Math.max(.025,1-queuing));
  if(rho<=.83 && latProxy<=c.LatencyLimit){operating=i;lat=latProxy;peakLoad=rho;break;}
  if(i===maxPods){operating=i;lat=latProxy;peakLoad=rho;}
 }
 const pods=operating+spare;
 const failPods=pods-(c.Fault?1:0);
 const safeFailure=failPods>=operating&&vramPass&&operating<maxPods;
 return {rate,operating,pods,lat,peakLoad,failPods,safeFailure,limited:operating>=maxPods};}
 const b=size(before),a=size(after);
 const fleet=Math.max(b.pods,a.pods),rates=hourlyRates(c),h=hourlyProfile(daily,batchFrac);
 const tasksBefore=h.before, tasksAfter=h.before.slice();
 const available=Array.from({length:24},(_,hr)=>fleet*Math.max(1,a.rate)*(1-reserve)-h.interactive[hr]);
 const batchShift=Array(24).fill(0);
 let deadlinesMet=true,shifts=0;
 for(let hr=0;hr<24;hr++){
  let amount=h.batch[hr];const future=[];
  for(let slot=hr;slot<=Math.min(23,hr+Math.max(0,c.Deadline));slot++)future.push(slot);
  future.sort((x,y)=>rates[x].eff-rates[y].eff||x-y);
  for(const slot of future){if(amount<=.001)break;const free=Math.max(0,available[slot]);const delivered=Math.min(free,amount);batchShift[slot]+=delivered;available[slot]-=delivered;amount-=delivered;if(slot!==hr)shifts+=delivered;}
  if(amount>.001){batchShift[hr]+=amount;available[hr]-=amount;deadlinesMet=false;}
 }
 for(let i=0;i<24;i++)tasksAfter[i]=h.interactive[i]+batchShift[i];
 const idlePod=Math.max(19+64*.14+4.5,Math.min(before.site,after.site)*.36); // estimated always-on floor
 const beforeDyn=Math.max(0,before.site-idlePod),afterDyn=Math.max(0,after.site-idlePod);
 function tariffBill(result,sz,tasks){const dyn=Math.max(0,result.site-idlePod), perTask=dyn/Math.max(1,sz.rate),dailyEnergy=24*fleet*idlePod+daily*perTask;
  const dailyBill=rates.reduce((sum,r,hr)=>sum+(fleet*idlePod+tasks[hr]*perTask)*r.eff,0);
  return {bill:dailyBill,energy:dailyEnergy};}
 const pre=tariffBill(before,b,tasksBefore),unshifted=tariffBill(after,a,tasksBefore),opt=tariffBill(after,a,tasksAfter);
 const elecSavings=(pre.bill-opt.bill)*days,algorithmSavings=(pre.bill-unshifted.bill)*days,shiftSavings=(unshifted.bill-opt.bill)*days;
 const netSavings=elecSavings-c.SoftwareOpex,energySaved=(pre.energy-opt.energy)*days;
 const capexPossible=(b.pods-a.pods)*64*c.GpuCapex;
 const capexExtra=c.ProjectCapex,capexAnnual=netSavings>0?capexExtra/netSavings:Infinity;
 const utilizationBefore=daily/Math.max(1,b.rate*(fleet-spare)*24),utilizationAfter=daily/Math.max(1,a.rate*(fleet-spare)*24);
 const heatThermalPerPod=Math.max(0,after.heat);
 const heatAnnualPotential=Math.min(Math.max(0,heatThermalPerPod*fleet*24),Math.max(0,c.HeatBuyer))*days*c.HeatRate;
 const latencyPass=Number.isFinite(a.lat)&&a.lat<=c.LatencyLimit&&!a.limited;
 const burstPass=a.peakLoad<=.83&&!a.limited;
 const faultPass=c.Fault? a.safeFailure : (spare? a.pods-1>=a.operating : false);
 const fixedWorkPass=(Math.abs(tasksBefore.reduce((s,x)=>s+x,0)-tasksAfter.reduce((s,x)=>s+x,0))<Math.max(1e-7,daily*1e-10))&& (daily<=fleet*a.rate*24+.0001);
 const feasible=vramPass&&latencyPass&&burstPass&&deadlinesMet&&fixedWorkPass&&faultPass;
 return {e,c,daily,peak,spare,fleet,days,b,a,latencyPass,burstPass,faultPass,vramPass,fixedWorkPass,deadlinesMet,feasible,contextMultiplier,vramNeed,tasksBefore,tasksAfter,rates,shifts,pre,unshifted,opt,elecSavings,algorithmSavings,shiftSavings,netSavings,energySaved,capexPossible,capexExtra,capexAnnual,heatAnnualPotential,idlePod,utilizationBefore,utilizationAfter};}
function row(label,value,className=''){return `<div class="scale-money-item ${className}"><span>${label}</span><strong>${value}</strong></div>`}
function put(id,str){const x=$(id);if(x)x.textContent=str}
function show(r){if(!r)return;current=r;const {c,b,a}=r;
put('scFeasibilityBadge',r.feasible?'CONSTRAINTS PASS · SYNTHETIC':'CONSTRAINTS NOT MET');$('scFeasibilityBadge').classList.toggle('fail',!r.feasible);put('scPodsBefore',num(b.pods));put('scPodsAfter',num(a.pods));put('scGpuBefore',num(b.pods*64)+' GPUs · '+num(b.operating)+' operating pods');put('scGpuAfter',num(a.pods*64)+' GPUs · '+num(a.operating)+' operating pods');put('scAnnualGross',money(r.elecSavings));put('scAnnualNet',money(r.netSavings));
const annualBillB=r.pre.bill*r.days,annualBillA=r.opt.bill*r.days;
$('scMoneyBreakdown').innerHTML=row('Baseline grid bill · annual',money(annualBillB))+row('Optimized grid bill · annual',money(annualBillA))+row('Compute energy benefit · annual',money(r.algorithmSavings))+row('Batch price-shifting benefit · annual',money(r.shiftSavings))+row('Site electricity energy delta',num(r.energySaved)+' kWh/year')+row('Total grid bill savings',money(r.elecSavings),'major')+row('Added software operating cost',money(c.SoftwareOpex),'cost')+row('Annual net change',money(r.netSavings),'major');
$('scSizingBreakdown').innerHTML=row('Common paid-for fleet',num(r.fleet)+' pods · '+num(r.fleet*64)+' GPUs')+row('Baseline-sized GPU requirement',num(b.pods*64)+' GPUs')+row('Optimized GPU requirement',num(a.pods*64)+' GPUs')+row('GPU/hardware capital cost · baseline',money(b.pods*64*c.GpuCapex))+row('GPU/hardware capital cost · optimized',money(a.pods*64*c.GpuCapex))+row('Shared campus heat-loop CAPEX',money(c.ThermalCapex))+row('Total optimized project setup & hardware',money(a.pods*64*c.GpuCapex+c.ThermalCapex+c.ProjectCapex))+row('Separate right-sizing CAPEX opportunity',money(r.capexPossible),'major')+row('N+1 reserve hardware component',money(r.spare*64*c.GpuCapex),'cost')+row('Additional software setup investment',money(r.capexExtra),'cost')+row('Simple payback on setup',Number.isFinite(r.capexAnnual)?num(r.capexAnnual,1)+' years':'Not reached')+row('Heat-use market value (NOT added)',money(r.heatAnnualPotential));
const cases=[
  status('Interactive latency',r.latencyPass,'01 · Interactive P95 latency','Optimized '+num(a.lat,0)+' ms vs limit '+num(c.LatencyLimit)+' ms; includes '+num(c.Remote)+' ms network RTT. Queueing is a proxy, not measured TTFT.'),
  status('Fixed daily task volume',r.fixedWorkPass,'02 · Fixed daily task volume','Both modeled schedules contain '+num(r.daily)+' tasks/day. Idle hardware remains on; turning servers off is not the saving mechanism.'),
  status('Long-context GPU VRAM',r.vramPass,'03 · Long-context VRAM constraint','Illustrative demand '+num(r.vramNeed,1)+' GiB vs '+num(c.Vram)+' GiB/GPU. '+(r.vramPass?'Within this synthetic device envelope.':'Does not fit per GPU; add KV optimization, reduce concurrency, or model sharding.')+' Assumed context slowdown ×'+num(r.contextMultiplier,2)+'.'),
  status('Batch deadline window',r.deadlinesMet,'04 · Flexible batch deadlines',num(r.shifts)+' tasks shifted to cheaper/solar hours within '+num(c.Deadline)+' h max delay. '+(r.deadlinesMet?'Allocation fits available slots.':'Some shifted jobs could not fit within the allowed window; projected savings are conditional.')),
  status('Demand burst sizing',r.burstPass,'05 · Demand burst','Designed for peak '+num(r.peak)+'× daily average at ≤83% assumed effective capacity utilization. Optimized fleet: '+num(a.pods)+' pods.'),
  status('Failure / spare capacity',r.faultPass,'06 · Failure test / N+1','Optimized '+num(a.operating)+' working pods + '+num(r.spare)+' spare. '+(c.Fault?'One whole 64-GPU pod is currently unavailable.':'Select pod failure to test contingency.')+' Reserve has hardware cost.')];
$('scConditionCards').innerHTML=cases.join('');
$('scExplanation').innerHTML='<b>Comparability:</b> both financial cases assume a fixed daily volume of <b>'+num(r.daily)+' requests</b>, with all '+num(r.fleet)+' installed pods remaining powered 24/7. A common fleet is chosen so the comparison does not hide work by switching servers off. <b>Financial components:</b> '+money(r.algorithmSavings)+' /year from the simulated compute envelope, '+money(r.shiftSavings)+' /year from deadline-limited scheduling, minus '+money(c.SoftwareOpex)+' /year software OPEX. <b>Deployability:</b> '+(r.feasible?'<span style="color:#90e8c7">all six simplified constraint tests pass</span>':'<span style="color:#ffb995">one or more project constraints are not met; numbers above are conditional estimates, not achievable savings</span>')+'. Hardware CAPEX avoidance ('+money(r.capexPossible)+') and heat reuse value are deliberately reported separately, NOT included in the annual energy bill savings. Running 64-GPU simulator request length and long-context memory are <b>proxies</b> in this economics module.';
put('scShiftNote',num(r.shifts)+' batch requests/day shift to lower effective grid-price hours · '+(r.deadlinesMet?'all modeled deadlines fit':'some deadlines are infeasible')+'. Tasks are never discarded.');
for(const canvas of [$('scWorkChart'),$('scRateChart')])if(canvas&&canvas.getBoundingClientRect().width)drawCharts(r);
}
function drawLine(id,series,maxScale,format){const canvas=$(id);if(!canvas||canvas.closest('[hidden]'))return;const rect=canvas.getBoundingClientRect();if(rect.width<10)return;const W=rect.width,H=rect.height,dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);const top=16,left=40,right=W-10,bottom=H-30;const max=maxScale||Math.max(1,...series.flatMap(s=>s.v))*1.15;
for(let j=0;j<5;j++){const y=top+(bottom-top)*j/4;ctx.strokeStyle='#2a4457';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#7094aa';ctx.font='10px Segoe UI';ctx.fillText(format(max*(4-j)/4),0,y+3)}
for(const s of series){ctx.strokeStyle=s.color;ctx.lineWidth=2.3;ctx.beginPath();s.v.forEach((val,i)=>{const x=left+(right-left)*i/23,y=bottom-(val/max)*(bottom-top);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()}
ctx.fillStyle='#8fb0c0';for(const t of [0,6,12,18,23])ctx.fillText(t+'h',left+(right-left)*t/23-9,bottom+20)}
function drawCharts(r){drawLine('scWorkChart',[{v:r.tasksBefore,color:'#f1a47e'},{v:r.tasksAfter,color:'#6bdbe8'}],null,v=>num(v/1000,1)+'k');drawLine('scRateChart',[{v:r.rates.map(x=>x.tariff),color:'#f1a47e'},{v:r.rates.map(x=>x.eff),color:'#a6dda2'}],null,v=>'$'+num(v,2))}
function download(){if(!current)return;const {e,...data}=current;data.assumptions={note:'All values synthetic; financially unvalidated. GUI hardware pricing only illustrative; N+1 spare not operating capacity; fixed daily task workload retained.',sourceGPUReference:'ThermaLoop 64-GPU paired 60-minute simulator',referenceBefore:e.before.site,referenceAfter:e.after.site,referenceBeforeCompleted:e.before.done,referenceAfterCompleted:e.after.done};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ThermaLoop_Project_Scale_Financial_Conditions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function init(){for(const b of document.querySelectorAll('[data-scale-page]'))b.addEventListener('click',()=>{document.querySelectorAll('[data-scale-page]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-scale-panel]').forEach(x=>x.hidden=x.dataset.scalePanel!==b.dataset.scalePage);show(current||calculate())});for(const id of labels)$(id).addEventListener('input',()=>show(calculate()));$('scExport').addEventListener('click',download);const watch=document.getElementById('abAfterPower');if(watch){new MutationObserver(()=>show(calculate())).observe(watch,{childList:true,characterData:true,subtree:true})}window.addEventListener('resize',()=>current&&drawCharts(current));show(calculate());}
window.ThermaScaleLab={calculate,update:()=>show(calculate()),get current(){return current}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>
