const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(browserPath, [
    '--headless',
    '--remote-debugging-port=9227',
    '--disable-gpu',
    'http://localhost:3030/index.html'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  function getTabs() {
    return new Promise((resolve, reject) => {
      http.get('http://localhost:9227/json', res => {
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

  async function snap(w, h, mobile, name) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile
    });
    await new Promise(r => setTimeout(r, 500));
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(name, Buffer.from(ss.data, 'base64'));
    console.log('Saved', name);
  }

  // 1. Desktop
  await snap(1280, 800, false, 'verify_desktop.png');

  // 2. Tablet
  await snap(768, 1024, false, 'verify_tablet.png');

  // 3. Mobile standard
  await snap(390, 844, true, 'verify_mobile_390.png');

  // 4. Mobile narrow
  await snap(360, 740, true, 'verify_mobile_360.png');

  // 5. Test switching to piece 3 (Racing Spider Tee) on mobile
  await send('Runtime.evaluate', {
    expression: "document.querySelectorAll('.bars button')[2].click()"
  });
  await new Promise(r => setTimeout(r, 500));
  const ssTeeMobile = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('verify_mobile_tee.png', Buffer.from(ssTeeMobile.data, 'base64'));
  console.log('Saved verify_mobile_tee.png');

  ws.close();
  edge.kill();
  process.exit(0);
}

main().catch(console.error);
