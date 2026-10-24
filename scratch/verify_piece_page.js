const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9230;

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
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result ? res.result.value : undefined;
  }
  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768
    });
  }
  async screenshot(outputPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
  }
}

async function run() {
  const p = spawn(EDGE_PATH, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1500);

  const report = {};

  try {
    const v = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    const c = new CDP(v.webSocketDebuggerUrl);
    await c.connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'http://localhost:3030/#/piece/distressed-moto-jacket' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();
    await pc.send('Page.enable');
    await pc.send('Runtime.enable');

    // 1. Desktop 1366x768
    await pc.setViewport(1366, 768);
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/piece/distressed-moto-jacket' });
    await sleep(2000);

    const desktopChecks = await pc.evaluate(`(() => {
      const screen = document.getElementById('screen-piece');
      const screenStyle = getComputedStyle(screen);
      const mainBox = document.querySelector('.piece-main-img-box');
      const mainBoxStyle = getComputedStyle(mainBox);
      const img = document.getElementById('pieceMainImg');
      const imgStyle = getComputedStyle(img);
      const specs = document.querySelector('.piece-specs');
      const specsStyle = getComputedStyle(specs);
      const addBtn = document.getElementById('addToBagBtn');
      const saveBtn = document.getElementById('savePieceBtn');

      return {
        screenActive: screen.classList.contains('active'),
        hasConcreteBackground: screenStyle.backgroundImage.includes('concrete-texture.png'),
        screenBgColor: screenStyle.backgroundColor,
        screenAttachment: screenStyle.backgroundAttachment,
        mainBox: {
          background: mainBoxStyle.backgroundImage || mainBoxStyle.backgroundColor,
          border: mainBoxStyle.borderColor,
          boxShadow: mainBoxStyle.boxShadow,
          width: mainBox.offsetWidth,
          height: mainBox.offsetHeight
        },
        image: {
          src: img.getAttribute('src'),
          objectFit: imgStyle.objectFit,
          filter: imgStyle.filter
        },
        specsBox: {
          background: specsStyle.backgroundColor,
          border: specsStyle.borderColor
        },
        productDetails: {
          title: document.querySelector('.piece-title') ? document.querySelector('.piece-title').textContent : null,
          price: document.querySelector('.piece-price') ? document.querySelector('.piece-price').textContent : null,
          badge: document.querySelector('.piece-badge') ? document.querySelector('.piece-badge').textContent : null,
          sizesCount: document.querySelectorAll('.size-chip').length,
          selectedSize: document.querySelector('.size-chip.selected') ? document.querySelector('.size-chip.selected').getAttribute('data-size-val') : null
        },
        overflow: {
          scrollWidth: screen.scrollWidth,
          clientWidth: screen.clientWidth,
          hasHorizontalOverflow: screen.scrollWidth > screen.clientWidth
        }
      };
    })()`);

    report.desktop1366 = desktopChecks;
    console.log('Desktop 1366 Checks:', JSON.stringify(desktopChecks, null, 2));

    const shot1366 = path.join(__dirname, '..', 'piece_desktop_1366.png');
    await pc.screenshot(shot1366);

    // 2. Test Size Selection
    console.log('Testing size chip selection...');
    await pc.evaluate(`
      const sizes = Array.from(document.querySelectorAll('.size-chip'));
      const sizeM = sizes.find(s => s.getAttribute('data-size-val') === 'M');
      if (sizeM) sizeM.click();
    `);
    await sleep(200);
    const sizeState = await pc.evaluate(`document.querySelector('.size-chip.selected') ? document.querySelector('.size-chip.selected').getAttribute('data-size-val') : null`);
    report.selectedSizeAfterClick = sizeState;

    // 3. Test Add to Bag
    console.log('Testing Add to Bag...');
    await pc.evaluate(`document.getElementById('addToBagBtn').click();`);
    await sleep(300);
    const cartState = await pc.evaluate(`({
      cartBadge: document.getElementById('cartCountBadge') ? document.getElementById('cartCountBadge').textContent : null,
      toastVisible: document.getElementById('toast').classList.contains('show'),
      toastText: document.getElementById('toast').textContent
    })`);
    report.cartAction = cartState;

    // 4. Test Save Piece
    console.log('Testing Save Piece toggle...');
    await pc.evaluate(`document.getElementById('savePieceBtn').click();`);
    await sleep(300);
    const saveState = await pc.evaluate(`({
      btnSaved: document.getElementById('savePieceBtn').classList.contains('saved'),
      btnText: document.getElementById('savePieceBtnText').textContent,
      savedBadge: document.getElementById('savedCountBadge') ? document.getElementById('savedCountBadge').textContent : null,
      toastVisible: document.getElementById('toast').classList.contains('show'),
      toastText: document.getElementById('toast').textContent
    })`);
    report.saveAction = saveState;

    // 5. Mobile 390x844
    console.log('Testing Mobile 390px Viewport...');
    await pc.setViewport(390, 844);
    await sleep(600);

    const mobileChecks = await pc.evaluate(`(() => {
      const screen = document.getElementById('screen-piece');
      const mainBox = document.querySelector('.piece-main-img-box');
      const img = document.getElementById('pieceMainImg');

      return {
        screenActive: screen.classList.contains('active'),
        mainBoxWidth: mainBox.offsetWidth,
        imgWidth: img.offsetWidth,
        overflow: {
          scrollWidth: screen.scrollWidth,
          clientWidth: screen.clientWidth,
          hasHorizontalOverflow: screen.scrollWidth > screen.clientWidth
        }
      };
    })()`);

    report.mobile390 = mobileChecks;
    console.log('Mobile 390 Checks:', JSON.stringify(mobileChecks, null, 2));

    const shotMobile = path.join(__dirname, '..', 'piece_mobile_390.png');
    await pc.screenshot(shotMobile);

    fs.writeFileSync(path.join(__dirname, '..', 'piece_verification_results.json'), JSON.stringify(report, null, 2));
    console.log('Finished verifying product detail page!');

    await pc.send('Page.close');
  } catch (err) {
    console.error('Error during piece verification:', err);
  } finally {
    p.kill();
  }
}
run();
