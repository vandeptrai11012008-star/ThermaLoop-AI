#!/usr/bin/env python3
"""Agent Sandbox browser regression, preserving the existing website workspaces."""
import argparse, asyncio, json, shutil, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

async def run(base, out):
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        pinned = Path(p.chromium.executable_path).is_file()
        browser = await p.chromium.launch(executable_path=None if pinned else shutil.which('chromium'), headless=True,
            args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        async def execute():
            await page.locator('#agentRun').click()
            await page.wait_for_function('window.ThermaAgentSandboxDashboard?.getReport() !== null')
            return await page.evaluate('ThermaAgentSandboxDashboard.getReport()')
        try:
            await page.goto(base + '/#agent-sandbox')
            await page.wait_for_function('window.ThermaWorkspaces && window.ThermaAgentSandboxDashboard')
            await page.add_style_tag(content='html{scroll-behavior:auto!important}')
            result = await execute()
            assert result['verdict']['status'] == 'within_tested_envelope'
            assert result['verdict']['hardwareAuthorized'] is False
            assert await page.locator('#agentGPUChart svg').count() == 1
            assert await page.locator('.workspace-screen:visible').count() == 1
            await page.screenshot(path=str(out/'desktop.png'), full_page=True)
            async with page.expect_download() as event:
                await page.locator('#agentExport').click()
            download = await event.value
            await download.save_as(out/'report-export.json')
            assert json.loads((out/'report-export.json').read_text()) == result
            await page.locator('.side [data-workspace-link="overview"]').click()
            assert await page.locator('#glCanvas').is_visible()
            await page.locator('.side [data-workspace-link="agents"]').click()
            assert await page.evaluate('ThermaAgentSandboxDashboard.getReport()') == result
            await page.locator('#agentPreset').select_option('pump-fault')
            assert await page.locator('#agentResults').is_hidden()
            assert await page.locator('#agentExport').is_disabled()
            fault = await execute()
            assert fault['verdict']['status'] == 'needs_revision'
            assert 'gpu_over_temperature' in await page.locator('#agentChecks').inner_text()
            await page.locator('#agentPlan').fill('[{"atMinute":0,"controls":{"pumpPct":999}}]')
            await page.locator('#agentRun').click()
            assert 'pumpPct' in await page.locator('#agentStatus').inner_text()
            assert await page.evaluate('ThermaAgentSandboxDashboard.getReport()') is None
            assert await page.locator('#agentExport').is_disabled()
            await page.locator('#agentExample').click()
            await page.locator('#agentPreset').select_option('winter')
            await page.locator('#agentBaselinePlan').click()
            baseline = await execute()
            assert baseline['comparison']['energySavedKWh'] == 0
            await page.locator('#agentExample').click()
            await execute()
            for width in [768, 390]:
                await page.set_viewport_size({'width': width, 'height': 844})
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                await page.screenshot(path=str(out/f'layout-{width}.png'), full_page=True)
            assert not errors, errors
            (out/'browser-report.json').write_text(json.dumps({'status':'passed','browser':browser.version,
                'checks':['paired simulation','fault rejection','stale results','input validation','JSON export',
                    'workspace preservation','desktop and narrow layouts'],'pageErrors':errors},indent=2)+'\n')
        finally:
            await browser.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, default=Path('/tmp/thermaloop-agent-browser'))
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try: asyncio.run(run(f'http://127.0.0.1:{server.server_port}', args.artifacts))
    finally: server.shutdown()
