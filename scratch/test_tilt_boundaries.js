const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9235;

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

async function testTiltAt(pc, width, height, css) {
  await pc.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: { angle: 0, type: 'portraitPrimary' }
  });
  await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
  await sleep(1000);

  // Apply new styles
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

  // Test tilts:
  // Tilt angles: extreme right (x=1, y=0), extreme left (x=-1, y=0), extreme down (x=0, y=1), extreme up (x=0, y=-1)
  const tilts = [
    { name: 'Resting (0,0)', x: 0, y: 0 },
    { name: 'Max Right Tilt (x=1, y=0)', x: 1, y: 0 },
    { name: 'Max Left Tilt (x=-1, y=0)', x: -1, y: 0 },
    { name: 'Max Forward Tilt (x=0, y=1)', x: 0, y: 1 },
    { name: 'Max Backward Tilt (x=0, y=-1)', x: 0, y: -1 }
  ];

  console.log(`\nTesting Tilt at ${width}x${height}:`);
  for (const t of tilts) {
    const metrics = await pc.evaluate(`(() => {
      const rack = document.getElementById('rack');
      const img = document.querySelector('#rack .item img');
      const header = document.querySelector('.top-header');
      const info = document.getElementById('info');
      const name = document.getElementById('name');

      rack.style.transition = 'none';
      rack.style.setProperty('--ry', (${t.x} * 10.5).toFixed(2) + 'deg');
      rack.style.setProperty('--rx', (-1 * ${t.y} * 7.5).toFixed(2) + 'deg');
      rack.style.setProperty('--tx', (${t.x} * 18).toFixed(1) + 'px');
      rack.style.setProperty('--ty', (${t.y} * 12).toFixed(1) + 'px');

      const imgRect = img.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const infoRect = info.getBoundingClientRect();
      const nameRect = name.getBoundingClientRect();

      // Non-transparent jacket bounding box inside image element:
      // image natural: 896x1200
      // non-transparent: minX=63, maxX=838, minY=123, maxY=1096
      const contentRatioW = 776 / 896;
      const contentRatioH = 974 / 1200;
      const padLeftRatio = 63 / 896;
      const padRightRatio = (896 - 838) / 896;
      const padTopRatio = 123 / 1200;
      const padBottomRatio = (1200 - 1096) / 1200;

      const jacketW = imgRect.width * contentRatioW;
      const jacketH = imgRect.height * contentRatioH;

      const jacketLeft = imgRect.left + (imgRect.width * padLeftRatio);
      const jacketRight = imgRect.right - (imgRect.width * padRightRatio);
      const jacketTop = imgRect.top + (imgRect.height * padTopRatio);
      const jacketBottom = imgRect.bottom - (imgRect.height * padBottomRatio);

      return {
        jacketLeft: Math.round(jacketLeft),
        jacketRight: Math.round(jacketRight),
        jacketTop: Math.round(jacketTop),
        jacketBottom: Math.round(jacketBottom),
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        overflowLeft: jacketLeft < 0,
        overflowRight: jacketRight > window.innerWidth,
        overflowTop: jacketTop < headerRect.bottom,
        overflowBottom: jacketBottom > infoRect.top,
        gapToHeader: Math.round(jacketTop - headerRect.bottom),
        gapToInfo: Math.round(infoRect.top - jacketBottom),
        gapToTitle: Math.round(nameRect.top - jacketBottom)
      };
    })()`);

    console.log(`- ${t.name}:`);
    console.log(`  Jacket Box: [left: ${metrics.jacketLeft}px, right: ${metrics.jacketRight}px, top: ${metrics.jacketTop}px, bottom: ${metrics.jacketBottom}px]`);
    console.log(`  Screen: 0 - ${metrics.viewportW}px wide`);
    console.log(`  Gap to Header: ${metrics.gapToHeader}px | Gap to Info Top: ${metrics.gapToInfo}px | Gap to Title: ${metrics.gapToTitle}px`);
    console.log(`  Clipping/Overflow: Left: ${metrics.overflowLeft}, Right: ${metrics.overflowRight}, Top: ${metrics.overflowTop}, Bottom: ${metrics.overflowBottom}`);
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

    const config = {
      top: 'max(68px, 8.2%)',
      height: '64%',
      smallTop: 'max(62px, 8%)',
      smallHeight: '58%',
      mult: 0.77
    };

    await testTiltAt(pc, 390, 844, config);
    await testTiltAt(pc, 375, 667, config);
  } finally {
    p.kill();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
