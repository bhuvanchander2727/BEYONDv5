const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9228;

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
    const { targetId } = await c.send('Target.createTarget', { url: 'http://localhost:3030/#/shop' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();
    await pc.send('Page.enable');
    await pc.send('Runtime.enable');

    // 1. Desktop 1366px
    await pc.setViewport(1366, 768);
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/shop' });
    await sleep(2000);

    const desktopChecks = await pc.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.shop-card'));
      const firstCard = cards[0];
      const media = firstCard.querySelector('.shop-card-media');
      const img = firstCard.querySelector('.shop-card-img');
      const saveBtn = firstCard.querySelector('.shop-card-save-btn');
      const name = firstCard.querySelector('.shop-card-name');
      const price = firstCard.querySelector('.shop-card-price');
      const cta = firstCard.querySelector('.shop-card-cta');

      const cardStyle = getComputedStyle(firstCard);
      const mediaStyle = getComputedStyle(media);
      const imgStyle = getComputedStyle(img);

      // Verify the first 4 products
      const first4 = cards.slice(0, 4).map(card => ({
        id: card.getAttribute('data-id'),
        name: card.querySelector('.shop-card-name').textContent.trim(),
        price: card.querySelector('.shop-card-price').textContent.trim(),
        badge: card.querySelector('.shop-card-badge') ? card.querySelector('.shop-card-badge').textContent.trim() : null,
        imgSrc: card.querySelector('.shop-card-img').getAttribute('src')
      }));

      return {
        cardsTotal: cards.length,
        first4Products: first4,
        cardSurface: {
          background: cardStyle.background || cardStyle.backgroundImage,
          border: cardStyle.borderColor,
          boxShadow: cardStyle.boxShadow
        },
        mediaDimensions: {
          width: media.offsetWidth,
          height: media.offsetHeight,
          padding: mediaStyle.padding
        },
        imageDetails: {
          width: img.offsetWidth,
          height: img.offsetHeight,
          objectFit: imgStyle.objectFit,
          filter: imgStyle.filter
        },
        typography: {
          nameFont: getComputedStyle(name).fontFamily,
          nameSize: getComputedStyle(name).fontSize,
          priceFont: getComputedStyle(price).fontFamily,
          priceSize: getComputedStyle(price).fontSize,
          ctaText: cta.textContent.trim()
        },
        saveButton: {
          top: getComputedStyle(saveBtn).top,
          right: getComputedStyle(saveBtn).right,
          width: saveBtn.offsetWidth,
          height: saveBtn.offsetHeight
        },
        overflow: {
          scrollWidth: document.getElementById('screen-shop').scrollWidth,
          clientWidth: document.getElementById('screen-shop').clientWidth,
          hasHorizontalOverflow: document.getElementById('screen-shop').scrollWidth > document.getElementById('screen-shop').clientWidth
        }
      };
    })()`);

    report.desktop1366 = desktopChecks;
    console.log('Desktop 1366 Verification:', JSON.stringify(desktopChecks, null, 2));

    const shotDesktop = path.join(__dirname, '..', 'shop_card_polish_1366.png');
    await pc.screenshot(shotDesktop);

    // 2. Test Hover Effect on Card 1
    console.log('Simulating hover on Card 1...');
    // We can evaluate computed style while dispatching mouseenter / hover class or checking hover styles
    const hoverStyles = await pc.evaluate(`(() => {
      const card = document.querySelector('.shop-card');
      card.classList.add('hover-test');
      return {
        transition: getComputedStyle(card).transition,
        imgTransition: getComputedStyle(card.querySelector('.shop-card-img')).transition
      };
    })()`);
    report.hover = hoverStyles;

    // 3. Mobile 390px
    console.log('Testing Mobile 390px Viewport...');
    await pc.setViewport(390, 844);
    await sleep(600);

    const mobileChecks = await pc.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.shop-card'));
      const firstCard = cards[0];
      const media = firstCard.querySelector('.shop-card-media');
      const img = firstCard.querySelector('.shop-card-img');
      const grid = document.querySelector('.shop-grid');

      return {
        gridCols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        cardWidth: firstCard.offsetWidth,
        imgWidth: img.offsetWidth,
        imgHeight: img.offsetHeight,
        overflow: {
          scrollWidth: document.getElementById('screen-shop').scrollWidth,
          clientWidth: document.getElementById('screen-shop').clientWidth,
          hasHorizontalOverflow: document.getElementById('screen-shop').scrollWidth > document.getElementById('screen-shop').clientWidth
        }
      };
    })()`);

    report.mobile390 = mobileChecks;
    console.log('Mobile 390 Verification:', JSON.stringify(mobileChecks, null, 2));

    const shotMobile = path.join(__dirname, '..', 'shop_card_polish_390.png');
    await pc.screenshot(shotMobile);

    fs.writeFileSync(path.join(__dirname, '..', 'shop_card_polish_results.json'), JSON.stringify(report, null, 2));
    console.log('Finished successfully!');

    await pc.send('Page.close');
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    p.kill();
  }
}
run();
