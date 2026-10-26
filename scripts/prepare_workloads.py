#!/usr/bin/env python3
"""Rebuild/compare workload inputs and fitted router using verified public files."""
import argparse
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from workloads.prepare import prepare


def compare(current,saved):
    for key in ["schemaVersion","protocol","sources","sourceHashes","scheduling"]:
        if current[key]!=saved[key]:
            raise ValueError("Workload reproduction differs: "+key)
    a,b=current["routing"],saved["routing"]
    if a["partitions"]!=b["partitions"]:
        raise ValueError("Router partitions differ")
    deltas=[]
    for x,y in zip(a["testRecords"],b["testRecords"],strict=True):
        if {k:v for k,v in x.items() if k!="score"}!={k:v for k,v in y.items() if k!="score"}:
            raise ValueError("Test outcome identity differs")
        deltas.append(abs(x["score"]-y["score"]))
    for x,y in zip(a["thresholds"],b["thresholds"],strict=True):
        if x["targetWeakShare"]!=y["targetWeakShare"]:
            raise ValueError("Routing budget differs")
        deltas.append(abs(x["threshold"]-y["threshold"]))
        if [r["score"]<=x["threshold"] for r in a["testRecords"]]!=[r["score"]<=y["threshold"] for r in b["testRecords"]]:
            raise ValueError("Held-out routing decisions differ")
    for key in ["idf","coefficients"]:
        deltas.extend(abs(x-y) for x,y in zip(a["fittedModel"][key],b["fittedModel"][key],strict=True))
    deltas.append(abs(a["fittedModel"]["intercept"]-b["fittedModel"]["intercept"]))
    if max(deltas)>1e-8:
        raise ValueError("Router numerical reproduction exceeds 1e-8 score/coefficient budget")
    return {"maxNumericDifference":max(deltas),"budget":1e-8,"routingDecisionsIdentical":True}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache",type=Path,default=Path("/tmp/thermaloop-evidence-cache"))
    parser.add_argument("--compare",type=Path)
    args=parser.parse_args();result=prepare(args.cache)
    if args.compare:
        print(json.dumps(compare(result,json.loads(args.compare.read_text())),indent=2))
    else:
        path=ROOT/"science/workloads/data.json"
        path.write_text(json.dumps(result,indent=2,sort_keys=True,allow_nan=False)+"\n")
        print("Wrote",path)
    print("Router partitions:",{k:len(v) for k,v in result["routing"]["partitions"].items()})
    print("Reservation records:",len(result["scheduling"]["records"]),result["scheduling"]["sourcePhases"])
