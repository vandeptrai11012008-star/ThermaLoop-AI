"""Fit a frozen lightweight router; import attributed, qualified trace reservations.

Only training labels fit coefficients. Calibration *scores* set fixed routing
thresholds; calibration/test labels never select parameters or thresholds.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import platform
import re
import ssl
import urllib.request

import numpy as np
import scipy
import sklearn
from sklearn.feature_extraction.text import HashingVectorizer, TfidfTransformer
from sklearn.linear_model import Ridge

ROOT = Path(__file__).resolve().parents[1]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def sources():
    wanted = {"routing.csv", "routing-contaminated.jsonl", "scheduling.csv"}
    result = [dict(s) for s in json.loads((ROOT/"science/data/sources.json").read_text()) if s["id"] in wanted]
    snapshot = ROOT/"science/workloads/alibaba-readme.md"
    result.append({"id":"alibaba-readme.md", "repository":"alibaba/clusterdata",
                   "commit":"3858992ca41bf92082e6d6522ddf0bebd14e838b",
                   "url":"https://raw.githubusercontent.com/alibaba/clusterdata/3858992ca41bf92082e6d6522ddf0bebd14e838b/cluster-trace-gpu-v2023/README.md",
                   "sha256":digest(snapshot.read_bytes()),"bytes":snapshot.stat().st_size,
                   "kind":"Upstream timestamp/unit documentation", "license":"No explicit data license located; attribution is not a license grant"})
    return result


def read_verified(cache):
    result = {}
    context = ssl.create_default_context()
    for source in sources():
        path = cache/source["id"]
        if source["id"] == "alibaba-readme.md":
            path = ROOT/"science/workloads/alibaba-readme.md"
        if not path.exists():
            with urllib.request.urlopen(source["url"],context=context,timeout=45) as response:
                raw=response.read()
            cache.mkdir(parents=True,exist_ok=True)
            path.write_bytes(raw)
        raw=path.read_bytes()
        if digest(raw)!=source["sha256"] or len(raw)!=source["bytes"]:
            raise ValueError("Upstream content identity differs: "+source["id"])
        result[source["id"]]=raw.decode("utf-8")
    return result


def routing_rows(raw):
    excluded={json.loads(line)["eval_prompt"] for line in raw["routing-contaminated.jsonl"].splitlines() if line.strip()}
    rows=[]
    for i,row in enumerate(csv.DictReader(io.StringIO(raw["routing.csv"]))):
        if row["prompt"] in excluded:
            continue
        normalized=re.sub(r"\s+"," ",row["prompt"].casefold()).strip()
        weak,strong=row["mistralai/Mixtral-8x7B-Instruct-v0.1"],row["gpt-4-1106-preview"]
        if weak not in ["True","False"] or strong not in ["True","False"]:
            raise ValueError("Invalid published correctness outcome")
        rows.append({"row":i,"id":digest(row["prompt"].encode()),"group":digest(normalized.encode()),
                     "prompt":row["prompt"],"weak":weak=="True","strong":strong=="True"})
    return rows


def partitions(rows, config):
    groups=sorted({r["group"] for r in rows},key=lambda group:digest(f"split-v1|{config['splitSeed']}|{group}".encode()))
    ntrain=int(len(groups)*config["trainFraction"])
    ncal=int(len(groups)*config["calibrationFraction"])
    labels={g:("train" if i<ntrain else "calibration" if i<ntrain+ncal else "test") for i,g in enumerate(groups)}
    return {key:[r for r in rows if labels[r["group"]]==key] for key in ["train","calibration","test"]}


def fit_router(rows, config):
    split=partitions(rows,config)
    vectorizer=HashingVectorizer(n_features=config["hashFeatures"],alternate_sign=False,
        norm=None,ngram_range=(1,2),lowercase=True,token_pattern=r"(?u)\b\w\w+\b")
    transform=TfidfTransformer(sublinear_tf=True,norm="l2",smooth_idf=True)
    train=split["train"]
    X=transform.fit_transform(vectorizer.transform([r["prompt"] for r in train]))
    # Positive score predicts an accuracy advantage for the strong model.
    target=np.array([int(r["strong"])-int(r["weak"]) for r in train],dtype=float)
    model=Ridge(alpha=config["ridgeAlpha"],solver="lsqr",tol=1e-10)
    model.fit(X,target)
    def scores(records):
        return model.predict(transform.transform(vectorizer.transform([r["prompt"] for r in records])))
    cal_scores=scores(split["calibration"])
    thresholds=[]
    # Linear quantile is fixed a priori; ties route to weak and can exceed target.
    for share in config["weakShares"]:
        threshold=float(np.quantile(cal_scores,share,method="linear"))
        thresholds.append({"targetWeakShare":share,"threshold":threshold,
                           "calibrationRealizedShare":float(np.mean(cal_scores<=threshold))})
    test=split["test"]
    predictions=[{k:r[k] for k in ["row","id","group","weak","strong"]} | {"score":float(score)} for r,score in zip(test,scores(test),strict=True)]
    return {"method":"Hashed word unigram/bigram TF-IDF + ridge regression of strong-minus-weak correctness; not RouteLLM",
            "partitions":{key:[{"id":r["id"],"group":r["group"],"row":r["row"]} for r in values] for key,values in split.items()},
            "thresholds":thresholds,"testRecords":predictions,
            "fittedModel":{"idf":transform.idf_.tolist(),"coefficients":model.coef_.tolist(),"intercept":float(model.intercept_)},
            "energyJ":None,"latencyMs":None,
            "scope":"Retrospective within-GSM8K holdout. Labels are cached model outcomes; no new LLM inference. All test results are now inspectable and must not be reused for further tuning as untouched data."}


def trace_rows(raw):
    original=list(csv.DictReader(io.StringIO(raw)))
    kept=[];excluded={}
    for row in original:
        reason=None
        if int(row["num_gpu"])!=1 or row["gpu_spec"].strip():
            reason="not_single_unconstrained_GPU"
        elif row["pod_phase"] not in ["Succeeded","Failed"]:
            reason="not_terminated_in_trace"
        else:
            try:
                arrival,scheduled,deleted=[float(row[k]) for k in ["creation_time","scheduled_time","deletion_time"]]
                milli=int(row["gpu_milli"])
                if not np.isfinite([arrival,scheduled,deleted]).all() or not arrival<=scheduled<deleted or not 0<milli<=1000:
                    reason="invalid_interval_or_request"
            except (ValueError,TypeError):
                reason="invalid_interval_or_request"
        if reason:
            excluded[reason]=excluded.get(reason,0)+1
            continue
        kept.append({"id":row["name"],"gpuMilli":milli,"creationSeconds":arrival,
                     "scheduledSeconds":scheduled,"deletionSeconds":deleted,
                     "reservationSeconds":deleted-scheduled,"sourcePhase":row["pod_phase"]})
    kept.sort(key=lambda r:(r["creationSeconds"],r["id"]))
    if not kept or len({r["id"] for r in kept})!=len(kept):
        raise ValueError("Empty or nonunique reservation trace")
    phases={phase:sum(r["sourcePhase"]==phase for r in kept) for phase in ["Succeeded","Failed"]}
    return {"originalCount":len(original),"excluded":excluded,"sourcePhases":phases,"records":kept,
            "scope":"Recorded deletion-minus-scheduled residence is a fixed reservation-duration proxy, not measured GPU service time. Source failures remain failures; simulated release is not successful work completion. CPU/RAM/VRAM, device heterogeneity, interference and preemption are not modeled."}


def fingerprint():
    files=[*sorted((ROOT/"workloads").glob("*.py")),ROOT/"workloads/protocol.json",
           ROOT/"requirements-workloads.txt",ROOT/"scripts/prepare_workloads.py",ROOT/"science/data/sources.json",
           ROOT/"science/workloads/alibaba-readme.md"]
    return {str(p.relative_to(ROOT)):digest(p.read_bytes()) for p in files}


def prepare(cache):
    config=json.loads((ROOT/"workloads/protocol.json").read_text())
    raw=read_verified(cache)
    return {"schemaVersion":1,"kind":"Public-outcome router holdout and counterfactual GPU reservation replay; not deployment measurements",
            "protocol":config,"sources":sources(),"sourceHashes":fingerprint(),
            "environment":{"python":platform.python_version(),"numpy":np.__version__,"scipy":scipy.__version__,"sklearn":sklearn.__version__},
            "routing":fit_router(routing_rows(raw),config),"scheduling":trace_rows(raw["scheduling.csv"])}
