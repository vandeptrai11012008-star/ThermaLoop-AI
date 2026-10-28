#!/usr/bin/env python3
"""Verify desktop screen routing, retained state, history, legacy 3D jumps and fallback."""
import argparse,asyncio,json,shutil,threading
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def run(base,out):
 out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
 async with async_playwright() as p:
  pinned=Path(p.chromium.executable_path).is_file()
  browser=await p.chromium.launch(executable_path=None if pinned else shutil.which('chromium'),headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
  page.on('pageerror',lambda error:errors.append(str(error)))
  try:
   await page.goto(base)
   await page.locator('#play').click()
   await page.wait_for_function('window.ThermaWorkspaces && window.ThermaPhysicsDashboard?.getReport() && window.ThermaScientificDashboard?.getResult()',polling=100)
   await page.add_style_tag(content='html{scroll-behavior:auto!important}')
   async def state(workspace,panel):
    await page.wait_for_function('(v)=>ThermaWorkspaces.getState().workspace===v[0] && ThermaWorkspaces.getState().panel===v[1]',arg=[workspace,panel],polling=100)
    assert await page.locator('.workspace-screen:visible').count()==1
    assert await page.locator('.workspace-panel:visible').count()==1
    assert await page.locator('.side [aria-current="page"]').count()==1
    print('PASS screen:',workspace,panel,flush=True)
   async def enter(anchor,workspace,panel=None):
    await page.evaluate('(h)=>{location.hash=h}', '#'+anchor)
    await state(workspace,panel or anchor)
   assert await page.locator('.side .menu a').count()==5
   assert await page.locator('[data-workspace-link="economics"]').count()==0
   assert await page.locator('#scale-lab').is_hidden()
   await state('overview','digital-twin')
   original_height=await page.evaluate('document.documentElement.scrollHeight')
   assert original_height<6000,original_height
   assert await page.evaluate("!!document.getElementById('glCanvas').getContext('webgl')")
   await page.evaluate('scrollTo(0,0)')
   await page.screenshot(path=str(out/'overview-1440.png'))
   checks.append('Five focused destinations; archived economics hidden; compact overview and preserved WebGL')
   # All former anchors and their descendants still route to their owning screen.
   targets=[('analytics','overview','analytics'),('comparison','experiments','comparison'),('experiment-studio','experiments','experiment-studio'),('gpu-lab','experiments','gpu-lab'),('diagnostics','experiments','control'),('public-workloads','experiments','public-workloads'),('physical-model','thermal','physical-model'),('scientific-validation','thermal','scientific-validation'),('numerical-verification','thermal','numerical-verification'),('agent-sandbox','agents','agent-sandbox'),('agent-research','agents','agent-research'),('scientific-evidence','evidence','scientific-evidence')]
   for anchor,group,panel in targets:
    await enter(anchor,group,panel);assert await page.locator('#'+anchor).is_visible()
   checks.append('Twelve active/deep-link destinations reveal the correct screen and panel')
   await enter('physical-model','thermal');await page.locator('#physFlow').select_option('0.06')
   await page.evaluate('window.__retainedPhysicsInput=document.getElementById("physFlow")')
   physics=await page.evaluate('ThermaPhysicsDashboard.getReport()')
   science=await page.evaluate('ThermaScientificDashboard.getResult()')
   numerical=await page.evaluate('ThermaNumericalDashboard.getReport()')
   await enter('public-workloads','experiments');await page.locator('#wlWeakShare').select_option('0.6');await page.locator('#wlRun').click()
   workload=await page.evaluate('ThermaWorkloadDashboard.getReport()')
   for _ in range(2):
    for group in ['overview','evidence','experiments','thermal','agents']:
     await page.locator('.side [data-workspace-link="'+group+'"]').click()
   assert await page.locator('#scale-lab').is_hidden()
   assert await page.evaluate('ThermaPhysicsDashboard.getReport()')==physics
   assert await page.evaluate('ThermaScientificDashboard.getResult()')==science
   assert await page.evaluate('ThermaNumericalDashboard.getReport()')==numerical
   assert await page.evaluate('ThermaWorkloadDashboard.getReport()')==workload
   assert await page.evaluate('window.__retainedPhysicsInput===document.getElementById("physFlow")')
   checks.append('Repeated screen switches preserve DOM identity, inputs and all scientific engine results')
   await enter('physical-model','thermal');await page.locator('[data-workspace-section="scientific-validation"]').click();await state('thermal','scientific-validation')
   await page.go_back();await state('thermal','physical-model')
   await page.go_forward();await state('thermal','scientific-validation')
   assert await page.locator('[data-workspace-section="scientific-validation"]').get_attribute('aria-current')=='location'
   checks.append('Section links, active navigation and browser Back/Forward agree')
   await enter('gpu-lab','experiments');await page.locator('#gpuFocusBtn').click();await state('overview','digital-twin')
   assert await page.locator('#inspector').is_visible();await page.locator('#closeInspector').click()
   assert await page.locator('#glCanvas').evaluate('e=>e.width>100 && e.getBoundingClientRect().width>100')
   await enter('comparison','experiments');await page.locator('#compareJump').click();await state('overview','digital-twin')
   await enter('digital-twin','overview');await page.locator('[data-cascade="greenhouse"]').click();await state('overview','digital-twin')
   assert await page.locator('#inspector').is_visible()
   checks.append('GPU focus, comparison jump and cascade inspector reveal the existing 3D scene')
   await page.locator('.side [data-workspace-link="thermal"]').focus();await page.keyboard.press('Enter');await state('thermal','scientific-validation')
   await enter('physical-model','thermal');await page.screenshot(path=str(out/'thermal-1440.png'))
   await page.set_viewport_size({'width':1920,'height':1080});await page.screenshot(path=str(out/'thermal-1920.png'))
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   checks.append('Keyboard navigation and desktop layouts at 1440 and 1920 pixels')
   await page.goto(base+'/#physMethodsDetails')
   await page.wait_for_function('window.ThermaWorkspaces',polling=100);await state('thermal','physical-model')
   assert await page.locator('#physMethodsDetails').is_visible()
   assert await page.locator('#physMethodsDetails').evaluate('e=>e.open')
   await page.evaluate("location.hash='#unknown-workspace'")
   await state('overview','digital-twin')
   checks.append('Direct reload opens nested methods; unknown hashes fall back safely')
   fallback=await browser.new_page(viewport={'width':1440,'height':1000})
   fallback.on('pageerror',lambda error:errors.append(str(error)))
   await fallback.route('**/science/workspaces.js',lambda route:route.abort())
   await fallback.goto(base);await fallback.locator('#play').click()
   await fallback.wait_for_function('window.ThermaPhysicsDashboard?.getReport()',polling=100)
   assert await fallback.locator('.side .menu a').count()==8
   assert await fallback.locator('#physical-model').is_visible()
   assert not await fallback.locator('html').evaluate('e=>e.classList.contains("has-workspaces")')
   await fallback.close();checks.append('Unavailable navigation module retains the original long-page layout and model engines')
   assert not errors,errors
   report={'status':'passed','target':base,'browserVersion':browser.version,'browserSource':'playwright-pinned' if pinned else 'system-fallback','checks':checks,'pageErrors':errors,'overviewHeight1440':original_height}
   (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
  except Exception as error:
   print('FAIL:',repr(error),flush=True)
   diagnostic={'error':repr(error),'url':page.url,'pageErrors':errors}
   try:
    diagnostic['text']=(await page.locator('body').inner_text(timeout=5000))[:4000]
    await page.screenshot(path=str(out/'failure.png'),timeout=5000)
   except Exception as capture: diagnostic['captureError']=str(capture)
   (out/'failure.json').write_text(json.dumps(diagnostic,indent=2))
   raise
  finally:await browser.close()
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--base-url');parser.add_argument('--artifacts',type=Path,default=Path('/tmp/thermaloop-workspaces-browser'));args=parser.parse_args()
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
 try:asyncio.run(run(args.base_url.rstrip('/') if args.base_url else f'http://127.0.0.1:{server.server_port}',args.artifacts))
 finally:server.shutdown()
