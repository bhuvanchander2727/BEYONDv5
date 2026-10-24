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
project_url = (_env.get('SUPABASE_URL') or _env.get('VITE_SUPABASE_URL') or 'https://xlezpwiabwbhllvyuaxw.supabase.co').rstrip('/')

endpoints = ['/pg/v1/query', '/rest/v1/rpc', '/v1/query', '/sql']
for ep in endpoints:
    body = json.dumps({'query': 'SELECT 1;'}).encode('utf-8')
    req = urllib.request.Request(project_url + ep, data=body, headers={
        'apikey': service_role,
        'Authorization': f'Bearer {service_role}',
        'Content-Type': 'application/json'
    }, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            print(f'{ep}: Status {resp.status}')
    except urllib.error.HTTPError as e:
        print(f'{ep}: Error {e.code}')
    except Exception as e:
        print(f'{ep}: {e}')
