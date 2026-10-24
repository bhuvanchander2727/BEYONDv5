const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9237;

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
    return res.result ? res.result.value : res;
  }
}

async function verify() {
  const p = spawn(EDGE_PATH, ['--remote-debugging-port=' + PORT, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1200);
  const results = { checks: [], screenshots: [] };

  try {
    const v = await httpGet('http://127.0.0.1:' + PORT + '/json/version');
    const c = new CDP(v.webSocketDebuggerUrl);
    await c.connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const targets = await httpGet('http://127.0.0.1:' + PORT + '/json');
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();

    await pc.send('Network.enable');
    await pc.send('Page.enable');

    // 1. Check Mobile 390x844
    await pc.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    });
    await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
    await sleep(1500);

    const m390 = await pc.evaluate(`(() => {
      const rack = document.getElementById('rack');
      const img = document.querySelector('#rack .item[data-id="distressed-moto-jacket"] img');
      const header = document.querySelector('.top-header');
      const info = document.getElementById('info');
      const name = document.getElementById('name');
      const wordmark = document.querySelector('.hero-background-wordmark');
      const wordmarkSpan = document.querySelector('.hero-background-wordmark span');

      const ir = img.getBoundingClientRect();
      const hr = header.getBoundingClientRect();
      const infor = info.getBoundingClientRect();
      const nr = name.getBoundingClientRect();
      const wr = wordmark.getBoundingClientRect();

      // Content bbox of jacket (natural 896x1200, non-transparent minX=63, maxX=838, minY=123, maxY=1096)
      const renderRatio = 896 / 1200;
      const cRatio = ir.width / ir.height;
      let rw = ir.width, rh = ir.height;
      if (cRatio > renderRatio) {
        rw = rh * renderRatio;
      } else {
        rh = rw / renderRatio;
      }

      const jw = rw * (776 / 896);
      const jh = rh * (974 / 1200);
      const jl = ir.left + (rw * (63 / 896));
      const jr = jl + jw;
      const jt = ir.bottom - rh + (rh * (123 / 1200));
      const jb = jt + jh;

      return {
        iw: rack.style.getPropertyValue('--iw'),
        rackRect: { top: rack.getBoundingClientRect().top, height: rack.getBoundingClientRect().height },
        imageRect: { width: Math.round(rw), height: Math.round(rh) },
        jacketRect: { width: Math.round(jw), height: Math.round(jh), left: Math.round(jl), right: Math.round(jr), top: Math.round(jt), bottom: Math.round(jb) },
        sideMarginLeft: Math.round(jl),
        sideMarginRight: Math.round(window.innerWidth - jr),
        gapToHeader: Math.round(jt - hr.bottom),
        gapToInfoTop: Math.round(infor.top - jb),
        gapToTitle: Math.round(nr.top - jb),
        wordmarkTop: Math.round(wr.top),
        aspectRatio: (rw / rh).toFixed(4)
      };
    })()`);

    const shot390 = await pc.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/final_verified_390x844.png', Buffer.from(shot390.data, 'base64'));

    // Check Mobile 375x667
    await pc.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    });
    await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
    await sleep(1500);

    const m375 = await pc.evaluate(`(() => {
      const rack = document.getElementById('rack');
      const img = document.querySelector('#rack .item[data-id="distressed-moto-jacket"] img');
      const header = document.querySelector('.top-header');
      const info = document.getElementById('info');
      const name = document.getElementById('name');

      const ir = img.getBoundingClientRect();
      const hr = header.getBoundingClientRect();
      const infor = info.getBoundingClientRect();
      const nr = name.getBoundingClientRect();

      const renderRatio = 896 / 1200;
      const cRatio = ir.width / ir.height;
      let rw = ir.width, rh = ir.height;
      if (cRatio > renderRatio) {
        rw = rh * renderRatio;
      } else {
        rh = rw / renderRatio;
      }

      const jw = rw * (776 / 896);
      const jh = rh * (974 / 1200);
      const jl = ir.left + (rw * (63 / 896));
      const jr = jl + jw;
      const jt = ir.bottom - rh + (rh * (123 / 1200));
      const jb = jt + jh;

      return {
        iw: rack.style.getPropertyValue('--iw'),
        rackRect: { top: rack.getBoundingClientRect().top, height: rack.getBoundingClientRect().height },
        imageRect: { width: Math.round(rw), height: Math.round(rh) },
        jacketRect: { width: Math.round(jw), height: Math.round(jh), left: Math.round(jl), right: Math.round(jr), top: Math.round(jt), bottom: Math.round(jb) },
        sideMarginLeft: Math.round(jl),
        sideMarginRight: Math.round(window.innerWidth - jr),
        gapToHeader: Math.round(jt - hr.bottom),
        gapToInfoTop: Math.round(infor.top - jb),
        gapToTitle: Math.round(nr.top - jb),
        aspectRatio: (rw / rh).toFixed(4)
      };
    })()`);

    const shot375 = await pc.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/final_verified_375x667.png', Buffer.from(shot375.data, 'base64'));

    // Check Desktop 1280x800
    await pc.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
      screenOrientation: { angle: 0, type: 'landscapePrimary' }
    });
    await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
    await sleep(1500);

    const mDesktop = await pc.evaluate(`(() => {
      const rack = document.getElementById('rack');
      const cs = window.getComputedStyle(rack);
      return {
        top: cs.top,
        height: cs.height,
        iw: rack.style.getPropertyValue('--iw')
      };
    })()`);

    console.log('=== VERIFICATION SUMMARY ===');
    console.log('\n1. 390x844 Mobile Viewport:');
    console.log('Baseline size: 289px x 363px');
    console.log('New visible size: ' + m390.jacketRect.width + 'px x ' + m390.jacketRect.height + 'px');
    const incW390 = ((m390.jacketRect.width / 289 - 1) * 100).toFixed(1);
    const incH390 = ((m390.jacketRect.height / 363 - 1) * 100).toFixed(1);
    console.log('Scale Increase: +' + incW390 + '% width, +' + incH390 + '% height (Target: 20-25%)');
    console.log('Horizontally centered: Left margin ' + m390.sideMarginLeft + 'px, Right margin ' + m390.sideMarginRight + 'px');
    console.log('Aspect ratio: ' + m390.aspectRatio + ' (Original 896/1200 = 0.7467)');
    console.log('Gap to Header: ' + m390.gapToHeader + 'px');
    console.log('Gap to Info Top: ' + m390.gapToInfoTop + 'px');
    console.log('Gap to Title: ' + m390.gapToTitle + 'px');

    console.log('\n2. 375x667 Small Mobile Viewport:');
    console.log('Baseline size: 207px x 260px');
    console.log('New visible size: ' + m375.jacketRect.width + 'px x ' + m375.jacketRect.height + 'px');
    const incW375 = ((m375.jacketRect.width / 207 - 1) * 100).toFixed(1);
    const incH375 = ((m375.jacketRect.height / 260 - 1) * 100).toFixed(1);
    console.log('Scale Increase: +' + incW375 + '% width, +' + incH375 + '% height (Target: 20-25%)');
    console.log('Horizontally centered: Left margin ' + m375.sideMarginLeft + 'px, Right margin ' + m375.sideMarginRight + 'px');
    console.log('Aspect ratio: ' + m375.aspectRatio + ' (Original 896/1200 = 0.7467)');
    console.log('Gap to Header: ' + m375.gapToHeader + 'px');
    console.log('Gap to Info Top: ' + m375.gapToInfoTop + 'px');
    console.log('Gap to Title: ' + m375.gapToTitle + 'px');

    console.log('\n3. Desktop Viewport (1280x800):');
    console.log('Rack top: ' + mDesktop.top);
    console.log('Rack height: ' + mDesktop.height);
    console.log('Desktop --iw: ' + mDesktop.iw + ' (expected: 420px, unchanged)');

  } finally {
    p.kill();
  }
}

verify().catch(err => { console.error(err); process.exit(1); });
