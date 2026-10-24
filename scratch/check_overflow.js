const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9226;

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

async function run() {
  const p = spawn(EDGE_PATH, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1500);
  try {
    const v = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    const c = new CDP(v.webSocketDebuggerUrl);
    await c.connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'http://localhost:3030/#/shop' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();
    await pc.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/shop' });
    await sleep(1500);

    // Filter TOPS
    await pc.evaluate(`
      const topsBtn = Array.from(document.querySelectorAll('.shop-filter-btn')).find(b => b.textContent.includes('TOPS'));
      if (topsBtn) topsBtn.click();
    `);
    await sleep(400);

    // Save item
    await pc.evaluate(`
      const saveBtn = document.querySelector('.shop-card-save-btn');
      if (saveBtn) saveBtn.click();
    `);
    await sleep(300);

    // Click ALL
    await pc.evaluate(`
      const allBtn = Array.from(document.querySelectorAll('.shop-filter-btn')).find(b => b.textContent.includes('ALL'));
      if (allBtn) allBtn.click();
    `);
    await sleep(400);

    // Resize to 390
    await pc.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(500);

    const check = await pc.evaluate(`({
      scrollWidth: document.getElementById('screen-shop').scrollWidth,
      clientWidth: document.getElementById('screen-shop').clientWidth,
      toast: document.getElementById('toast').offsetWidth,
      toastRight: document.getElementById('toast').getBoundingClientRect().right,
      overflownElements: Array.from(document.querySelectorAll('#screen-shop *')).filter(el => el.scrollWidth > document.getElementById('screen-shop').clientWidth || el.getBoundingClientRect().right > 390).map(el => ({
        tag: el.tagName,
        class: el.className,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        rectRight: el.getBoundingClientRect().right
      }))
    })`);

    console.log('Result after full sequence:', JSON.stringify(check, null, 2));

    await pc.send('Page.close');
  } catch (e) {
    console.error(e);
  } finally {
    p.kill();
  }
}
run();
