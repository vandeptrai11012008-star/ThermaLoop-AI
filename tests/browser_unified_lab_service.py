#!/usr/bin/env python3
"""Pinned-Chromium check of the v1.5 Web Service-only shared physical world."""
import asyncio, json, os, shutil, socket, subprocess, time
from pathlib import Path
from urllib.request import urlopen
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
async def test_world(base,out):
    out.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        pinned=Path(p.chromium.executable_path).is_file()
        browser=await p.chromium.launch(executable_path=None if pinned else shutil.which('chromium'),headless=True,
            args=['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader'])
        page=await browser.new_page(viewport={'width':1440,'height':960},accept_downloads=True)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        try:
            await page.goto(base+'/physics-lab')
            await page.wait_for_function('window.ThermaUnifiedLab?.getReport() !== null')
            assert 'v1.5' in await page.title()
            initial=await page.evaluate('ThermaUnifiedLab.getReport()')
            assert initial['minute']==0 and len(initial['topology']['nodes'])==6
            assert await page.locator('#worldSvg .node').count()==6
            assert (await page.locator('#worldSvg').get_attribute('viewBox')).endswith('515')
            initial_flow=await page.evaluate('ThermaUnifiedPhysics.hydraulics(ThermaUnifiedLab.getReport().topology,75).flowLps')
            await page.locator('#nodeSelect').select_option('PIPE-A')
            await page.locator('#paramSelect').select_option('diameterMm')
            await page.locator('#paramValue').fill('20')
            await page.locator('#editParam').click()
            reduced=await page.evaluate('ThermaUnifiedPhysics.hydraulics(ThermaUnifiedLab.getReport().topology,75).flowLps')
            assert reduced<initial_flow
            await page.locator('#insertAfter').select_option('PIPE-A')
            await page.locator('#addTank').click()
            expanded=await page.evaluate('ThermaUnifiedLab.getReport()')
            assert len(expanded['topology']['nodes'])==7
            tank=next(n for n in expanded['topology']['nodes'] if n['type']=='tank')
            assert tank['params']['waterLiters']==200
            assert await page.locator('#worldSvg .node').count()==7
            await page.locator('#nodeSelect').select_option(tank['id'])
            await page.locator('#moveAfter').select_option('HX-101')
            await page.locator('#rewire').click()
            graph=await page.evaluate('ThermaUnifiedLab.getReport().topology')
            assert graph['order'][graph['order'].index('HX-101')+1]==tank['id']
            await page.locator('#stepFive').click()
            result=await page.evaluate('ThermaUnifiedLab.getReport()')
            assert result['minute']==5 and len(result['trace'])==6
            assert result['hydraulics']['flowLps']>0
            assert result['energyResidualKJ']<1e-5
            assert result['maxPressureResidualPa']<1e-5
            assert await page.locator('#minute').inner_text()=='5 / 60'
            assert not await page.locator('#editParam').is_enabled()
            async with page.expect_download() as downloaded:
                await page.locator('#export').click()
            file=await downloaded.value;await file.save_as(out/'world.json')
            assert json.loads((out/'world.json').read_text())==result
            await page.screenshot(path=str(out/'unified-desktop.png'),full_page=True)
            for width in [768,390]:
                await page.set_viewport_size({'width':width,'height':860})
                dims=await page.evaluate('({viewport:innerWidth,scroll:document.documentElement.scrollWidth})')
                assert dims['scroll']<=dims['viewport']+1,dims
            assert not errors,errors
            await page.set_viewport_size({'width':1440,'height':960})
            await page.goto(base+'/')
            await page.wait_for_load_state('domcontentloaded')
            bridge=page.locator('[aria-label="Shared physics engine snapshot"]')
            await bridge.wait_for(state='visible')
            text=await bridge.inner_text()
            assert 'CANONICAL v1.5' in text and 't=5m' in text,text
            assert 'Legacy' in (await page.locator('body').inner_text()) or 'legacy' in (await page.locator('body').inner_text())
            (out/'result.json').write_text(json.dumps({'status':'pass','browser':browser.version,
                'sharedStateMinute':result['minute'],'nodes':len(result['topology']['nodes']),
                'flowBeforeLps':initial_flow,'flowAfterLps':reduced,'energyResidualKJ':result['energyResidualKJ']},indent=2)+'\n')
            print('PASS v1.5: topology editor, pressure/heat, replay, export, mobile and main-site shared state')
        finally:await browser.close()

if __name__=='__main__':
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env={**os.environ,'HOST':'127.0.0.1','PORT':str(port)}
    process=subprocess.Popen(['node','scripts/serve-agent-sandbox.cjs'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                with urlopen(f'http://127.0.0.1:{port}/healthz',timeout=1) as r:
                    if r.status==200:break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Web Service did not start')
        asyncio.run(test_world(f'http://127.0.0.1:{port}',Path('/tmp/thermaloop-unified-physics-browser')))
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
