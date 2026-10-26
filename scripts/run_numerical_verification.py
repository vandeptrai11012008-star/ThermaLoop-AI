#!/usr/bin/env python3
"""Generate offline numerical evidence; --compare independently reruns a saved protocol."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from research.verification import run_suite


def compare_runs(current,saved):
    if current["schemaVersion"]!=saved["schemaVersion"]:
        raise ValueError("Numerical artifact schema differs; regenerate and review")
    if current["sourceHashes"] != saved["sourceHashes"]:
        raise ValueError("Saved numerical evidence has different source/configuration hashes; regenerate and review")
    # Reproduction budget is 1% of the declared temperature resolution;
    # this is not an experimental confidence interval or accuracy claim.
    budget=current["protocol"]["temperature_target_C"]*.01
    changes=[];timing=[];heat=[];dimensionless=[]
    def difference(a,b,label):
        if (a is None)!=(b is None):
            raise ValueError("Reproduction differs in applicability: "+label)
        return 0. if a is None else abs(a-b)
    for kind in ["lumped","1d"]:
        a,b=current["models"][kind],saved["models"][kind]
        for metric in ["peak_temperature_C","final_temperature_C"]:
            changes.append(abs(a["reference"][metric]-b["reference"][metric]))
        timing.append(difference(a["reference"]["threshold_crossing_s"],b["reference"]["threshold_crossing_s"],kind+" threshold"))
        changes.extend(abs(a["clock"][key]-b["clock"][key]) for key in ["legacy_difference_C","corrected_max_difference_C"])
        for key in ["input_energy_J","final_rejected_energy_J","final_stored_energy_change_J"]:
            heat.append(abs(a["energy"][key]-b["energy"][key]))
        for study in ["step_limits","tolerance_levels"]:
            for ca,cb in zip(a[study],b[study],strict=True):
                if any(ca[k]!=cb[k] for k in ["rtol","atol","max_step"]):
                    raise ValueError("Reproduction has different solver controls")
                changes.append(abs(ca["max_trajectory_error_C"]-cb["max_trajectory_error_C"]))
                timing.append(difference(ca["threshold_error_s"],cb["threshold_error_s"],kind+" threshold error"))
                heat.append(abs(ca["integrated_external_heat_J"]-cb["integrated_external_heat_J"]))
    for a,b in zip(current["spatial"]["rows"],saved["spatial"]["rows"],strict=True):
        if a["cells"]!=b["cells"]:
            raise ValueError("Reproduction has different spatial resolutions")
        changes.append(abs(a["steady_temperature_C"]-b["steady_temperature_C"]))
        changes.append(abs(a["transient"]["peak_temperature_C"]-b["transient"]["peak_temperature_C"]))
        timing.append(difference(a["transient"]["threshold_crossing_s"],b["transient"]["threshold_crossing_s"],"spatial threshold"))
        heat.append(abs(a["transient"]["integrated_external_heat_J"]-b["transient"]["integrated_external_heat_J"]))
    for key in ["NTU","isothermal_effectiveness","lumped_counterflow_effectiveness"]:
        dimensionless.append(abs(current["CDU"][key]-saved["CDU"][key]))
    if any(current["CDU"][key]!=saved["CDU"][key] for key in ["mesh_cells","cdu_cells"]):
        raise ValueError("CDU diagnostic uses a different mesh")
    maximum=max(changes)
    if maximum>budget:
        raise ValueError(f"Cross-environment temperature difference {maximum:g} C exceeds declared reproduction budget {budget:g} C")
    time_budget=current["protocol"]["threshold_time_target_s"]*.01
    energy_budget=current["protocol"]["integrated_heat_relative_target"]*.01*max(s["energy"]["input_energy_J"] for s in current["models"].values())
    if max(timing)>time_budget:
        raise ValueError("Cross-environment timing difference exceeds declared reproduction budget")
    if max(heat)>energy_budget:
        raise ValueError("Cross-environment heat/energy difference exceeds declared reproduction budget")
    if max(dimensionless)>1e-10:
        raise ValueError("CDU metric reproduction differs beyond floating-point budget")
    return {"max_temperature_difference_C":maximum,"reproduction_budget_C":budget,
            "max_time_difference_s":max(timing),"time_budget_s":time_budget,
            "max_heat_difference_J":max(heat),"heat_budget_J":energy_budget,
            "max_CDU_difference":max(dimensionless),"CDU_budget":1e-10}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=ROOT/"science/numerical/results.json")
    parser.add_argument("--compare",type=Path)
    args=parser.parse_args()
    print("Running fixed-input, fixed-property numerical verification…",flush=True)
    report=run_suite()
    if args.compare:
        print(json.dumps(compare_runs(report,json.loads(args.compare.read_text())),indent=2),flush=True)
    else:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,indent=2,sort_keys=True,allow_nan=False)+"\n")
        print("Report:",args.output,flush=True)
    print(json.dumps({"gates":report["gates"],"steady_grid":report["spatial"]["first_steady_grid_meeting_target"]},indent=2),flush=True)
    if not all(report["gates"].values()):
        raise SystemExit("Numerical target not met; inspect results, do not relabel as a pass")


if __name__=="__main__":
    main()
