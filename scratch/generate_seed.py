import json
import os

with open('products.json', 'r', encoding='utf-8') as f:
    products = json.load(f)

categories = [
    ('outerwear', 'Outerwear', 'outerwear', 'Heavyweight coats, bombers, and distressed leather jackets.', 1),
    ('tops', 'Tops & Knitwear', 'tops', 'Heavy fleece hoodies, boxy tees, and brutalist knits.', 2),
    ('bottoms', 'Bottoms', 'bottoms', 'Waxed canvas cargos, straight selvedge denim, and stacked sweatpants.', 3),
    ('footwear', 'Footwear', 'footwear', 'Goodyear welted brutalist boots and lug sole footwear.', 4),
    ('accessories', 'Accessories', 'accessories', 'Ribbed beanies, waxed canvas totes, and utilitarian bags.', 5)
]

sql = []
sql.append('-- ==============================================================================')
sql.append('-- BEYOND E-COMMERCE SEED DATA')
sql.append('-- Generated from products.json')
sql.append('-- ==============================================================================\n')

# 1. Categories
sql.append('-- 1. CATEGORIES')
for cat_id, name, slug, desc, sort in categories:
    sql.append(f"INSERT INTO public.categories (id, name, slug, description, sort_order, is_active) VALUES ('{cat_id}', '{name}', '{slug}', '{desc}', {sort}, true) ON CONFLICT (id) DO NOTHING;")

sql.append('\n-- 2. PRODUCTS, VARIANTS, AND IMAGES')

for p in products:
    pid = p['id']
    name = p['name'].replace("'", "''")
    slug = pid
    cat = p.get('category', 'tops')
    price = p['price']
    price_formatted = p['priceFormatted'].replace("'", "''")
    desc = p['description'].replace("'", "''")
    mat = p.get('material', '').replace("'", "''")
    fit = p.get('fitNotes', '').replace("'", "''")
    featured = 'true' if p.get('featured') else 'false'
    badge = f"'{p['badge']}'" if p.get('badge') else 'NULL'

    sql.append(f"INSERT INTO public.products (id, name, slug, category_id, regular_price, price_formatted, description, material, fit_notes, status, featured, badge) VALUES ('{pid}', '{name}', '{slug}', '{cat}', {price}, '{price_formatted}', '{desc}', '{mat}', '{fit}', 'published', {featured}, {badge}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, regular_price = EXCLUDED.regular_price, featured = EXCLUDED.featured;")

    # Variants
    for s_item in p.get('sizes', []):
        size = s_item['size']
        stock = s_item['stock']
        sku = f"BYND-{pid.upper()}-{size}".replace(' ', '')
        sql.append(f"INSERT INTO public.product_variants (product_id, size, sku, stock_quantity, is_active) VALUES ('{pid}', '{size}', '{sku}', {stock}, true) ON CONFLICT (product_id, size, color) DO UPDATE SET stock_quantity = EXCLUDED.stock_quantity;")

    # Images
    for idx, img in enumerate(p.get('images', [])):
        is_prim = 'true' if idx == 0 else 'false'
        sql.append(f"INSERT INTO public.product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES ('{pid}', '{img}', '{name}', {is_prim}, {idx});")

# 3. Store settings
sql.append('\n-- 3. STORE SETTINGS')
settings = [
    ('store_name', '"BEYOND"', 'Store brand name'),
    ('currency', '"INR"', 'Base currency'),
    ('currency_symbol', '"₹"', 'Currency symbol'),
    ('tax_rate_percent', '12', 'Standard GST rate'),
    ('free_shipping_threshold', '0', 'Complimentary shipping on all orders'),
    ('cod_enabled', 'true', 'Cash on delivery availability'),
    ('support_email', '"concierge@beyond-streetwear.com"', 'Customer support email'),
    ('low_stock_threshold', '3', 'Threshold for low-stock inventory alerts')
]

for k, v, d in settings:
    sql.append(f"INSERT INTO public.store_settings (key, value, description) VALUES ('{k}', '{v}'::jsonb, '{d}') ON CONFLICT (key) DO NOTHING;")

# 4. Homepage slides
sql.append('\n-- 4. HOMEPAGE SLIDES')
for idx, p in enumerate([prod for prod in products if prod.get('featured')][:4]):
    pid = p['id']
    name = p['name'].replace("'", "''")
    img = p['images'][0]
    sql.append(f"INSERT INTO public.homepage_slides (title, subtitle, cta_label, cta_url, desktop_image_url, product_id, sort_order, is_active) VALUES ('{name}', 'FALL-WINTER 2026', 'VIEW PIECE', '#/piece/{pid}', '{img}', '{pid}', {idx + 1}, true);")

os.makedirs('supabase', exist_ok=True)
with open('supabase/seed.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(sql) + '\n')

print(f'Generated supabase/seed.sql with {len(sql)} statements successfully.')
