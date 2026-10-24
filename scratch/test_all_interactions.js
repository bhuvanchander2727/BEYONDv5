const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9224;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = err => reject(err);
      this.ws.onmessage = msg => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const { res, rej } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) {
            rej(new Error(data.error.message));
          } else {
            res(data.result);
          }
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
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async screenshot(outputPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  const edgeProcess = spawn(EDGE_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1366,768',
    'about:blank'
  ]);

  console.log('Spawned Edge headless process on port ' + PORT + '...');
  await sleep(1500);

  const testReport = {
    header: {},
    carousel: {},
    viewPiece: {},
    bottomNav: {},
    state: {},
    screenshots: []
  };

  try {
    const versionInfo = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    const browserWs = versionInfo.webSocketDebuggerUrl;

    const client = new CDPClient(browserWs);
    await client.connect();

    const { targetId } = await client.send('Target.createTarget', { url: 'http://localhost:3030/#/' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pageTarget = targets.find(t => t.id === targetId || t.type === 'page');

    const pageClient = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await pageClient.connect();

    await pageClient.send('Page.enable');
    await pageClient.send('DOM.enable');
    await pageClient.send('Runtime.enable');

    console.log('Navigating to http://localhost:3030/#/ ...');
    await pageClient.send('Page.navigate', { url: 'http://localhost:3030/#/' });
    await sleep(2000);

    // TEST 1: Carousel 4 Pieces Navigation via Indicators
    console.log('Testing Carousel Indicators & Data Sync...');
    for (let k = 0; k < 4; k++) {
      await pageClient.evaluate(`document.querySelectorAll('.bars button')[${k}].click();`);
      await sleep(400); // Allow lerp & text fade
      const pieceData = await pageClient.evaluate(`({
        name: document.getElementById('name').textContent,
        price: document.getElementById('price').textContent,
        cnt: document.getElementById('cnt').textContent,
        href: document.getElementById('viewPieceBtn').getAttribute('href'),
        visibleItems: Array.from(document.querySelectorAll('.item')).filter(el => getComputedStyle(el).display !== 'none').length
      })`);
      testReport.carousel[`piece_${k}`] = pieceData;
      console.log(`Piece ${k}:`, pieceData);
    }

    // TEST 2: Keyboard Navigation
    console.log('Testing Keyboard controls...');
    await pageClient.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))`);
    await sleep(400);
    const afterArrowLeft = await pageClient.evaluate(`document.getElementById('name').textContent`);
    await pageClient.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }))`);
    await sleep(400);
    const afterHome = await pageClient.evaluate(`document.getElementById('name').textContent`);
    testReport.carousel.keyboard = { afterArrowLeft, afterHome };
    console.log('Keyboard afterHome:', afterHome);

    // TEST 3: Header Menu Drawer Open, Close, Backdrop, Escape
    console.log('Testing Navigation Drawer...');
    await pageClient.evaluate(`document.getElementById('menuBtn').click();`);
    await sleep(350);
    const drawerOpen = await pageClient.evaluate(`({
      isOpen: document.getElementById('navDrawer').classList.contains('open'),
      ariaExpanded: document.getElementById('menuBtn').getAttribute('aria-expanded'),
      ariaHidden: document.getElementById('navDrawer').getAttribute('aria-hidden')
    })`);
    testReport.header.drawerOpen = drawerOpen;

    await pageClient.evaluate(`document.getElementById('drawerCloseBtn').click();`);
    await sleep(350);
    const drawerClosedBtn = await pageClient.evaluate(`({
      isOpen: document.getElementById('navDrawer').classList.contains('open'),
      ariaExpanded: document.getElementById('menuBtn').getAttribute('aria-expanded')
    })`);
    testReport.header.drawerClosedBtn = drawerClosedBtn;

    await pageClient.evaluate(`document.getElementById('menuBtn').click();`);
    await sleep(350);
    await pageClient.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(350);
    const drawerClosedEsc = await pageClient.evaluate(`document.getElementById('navDrawer').classList.contains('open')`);
    testReport.header.drawerClosedEsc = !drawerClosedEsc;

    // TEST 4: Header Search Button
    console.log('Testing Header Search Button...');
    await pageClient.evaluate(`document.getElementById('headerSearchBtn').click();`);
    await sleep(350);
    const searchScreenActive = await pageClient.evaluate(`({
      hash: window.location.hash,
      isSearchScreenActive: document.getElementById('screen-search').classList.contains('active'),
      isSearchTabActive: document.querySelector('.tab[data-route="/search"]').classList.contains('on'),
      searchInputExists: !!document.getElementById('searchInput')
    })`);
    testReport.header.searchScreen = searchScreenActive;

    // TEST 5: Live Search Querying
    console.log('Testing Live Search functionality...');
    await pageClient.evaluate(`
      const input = document.getElementById('searchInput');
      input.value = 'hoodie';
      input.dispatchEvent(new Event('input'));
    `);
    await sleep(250);
    const searchMatches = await pageClient.evaluate(`({
      status: document.getElementById('searchStatus').textContent,
      cardsCount: document.querySelectorAll('#searchGrid .product-card').length
    })`);
    testReport.bottomNav.searchMatches = searchMatches;

    // TEST 6: BEYOND Logo returns to home & resets carousel
    console.log('Testing BEYOND Logo Click...');
    await pageClient.evaluate(`document.querySelector('.logo').click();`);
    await sleep(350);
    const logoReturn = await pageClient.evaluate(`({
      hash: window.location.hash,
      isHomeScreenActive: document.getElementById('screen-home').classList.contains('active'),
      currentPiece: document.getElementById('name').textContent
    })`);
    testReport.header.logoReturn = logoReturn;

    // TEST 7: VIEW PIECE dedicated detail page navigation for each piece
    console.log('Testing VIEW PIECE for all 4 products...');
    const piecesTest = [
      { idx: 0, id: 'distressed-moto-jacket', expectedTitle: 'Distressed Moto Jacket' },
      { idx: 1, id: 'heavy-fleece-hoodie-01', expectedTitle: 'Heavy Fleece Hoodie 01' },
      { idx: 2, id: 'racing-spider-oversized-tee', expectedTitle: 'Racing Spider Oversized Tee' },
      { idx: 3, id: 'raw-plaster-hoodie-02', expectedTitle: 'Raw Plaster Hoodie 02' }
    ];

    for (const pTest of piecesTest) {
      await pageClient.evaluate(`document.querySelectorAll('.bars button')[${pTest.idx}].click();`);
      await sleep(350);
      await pageClient.evaluate(`document.getElementById('viewPieceBtn').click();`);
      await sleep(350);
      const detail = await pageClient.evaluate(`({
        hash: window.location.hash,
        title: document.querySelector('.piece-title') ? document.querySelector('.piece-title').textContent : null,
        price: document.querySelector('.piece-price') ? document.querySelector('.piece-price').textContent : null,
        hasAddBtn: !!document.getElementById('addToBagBtn'),
        hasSaveBtn: !!document.getElementById('savePieceBtn')
      })`);
      testReport.viewPiece[`piece_${pTest.idx}`] = detail;
      console.log(`Detail for Piece ${pTest.idx} (${pTest.id}):`, detail);

      if (pTest.idx === 0) {
        // Add to Bag and Save
        await pageClient.evaluate(`document.getElementById('addToBagBtn').click();`);
        await sleep(150);
        await pageClient.evaluate(`document.getElementById('savePieceBtn').click();`);
        await sleep(150);
      }

      // Return to Gallery
      await pageClient.evaluate(`document.getElementById('pieceBackBtn').click();`);
      await sleep(300);
    }

    // Check badges after add/save
    const badgesState = await pageClient.evaluate(`({
      cartBadge: document.getElementById('cartCountBadge').textContent,
      savedBadge: document.getElementById('savedCountBadge').textContent,
      drawerCartBadge: document.getElementById('drawerCartBadge').textContent,
      drawerSavedBadge: document.getElementById('drawerSavedBadge').textContent
    })`);
    testReport.state.badges = badgesState;
    console.log('Badges State:', badgesState);

    // TEST 8: Bottom Navigation - SHOP
    console.log('Testing Bottom Navigation: SHOP...');
    await pageClient.evaluate(`document.querySelector('.tab[data-route="/shop"]').click();`);
    await sleep(350);
    const shopData = await pageClient.evaluate(`({
      hash: window.location.hash,
      isShopActive: document.getElementById('screen-shop').classList.contains('active'),
      isShopTabOn: document.querySelector('.tab[data-route="/shop"]').classList.contains('on'),
      cardsCount: document.querySelectorAll('#shopGrid .product-card').length,
      filterButtons: document.querySelectorAll('.filter-btn').length
    })`);
    testReport.bottomNav.shop = shopData;

    // TEST 9: Bottom Navigation - SAVED
    console.log('Testing Bottom Navigation: SAVED...');
    await pageClient.evaluate(`document.querySelector('.tab[data-route="/saved"]').click();`);
    await sleep(350);
    const savedData = await pageClient.evaluate(`({
      hash: window.location.hash,
      isSavedActive: document.getElementById('screen-saved').classList.contains('active'),
      isSavedTabOn: document.querySelector('.tab[data-route="/saved"]').classList.contains('on'),
      savedCards: document.querySelectorAll('#savedGrid .product-card').length
    })`);
    testReport.bottomNav.saved = savedData;

    // TEST 10: Bottom Navigation - CART
    console.log('Testing Bottom Navigation: CART...');
    await pageClient.evaluate(`document.querySelector('.tab[data-route="/cart"]').click();`);
    await sleep(350);
    const cartData = await pageClient.evaluate(`({
      hash: window.location.hash,
      isCartActive: document.getElementById('screen-cart').classList.contains('active'),
      isCartTabOn: document.querySelector('.tab[data-route="/cart"]').classList.contains('on'),
      itemsCount: document.querySelectorAll('.cart-item').length,
      totalText: document.querySelector('.summary-row.total') ? document.querySelector('.summary-row.total').textContent.trim() : null
    })`);
    testReport.bottomNav.cart = cartData;

    // TEST 11: Bottom Navigation - HOME
    console.log('Testing Bottom Navigation: HOME...');
    await pageClient.evaluate(`document.querySelector('.tab[data-route="/"]').click();`);
    await sleep(350);
    const homeData = await pageClient.evaluate(`({
      hash: window.location.hash,
      isHomeActive: document.getElementById('screen-home').classList.contains('active'),
      isHomeTabOn: document.querySelector('.tab[data-route="/"]').classList.contains('on')
    })`);
    testReport.bottomNav.home = homeData;

    fs.writeFileSync(
      path.join(__dirname, '..', 'interactive_verification_report.json'),
      JSON.stringify(testReport, null, 2)
    );
    console.log('Successfully completed all tests! Report saved.');

    await pageClient.close();
    await client.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    edgeProcess.kill();
  }
}

run();
