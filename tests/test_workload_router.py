"""Adversarial leakage and trace-meaning checks, separate from thermal verification."""
import copy
import json
from pathlib import Path

import numpy as np

from workloads.prepare import fit_router, partitions, routing_rows, trace_rows
from scripts.prepare_workloads import compare

ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/"workloads/protocol.json").read_text())


def examples():
    return [{"id":str(i),"group":str(i//2),"row":i,"prompt":f"Calculate {i//2} apples and {i%9} baskets how many remain",
             "weak":i%3==0,"strong":i%5!=0} for i in range(100)]


def test_duplicate_groups_cannot_cross_partitions():
    split=partitions(examples(),CONFIG)
    groups=[{r["group"] for r in rows} for rows in split.values()]
    assert not groups[0]&groups[1] and not groups[0]&groups[2] and not groups[1]&groups[2]
    assert sum(map(len,split.values()))==100


def test_test_and_calibration_labels_cannot_change_fit_thresholds_or_decisions():
    rows=examples();original=fit_router(rows,CONFIG)
    protected={r["id"] for key,values in original["partitions"].items() if key!="train" for r in values}
    changed=[dict(r,weak=not r["weak"],strong=not r["strong"]) if r["id"] in protected else r for r in rows]
    after=fit_router(changed,CONFIG)
    assert original["fittedModel"]==after["fittedModel"]
    assert original["thresholds"]==after["thresholds"]
    assert [r["score"] for r in original["testRecords"]]==[r["score"] for r in after["testRecords"]]
    assert original["testRecords"]!=after["testRecords"]


def test_training_labels_actually_fit_the_model():
    rows=examples();a=fit_router(rows,CONFIG)
    b=fit_router([dict(r,strong=True,weak=False) for r in rows],CONFIG)
    assert a["fittedModel"]!=b["fittedModel"]


def test_test_text_cannot_change_training_idf_coefficients_or_calibration_thresholds():
    rows=examples();a=fit_router(rows,CONFIG)
    test_ids={r["id"] for r in a["partitions"]["test"]}
    changed=[dict(r,prompt="entirely new unseen vocabulary qzx repeated qzx") if r["id"] in test_ids else r for r in rows]
    b=fit_router(changed,CONFIG)
    assert a["fittedModel"]==b["fittedModel"]
    assert a["thresholds"]==b["thresholds"]
    assert [r["score"] for r in a["testRecords"]]!=[r["score"] for r in b["testRecords"]]


def test_published_outcome_loader_excludes_contamination_and_groups_case_whitespace():
    raw={"routing-contaminated.jsonl":json.dumps({"eval_prompt":"excluded"}),
         "routing.csv":'prompt,mistralai/Mixtral-8x7B-Instruct-v0.1,gpt-4-1106-preview\nexcluded,True,True\nSame   text,True,False\nsame text,False,True\n'}
    result=routing_rows(raw)
    assert len(result)==2 and result[0]["group"]==result[1]["group"]
    assert result[0]["id"]!=result[1]["id"]


def test_trace_residence_is_not_creation_to_deletion_or_success_only():
    raw='name,num_gpu,gpu_spec,pod_phase,creation_time,scheduled_time,deletion_time,gpu_milli\na,1,,Succeeded,0,3,13,500\nb,1,,Failed,0,2,7,1000\nc,1,,Running,0,1,10,200\nd,1,,Pending,0,,10,1000\ne,1,,Failed,9,2,10,1000\n'
    result=trace_rows(raw)
    assert [r["reservationSeconds"] for r in result["records"]]==[10,5]
    assert result["sourcePhases"]=={"Succeeded":1,"Failed":1}
    assert sum(result["excluded"].values())+len(result["records"])==5
    assert "not measured GPU service time" in result["scope"]


def test_committed_partitions_and_scores_are_finite_and_disjoint():
    data=json.loads((ROOT/"science/workloads/data.json").read_text())
    groups=[{r["group"] for r in values} for values in data["routing"]["partitions"].values()]
    assert all(not groups[i]&groups[j] for i in range(3) for j in range(i))
    assert sum(len(v) for v in data["routing"]["partitions"].values())==1307
    assert np.isfinite([r["score"] for r in data["routing"]["testRecords"]]).all()
    assert data["scheduling"]["sourcePhases"]=={"Succeeded":178,"Failed":1813}


def test_reproduction_rejects_changed_outcomes_and_decisions():
    import pytest
    saved=json.loads((ROOT/"science/workloads/data.json").read_text())
    changed=copy.deepcopy(saved);changed["routing"]["testRecords"][0]["weak"]=not changed["routing"]["testRecords"][0]["weak"]
    with pytest.raises(ValueError,match="outcome identity"):
        compare(changed,saved)
    changed=copy.deepcopy(saved);changed["routing"]["thresholds"][0]["threshold"]=-100
    with pytest.raises(ValueError,match="decisions differ"):
        compare(changed,saved)
