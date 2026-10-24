const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9234;

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

async function capture(pc, width, height, label, css) {
  await pc.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: { angle: 0, type: 'portraitPrimary' }
  });
  await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
  await sleep(1000);

  await pc.evaluate(`(() => {
    const isSmall = window.innerHeight <= 670;
    const rack = document.getElementById('rack');
    rack.style.top = isSmall ? '${css.smallTop}' : '${css.top}';
    rack.style.height = isSmall ? '${css.smallHeight}' : '${css.height}';

    const rh = rack.clientHeight;
    const iw = Math.round(rh * ${css.mult});
    rack.style.setProperty('--iw', iw + 'px');
    document.querySelectorAll('#rack .item').forEach(el => el.style.setProperty('--iw', iw + 'px'));
  })()`);

  await sleep(400);

  const shot = await pc.send('Page.captureScreenshot', { format: 'png' });
  const fn = 'scratch/preview_' + label + '_' + width + 'x' + height + '.png';
  fs.writeFileSync(fn, Buffer.from(shot.data, 'base64'));
  console.log('Saved:', fn);
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

    const configF = {
      top: 'max(68px, 8.2%)',
      height: '64.5%',
      smallTop: 'max(62px, 8%)',
      smallHeight: '58.5%',
      mult: 0.775
    };

    const configD = {
      top: 'max(68px, 8.2%)',
      height: '64%',
      smallTop: 'max(62px, 8%)',
      smallHeight: '58%',
      mult: 0.77
    };

    await capture(pc, 390, 844, 'configF', configF);
    await capture(pc, 375, 667, 'configF', configF);
    await capture(pc, 390, 844, 'configD', configD);
    await capture(pc, 375, 667, 'configD', configD);
  } finally {
    p.kill();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
