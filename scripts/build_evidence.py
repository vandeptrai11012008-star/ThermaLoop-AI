#!/usr/bin/env python3
"""Build the offline evidence bundle; --refresh verifies pinned upstream bytes first."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "science/data"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def refresh(cache):
    sources = json.loads((DATA / "sources.json").read_text())
    raw = {}
    for source in sources:
        path = cache / source["id"]
        if path.exists():
            content = path.read_bytes()
        else:
            with urllib.request.urlopen(source["url"], timeout=90) as response:
                content = response.read()
            cache.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        if digest(content) != source["sha256"]:
            raise ValueError(f"Checksum mismatch: {source['id']}; refusing to import")
        raw[source["id"]] = content.decode("utf-8")

    exclusions = {json.loads(line)["eval_prompt"] for line in
                  raw["routing-contaminated.jsonl"].splitlines() if line.strip()}
    original = list(csv.DictReader(io.StringIO(raw["routing.csv"])))
    routing = []
    for index, row in enumerate(original):
        if row["prompt"] in exclusions:
            continue
        weak = row["mistralai/Mixtral-8x7B-Instruct-v0.1"]
        strong = row["gpt-4-1106-preview"]
        if weak not in ("True", "False") or strong not in ("True", "False"):
            raise ValueError("Missing/non-boolean routing outcome")
        routing.append({"row": index, "id": digest(row["prompt"].encode())[:16],
                        "weak": weak == "True", "strong": strong == "True"})

    pods = list(csv.DictReader(io.StringIO(raw["scheduling.csv"])))
    eligible = [r for r in pods if int(r["num_gpu"]) == 1 and not r["gpu_spec"].strip()
                and 0 < int(r["gpu_milli"]) <= 1000]
    eligible.sort(key=lambda r: (float(r["creation_time"]), r["name"]))
    scheduling = [{"id": r["name"], "gpuMilli": int(r["gpu_milli"]),
                   "creationSeconds": float(r["creation_time"])} for r in eligible[:256]]

    weather = []
    for line in raw["weather.mos"].splitlines():
        if not re.match(r"^\d", line):
            continue
        row = [float(x) for x in line.split()]
        assert len(row) == 30 and -70 < row[1] < 70 and 0 <= row[8] < 2000
        weather.append({"timeSeconds": row[0], "outsideC": row[1], "ghiWm2": row[8]})
    assert len(weather) == 8760
    assert all(b["timeSeconds"] - a["timeSeconds"] == 3600
               for a, b in zip(weather, weather[1:]))

    gpu = []
    keys = ("gpu_model", "num_gpus", "max_num_seqs", "avg_power_watts",
            "energy_per_token_joules", "energy_per_request_joules", "avg_output_len",
            "output_throughput_tokens_per_sec", "p95_itl_ms", "parallelization")
    for file, model in [("gpu-8b.json", "meta-llama/Llama-3.1-8B-Instruct"),
                        ("gpu-70b.json", "meta-llama/Llama-3.1-70B-Instruct")]:
        obj = json.loads(raw[file])
        for row in obj["configurations"]:
            if row["gpu_model"] == "H100":
                gpu.append({"model": model, "source": file, **{k: row[k] for k in keys}})

    hp = raw["heat-pump.mo"].split("    coo(")[0]
    def number(pattern):
        return float(re.search(pattern, hp)[1])
    heat_pump = {"capacityW": number(r"Q_flow\s*=\s*([\d.]+)"),
                 "electricW": number(r"\bP\s*=\s*([\d.]+)"),
                 "sourceC": number(r"TRefSou\s*=\s*([\d.]+)"),
                 "loadC": number(r"TRefLoa\s*=\s*([\d.]+)"),
                 "massFlowKgS": number(r"mLoa_flow\s*=\s*([\d.]+)")}
    params = json.loads(raw["greenhouse.json"])["Parameters"]["Table 1 (Katzin 2020)"]
    geometry = {key: {"value": float(params[key]["definition"]), "unit": params[key]["unit"],
                      "reference": params[key]["reference"]} for key in ("aFlr", "aCov", "hGh")}
    evidence = {
        "schemaVersion": 1, "sources": sources,
        "routing": {"records": routing, "originalCount": len(original),
                    "excludedCount": len(original) - len(routing),
                    "strongModel": "gpt-4-1106-preview",
                    "weakModel": "mistralai/Mixtral-8x7B-Instruct-v0.1"},
        "scheduling": {"records": scheduling, "originalCount": len(pods),
                       "eligibleCount": len(eligible), "selection": "First 256 single-GPU requests without GPU-type constraints, ordered by creation time then name"},
        "gpu": gpu,
        "weather": {"winter": weather[:168], "summer": weather[181 * 24:188 * 24],
                    "description": "Chicago O'Hare TMY3; first January week and July 1–7; local standard time UTC−6, no DST; no annual extrapolation",
                    "inputCount": len(weather)},
        "heatPump": heat_pump, "greenhouseGeometry": geometry,
    }
    (DATA / "evidence.json").write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
    print(f"Imported: {len(routing)} routing outcomes, {len(scheduling)} GPU requests, "
          f"{len(gpu)} GPU benchmark configurations, 336 weather hours")


def build(check=False):
    raw = (DATA / "evidence.json").read_bytes()
    obj = json.loads(raw)
    # Plain script works over file:// as well as HTTP; no fetch, CDN, key, or build runtime.
    bundle = ("/* Generated by scripts/build_evidence.py; do not edit. */\n"
              "globalThis.ThermaEvidenceData = " + json.dumps(obj, separators=(",", ":"), ensure_ascii=True)
              + ";\n")
    target = ROOT / "science/evidence-data.js"
    if check:
        assert target.read_text() == bundle, "Evidence bundle is stale"
    else:
        target.write_text(bundle)
    print("Offline evidence SHA-256:", digest(raw))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--cache", type=Path, default=Path("/tmp/thermaloop-evidence-cache"))
    args = parser.parse_args()
    if args.refresh:
        refresh(args.cache)
    build(args.check)
