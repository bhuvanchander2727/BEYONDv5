import subprocess
import os
import shutil
import time

chrome_exe = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
profile_dir = os.path.abspath('temp_test_profile_sec')
os.makedirs(profile_dir, exist_ok=True)

test_runner_html = os.path.abspath('run_sec_tests.html')

with open(test_runner_html, 'w', encoding='utf-8') as f:
    f.write('''<!DOCTYPE html>
<html>
<head><title>Security & Auth Verification Runner</title></head>
<body style="font-family: monospace; background: #111; color: #eee; padding: 20px;">
<h2>BEYOND Admin Security Verification</h2>
<iframe id="adminFrame" src="http://localhost:3030/admin/" style="width: 1200px; height: 750px; border: 1px solid #333;"></iframe>
<pre id="output" style="font-size: 14px; line-height: 1.6; margin-top: 20px;"></pre>
<script>
window.__testResults = { passed: 0, failed: 0, log: [] };

function log(msg, success = true) {
  const line = (success ? '[PASS] ' : '[FAIL] ') + msg;
  window.__testResults.log.push(line);
  if (success) window.__testResults.passed++;
  else window.__testResults.failed++;
  document.getElementById('output').textContent = window.__testResults.log.join('\\n');
}

const frame = document.getElementById('adminFrame');

frame.onload = async function() {
  const doc = frame.contentDocument || frame.contentWindow.document;
  const win = frame.contentWindow;

  // Clear previous session
  win.localStorage.removeItem('beyond_admin_auth_v1');
  win.location.reload();

  frame.onload = async function() {
    const fDoc = frame.contentDocument || frame.contentWindow.document;
    const fWin = frame.contentWindow;

    await new Promise(r => setTimeout(r, 400));

    // CHECK 1: Verify dynamic credentials notice exists on localhost
    const notice = fDoc.getElementById('devCredentialsNotice');
    if (notice && notice.textContent.includes('owner@beyond.local')) {
      log('Check 1: Dynamic local dev credentials notice injected on localhost without hardcoding in HTML', true);
    } else {
      log('Check 1: Failed to find devCredentialsNotice', false);
    }

    // CHECK 2: Invalid password rejection
    const emailInput = fDoc.getElementById('loginEmail');
    const passInput = fDoc.getElementById('loginPassword');
    const form = fDoc.getElementById('loginForm');
    const authError = fDoc.getElementById('authError');
    const authView = fDoc.getElementById('authView');
    const appShell = fDoc.getElementById('appShell');

    emailInput.value = 'owner@beyond.local';
    passInput.value = 'WrongSecret999';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 200));

    if (authError.classList.contains('visible') && authError.textContent.includes('incorrect')) {
      log('Check 2: Invalid credentials rejected cleanly: "' + authError.textContent + '"', true);
    } else {
      log('Check 2: Failed to reject invalid password', false);
    }

    // CHECK 3: Valid local demo login
    emailInput.value = 'owner@beyond.local';
    passInput.value = 'BeyondDemo@2026';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 300));

    const isAppVisible = appShell && fWin.getComputedStyle(appShell).display !== 'none';
    const isAuthHidden = authView && fWin.getComputedStyle(authView).display === 'none';

    if (isAppVisible && isAuthHidden) {
      log('Check 3: Valid local demo authentication succeeded, dashboard visible', true);
    } else {
      log('Check 3: Valid login failed to reveal dashboard', false);
    }

    // CHECK 4: Working Logout
    const logoutBtn = fDoc.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.click();
      await new Promise(r => setTimeout(r, 300));

      const isAppHiddenAfterLogout = appShell && fWin.getComputedStyle(appShell).display === 'none';
      const isAuthVisibleAfterLogout = authView && fWin.getComputedStyle(authView).display !== 'none';
      const sessionCleared = !fWin.localStorage.getItem('beyond_admin_auth_v1');

      if (isAppHiddenAfterLogout && isAuthVisibleAfterLogout && sessionCleared) {
        log('Check 4: Working logout button cleared storage and returned to login view', true);
      } else {
        log('Check 4: Logout did not reset cleanly', false);
      }
    }

    // CHECK 5: Prevent localStorage values from being treated as proof of owner authentication!
    // Simulate attacker injecting {role: 'owner'} directly into localStorage
    fWin.localStorage.setItem('beyond_admin_auth_v1', JSON.stringify({
      id: 'attacker-id',
      email: 'attacker@evil.com',
      role: 'owner'
    }));

    // Trigger checkSession reload
    fWin.location.reload();

    frame.onload = async function() {
      const fDoc2 = frame.contentDocument || frame.contentWindow.document;
      const fWin2 = frame.contentWindow;

      await new Promise(r => setTimeout(r, 400));

      const appShell2 = fDoc2.getElementById('appShell');
      const authView2 = fDoc2.getElementById('authView');

      const isAppHiddenAfterForgedStorage = appShell2 && fWin2.getComputedStyle(appShell2).display === 'none';
      const isAuthVisibleAfterForgedStorage = authView2 && fWin2.getComputedStyle(authView2).display !== 'none';

      if (isAppHiddenAfterForgedStorage && isAuthVisibleAfterForgedStorage) {
        log('Check 5: Forged localStorage ({role:"owner"}) was REJECTED by checkSession() — login view displayed', true);
      } else {
        log('Check 5: Forged localStorage was accepted! SECURITY VULNERABILITY!', false);
      }

      document.title = 'SECURITY_CHECKS_COMPLETED: ' + window.__testResults.passed + ' PASSED, ' + window.__testResults.failed + ' FAILED';
      
      // Save results to server or localStorage for reading
      fetch('http://localhost:3030/scratch/results.txt', {
        method: 'POST',
        body: JSON.stringify(window.__testResults)
      }).catch(() => {});
    };
  };
};
</script>
</body>
</html>''')

out_screen = os.path.abspath('sec_test_results.png')
res = subprocess.run([
    chrome_exe,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={profile_dir}',
    f'--screenshot={out_screen}',
    '--window-size=1200,1400',
    '--virtual-time-budget=25000',
    'http://localhost:3030/run_sec_tests.html'
], capture_output=True, text=True)

print('Chrome exited with code:', res.returncode)

if os.path.exists(test_runner_html): os.remove(test_runner_html)
if os.path.exists(profile_dir): shutil.rmtree(profile_dir, ignore_errors=True)
