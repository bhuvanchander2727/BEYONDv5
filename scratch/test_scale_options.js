const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9233;

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

async function run() {
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

    // Baseline metrics:
    // 390x844: visibleWidth = 289px, visibleHeight = 363px
    // 375x667: visibleWidth = 207px, visibleHeight = 260px

    const testConfigs = [
      {
        name: 'Config D: rack height 64%, top max(68px, 8.2%), small height 58%, top max(62px, 8%), iw = Math.round(rh * 0.77)',
        rackTop: 'max(68px, 8.2%)',
        rackHeight: '64%',
        smallRackTop: 'max(62px, 8%)',
        smallRackHeight: '58%',
        iwMultiplier: 0.77
      },
      {
        name: 'Config E: rack height 63.5%, top max(70px, 8.5%), small height 57.5%, top max(62px, 8.2%), iw = Math.round(rh * 0.76)',
        rackTop: 'max(70px, 8.5%)',
        rackHeight: '63.5%',
        smallRackTop: 'max(62px, 8.2%)',
        smallRackHeight: '57.5%',
        iwMultiplier: 0.76
      },
      {
        name: 'Config F: rack height 64.5%, top max(68px, 8.2%), small height 58.5%, top max(62px, 8%), iw = Math.round(rh * 0.775)',
        rackTop: 'max(68px, 8.2%)',
        rackHeight: '64.5%',
        smallRackTop: 'max(62px, 8%)',
        smallRackHeight: '58.5%',
        iwMultiplier: 0.775
      }
    ];

    for (const vp of [{ w: 390, h: 844, baseW: 289, baseH: 363 }, { w: 375, h: 667, baseW: 207, baseH: 260 }]) {
      console.log(`\n================== Viewport ${vp.w}x${vp.h} ==================`);
      await pc.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 2,
        mobile: true,
        screenOrientation: { angle: 0, type: 'portraitPrimary' }
      });
      await pc.send('Page.navigate', { url: 'http://localhost:3000/#/' });
      await sleep(1000);

      for (const cfg of testConfigs) {
        const res = await pc.evaluate(`(() => {
          const rack = document.getElementById('rack');
          const hero = document.getElementById('hero');
          const header = document.querySelector('.top-header');
          const info = document.getElementById('info');
          const name = document.getElementById('name');
          const isSmall = window.innerHeight <= 670;

          rack.style.top = isSmall ? '${cfg.smallRackTop}' : '${cfg.rackTop}';
          rack.style.height = isSmall ? '${cfg.smallRackHeight}' : '${cfg.rackHeight}';

          const rh = rack.clientHeight;
          const iw = Math.round(rh * ${cfg.iwMultiplier});
          rack.style.setProperty('--iw', iw + 'px');
          document.querySelectorAll('#rack .item').forEach(el => el.style.setProperty('--iw', iw + 'px'));

          const img = document.querySelector('#rack .item img');
          const rackRect = rack.getBoundingClientRect();
          const imgRect = img.getBoundingClientRect();
          const infoRect = info.getBoundingClientRect();
          const nameRect = name.getBoundingClientRect();
          const headerRect = header.getBoundingClientRect();

          // In object-fit: contain for image 896x1200:
          const renderRatio = 896 / 1200;
          const containerRatio = imgRect.width / imgRect.height;
          let renderedW, renderedH;
          if (containerRatio > renderRatio) {
            renderedH = imgRect.height;
            renderedW = renderedH * renderRatio;
          } else {
            renderedW = imgRect.width;
            renderedH = renderedW / renderRatio;
          }

          // Content bbox (jacket):
          const jacketContentW = renderedW * (776 / 896);
          const jacketContentH = renderedH * (974 / 1200);

          // Position of jacket top and bottom
          // object-position: center bottom:
          const imgBottom = imgRect.bottom;
          const imgTop = imgBottom - renderedH;
          const jacketTop = imgTop + (renderedH * (123 / 1200));
          const jacketBottom = imgTop + (renderedH * (1096 / 1200));

          const jacketLeft = (window.innerWidth - jacketContentW) / 2;
          const jacketRight = jacketLeft + jacketContentW;

          return {
            iw,
            rackRect: { top: rackRect.top, height: rackRect.height, bottom: rackRect.bottom },
            renderedImage: { width: Math.round(renderedW), height: Math.round(renderedH) },
            visibleJacket: {
              width: Math.round(jacketContentW),
              height: Math.round(jacketContentH),
              left: Math.round(jacketLeft),
              right: Math.round(jacketRight),
              top: Math.round(jacketTop),
              bottom: Math.round(jacketBottom)
            },
            gapToHeader: Math.round(jacketTop - headerRect.bottom),
            gapToInfoTop: Math.round(infoRect.top - jacketBottom),
            gapToTitle: Math.round(nameRect.top - jacketBottom),
            marginSides: Math.round(jacketLeft)
          };
        })()`);

        const scaleW = ((res.visibleJacket.width / vp.baseW - 1) * 100).toFixed(1);
        const scaleH = ((res.visibleJacket.height / vp.baseH - 1) * 100).toFixed(1);
        console.log(`\n--- ${cfg.name} ---`);
        console.log(`Visible Jacket: ${res.visibleJacket.width}px x ${res.visibleJacket.height}px`);
        console.log(`Scale Increase: +${scaleW}% width, +${scaleH}% height`);
        console.log(`Side Margins: ${res.marginSides}px each side (Screen: ${vp.w}px)`);
        console.log(`Gap Header Bottom -> Jacket Collar: ${res.gapToHeader}px`);
        console.log(`Gap Jacket Hem -> Info Panel Top: ${res.gapToInfoTop}px`);
        console.log(`Gap Jacket Hem -> Title "DISTRESSED MOTO JACKET": ${res.gapToTitle}px`);
      }
    }
  } finally {
    p.kill();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
