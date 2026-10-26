#!/usr/bin/env python3
"""Exercise the existing website and scientific dashboard in a real Chromium browser."""
import argparse
import asyncio
import csv
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import mimetypes
from pathlib import Path
import shutil
import threading
import urllib.request
import urllib.parse
from playwright.async_api import async_playwright, Error as PlaywrightError

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "tests/legacy-contract.json").read_text())


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class CheckLog(list):
    def append(self, value):
        super().append(value)
        print("PASS:", value, flush=True)


async def run(base, artifacts):
    checks, errors, limitations = CheckLog(), [], []
    navigations, request_failures, console_errors = [], [], []
    async with async_playwright() as p:
        executable = shutil.which("chromium") or shutil.which("chromium-browser")
        browser = await p.chromium.launch(executable_path=executable, headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--enable-unsafe-swiftshader"])
        page = await browser.new_page(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("framenavigated", lambda frame: navigations.append(frame.url) if frame == page.main_frame else None)
        page.on("requestfailed", lambda request: request_failures.append({"url":request.url,"failure":request.failure}))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        dataset_requests = []
        page.on("request", lambda request: dataset_requests.append(request.url)
                if urllib.parse.urlsplit(request.url).path.endswith("/science/data/evidence.json") else None)
        try:
            await page.goto(base)
            await page.wait_for_function("window.ThermaCompare?.getExperiment() && window.ThermaScientificDashboard?.getResult()")
            await page.locator("#play").click()  # pause the initially running legacy clock
            await page.add_style_tag(content="html { scroll-behavior: auto !important; }")
            missing = await page.evaluate("ids => ids.filter(id => !document.getElementById(id))", CONTRACT["originalIDs"])
            assert not missing, missing
            checks.append("All pre-existing DOM IDs preserved")
            links = await page.locator("a[href]").evaluate_all("xs => xs.map(x => x.getAttribute('href'))")
            assert all(href in links for href in CONTRACT["externalLinks"])
            assert await page.evaluate("!!document.getElementById('glCanvas').getContext('webgl')")
            checks.append("WebGL 3D context and all three original external destinations preserved")

            # Identity checks must not claim a connection or silently update scientific inputs.
            assert not dataset_requests, "Dataset verification should run only on user request"
            assert await page.locator("#sciSyncStatus").get_attribute("data-state") == "unchecked"
            assert "NOT CONNECTED" in await page.locator(".science-data-status").inner_text()
            baseline = await page.evaluate("window.ThermaScientificDashboard.getResult()")
            dataset_bytes = (ROOT / "science/data/evidence.json").read_bytes()
            expected_hash = hashlib.sha256(dataset_bytes).hexdigest()
            await page.locator("#sciCheckSync").click()
            await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state === 'matched'")
            report = await page.evaluate("window.ThermaDataStatus.getReport()")
            assert report["verification"]["observedSHA256"] == expected_hash
            assert report["expected"]["evidenceSHA256"] == expected_hash
            assert report["liveTelemetryConnected"] is False
            assert len(report["sources"]) == 8
            assert report["sourceRetrievalDates"] == ["2026-10-25"]
            async with page.expect_download() as event:
                await page.locator("#sciExportDataStatus").click()
            download = await event.value
            destination = artifacts / download.suggested_filename
            await download.save_as(destination)
            assert json.loads(destination.read_text()) == report

            async def changed_dataset(route):
                # Even semantically equivalent JSON must not pass a byte-identity check.
                await route.fulfill(status=200, body=dataset_bytes + b"\n", content_type="application/json")

            dataset_url = "**/science/data/evidence.json"
            await page.route(dataset_url, changed_dataset)
            await page.locator("#sciCheckSync").click()
            await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state === 'mismatch'")
            await page.unroute(dataset_url, changed_dataset)

            async def failed_dataset(route):
                await route.fulfill(status=503, body="Unavailable")

            await page.route(dataset_url, failed_dataset)
            await page.locator("#sciCheckSync").click()
            await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state === 'unavailable'")
            report = await page.evaluate("window.ThermaDataStatus.getReport()")
            assert report["verification"]["observedSHA256"] is None
            assert "HTTP 503" in report["verification"]["message"]
            await page.unroute(dataset_url, failed_dataset)

            async def disconnected_dataset(route):
                await route.abort("internetdisconnected")

            await page.route(dataset_url, disconnected_dataset)
            await page.locator("#sciCheckSync").click()
            await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state === 'unavailable'")
            assert await page.locator("#sciCheckSync").is_enabled()
            assert await page.locator("#sciExportJSON").is_enabled()
            await page.unroute(dataset_url, disconnected_dataset)
            await page.locator("#sciCheckSync").click()
            await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state === 'matched'")
            assert baseline == await page.evaluate("window.ThermaScientificDashboard.getResult()")
            for _ in range(3):
                await page.route(dataset_url, disconnected_dataset)
                await page.locator("#sciCheckSync").click()
                await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state === 'unavailable'")
                await page.unroute(dataset_url, disconnected_dataset)
                await page.locator("#sciCheckSync").click()
                await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state === 'matched'")
                assert await page.locator("#sciCheckSync").is_enabled()
            checks.append("Dataset status/export, SHA-256 match, altered bytes, HTTP failure, disconnection and recovery; experiment inputs stay unchanged")

            before = await page.locator("#clock").inner_text()
            await page.locator("#step").click()
            assert before != await page.locator("#clock").inner_text()
            await page.locator("#restart").click()
            checks.append("Legacy pause, step and restart")
            for speed in ["1600", "850", "350"]:
                await page.locator(f'[data-speed="{speed}"]').click()
                assert "active" in (await page.locator(f'[data-speed="{speed}"]').get_attribute("class"))
            checks.append("All three simulation speeds")
            for id in ["fusionHall", "fusionCampus", "viewTop", "viewFront", "viewIso", "resetCam"]:
                await page.locator("#" + id).click()
            await page.locator("#fusionOrbit").click()
            assert await page.evaluate("window.ThermaActiveWorld.autoOrbit")
            await page.locator("#fusionOrbit").click()
            assert not await page.evaluate("window.ThermaActiveWorld.autoOrbit")
            for id in ["showBefore3D", "showAfter3D", "showLive3D"]:
                await page.locator("#" + id).click()
                assert "active" in (await page.locator("#" + id).get_attribute("class"))
            checks.append("Campus/hall cameras, orbit, ISO/TOP/SIDE and paired 3D modes")

            for scenario in ["standard", "winter", "burst", "summer", "fault"]:
                await page.locator("#scenario").select_option(scenario)
                await page.wait_for_function("s => window.ThermaCompare.getExperiment().scenario === s", arg=scenario)
                result = await page.evaluate("(() => {const e=window.ThermaCompare.getExperiment(); return {b:e.before.history.length,a:e.after.history.length,finite:Number.isFinite(e.after.site)}})()")
                assert result == {"b": 60, "a": 60, "finite": True}, (scenario, result)
            checks.append("All five legacy scenarios run complete 60-minute A/B histories")
            for id, value in [("demand", 125), ("outside", 10), ("renewable", 30), ("bufferCap", 140)]:
                await page.locator("#" + id).evaluate("(e, v) => {e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}", value)
            await page.locator("#compareReRun").click()
            inputs = await page.evaluate("window.ThermaCompare.getExperiment().input")
            assert inputs == {"arrivals": 125, "outside": 10, "renewables": 0.3, "storageCap": 140}, inputs
            await page.locator("#compareJump").click()
            checks.append("All four live parameter sliders, explicit A/B rerun and 3D jump")

            for flag in ["routing", "dvfs", "disagg", "thermal", "diagnostics"]:
                if await page.locator("#" + flag + "Toggle").is_checked():
                    # The original styled switch covers its native checkbox; click the visible label surface.
                    await page.locator("#" + flag + "Toggle + .switch").click()
                await page.wait_for_function("k => !window.ThermaCompare.getExperiment().selected[k]", arg=flag)
            await page.locator("#enableAll").click()
            await page.wait_for_function("Object.values(window.ThermaCompare.getExperiment().selected).every(Boolean)")
            checks.append("Five individual policy toggles and enable-all")
            for case in ["routing", "dvfs", "disagg", "thermal", "diagnostics", "all"]:
                await page.locator(f'.fusion-preset[data-case="{case}"]').click()
                assert "active" in (await page.locator(f'.fusion-preset[data-case="{case}"]').get_attribute("class"))
            await page.locator("#fusionMinute").evaluate("e => {e.value=15;e.dispatchEvent(new Event('input',{bubbles:true}));}")
            assert "15" in await page.locator("#fusionMinuteValue").inner_text()
            await page.locator("#fusionPlay").click()
            await page.wait_for_function("+document.getElementById('fusionMinute').value > 15")
            await page.locator("#fusionPlay").click()
            checks.append("All six experiment presets, minute scrubbing and paired playback")

            await page.locator("#gpuDeviceSelect").select_option("63")
            assert "64" in await page.locator("#gpuActiveId").inner_text()
            await page.locator("#gpuRackSelect").select_option("3")
            assert "25" in await page.locator("#gpuActiveId").inner_text()
            await page.locator('#gpuABMapAfter button[data-gpu="7"]').click()
            assert "08" in await page.locator("#gpuActiveId").inner_text()
            await page.locator("#gpuMinuteSelect").evaluate("e => {e.value=30;e.dispatchEvent(new Event('input',{bubbles:true}));}")
            assert "30" in await page.locator("#gpuTimeLabel").inner_text()
            await page.locator("#gpuHotBtn").click()
            await page.locator("#gpuFocusBtn").click()
            assert "open" in (await page.locator("#inspector").get_attribute("class"))
            await page.locator("#closeInspector").click()
            await page.locator('[data-cascade="greenhouse"]').click()
            assert "open" in (await page.locator("#inspector").get_attribute("class"))
            checks.append("Per-GPU selection, GPU minute history, hottest GPU, 3D inspector and thermal cascade")

            await page.locator("#injectFault").click()
            assert "flow" in (await page.locator("#events").inner_text()).lower()
            await page.locator("#clearFault").click()
            await page.locator("#rebenchmark").click()
            assert "—" not in await page.locator("#baseline").inner_text()
            await page.locator("#clearEvents").click()
            assert await page.locator("#events .event").count() == 0
            checks.append("Cooling-fault injection/reset and legacy energy benchmark")
            for panel in ["conditions", "hours", "method", "overview"]:
                button = page.locator(f'[data-scale-page="{panel}"]')
                await button.click()
                assert await page.locator(f'[data-scale-panel="{panel}"]').is_visible()
            checks.append("Finance lab tabs and existing scale calculation")

            downloads = {}
            for id in ["export", "compareExport", "fusionDownload", "gpuGpuExport", "scExport", "sciExportJSON", "sciExportCSV", "sciExportSVG"]:
                async with page.expect_download() as event:
                    await page.locator("#" + id).click()
                download = await event.value
                destination = artifacts / download.suggested_filename
                await download.save_as(destination)
                content = destination.read_text()
                assert len(content) > 100, id
                downloads[id] = content
            scientific = json.loads(downloads["sciExportJSON"])
            assert all(scientific["checks"].values())
            assert len(scientific["routing"]["rows"]) == 1307
            assert len(scientific["thermal"]["rows"]) == 168
            assert scientific["thermal"]["measuredPredictionMAE"] is None
            assert len(list(csv.reader(io.StringIO(downloads["gpuGpuExport"])))) == 3841
            assert "SHA-256:" in downloads["sciExportCSV"]
            assert "NOT measured" in downloads["sciExportSVG"]
            checks.append("All five legacy exports and three scientific exports contain valid results")

            for details in ["sciDesign", "sciMethods", "sciSourceDetails"]:
                await page.locator("#" + details).evaluate("e => e.open = true")
            await page.locator("#sciWeakShare").fill("0")
            await page.locator("#sciRun").click()
            await page.wait_for_function("window.ThermaScientificDashboard.getResult()?.routing.weakCalls === 0")
            await page.locator("#sciITL").fill("1")
            await page.locator("#sciRun").click()
            assert not await page.evaluate("window.ThermaScientificDashboard.getResult().gpu.feasible")
            await page.locator("#sciITL").fill("")
            await page.locator("#sciRun").click()
            assert await page.locator("#sciExportJSON").is_disabled()
            assert not await page.locator(".science-grid").is_visible()
            assert "Experiment not run" in await page.locator("#sciStatus").inner_text()
            await page.locator("#sciReset").click()
            await page.wait_for_function("window.ThermaScientificDashboard.getResult()?.gpu.feasible")
            await page.locator("#sciModel").select_option("meta-llama/Llama-3.1-70B-Instruct")
            await page.locator("#sciSeason").select_option("summer")
            await page.locator("#sciRun").click()
            assert await page.evaluate("window.ThermaScientificDashboard.getResult().gpu.baseline.num_gpus") == 4
            assert await page.evaluate("window.ThermaScientificDashboard.getResult().thermal.period") == "summer"
            await page.locator("#sciReset").click()
            checks.append("Scientific parameters, 70B hardware scope, summer data, infeasibility, invalid-input rejection and reset")

            await page.wait_for_function("window.ThermaValidationDashboard?.getReport().comparison")
            workspace = await page.evaluate("window.ThermaValidationDashboard.getReport()")
            assert workspace["comparison"]["calibrationCount"] == 1
            assert workspace["comparison"]["evaluationCount"] == 3
            assert workspace["comparison"]["independentValidationCount"] == 0
            assert workspace["registry"]["anchor"]["primarySourceVerified"] is False
            assert await page.locator("#valCoverage tr").count() == 9
            await page.select_option("#valExponent", "0.8")
            assert "Incompatible" in await page.locator("#valApplicability").inner_text()
            await page.select_option("#valExponent", "0.3333333333333333")
            assert "unknown without conductivity" in await page.locator("#valApplicability").inner_text()
            await page.select_option("#valExponent", "0")
            await page.locator("#valReportExample").click()
            calc = await page.evaluate("window.ThermaValidationDashboard.getReport().illustrativeMeasurement")
            assert abs(calc["R_Tin_electrical_K_W"] - 53/750) < 1e-12
            assert calc["Q_fluid_W"] is None
            assert calc["reportedResistanceArithmeticConsistent"] is False
            assert "inconsistent" in await page.locator("#valMeasurementStatus").inner_text()
            await page.locator("#valPower").fill("0")
            assert await page.evaluate("window.ThermaValidationDashboard.getReport().illustrativeMeasurement") is None
            assert "No current calculation" in await page.locator("#valMeasurementMetrics").inner_text()
            await page.locator("#valResetExample").click()
            await page.locator("#valTout").fill("45")
            assert await page.evaluate("window.ThermaValidationDashboard.getReport().illustrativeMeasurement") is None
            await page.locator("#valResetExample").click()
            await page.locator("#valMassFlow").fill("0.1")
            assert await page.evaluate("window.ThermaValidationDashboard.getReport().illustrativeMeasurement.captureFraction") == 2
            assert "heat differ" in await page.locator("#valMeasurementStatus").inner_text()
            await page.locator("#valResetExample").click()
            assert await page.evaluate("window.ThermaValidationDashboard.getReport().illustrativeMeasurement.Q_fluid_W") == 1000
            assert await page.evaluate("window.ThermaScientificDashboard.getResult().parameters.itlLimitMs") == 40
            checks.append("Research partition/source statuses, exponent applicability, report arithmetic, null/invalid inputs, heat imbalance and independent calculator reset")

            research_downloads = {}
            for id in ["valExportJSON", "valExportCSV", "valExportSVG"]:
                async with page.expect_download() as event:
                    await page.locator("#"+id).click()
                download = await event.value
                destination = artifacts/download.suggested_filename
                await download.save_as(destination)
                research_downloads[id] = destination.read_text()
            research = json.loads(research_downloads["valExportJSON"])
            assert research["comparison"]["metrics"]["n"] == 3
            assert research["comparison"]["coverage"] is None
            assert research["illustrativeMeasurement"]["kind"].startswith("User-entered illustrative")
            assert "SHA-256" in research_downloads["valExportCSV"]
            assert "same_source_evaluation" in research_downloads["valExportCSV"]
            assert "primary source unverified" in research_downloads["valExportSVG"]
            checks.append("Research JSON, CSV and SVG exports preserve provenance, partition, unavailable intervals and illustrative-input labels")
            await page.locator("#scientific-validation").evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
            await page.screenshot(path=str(artifacts/"validation-desktop.png"))
            for width in [768,390]:
                await page.set_viewport_size({"width":width,"height":844})
                await page.locator("#scientific-validation").evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
                assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
                await page.screenshot(path=str(artifacts/f"validation-{width}.png"))
            await page.locator("#valResetExample").scroll_into_view_if_needed()
            await page.screenshot(path=str(artifacts/"validation-calculator-mobile.png"))
            await page.set_viewport_size({"width":1440,"height":1000})
            checks.append("Research workspace desktop/tablet/mobile controls and charts without horizontal page overflow")

            await page.wait_for_function("window.ThermaNumericalDashboard?.getReport()")
            numerical = await page.evaluate("window.ThermaNumericalDashboard.getReport()")
            assert all(numerical["gates"].values())
            assert numerical["kind"].startswith("Numerical verification only")
            assert numerical["CDU"]["NTU"] > 1
            assert 0 <= numerical["CDU"]["isothermal_effectiveness"] <= 1
            assert numerical["spatial"]["first_steady_grid_meeting_target"] == 640
            assert await page.locator("#numSpatialRows tr").count() == 7
            await page.select_option("#numModel", "1d")
            await page.locator("#numTimeDetails > summary").click()
            await page.select_option("#numStudy", "tolerance_levels")
            assert await page.locator("#numTimeRows .num-above").count() >= 1
            assert "1.00e-8" in await page.locator("#numSelectedSolver").inner_text()
            await page.locator("#numCDUDetails > summary").click()
            assert "2.388915" in await page.locator("#numCDUMetrics").inner_text()
            await page.select_option("#numStudy", "step_limits")
            await page.select_option("#numModel", "lumped")
            assert "NaN" not in await page.locator("#numerical-verification").inner_text()
            checks.append("Numerical artifacts, clock/model controls, CDU definitions, target selection and honest coarse-tolerance failures")
            numerical_downloads = {}
            for id in ["numExportJSON", "numExportCSV", "numExportSVG"]:
                async with page.expect_download() as event:
                    await page.locator("#"+id).click()
                download = await event.value
                destination = artifacts/download.suggested_filename
                await download.save_as(destination)
                numerical_downloads[id] = destination.read_text()
            assert json.loads(numerical_downloads["numExportJSON"]) == numerical
            assert "SHA-256" in numerical_downloads["numExportCSV"]
            assert "not measured cooling benefit" in numerical_downloads["numExportCSV"]
            assert "not experimental accuracy" in numerical_downloads["numExportSVG"]
            assert "NaN" not in numerical_downloads["numExportSVG"]
            checks.append("Numerical JSON/CSV/SVG exports preserve full data, source fingerprints and non-experimental scope")
            await page.locator("#numerical-verification").evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
            await page.screenshot(path=str(artifacts/"numerical-desktop.png"))
            for width in [768,390]:
                await page.set_viewport_size({"width":width,"height":844})
                await page.evaluate("() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
                await page.locator("#numerical-verification").evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
                assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
                await page.screenshot(path=str(artifacts/f"numerical-{width}.png"))
            await page.set_viewport_size({"width":1440,"height":1000})
            checks.append("Numerical workspace responsive charts and controls at desktop/tablet/mobile widths")

            # Settle the restored desktop layout and enter the lab explicitly;
            # preceding checks finish at the bottom of the numerical section.
            await page.locator("#public-workloads").evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
            await page.evaluate("() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
            await page.wait_for_function("window.ThermaWorkloadDashboard?.getReport()")
            original_science=await page.evaluate("window.ThermaScientificDashboard.getResult()")
            original_numerical=await page.evaluate("window.ThermaNumericalDashboard.getReport()")
            workload=await page.evaluate("window.ThermaWorkloadDashboard.getReport()")
            assert workload["routing"]["testCount"]==262
            assert workload["routing"]["weakCalls"]==89
            assert workload["routing"]["energyJ"] is None and workload["routing"]["latencyMs"] is None
            assert all(s["meanWaitSeconds"]==0 for s in workload["scheduling"])
            assert "no scheduling benefit" in await page.locator("#wlSchedulerNote").inner_text()
            assert "1813 Failed" in await page.locator("#wlTraceStatus").inner_text()
            assert "1,813 Failed" in await page.locator("#wlSchedulerPhase").inner_text()
            for budget in ["0.2","0.6"]:
                await page.locator("#wlWeakShare").select_option(budget)
                await page.locator("#wlRun").click()
                assert await page.evaluate("window.ThermaWorkloadDashboard.getReport().parameters.weakShare")==float(budget)
            await page.locator("#wlWeakShare").select_option("0.4")
            await page.locator("#wlArrivalScale").select_option("0.1")
            await page.locator("#wlRun").click()
            stress=await page.evaluate("window.ThermaWorkloadDashboard.getReport()")
            assert "synthetic stress" in await page.locator("#wlStatus").inner_text()
            assert stress["scheduling"][3]["meanWaitSeconds"]<stress["scheduling"][0]["meanWaitSeconds"]
            assert stress["scheduling"][3]["maxWaitSeconds"]>stress["scheduling"][0]["maxWaitSeconds"]
            await page.locator("#wlGpuSlots").select_option("8")
            await page.locator("#wlRun").click()
            assert await page.evaluate("window.ThermaWorkloadDashboard.getReport().parameters.gpuSlots")==8
            await page.locator("#wlSweepDetails > summary").click()
            assert await page.locator("#wlSweepRows tr").count()==24
            assert original_science==await page.evaluate("window.ThermaScientificDashboard.getResult()")
            assert original_numerical==await page.evaluate("window.ThermaNumericalDashboard.getReport()")
            checks.append("Public-workload held-out routing, matched budgets, queue/placement ablation, stress trade-offs and independent existing engines")

            for export_id in ["wlExportJSON","wlExportCSV","wlExportSVG"]:
                async with page.expect_download() as event:
                    await page.locator("#"+export_id).click()
                download=await event.value;destination=artifacts/download.suggested_filename
                await download.save_as(destination);text=destination.read_text()
                if export_id=="wlExportJSON":
                    exported=json.loads(text)
                    assert exported["parameters"]=={"weakShare":.4,"gpuSlots":8,"arrivalScale":.1}
                    assert len(exported["routerAudit"]["partitions"]["train"])==784
                    assert all(len(s["jobs"])==1991 for s in exported["scheduling"])
                    assert len(exported["sources"])==4 and exported["routing"]["energyJ"] is None
                elif export_id=="wlExportCSV":
                    assert "residence" in text and "Failed" in text and "Input SHA-256" in text
                    assert "gpu_request" in text and "mGPU" in text and "assigned_slot" in text
                    assert len(list(csv.reader(io.StringIO(text))))>40000
                else:
                    import xml.etree.ElementTree as ET
                    ET.fromstring(text)
                    assert "not measured savings" in text and "Input SHA-256" in text
            checks.append("Workload JSON/CSV/SVG exports preserve partitions, per-reservation results, source failures, hashes and scope")
            await page.locator("#wlReset").click()
            assert await page.evaluate("window.ThermaWorkloadDashboard.getReport().parameters")=={"weakShare":.4,"gpuSlots":16,"arrivalScale":1}
            await page.locator("#wlSweepDetails > summary").click()
            await page.locator("#public-workloads").evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
            await page.screenshot(path=str(artifacts/"workloads-desktop.png"))
            for width in [768,390]:
                await page.set_viewport_size({"width":width,"height":844})
                await page.locator("#public-workloads").evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
                assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
                await page.screenshot(path=str(artifacts/f"workloads-{width}.png"))
            await page.set_viewport_size({"width":1440,"height":1000})
            checks.append("Public-workload workspace desktop/tablet/mobile controls and charts without page overflow")

            mixed_context = await browser.new_context(viewport={"width":1440,"height":1000})
            mixed_page = await mixed_context.new_page()
            mixed_errors=[]
            mixed_page.on("pageerror",lambda error:mixed_errors.append(str(error)))
            await mixed_page.route("**/science/numerical-data.js",lambda route:route.fulfill(
                status=200,content_type="application/javascript",body="globalThis.ThermaNumericalData={schemaVersion:1};globalThis.ThermaNumericalBuild={schemaVersion:1};"))
            await mixed_page.goto(base)
            await mixed_page.wait_for_function("window.ThermaNumericalDashboard?.status === 'unavailable' && window.ThermaScientificDashboard?.getResult() && window.ThermaCompare?.getExperiment()")
            assert "incompatible versions" in await mixed_page.locator("#numProtocolStatus").inner_text()
            assert await mixed_page.locator("#numExportJSON").is_disabled()
            assert await mixed_page.locator("#numExportCSV").is_disabled()
            assert await mixed_page.locator("#numExportSVG").is_disabled()
            assert await mixed_page.evaluate("window.ThermaNumericalDashboard.getReport()") is None
            assert not mixed_errors,mixed_errors
            await mixed_context.close()
            checks.append("Mixed-version numerical data is rejected with disabled exports and no impact on existing engines or uncaught errors")

            bad_workloads=await browser.new_context()
            bad_page=await bad_workloads.new_page();bad_errors=[]
            bad_page.on("pageerror",lambda error:bad_errors.append(str(error)))
            await bad_page.route("**/science/workload-data.js",lambda route:route.fulfill(status=200,content_type="application/javascript",body="globalThis.ThermaWorkloadData={schemaVersion:999};"))
            await bad_page.goto(base)
            await bad_page.wait_for_function("window.ThermaWorkloadDashboard?.status === 'unavailable' && window.ThermaScientificDashboard?.getResult() && window.ThermaCompare?.getExperiment()")
            for export_id in ["wlExportJSON","wlExportCSV","wlExportSVG"]:
                assert await bad_page.locator("#"+export_id).is_disabled()
            assert await bad_page.evaluate("window.ThermaWorkloadDashboard.getReport()") is None
            assert not bad_errors,bad_errors
            await bad_workloads.close()
            checks.append("Incompatible workload artifacts fail visibly with disabled exports and independent legacy engines")

            # Every same-origin document link must resolve; external sites are preserved, not claimed as tested deployments.
            for href in set(links):
                if href.startswith(("#", "http:", "https:", "blob:")):
                    continue
                request = urllib.request.Request(base + "/" + href, method="HEAD")
                with urllib.request.urlopen(request) as response:
                    assert response.status == 200, href
            checks.append("All local evidence, methods and audit links resolve")
            for href in ["#digital-twin", "#comparison", "#experiment-studio", "#gpu-lab", "#analytics", "#control", "#diagnostics", "#scale-lab", "#scientific-evidence"]:
                await page.locator(f'a.menu-item[href="{href}"]').click()
                assert await page.locator(f'a[href="{href}"][aria-current="location"]').count() == 1
            await page.locator("#scientific-evidence").evaluate("e => e.scrollIntoView({block:'start',behavior:'instant'})")
            await page.screenshot(path=str(artifacts / "scientific-desktop.png"))
            for width in [768, 390]:
                await page.set_viewport_size({"width": width, "height": 844})
                await page.locator("#scientific-evidence").evaluate("e => e.scrollIntoView({block:'start',behavior:'instant'})")
                # Tables have their own scrolling containers; the page must not spill horizontally.
                dimensions = await page.evaluate("({viewport:innerWidth, page:document.documentElement.scrollWidth})")
                assert dimensions["page"] <= dimensions["viewport"] + 1, dimensions
                assert await page.locator("#sciExportJSON").is_visible()
                await page.screenshot(path=str(artifacts / f"scientific-{width}.png"))
            checks.append("Sidebar navigation and responsive desktop/tablet/mobile evidence layout")
            # Try direct offline files; report an administrator restriction separately from application failures.
            offline = await browser.new_context(offline=True)
            filepage = await offline.new_page()
            filepage.on("pageerror", lambda error: errors.append(str(error)))
            try:
                await filepage.goto((ROOT / "index.html").as_uri())
                await filepage.wait_for_function("window.ThermaScientificDashboard?.getResult() && window.ThermaCompare?.getExperiment()")
                assert await filepage.evaluate("Object.values(window.ThermaScientificDashboard.getResult().checks).every(Boolean)")
                checks.append("Direct offline file:// startup")
            except PlaywrightError as error:
                if "ERR_BLOCKED_BY_ADMINISTRATOR" not in str(error):
                    raise
                limitations.append("Direct file:// navigation is blocked by this Chromium administrator policy; file-loader validation is unverified")
            await offline.close()

            # Load the exact static files by local resource fulfillment in an offline browser context.
            # This validates zero network dependencies without bypassing a browser file-access policy.
            offline = await browser.new_context(offline=True)
            async def local_resource(route):
                request_path = urllib.parse.unquote(urllib.parse.urlsplit(route.request.url).path).lstrip("/")
                target = (ROOT / (request_path or "index.html")).resolve()
                if not target.is_relative_to(ROOT) or not target.is_file():
                    await route.fulfill(status=404, body="Not found")
                    return
                await route.fulfill(status=200, body=target.read_bytes(),
                                    content_type=mimetypes.guess_type(str(target))[0] or "application/octet-stream")
            await offline.route("**/*", local_resource)
            filepage = await offline.new_page()
            filepage.on("pageerror", lambda error: errors.append(str(error)))
            await filepage.goto(base)
            await filepage.wait_for_function("window.ThermaScientificDashboard?.getResult() && window.ThermaCompare?.getExperiment() && window.ThermaValidationDashboard?.getReport() && window.ThermaNumericalDashboard?.getReport() && window.ThermaWorkloadDashboard?.getReport()")
            assert await filepage.evaluate("Object.values(window.ThermaScientificDashboard.getResult().checks).every(Boolean)")
            assert await filepage.evaluate("window.ThermaValidationDashboard.getReport().comparison.rows.length") == 4
            assert await filepage.evaluate("Object.values(window.ThermaNumericalDashboard.getReport().gates).every(Boolean)")
            assert await filepage.evaluate("Object.values(window.ThermaWorkloadDashboard.getReport().checks).every(Boolean)")
            await offline.close()
            checks.append("Offline browser context with local static resource fulfillment; both experiment engines work")
            assert not errors, errors
            checks.append("No uncaught browser JavaScript exceptions")
        except Exception as error:
            diagnostic={"error":str(error),"url":page.url,"pageErrors":errors,
                        "navigations":navigations,"failedRequests":request_failures,"consoleErrors":console_errors}
            try:
                diagnostic["title"]=await page.title()
                diagnostic["bodyExcerpt"]=(await page.locator("body").inner_text())[:5000]
                await page.screenshot(path=str(artifacts/"failure.png"),timeout=5000)
            except Exception as capture_error:
                diagnostic["captureError"]=str(capture_error)
            (artifacts/"failure.json").write_text(json.dumps(diagnostic,indent=2)+"\n")
            raise
        finally:
            await browser.close()
    return {"status": "passed", "checks": checks, "checkCount": len(checks), "pageErrors": errors,
            "limitations": limitations}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=Path("/tmp/thermaloop-browser-results"))
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        result = asyncio.run(run(f"http://127.0.0.1:{server.server_port}", args.artifacts))
        (args.artifacts / "browser-report.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
    finally:
        server.shutdown()
