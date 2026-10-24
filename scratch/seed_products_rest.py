import urllib.request, json, os, re

def load_env():
    env = {}
    if os.path.exists('.env.local'):
        with open('.env.local', 'r', encoding='utf-8') as f:
            for line in f:
                m = re.match(r'^([A-Z_]+)\s*=\s*(.*)$', line.strip())
                if m:
                    env[m.group(1)] = m.group(2)
    return env

_env = load_env()
service_role = _env.get('SUPABASE_SERVICE_ROLE_KEY', '')
base_url = (_env.get('SUPABASE_URL') or _env.get('VITE_SUPABASE_URL') or 'https://xlezpwiabwbhllvyuaxw.supabase.co').rstrip('/') + '/rest/v1/'

with open('products.json', 'r', encoding='utf-8') as f:
    products_data = json.load(f)

# 1. Prepare products rows
products_rows = []
variants_rows = []
images_rows = []

for p in products_data:
    pid = p['id']
    products_rows.append({
        'id': pid,
        'name': p['name'],
        'slug': pid,
        'category_id': p.get('category', 'tops'),
        'regular_price': p['price'],
        'price_formatted': p['priceFormatted'],
        'description': p['description'],
        'material': p.get('material', ''),
        'fit_notes': p.get('fitNotes', ''),
        'status': 'published',
        'featured': bool(p.get('featured', False)),
        'badge': p.get('badge')
    })
    
    for s in p.get('sizes', []):
        variants_rows.append({
            'product_id': pid,
            'size': s['size'],
            'sku': f"BYND-{pid.upper()}-{s['size']}".replace(' ', ''),
            'stock_quantity': s.get('stock', 0),
            'is_active': True
        })
        
    for idx, img in enumerate(p.get('images', [])):
        images_rows.append({
            'product_id': pid,
            'image_url': img,
            'alt_text': p['name'],
            'is_primary': (idx == 0),
            'sort_order': idx
        })

def post_rows(table, rows, on_conflict=None):
    url = base_url + table
    if on_conflict:
        url += f'?on_conflict={on_conflict}'
    req = urllib.request.Request(url, data=json.dumps(rows).encode('utf-8'), headers={
        'apikey': service_role,
        'Authorization': f'Bearer {service_role}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    }, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            print(f'Table {table}: inserted/upserted {len(rows)} rows, status {resp.status}')
    except urllib.error.HTTPError as e:
        print(f'Table {table} error {e.code}: {e.read().decode("utf-8")}')

post_rows('products', products_rows, on_conflict='id')
post_rows('product_variants', variants_rows, on_conflict='product_id,size,color')
post_rows('product_images', images_rows, on_conflict='product_id,sort_order')
