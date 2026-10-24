const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9236;

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

async function main() {
  const p = spawn(EDGE_PATH, ['--remote-debugging-port=' + PORT, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1200);
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

    const viewports = [
      { w: 390, h: 844, top: 'max(68px, 8.2%)', height: '64%' },
      { w: 375, h: 667, top: 'max(62px, 8%)', height: '58%' }
    ];

    for (const vp of viewports) {
      await pc.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 2,
        mobile: true,
        screenOrientation: { angle: 0, type: 'portraitPrimary' }
      });
      await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
      await sleep(1000);

      // Apply new styles
      await pc.evaluate(`(() => {
        const rack = document.getElementById('rack');
        rack.style.top = '${vp.top}';
        rack.style.height = '${vp.height}';
        const rh = rack.clientHeight;
        const iw = Math.round(rh * 0.77);
        rack.style.setProperty('--iw', iw + 'px');
        document.querySelectorAll('#rack .item').forEach(el => el.style.setProperty('--iw', iw + 'px'));
      })()`);

      console.log('\n================ Viewport ' + vp.w + 'x' + vp.h + ' ================');

      // Check all 4 items
      for (let slide = 0; slide < 4; slide++) {
        // Go to slide
        await pc.evaluate('(() => { const bars = document.querySelectorAll("#bars button"); if (bars[' + slide + ']) bars[' + slide + '].click(); })()');
        await sleep(300);

        const data = await pc.evaluate('(() => {' +
          'const name = document.getElementById("name")?.textContent;' +
          'const price = document.getElementById("price")?.textContent;' +
          'const rack = document.getElementById("rack");' +
          'const item = document.querySelector("#rack .item[data-index=\\"' + slide + '\\"]");' +
          'const img = item ? item.querySelector("img") : null;' +
          'const header = document.querySelector(".top-header");' +
          'const info = document.getElementById("info");' +
          'const nameEl = document.getElementById("name");' +
          'if (!img) return null;' +
          'const r = img.getBoundingClientRect();' +
          'const hr = header.getBoundingClientRect();' +
          'const ir = info.getBoundingClientRect();' +
          'const nr = nameEl.getBoundingClientRect();' +
          'return {' +
          '  slide: ' + slide + ',' +
          '  name,' +
          '  price,' +
          '  imgRect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },' +
          '  gapToHeader: Math.round(r.top - hr.bottom),' +
          '  gapToInfo: Math.round(ir.top - r.bottom),' +
          '  gapToName: Math.round(nr.top - r.bottom),' +
          '  naturalWidth: img.naturalWidth,' +
          '  naturalHeight: img.naturalHeight' +
          '};' +
        '})()');

        console.log('- Slide ' + (slide + 1) + ': ' + data.name + ' (' + data.price + ')');
        console.log('  Natural: ' + data.naturalWidth + 'x' + data.naturalHeight + ' | Rendered: ' + data.imgRect.width + 'x' + data.imgRect.height);
        console.log('  Position: left ' + data.imgRect.left + 'px, right ' + data.imgRect.right + 'px, top ' + data.imgRect.top + 'px, bottom ' + data.imgRect.bottom + 'px');
        console.log('  Gap to Header: ' + data.gapToHeader + 'px, Gap to Info: ' + data.gapToInfo + 'px, Gap to Title: ' + data.gapToName + 'px');

        // Capture screenshot of each slide
        const shot = await pc.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('scratch/slide_' + (slide + 1) + '_' + vp.w + 'x' + vp.h + '.png', Buffer.from(shot.data, 'base64'));
      }
    }
  } finally {
    p.kill();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
