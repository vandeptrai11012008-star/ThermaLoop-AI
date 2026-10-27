#!/usr/bin/env python3
"""Default-motion interaction/visual checks complementing full website regression."""
import argparse,asyncio,json,shutil,time,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--artifacts',type=Path,default=Path('/tmp/thermaloop-physics-default-motion'))
args=parser.parse_args();OUT=args.artifacts;OUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
async def main():
 async with async_playwright() as p:
  pinned=Path(p.chromium.executable_path).is_file()
  browser=await p.chromium.launch(executable_path=None if pinned else shutil.which('chromium'),headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   await page.goto(f'http://127.0.0.1:{server.server_port}');await page.wait_for_function('window.ThermaPhysicsDashboard?.getReport() && window.ThermaScientificDashboard?.getResult()')
   await page.locator('#play').click();await page.add_style_tag(content='html{scroll-behavior:auto!important}')
   records=[]
   async def click(id):
    await page.bring_to_front();button=page.locator('#'+id);await button.evaluate("e=>e.scrollIntoView({block:'center',behavior:'instant'})")
    started=time.monotonic();await button.click();return time.monotonic()-started
   async def enter(anchor):
    await page.evaluate('h=>{location.hash=h}', '#'+anchor)
    await page.wait_for_function('id=>!!document.getElementById(id)?.getClientRects().length',arg=anchor)
   await enter('scientific-evidence')
   for i in range(4):
    await page.locator('#sciITL').fill('');await click('sciRun');assert await page.locator('#sciExportJSON').is_disabled()
    seconds=await click('sciReset');assert await page.evaluate('window.ThermaScientificDashboard.getResult().gpu.feasible')
    records.append({'case':'invalid_then_reset','seconds':seconds});print(records[-1],flush=True)
    await click('sciCheckSync');await page.wait_for_function("window.ThermaDataStatus.getReport().verification.state==='matched'")
   await enter('physical-model')
   await page.locator('#physical-model').evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
   for i in range(12):
    flow=['0.06','0.12','0.24','0.48','0.96'][i%5];started=time.monotonic();await page.locator('#physFlow').select_option(flow)
    assert await page.evaluate('window.ThermaPhysicsDashboard.getReport().selectedPrimaryFlow_kg_s')==float(flow)
    records.append({'case':'flow_'+flow,'seconds':time.monotonic()-started})
   await click('physReset')
   await page.locator('#physical-model').evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})");await page.screenshot(path=str(OUT/'desktop.png'))
   for width in [768,390]:
    await page.set_viewport_size({'width':width,'height':844});await page.locator('#physical-model').evaluate("e=>e.scrollIntoView({block:'start',behavior:'instant'})")
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');await page.screenshot(path=str(OUT/f'mobile-{width}.png'))
   for id in ['physExportJSON','physExportCSV','physExportSVG']:
    async with page.expect_download() as event:await click(id)
    dl=await event.value;destination=OUT/dl.suggested_filename;await dl.save_as(destination)
    text=destination.read_text()
    if id=='physExportJSON':
     data=json.loads(text);assert data['selectedPrimaryFlow_kg_s']==.48 and data['evidence']['measured_prediction_MAE_C'] is None
    elif id=='physExportCSV':assert 'not measurements' in text and 'SHA-256' in text
    else:
     import xml.etree.ElementTree as ET
     ET.fromstring(text);assert 'No new measurements' in text
   assert not errors,errors
   (OUT/'report.json').write_text(json.dumps({'status':'passed','prefersReducedMotion':await page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),'browserVersion':browser.version,'browserSource':'playwright-pinned' if pinned else 'system-fallback','interactions':records,'pageErrors':errors},indent=2)+'\n')
  finally:await browser.close()
try:asyncio.run(main())
finally:server.shutdown()
