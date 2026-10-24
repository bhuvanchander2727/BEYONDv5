import subprocess
import os
import shutil

chrome_exe = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
profile_dir = os.path.abspath('temp_test_profile')
os.makedirs(profile_dir, exist_ok=True)

test_runner_html = os.path.abspath('admin_auth_test_runner.html')

# We create an automated test harness that loads inside the browser,
# executes the authentication tests against admin/index.html, and reports results to window.__testResults
with open(test_runner_html, 'w', encoding='utf-8') as f:
    f.write('''<!DOCTYPE html>
<html>
<head><title>Admin Auth Test Runner</title></head>
<body>
<iframe id="adminFrame" src="http://localhost:3030/admin/" style="width: 1200px; height: 800px;"></iframe>
<pre id="output"></pre>
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

  // Wait for reload
  frame.onload = async function() {
    const fDoc = frame.contentDocument || frame.contentWindow.document;
    const fWin = frame.contentWindow;

    const emailInput = fDoc.getElementById('loginEmail');
    const passInput = fDoc.getElementById('loginPassword');
    const form = fDoc.getElementById('loginForm');
    const authError = fDoc.getElementById('authError');
    const authView = fDoc.getElementById('authView');
    const appShell = fDoc.getElementById('appShell');

    log('Loaded admin login page on origin ' + fWin.location.origin, true);

    // TEST 1: Invalid Password
    emailInput.value = 'owner@beyond.local';
    passInput.value = 'WrongPassword123';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 200));

    if (authError.classList.contains('visible') && authError.textContent.includes('incorrect')) {
      log('Test 1: Wrong password correctly rejected with message: "' + authError.textContent + '"', true);
    } else {
      log('Test 1: Failed to reject wrong password. Error text: ' + authError.textContent, false);
    }

    // TEST 2: Invalid Email
    emailInput.value = 'intruder@random.com';
    passInput.value = 'BeyondDemo@2026';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 200));

    if (authError.classList.contains('visible') && authError.textContent.includes('owner@beyond.local')) {
      log('Test 2: Unknown email correctly rejected with message: "' + authError.textContent + '"', true);
    } else {
      log('Test 2: Failed to reject unknown email. Error text: ' + authError.textContent, false);
    }

    // TEST 3: Valid Demo Login (owner@beyond.local / BeyondDemo@2026)
    emailInput.value = 'owner@beyond.local';
    passInput.value = 'BeyondDemo@2026';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 300));

    const isAppVisible = appShell && fWin.getComputedStyle(appShell).display !== 'none';
    const isAuthHidden = authView && fWin.getComputedStyle(authView).display === 'none';
    const userEmailEl = fDoc.getElementById('sidebarUserEmail');

    if (isAppVisible && isAuthHidden && userEmailEl && userEmailEl.textContent.includes('owner@beyond.local')) {
      log('Test 3: Demo login succeeded! Dashboard visible for ' + userEmailEl.textContent, true);
    } else {
      log('Test 3: Demo login failed to reveal dashboard', false);
    }

    // TEST 4: Navigation through sections
    fWin.location.hash = '#/products';
    await new Promise(r => setTimeout(r, 200));
    const topbarTitle = fDoc.getElementById('topbarTitle');
    if (topbarTitle && topbarTitle.textContent === 'Products') {
      log('Test 4: Navigation to #/products verified (topbar: ' + topbarTitle.textContent + ')', true);
    } else {
      log('Test 4: Navigation failed', false);
    }

    // TEST 5: Working Logout Button
    const logoutBtn = fDoc.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.click();
      await new Promise(r => setTimeout(r, 300));

      const isAppHiddenAfterLogout = appShell && fWin.getComputedStyle(appShell).display === 'none';
      const isAuthVisibleAfterLogout = authView && fWin.getComputedStyle(authView).display !== 'none';
      const sessionCleared = !fWin.localStorage.getItem('beyond_admin_auth_v1');

      if (isAppHiddenAfterLogout && isAuthVisibleAfterLogout && sessionCleared) {
        log('Test 5: Working logout button successfully cleared session and returned to login view', true);
      } else {
        log('Test 5: Logout failed to reset state cleanly', false);
      }
    } else {
      log('Test 5: Logout button not found', false);
    }

    document.title = 'TESTS_COMPLETED';
  };
};
</script>
</body>
</html>''')

# Copy to root so it can be served via localhost
shutil.copy2(test_runner_html, 'run_auth_tests.html')

out_screen = os.path.abspath('auth_test_results.png')
res = subprocess.run([
    chrome_exe,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={profile_dir}',
    f'--screenshot={out_screen}',
    '--window-size=1200,900',
    '--virtual-time-budget=8000',
    'http://localhost:3030/run_auth_tests.html'
], capture_output=True, text=True)

print('Chrome exited with code:', res.returncode)

if os.path.exists('run_auth_tests.html'): os.remove('run_auth_tests.html')
if os.path.exists(test_runner_html): os.remove(test_runner_html)
if os.path.exists(profile_dir): shutil.rmtree(profile_dir, ignore_errors=True)
