const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function testWidths() {
  const browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(browserPath, [
    '--headless',
    '--remote-debugging-port=9228',
    '--disable-gpu',
    'http://localhost:3030/index.html'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  function getTabs() {
    return new Promise((resolve, reject) => {
      http.get('http://localhost:9228/json', res => {
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

  async function capture(w, h, filename) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 600));
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filename, Buffer.from(ss.data, 'base64'));
    console.log('Saved', filename);
  }

  await capture(1366, 768, 'test_1366.png');
  await capture(1920, 1080, 'test_1920.png');

  ws.close();
  edge.kill();
  process.exit(0);
}

testWidths().catch(console.error);
