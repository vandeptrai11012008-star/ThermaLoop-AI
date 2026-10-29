/* Web Service-only canonical-world handoff for the original 3D campus view.
 * Never rewrites the legacy 64-GPU model's illustrative telemetry. */
(()=>{'use strict';
  const engine=globalThis.ThermaUnifiedPhysics;
  const container=document.querySelector('.world-frame .world-top');
  if(!container||!engine)return;
  container.style.flexWrap='wrap';
  const strip=document.createElement('div');strip.setAttribute('aria-label','Shared physics engine snapshot');
  strip.style.cssText='display:flex;flex-wrap:wrap;gap:10px;align-items:center;border:1px solid #34738b;background:#0b2b3a;border-radius:8px;padding:7px 10px;margin-left:auto;font-size:10px;max-width:560px';
  const label=document.createElement('strong');label.style.color='#a1f8d9';label.textContent='CANONICAL v1.5';
  const readout=document.createElement('span');readout.style.cssText='font-variant-numeric:tabular-nums;color:#c5e7ef';
  const action=document.createElement('a');action.href='/physics-lab';action.style.cssText='color:#aaf4f3;text-decoration:underline';action.textContent='Open physical world ↗';
  strip.append(label,readout,action);container.append(strip);
  const note=document.createElement('p');note.style.cssText='color:#78aec2;font-size:10px;line-height:1.45;margin:0 0 8px 1px';
  note.textContent='Physics v1.5 above is a shared browser-local solver snapshot. The legacy 64-GPU 3D scene below remains an illustrative reference, not an independently calibrated physical circuit.';
  container.parentNode.insertBefore(note,container.nextSibling);
  function render(){try{const raw=localStorage.getItem('thermaloop-unified-world-v15');
    if(!raw){readout.textContent='No episode yet · create one in Physics Lab';return;}
    const snap=JSON.parse(raw);if(snap.version!==engine.VERSION)throw Error('version');
    const w=snap.world,x=w.state;
    if(!Number.isInteger(w.minute)||!['gpuC','coolantC','buildingC'].every(k=>Number.isFinite(x[k]))||
      !Array.isArray(w.topology.nodes))throw Error('state');
    const flow=w.hydraulics?.flowLps;
    readout.textContent=`t=${w.minute}m · GPU ${x.gpuC.toFixed(1)}° · water ${x.coolantC.toFixed(1)}° · room ${x.buildingC.toFixed(1)}°`+
      (Number.isFinite(flow)?` · ${flow.toFixed(2)} L/s`:'');
  }catch{readout.textContent='Snapshot invalid; open lab to regenerate';}}
  render();window.addEventListener('storage',e=>{if(e.key==='thermaloop-unified-world-v15')render();});
})();
