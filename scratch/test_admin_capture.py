import subprocess
import os
import shutil

chrome_exe = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
profile_dir = os.path.abspath('temp_chrome_profile')
os.makedirs(profile_dir, exist_ok=True)

test_html = os.path.abspath('temp_auth_setup.html')
with open(test_html, 'w', encoding='utf-8') as f:
    f.write('''<!DOCTYPE html><html><body><script>
    localStorage.setItem("beyond_admin_auth_v1", JSON.stringify({
        id: "owner-1",
        email: "owner@beyond-streetwear.com",
        role: "owner"
    }));
    window.location.href = "http://localhost:3030/admin/#/dashboard";
    </script></body></html>''')

# Visit test_html once on localhost origin so localStorage is set for origin http://localhost:3030
# To do this cleanly, serve test_html through the server or load via localhost
shutil.copy2(test_html, 'admin_setup.html')

setup_url = 'http://localhost:3030/admin_setup.html'

subprocess.run([
    chrome_exe,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={profile_dir}',
    '--window-size=1440,900',
    '--virtual-time-budget=3000',
    setup_url
], capture_output=True)

# 1. Capture Dashboard
out_dash = os.path.abspath('admin_dashboard_verify.png')
subprocess.run([
    chrome_exe,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={profile_dir}',
    f'--screenshot={out_dash}',
    '--window-size=1440,900',
    '--virtual-time-budget=3000',
    'http://localhost:3030/admin/#/dashboard'
], capture_output=True)

# 2. Capture Products
out_prod = os.path.abspath('admin_products_verify.png')
subprocess.run([
    chrome_exe,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={profile_dir}',
    f'--screenshot={out_prod}',
    '--window-size=1440,900',
    '--virtual-time-budget=3000',
    'http://localhost:3030/admin/#/products'
], capture_output=True)

# 3. Capture Orders
out_ord = os.path.abspath('admin_orders_verify.png')
subprocess.run([
    chrome_exe,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={profile_dir}',
    f'--screenshot={out_ord}',
    '--window-size=1440,900',
    '--virtual-time-budget=3000',
    'http://localhost:3030/admin/#/orders'
], capture_output=True)

# 4. Capture Mobile View
out_mob = os.path.abspath('admin_mobile_verify.png')
subprocess.run([
    chrome_exe,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={profile_dir}',
    f'--screenshot={out_mob}',
    '--window-size=390,844',
    '--virtual-time-budget=3000',
    'http://localhost:3030/admin/#/dashboard'
], capture_output=True)

for f in ['admin_dashboard_verify.png', 'admin_products_verify.png', 'admin_orders_verify.png', 'admin_mobile_verify.png']:
    print(f, os.path.exists(f), os.path.getsize(f) if os.path.exists(f) else 0)

if os.path.exists('admin_setup.html'): os.remove('admin_setup.html')
if os.path.exists(test_html): os.remove(test_html)
