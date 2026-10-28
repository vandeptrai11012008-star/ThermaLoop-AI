#!/usr/bin/env python3
"""Web Service-only v1.4 laboratory browser checks; never uses the Static Site."""
import argparse, asyncio, json, os, shutil, socket, subprocess, time
from pathlib import Path
from urllib.request import urlopen
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]

async def run(base,out):
    out.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        pinned=Path(p.chromium.executable_path).is_file()
        browser=await p.chromium.launch(executable_path=None if pinned else shutil.which('chromium'),headless=True,
            args=['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader'])
        page=await browser.new_page(viewport={'width':1440,'height':960},accept_downloads=True)
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            await page.goto(base+'/physics-lab')
            await page.wait_for_function('window.ThermaPhysicsLab?.getEpisodeReport() !== null')
            assert 'v1.4' in await page.title()
            assert await page.locator('#minuteBadge').inner_text()=='0 / 60 min'
            assert await page.locator('#svgGpu').inner_text()=='55.00 °C'
            assert 'uncalibrated' in (await page.locator('footer').inner_text()).lower()
            await page.locator('#pump').evaluate("el=>{el.value=90;el.dispatchEvent(new Event('input',{bubbles:true}));}")
            await page.locator('#stepFive').click()
            report=await page.evaluate('ThermaPhysicsLab.getEpisodeReport()')
            display=await page.evaluate('ThermaPhysicsLab.getDisplayedState()')
            assert report['minute']==5 and len(report['trace'])==6
            assert display['state']['coolantC']==report['trace'][5]['coolantC']
            assert report['events'][0]['controls']['pumpPct']==90
            await page.locator('#replayMinute').evaluate("el=>{el.value=2;el.dispatchEvent(new Event('input',{bubbles:true}));}")
            historical=await page.evaluate('ThermaPhysicsLab.getDisplayedState()')
            assert historical['state']['gpuC']==report['trace'][2]['gpuC']
            assert (await page.evaluate('ThermaPhysicsLab.getEpisodeReport()'))['minute']==5
            await page.locator('[data-node="coolant"]').click()
            assert 'COOLANT' in await page.locator('#nodeInspector').inner_text()
            await page.locator('#feedback').click()
            assert (await page.evaluate('ThermaPhysicsLab.getEpisodeReport()'))['minute']==15
            async with page.expect_download() as e:
                await page.locator('#exportEpisode').click()
            exported=await e.value;await exported.save_as(out/'episode.json')
            assert json.loads((out/'episode.json').read_text())==await page.evaluate('ThermaPhysicsLab.getEpisodeReport()')
            await page.locator('#trials').fill('30')
            await page.locator('#runResearch').click()
            await page.wait_for_function('ThermaPhysicsLab.getResearchResult() !== null',timeout=15000)
            research=await page.evaluate('ThermaPhysicsLab.getResearchResult()')
            assert research['version']=='1.4.0' and research['hardwareAuthorized'] is False
            assert research['trialCount']==30 and research['best']['eligible'] is True
            assert research['best']['energySavedKWh']<9
            assert research['best']['terminalEquivalent'] is True
            assert len(research['holdouts'])==2
            async with page.expect_download() as e:
                await page.locator('#exportResearch').click()
            exported=await e.value;await exported.save_as(out/'research.json')
            assert json.loads((out/'research.json').read_text())==research
            await page.locator('#loadWinner').click()
            assert float(await page.locator('#setpoint').input_value())==research['best']['plan'][0]['controls']['heatingSetpointC']
            await page.screenshot(path=str(out/'desktop.png'),full_page=True)
            for width in [768,390]:
                await page.set_viewport_size({'width':width,'height':880})
                dims=await page.evaluate('({viewport:innerWidth,scroll:document.documentElement.scrollWidth})')
                assert dims['scroll']<=dims['viewport']+1,dims
            assert not errors,errors
            (out/'report.json').write_text(json.dumps({'status':'passed','browserVersion':browser.version,
                'browserSource':'playwright-pinned' if pinned else 'system-fallback',
                'researchSavingsKWh':research['best']['energySavedKWh'],'pageErrors':errors},indent=2)+'\n')
            print('PASS Web Service v1.4 physics lab: state, replay, research, exports and responsive UI')
        finally:await browser.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--artifacts',default='/tmp/thermaloop-physics-lab')
    args=parser.parse_args()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env={**os.environ,'HOST':'127.0.0.1','PORT':str(port)}
    process=subprocess.Popen(['node','scripts/serve-agent-sandbox.cjs'],cwd=ROOT,env=env,
        stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                with urlopen(f'http://127.0.0.1:{port}/healthz',timeout=1) as response:
                    if response.status==200:break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Web Service did not start for browser tests')
        asyncio.run(run(f'http://127.0.0.1:{port}',Path(args.artifacts)))
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
