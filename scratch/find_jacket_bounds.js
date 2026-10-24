const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9232;

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

async function main() {
  const p = spawn(EDGE_PATH, ['--remote-debugging-port=' + PORT, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1200);
  try {
    const v = await httpGet('http://127.0.0.1:' + PORT + '/json/version');
    const c = new CDP(v.webSocketDebuggerUrl);
    await c.connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'http://localhost:3000/#/' });
    const targets = await httpGet('http://127.0.0.1:' + PORT + '/json');
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();
    await sleep(1000);

    const bounds = await pc.evaluate(`(async () => {
      const img = new Image();
      img.src = 'assets/products/moto-jacket.webp';
      await new Promise(r => { img.onload = r; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width, maxX = 0, minY = canvas.height, maxY = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const alpha = data[(y * canvas.width + x) * 4 + 3];
          if (alpha > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return {
        imageWidth: img.naturalWidth,
        imageHeight: img.naturalHeight,
        minX, maxX, minY, maxY,
        contentWidth: maxX - minX + 1,
        contentHeight: maxY - minY + 1,
        contentAspectRatio: (maxX - minX + 1) / (maxY - minY + 1)
      };
    })()`);

    console.log('Jacket pixel bounds:', JSON.stringify(bounds, null, 2));
  } finally {
    p.kill();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
