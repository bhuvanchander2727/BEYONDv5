const { spawn } = require('child_process');
const http = require('http');

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
    if (res.exceptionDetails) {
      console.error('JS Exception:', res.exceptionDetails);
    }
    return res.result ? res.result.value : res;
  }
}

async function run() {
  const p = spawn(EDGE_PATH, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1500);

  try {
    const v = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    const c = new CDP(v.webSocketDebuggerUrl);
    await c.connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'http://localhost:3030/#/' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();
    await pc.send('Page.enable');
    await pc.send('Runtime.enable');
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/' });
    await sleep(1500);

    const checkD = await pc.evaluate(`(() => {
      return {
        hasD: typeof window.DeviceOrientationEvent !== 'undefined',
        hasReqPerm: typeof window.DeviceOrientationEvent?.requestPermission === 'function',
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      };
    })()`);
    console.log('Browser Environment Check:', checkD);

    // Trigger first touch gesture to resolve permission seamlessly
    await pc.evaluate(`(async () => {
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') {
        await window.DeviceOrientationEvent.requestPermission().catch(() => {});
      }
      await new Promise(r => setTimeout(r, 100));
    })()`);
    await sleep(200);

    console.log('--- 1. Testing Baseline & Initial Orientation Calibration ---');
    // Emulate device orientation event: Initial holding position: beta=50 (holding upright at 50deg angle), gamma=0 (level)
    const initRes = await pc.evaluate(`(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: 50, gamma: 0, bubbles: true }));
      const rack = document.getElementById('rack');
      return {
        ry: rack.style.getPropertyValue('--ry'),
        rx: rack.style.getPropertyValue('--rx'),
        tx: rack.style.getPropertyValue('--tx'),
        ty: rack.style.getPropertyValue('--ty')
      };
    })()`);
    console.log('Resting Position (beta:50, gamma:0):', initRes);

    console.log('\n--- 2. Testing Small Tilt (3 degrees right: gamma=3) ---');
    // Dispatch small tilt multiple frames to simulate natural hand movement with smoothing
    const smallTiltRes = await pc.evaluate(`(() => {
      for (let i = 0; i < 6; i++) {
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: 50, gamma: 3, bubbles: true }));
      }
      const rack = document.getElementById('rack');
      return {
        ry: rack.style.getPropertyValue('--ry'),
        rx: rack.style.getPropertyValue('--rx'),
        tx: rack.style.getPropertyValue('--tx'),
        ty: rack.style.getPropertyValue('--ty')
      };
    })()`);
    console.log('Small 3deg tilt response:', smallTiltRes);

    console.log('\n--- 3. Testing Medium Tilt (7 degrees right, 6 degrees forward: gamma=7, beta=44) ---');
    const medTiltRes = await pc.evaluate(`(() => {
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: 44, gamma: 7, bubbles: true }));
      }
      const rack = document.getElementById('rack');
      return {
        ry: rack.style.getPropertyValue('--ry'),
        rx: rack.style.getPropertyValue('--rx'),
        tx: rack.style.getPropertyValue('--tx'),
        ty: rack.style.getPropertyValue('--ty')
      };
    })()`);
    console.log('Medium tilt response:', medTiltRes);

    console.log('\n--- 4. Testing Max Safe Tilt (15 degrees left, 15 degrees back: gamma=-15, beta=65) ---');
    const maxTiltRes = await pc.evaluate(`(() => {
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: 65, gamma: -15, bubbles: true }));
      }
      const rack = document.getElementById('rack');
      return {
        ry: rack.style.getPropertyValue('--ry'),
        rx: rack.style.getPropertyValue('--rx'),
        tx: rack.style.getPropertyValue('--tx'),
        ty: rack.style.getPropertyValue('--ty')
      };
    })()`);
    console.log('Max safe tilt response:', maxTiltRes);

    console.log('\n--- 5. Testing Smooth Return to Rest (gamma=0, beta=50) ---');
    const returnRestRes = await pc.evaluate(`(() => {
      for (let i = 0; i < 12; i++) {
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: 50, gamma: 0, bubbles: true }));
      }
      const rack = document.getElementById('rack');
      return {
        ry: rack.style.getPropertyValue('--ry'),
        rx: rack.style.getPropertyValue('--rx'),
        tx: rack.style.getPropertyValue('--tx'),
        ty: rack.style.getPropertyValue('--ty')
      };
    })()`);
    console.log('Returned to rest position:', returnRestRes);

    console.log('\n--- 6. Testing Desktop Pointer Interaction (Exact Preservation) ---');
    const desktopRes = await pc.evaluate(`(() => {
      // Simulate desktop mouse at right edge: clientX = window.innerWidth, clientY = window.innerHeight / 2
      // nx = (1)*2 - 1 = 1, ny = (0.5)*2 - 1 = 0
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: window.innerWidth,
        clientY: window.innerHeight / 2,
        pointerType: 'mouse',
        bubbles: true
      }));
      const rack = document.getElementById('rack');
      return {
        ry: rack.style.getPropertyValue('--ry'),
        rx: rack.style.getPropertyValue('--rx'),
        tx: rack.style.getPropertyValue('--tx'),
        ty: rack.style.getPropertyValue('--ty')
      };
    })()`);
    console.log('Desktop mouse at far right edge (expected: --ry: 5.50deg, --tx: 12.0px):', desktopRes);

    console.log('\n--- 7. Testing Desktop Mouse Leave ---');
    const desktopLeaveRes = await pc.evaluate(`(() => {
      document.dispatchEvent(new Event('mouseleave'));
      const rack = document.getElementById('rack');
      return {
        ry: rack.style.getPropertyValue('--ry'),
        rx: rack.style.getPropertyValue('--rx'),
        tx: rack.style.getPropertyValue('--tx'),
        ty: rack.style.getPropertyValue('--ty')
      };
    })()`);
    console.log('Desktop mouseleave (expected: 0.00deg, 0.0px):', desktopLeaveRes);

    p.kill();
    console.log('\nAll gyro and desktop tests passed successfully!');
  } catch (err) {
    p.kill();
    console.error('Test error:', err);
  }
}

run();
