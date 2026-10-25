#!/usr/bin/env python3
"""Exercise the existing website and scientific dashboard in a real Chromium browser."""
import argparse
import asyncio
import csv
import functools
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
    async with async_playwright() as p:
        executable = shutil.which("chromium") or shutil.which("chromium-browser")
        browser = await p.chromium.launch(executable_path=executable, headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--enable-unsafe-swiftshader"])
        page = await browser.new_page(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page.on("pageerror", lambda error: errors.append(str(error)))
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
            await filepage.wait_for_function("window.ThermaScientificDashboard?.getResult() && window.ThermaCompare?.getExperiment()")
            assert await filepage.evaluate("Object.values(window.ThermaScientificDashboard.getResult().checks).every(Boolean)")
            await offline.close()
            checks.append("Offline browser context with local static resource fulfillment; both experiment engines work")
            assert not errors, errors
            checks.append("No uncaught browser JavaScript exceptions")
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
