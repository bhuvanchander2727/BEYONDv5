import time
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

def test_storefront():
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    temp_dir = tempfile.mkdtemp()
    chrome_options.add_argument(f"--user-data-dir={temp_dir}")
    # Enable browser logs
    chrome_options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})

    driver = webdriver.Chrome(options=chrome_options)
    try:
        url = "http://localhost:3030/"
        print(f"Navigating to {url}...")
        driver.get(url)
        time.sleep(2)

        # 1. Check window.BeyondSupabase
        has_supabase_client = driver.execute_script("return typeof window.BeyondSupabase !== 'undefined'")
        print("window.BeyondSupabase defined:", has_supabase_client)
        assert has_supabase_client, "window.BeyondSupabase should be defined!"

        # 2. Check credentials resolution in browser
        creds = driver.execute_script("return window.BeyondSupabase.getCredentials()")
        print("Credentials in browser:", creds['url'][:25] + "...", "hasKey:", bool(creds['key']))
        assert creds['url'] and creds['key'], "Credentials must be resolved from config.js or window!"

        # 3. Check verifyConnection from browser
        verify_res = driver.execute_async_script("""
            const callback = arguments[arguments.length - 1];
            window.BeyondSupabase.verifyConnection().then(res => callback(res)).catch(err => callback({ error: String(err) }));
        """)
        print("Browser verifyConnection result:", verify_res)
        assert verify_res.get('success') == True, f"Supabase verification failed: {verify_res}"

        # 4. Check Hero rack items rendered
        rack_items = driver.find_elements(By.CSS_SELECTOR, "#rack .item")
        print(f"Hero rack items count: {len(rack_items)}")
        assert len(rack_items) >= 4, "Rack should have at least 4 items rendered!"

        # 5. Check product name & price in DOM
        name_el = driver.find_element(By.ID, "name")
        price_el = driver.find_element(By.ID, "price")
        print(f"Hero product displayed: '{name_el.text}', '{price_el.text}'")
        assert name_el.text != "", "Hero product name should not be empty!"

        # 6. Test Shop Route
        driver.get("http://localhost:3030/#/shop")
        time.sleep(1)
        shop_cards = driver.find_elements(By.CSS_SELECTOR, ".shop-card")
        print(f"Shop screen rendered with {len(shop_cards)} cards.")
        assert len(shop_cards) >= 12, "Shop should render collection items!"

        # 7. Test Piece Route
        driver.get("http://localhost:3030/#/piece/distressed-moto-jacket")
        time.sleep(1)
        piece_title = driver.find_element(By.CSS_SELECTOR, ".piece-hero-title")
        print(f"Piece details rendered: '{piece_title.text}'")
        assert "MOTO" in piece_title.text.upper()

        # 8. Test Cart Screen
        driver.get("http://localhost:3030/#/cart")
        time.sleep(1)
        cart_title = driver.find_element(By.CSS_SELECTOR, ".page-title")
        print(f"Cart page rendered: '{cart_title.text}'")

        # 9. Test Admin Portal
        driver.get("http://localhost:3030/admin/")
        time.sleep(1)
        auth_brand = driver.find_element(By.CSS_SELECTOR, ".auth-brand")
        print(f"Admin portal rendered: '{auth_brand.text}'")

        # Check console logs for any errors
        logs = driver.get_log('browser')
        errors = [l for l in logs if l['level'] == 'SEVERE']
        if errors:
            print("\nBrowser SEVERE errors:")
            for err in errors:
                print(" -", err['message'])
        else:
            print("\nZero SEVERE browser errors detected!")

        print("\nALL STOREFRONT & SUPABASE INTEGRATION TESTS PASSED!")

    finally:
        driver.quit()

if __name__ == "__main__":
    test_storefront()
