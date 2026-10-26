#!/usr/bin/env python3
"""Generate/reproduce physical-model evidence without replacing legacy results."""
import argparse
import json
import math
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from physics.verification import run_suite


def compare(a,b):
    for key in ["schemaVersion","protocol","sources","sourceHashes","parameters","geometry","gates","first_grid_meeting_target"]:
        if a[key]!=b[key]:raise ValueError("Physical-model identity differs: "+key)
    temp=[];heat=[];dimensionless=[]
    def near(x,y,path=""):
        if path.endswith("evaluations"):return
        if isinstance(x,dict):
            if set(x)!=set(y):raise ValueError("Result keys differ: "+path)
            for k in x:near(x[k],y[k],path+"/"+k)
        elif isinstance(x,list):
            if len(x)!=len(y):raise ValueError("Result lengths differ: "+path)
            for i,(v,w) in enumerate(zip(x,y,strict=True)):near(v,w,path+f"/{i}")
        elif isinstance(x,(int,float)) and not isinstance(x,bool):
            if not isinstance(y,(int,float)) or not math.isfinite(y):raise ValueError("Nonfinite/invalid saved value: "+path)
            # Roundoff-level diagnostics/evaluation counts are not exactly portable.
            if "roundoff" in path:
                if not 0<=y<=1:raise ValueError("Saved differential energy check violates roundoff budget")
                return
            if "max_steady_rate" in path:return
            delta=abs(x-y)
            if any(k in path for k in ["_J","/input_J","/rejected_J","/stored_change_J"]):heat.append(delta)
            elif any(k in path for k in ["effectiveness","entropy","residual","capacity","time_s","_flow","_volume","/cells","/primary_cells","state_count","/solver/controls"]):dimensionless.append(delta)
            else:temp.append(delta)
        elif x!=y:raise ValueError("Saved result differs: "+path)
    for key in ["cases","primary_volume_sensitivity","spatial"]:near(a[key],b[key],key)
    maxima={"temperature_C":max(temp,default=0),"integrated_heat_J":max(heat,default=0),"other_numeric":max(dimensionless,default=0)}
    if maxima["temperature_C"]>1e-5 or maxima["integrated_heat_J"]>.01 or maxima["other_numeric"]>1e-8:
        raise ValueError("Physical-model reproduction exceeds declared budgets: "+str(maxima))
    return maxima


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--compare",type=Path);args=parser.parse_args()
    report=run_suite()
    if args.compare:print(json.dumps(compare(report,json.loads(args.compare.read_text())),indent=2),flush=True)
    else:
        path=ROOT/"science/physics/results.json";path.write_text(json.dumps(report,indent=2,sort_keys=True,allow_nan=False)+"\n");print("Wrote",path,flush=True)
    print(json.dumps({"gates":report["gates"],"first_grid_meeting_target":report["first_grid_meeting_target"]},indent=2),flush=True)
    if not all(report["gates"].values()):raise SystemExit("Physical-model check unmet; inspect instead of relabeling a pass")
