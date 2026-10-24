import re

def verify_references():
    with open('supabase/migrations/001_initial_schema.sql', 'r', encoding='utf-8') as f:
        schema_text = f.read()

    with open('supabase/migrations/002_rls_policies.sql', 'r', encoding='utf-8') as f:
        rls_text = f.read()

    # Extract all tables and columns from 001
    table_pattern = re.compile(r'CREATE TABLE IF NOT EXISTS public\.(\w+)\s*\((.*?)\);', re.DOTALL)
    tables = {}
    for match in table_pattern.finditer(schema_text):
        table_name = match.group(1)
        body = match.group(2)
        columns = []
        for line in body.split('\n'):
            line = line.strip()
            if not line or line.startswith('--') or line.startswith('CONSTRAINT') or line.startswith('PRIMARY KEY'):
                continue
            col_match = re.match(r'([a-zA-Z0-9_]+)\s+', line)
            if col_match:
                col_name = col_match.group(1)
                columns.append(col_name)
        tables[table_name] = columns

    print(f"Total tables detected: {len(tables)}")
    for t, cols in tables.items():
        print(f"{t}: {cols}")

    # Check that pg_catalog.coalesce, pg_catalog.greatest, pg_catalog.least do not exist
    invalid_keywords = re.findall(r'pg_catalog\.(coalesce|greatest|least|nullif)', rls_text, re.IGNORECASE)
    if invalid_keywords:
        print(f"ERROR: Found schema-qualified keywords: {invalid_keywords}")
    else:
        print("PASS: No illegal schema-qualified keywords found (coalesce/greatest/least/nullif).")

if __name__ == '__main__':
    verify_references()
