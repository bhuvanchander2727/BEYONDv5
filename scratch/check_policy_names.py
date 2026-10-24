import re

with open('supabase/migrations/002_rls_policies.sql', 'r', encoding='utf-8') as f:
    text = f.read()

# Extract created policy names
created_policies = re.findall(r'CREATE POLICY "([^"]+)"', text)
print(f"Total CREATE POLICY statements: {len(created_policies)}")

# Extract known_policies from ARRAY[...]
m = re.search(r'known_policies\s*TEXT\[\]\s*:=\s*ARRAY\[(.*?)\];', text, re.DOTALL)
if m:
    raw_array = m.group(1)
    array_policies = [p.strip().strip("'") for p in raw_array.split(',') if p.strip()]
    print(f"Total policies in purge array: {len(array_policies)}")
    
    missing_from_purge = set(created_policies) - set(array_policies)
    if missing_from_purge:
        print(f"WARNING: Created policies missing from purge array: {missing_from_purge}")
    else:
        print("PASS: All created policies are included in the purge array!")
else:
    print("Could not find known_policies array.")
