const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9231;

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

async function inspectViewport(pc, width, height) {
  await pc.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: { angle: 0, type: 'portraitPrimary' }
  });
  await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
  await sleep(1500);

  const metrics = await pc.evaluate(`(() => {
    const hero = document.getElementById('hero');
    const stage = document.getElementById('stage');
    const rack = document.getElementById('rack');
    const wordmark = document.querySelector('.hero-background-wordmark');
    const wordmarkSpan = document.querySelector('.hero-background-wordmark span');
    const item = document.querySelector('#rack .item[data-id="distressed-moto-jacket"]') || document.querySelector('#rack .item');
    const img = item ? item.querySelector('.product-img') : null;
    const info = document.getElementById('info');
    const name = document.getElementById('name');
    const viewBtn = document.getElementById('viewPieceBtn');
    const tabs = document.getElementById('bottomTabs');
    const header = document.querySelector('.top-header');

    function r(el) {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        top: b.top,
        bottom: b.bottom,
        left: b.left,
        right: b.right,
        width: b.width,
        height: b.height,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        transform: style.transform
      };
    }

    return {
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
      header: r(header),
      hero: r(hero),
      rack: r(rack),
      wordmark: r(wordmark),
      wordmarkSpan: r(wordmarkSpan),
      item: r(item),
      img: r(img),
      imgNatural: img ? { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, ratio: img.naturalWidth / img.naturalHeight } : null,
      info: r(info),
      name: r(name),
      viewBtn: r(viewBtn),
      tabs: r(tabs),
      iwVar: rack ? rack.style.getPropertyValue('--iw') : null,
      gapImgToInfoTop: (info && img) ? (info.getBoundingClientRect().top - img.getBoundingClientRect().bottom) : null,
      gapImgToNameTop: (name && img) ? (name.getBoundingClientRect().top - img.getBoundingClientRect().bottom) : null,
      gapHeaderBottomToImgTop: (header && img) ? (img.getBoundingClientRect().top - header.getBoundingClientRect().bottom) : null,
    };
  })()`);

  console.log('--- Viewport: ' + width + 'x' + height + ' ---');
  console.log(JSON.stringify(metrics, null, 2));

  // Capture screenshot
  const shot = await pc.send('Page.captureScreenshot', { format: 'png' });
  const fs = require('fs');
  fs.writeFileSync('scratch/hero_' + width + 'x' + height + '.png', Buffer.from(shot.data, 'base64'));
  console.log('Saved screenshot: scratch/hero_' + width + 'x' + height + '.png');
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

    await inspectViewport(pc, 390, 844);
    await inspectViewport(pc, 375, 667);
    await inspectViewport(pc, 1280, 800);
  } finally {
    p.kill();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
