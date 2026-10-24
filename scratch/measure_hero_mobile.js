const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9229;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 1; this.callbacks = new Map(); }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = msg => {
        const d = JSON.parse(msg.data);
        if (d.id && this.callbacks.has(d.id)) {
          const { res, rej } = this.callbacks.get(d.id);
          this.callbacks.delete(d.id);
          if (d.error) rej(new Error(d.error.message));
          else res(d.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result ? res.result.value : undefined;
  }
}

async function measure(label, throttleNetwork = false) {
  const p = spawn(EDGE_PATH, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1200);

  try {
    const v = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    const c = new CDP(v.webSocketDebuggerUrl);
    await c.connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();

    // Enable Network & Page & Performance domains
    await pc.send('Network.enable');
    await pc.send('Page.enable');
    await pc.send('Performance.enable');

    // Emulate Mobile Device (iPhone 14 / Pixel 7: 390x844, scale factor 3, mobile: true)
    await pc.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    });
    await pc.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1'
    });

    if (throttleNetwork) {
      // Emulate Fast 4G: 1.5 Mbps download, 750 Kbps upload, 40ms RTT
      await pc.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 40,
        downloadThroughput: 1.5 * 1024 * 1024 / 8,
        uploadThroughput: 750 * 1024 / 8,
        connectionType: 'cellular4g'
      });
    }

    const networkEvents = [];
    pc.ws.addEventListener('message', (ev) => {
      const data = JSON.parse(ev.data);
      if (data.method === 'Network.responseReceived') {
        const resp = data.params.response;
        networkEvents.push({
          url: resp.url,
          mimeType: resp.mimeType,
          status: resp.status,
          encodedDataLength: resp.encodedDataLength
        });
      }
    });

    const startTime = Date.now();
    await pc.send('Page.navigate', { url: 'http://localhost:3030/' });

    // Poll hero readiness
    let heroReadyTime = null;
    let heroItemCount = 0;
    let heroProductName = '';
    let heroImageLoaded = false;
    let heroImageSrc = '';

    for (let i = 0; i < 50; i++) {
      await sleep(100);
      const state = await pc.evaluate(`(() => {
        const items = document.querySelectorAll('#rack .item');
        const name = document.getElementById('name')?.textContent || '';
        const img = document.querySelector('#rack .item img');
        return {
          itemsCount: items.length,
          name: name,
          imgComplete: img ? img.complete : false,
          imgNaturalWidth: img ? img.naturalWidth : 0,
          imgSrc: img ? img.src : ''
        };
      })()`);

      if (state && state.itemsCount > 0 && state.name && state.imgComplete && state.imgNaturalWidth > 0) {
        heroReadyTime = Date.now() - startTime;
        heroItemCount = state.itemsCount;
        heroProductName = state.name;
        heroImageLoaded = true;
        heroImageSrc = state.imgSrc;
        break;
      }
    }

    // Get timing metrics
    const perfTiming = await pc.evaluate(`JSON.stringify(window.performance.timing)`);
    const entries = await pc.evaluate(`JSON.stringify(window.performance.getEntriesByType('resource').map(r => ({
      name: r.name,
      initiatorType: r.initiatorType,
      duration: Math.round(r.duration),
      transferSize: r.transferSize || 0,
      decodedBodySize: r.decodedBodySize || 0
    })))`);

    const parsedEntries = JSON.parse(entries || '[]');
    const totalTransferred = parsedEntries.reduce((acc, r) => acc + r.transferSize, 0);

    const imageEntries = parsedEntries.filter(r => r.name.match(/\.(png|jpg|jpeg|webp|svg)$/i) || r.initiatorType === 'img' || r.initiatorType === 'css');
    const totalImageBytes = imageEntries.reduce((acc, r) => acc + r.transferSize, 0);

    console.log(`\n======================================================`);
    console.log(`MEASUREMENT: ${label} (Throttled: ${throttleNetwork})`);
    console.log(`======================================================`);
    console.log(`Hero Fully Visual & Complete: ${heroReadyTime ? heroReadyTime + ' ms' : 'TIMED OUT (>5000ms)'}`);
    console.log(`Hero Garment Items: ${heroItemCount}`);
    console.log(`Hero Product Name: "${heroProductName}"`);
    console.log(`Hero Image Loaded: ${heroImageLoaded} (${heroImageSrc})`);
    console.log(`Total Resources: ${parsedEntries.length}`);
    console.log(`Total Transferred: ${(totalTransferred / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total Image Bytes: ${(totalImageBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Key Image Resources:`);
    imageEntries.forEach(img => {
      const shortName = img.name.split('/').slice(-2).join('/');
      console.log(`  - ${shortName}: ${(img.transferSize / 1024).toFixed(1)} KB (Decoded: ${(img.decodedBodySize / 1024).toFixed(1)} KB, Duration: ${img.duration}ms)`);
    });

    p.kill();
    return {
      heroReadyTime,
      totalTransferred,
      totalImageBytes,
      imageEntries
    };
  } catch (err) {
    p.kill();
    console.error('Error during measurement:', err);
  }
}

(async () => {
  await measure('CURRENT BASELINE (Mobile 390x844)', false);
  await measure('CURRENT BASELINE (Mobile 390x844 on Simulated Fast 4G)', true);
})();
