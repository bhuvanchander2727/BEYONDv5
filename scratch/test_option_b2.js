const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function testOptionB2() {
  const browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(browserPath, [
    '--headless',
    '--remote-debugging-port=9226',
    '--disable-gpu',
    'http://localhost:3030/index.html'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  function getTabs() {
    return new Promise((resolve, reject) => {
      http.get('http://localhost:9226/json', res => {
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

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  const css = `
    .info {
      padding: 22px 20px 14px;
      background: linear-gradient(
        180deg,
        rgba(14, 14, 13, 0) 0%,
        rgba(14, 14, 13, 0.20) 22%,
        rgba(14, 14, 13, 0.62) 52%,
        rgba(14, 14, 13, 0.90) 80%,
        rgba(14, 14, 13, 0.98) 100%
      );
    }
    .bars {
      margin-bottom: 12px;
    }
    .info-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .name {
      font-size: clamp(18px, 5.2vw, 22px);
      line-height: 1.15;
      letter-spacing: 0.04em;
      min-height: auto;
      text-align: left;
    }
    .row {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 0;
    }
    .price {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      width: 100%;
    }
    .price small {
      font-size: 11px;
      letter-spacing: 0.16em;
      margin-bottom: 0;
      color: var(--ash-grey);
    }
    .price span {
      font-size: 19px;
      font-weight: 700;
      line-height: 1;
      color: var(--paper);
    }
    .view {
      width: 100%;
      text-align: center;
      justify-content: center;
      padding: 13px 20px;
      font-size: 12px;
      letter-spacing: 0.14em;
    }
  `;

  await send('Runtime.evaluate', {
    expression: `
      const style = document.createElement('style');
      style.textContent = \`${css}\`;
      document.head.appendChild(style);
    `
  });

  await new Promise(r => setTimeout(r, 600));

  const ss = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('test_option_b2_mobile.png', Buffer.from(ss.data, 'base64'));
  console.log('Saved test_option_b2_mobile.png');

  ws.close();
  edge.kill();
  process.exit(0);
}

testOptionB2().catch(console.error);
