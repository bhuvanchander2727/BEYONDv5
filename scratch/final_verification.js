const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function runFinalVerification() {
  const browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(browserPath, [
    '--headless',
    '--remote-debugging-port=9230',
    '--disable-gpu',
    'http://localhost:3030/index.html'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  function getTabs() {
    return new Promise((resolve, reject) => {
      http.get('http://localhost:9230/json', res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }

  const tabs = await getTabs();
  const pageTab = tabs.find(t => t.url.includes('localhost:3030')) || tabs[0];
  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

  let msgId = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      callbacks.get(data.id)(data.result);
      callbacks.delete(data.id);
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise(r => ws.onopen = r);

  async function evalJS(code) {
    const res = await send('Runtime.evaluate', { expression: code, returnByValue: true });
    return res.result ? res.result.value : null;
  }

  const results = {
    viewports: {},
    navTests: {},
    overflowTests: {}
  };

  const viewports = [
    { w: 390, h: 844, mobile: true, name: 'final_390.png' },
    { w: 768, h: 1024, mobile: false, name: 'final_768.png' },
    { w: 1366, h: 768, mobile: false, name: 'final_1366.png' },
    { w: 1920, h: 1080, mobile: false, name: 'final_1920.png' }
  ];

  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: vp.mobile ? 2 : 1,
      mobile: vp.mobile
    });
    await new Promise(r => setTimeout(r, 600));

    // Check overflow
    const overflowInfo = await evalJS(`
      ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth
      })
    `);

    results.overflowTests[vp.w] = overflowInfo;

    const ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(vp.name, Buffer.from(ss.data, 'base64'));
    results.viewports[vp.w] = vp.name;
    console.log(`Verified ${vp.w}px viewport - Screenshot: ${vp.name}, ScrollWidth: ${overflowInfo.scrollWidth}`);
  }

  // Set desktop for interactive component tests
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise(r => setTimeout(r, 400));

  // Test 1: Carousel indicator switching
  await evalJS("document.querySelectorAll('.bars button')[1].click()");
  await new Promise(r => setTimeout(r, 400));
  const activeProduct = await evalJS("document.getElementById('name').textContent");
  results.navTests.carouselSwitch = activeProduct;
  console.log('Carousel switched piece to:', activeProduct);

  // Test 2: VIEW PIECE button link
  const viewPieceHref = await evalJS("document.getElementById('viewPieceBtn').getAttribute('href')");
  results.navTests.viewPieceHref = viewPieceHref;
  console.log('VIEW PIECE button href:', viewPieceHref);

  // Test 3: Menu button toggle
  await evalJS("document.getElementById('menuBtn').click()");
  await new Promise(r => setTimeout(r, 200));
  const hashAfterMenu = await evalJS("window.location.hash");
  results.navTests.hashAfterMenu = hashAfterMenu;
  console.log('Hash after menuBtn click:', hashAfterMenu);

  // Test 4: Search link click
  await evalJS("document.getElementById('headerSearchBtn').click()");
  await new Promise(r => setTimeout(r, 200));
  const hashAfterSearch = await evalJS("window.location.hash");
  const searchTabActive = await evalJS("document.querySelector('.tab[data-route=\"/search\"]').classList.contains('on')");
  results.navTests.searchNav = { hash: hashAfterSearch, tabActive: searchTabActive };
  console.log('Search nav test:', results.navTests.searchNav);

  // Test 5: Bottom nav tabs click (return to home)
  await evalJS("document.querySelector('.tab[data-route=\"/\"]').click()");
  await new Promise(r => setTimeout(r, 200));
  const homeTabActive = await evalJS("document.querySelector('.tab[data-route=\"/\"]').classList.contains('on')");
  results.navTests.homeNav = { tabActive: homeTabActive };
  console.log('Home nav test:', results.navTests.homeNav);

  // Test 6: Reduced motion preference
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  await new Promise(r => setTimeout(r, 200));
  const reducedMotionState = await evalJS("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
  results.navTests.reducedMotion = reducedMotionState;
  console.log('Reduced motion active:', reducedMotionState);

  fs.writeFileSync('verification_summary.json', JSON.stringify(results, null, 2));

  ws.close();
  edge.kill();
  process.exit(0);
}

runFinalVerification().catch(console.error);
