import time
import os
import shutil
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def test_admin_portal():
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    temp_dir = tempfile.mkdtemp()
    chrome_options.add_argument(f"--user-data-dir={temp_dir}")

    driver = webdriver.Chrome(options=chrome_options)
    try:
        url = "http://localhost:3030/admin/"
        print(f"Navigating to {url}...")
        driver.get(url)
        time.sleep(1)

        # 1. Verify dynamic dev notice is injected on localhost
        notice = driver.find_element(By.ID, "devCredentialsNotice")
        print("PASS: Dynamic devCredentialsNotice found in local development DOM.")
        assert "owner@beyond.local" in notice.text
        assert "BeyondDemo@2026" in notice.text

        # 2. Test invalid credentials
        email_input = driver.find_element(By.ID, "loginEmail")
        pass_input = driver.find_element(By.ID, "loginPassword")
        submit_btn = driver.find_element(By.ID, "loginSubmitBtn")

        email_input.clear()
        email_input.send_keys("owner@beyond.local")
        pass_input.clear()
        pass_input.send_keys("WrongPassword")
        submit_btn.click()
        time.sleep(1)

        err_el = driver.find_element(By.ID, "authError")
        print(f"Auth error displayed: '{err_el.text}'")
        assert "incorrect" in err_el.text.lower() or "invalid" in err_el.text.lower()
        print("PASS: Invalid credentials correctly rejected.")

        # 3. Test valid local demo login
        email_input.clear()
        email_input.send_keys("owner@beyond.local")
        pass_input.clear()
        pass_input.send_keys("BeyondDemo@2026")
        submit_btn.click()
        time.sleep(1.5)

        app_shell = driver.find_element(By.ID, "appShell")
        assert app_shell.is_displayed()
        print("PASS: Valid local demo login successfully authenticated and dashboard displayed.")

        # 4. Verify logout
        logout_btn = driver.find_element(By.ID, "logoutBtn")
        logout_btn.click()
        time.sleep(1)

        auth_view = driver.find_element(By.ID, "authView")
        assert auth_view.is_displayed()
        print("PASS: Logout works and returned to auth view.")

        # 5. Verify localStorage tampering defense:
        # Simulate an attacker manually setting localStorage beyond_admin_auth_v1 without proper authType
        driver.execute_script("localStorage.setItem('beyond_admin_auth_v1', JSON.stringify({id:'hacker', email:'hacker@evil.com', role:'owner'}));")
        driver.refresh()
        time.sleep(1)

        auth_view_after_hack = driver.find_element(By.ID, "authView")
        assert auth_view_after_hack.is_displayed()
        print("PASS: Forged localStorage ({role:'owner'}) without valid authType was rejected!")

        print("\nALL 5 AUTHENTICATION & SECURITY TESTS PASSED SUCCESSFULLY!")

    finally:
        driver.quit()
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == '__main__':
    test_admin_portal()
