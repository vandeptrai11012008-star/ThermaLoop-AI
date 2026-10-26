/* Dataset identity checks are optional and never replace the pinned research inputs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const evidence = globalThis.ThermaEvidenceData, build = globalThis.ThermaEvidenceBuild;
  const boundary = 'Dataset byte identity only; no upstream freshness, field validation, live telemetry or whole-site synchronization is established.';
  let status = {state: 'unchecked', checkedAt: null, observedSHA256: null, observedBytes: null};

  function report() {
    return {schemaVersion: 1, kind: 'ThermaLoop dataset status',
      dataMode: 'Pinned public reference snapshot; no automatic upstream updates',
      liveTelemetryConnected: false, legacyCampus: 'Synthetic simulation; not calibrated by these datasets',
      sourceRetrievalDates: [...new Set((evidence?.sources || []).map(s => s.retrieved))].sort(),
      sources: evidence?.sources || [], expected: build || null, verification: {...status}, boundary};
  }

  function show(state, message, details = {}) {
    status = {...status, ...details, state, message};
    $('sciSyncStatus').dataset.state = state;
    $('sciSyncStatus').textContent = message;
  }

  async function check() {
    const button = $('sciCheckSync');
    if (button.disabled) return;
    const details = {checkedAt: null, observedSHA256: null, observedBytes: null};
    if (!build?.evidenceSHA256 || !globalThis.crypto?.subtle || !/^https?:$/.test(location.protocol)) {
      show('unavailable', 'Check unavailable. Use this website over HTTPS or localhost with browser SHA-256 support. The bundled experiments still work offline.', details);
      return;
    }
    button.disabled = true;
    show('checking', 'Checking the dataset served by this website…', details);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('science/data/evidence.json', {
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        headers: {'Accept': 'application/json'}
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(x => x.toString(16).padStart(2, '0')).join('');
      const details = {checkedAt: new Date().toISOString(), observedSHA256: hash, observedBytes: bytes.byteLength};
      if (hash !== build.evidenceSHA256 || bytes.byteLength !== build.evidenceBytes) {
        show('mismatch', 'Dataset mismatch. This page uses a different snapshot from the served JSON. Reload after deployment completes, then check again. Current experiments still use the bundled snapshot.', details);
      } else {
        show('matched', 'Matched · bundled snapshot and served dataset have identical SHA-256. Checked ' + details.checkedAt + '. Live sensors remain disconnected.', details);
      }
    } catch (error) {
      show('unavailable', 'Could not verify the served dataset (' + (error.name === 'AbortError' ? 'request timed out' : error.message) + '). No match is claimed. Bundled experiments remain available.',
        {checkedAt: new Date().toISOString()});
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  }

  function setup() {
    if (!$('sciSyncStatus')) return;
    const dates = report().sourceRetrievalDates;
    $('sciRetrieved').textContent = dates.length ? dates.join(' / ') : 'date unavailable';
    if (dates.length === 1) $('sciRetrieved').dateTime = dates[0];
    $('sciCheckSync').addEventListener('click', check);
    $('sciExportDataStatus').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url; link.download = 'ThermaLoop_Data_Status.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    window.ThermaDataStatus = {check, getReport: report};
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
