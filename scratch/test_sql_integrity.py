import re

def test_sql_files():
    with open('supabase/migrations/001_initial_schema.sql', 'r', encoding='utf-8') as f:
        schema = f.read()

    with open('supabase/migrations/002_rls_policies.sql', 'r', encoding='utf-8') as f:
        rls = f.read()

    with open('supabase/seed.sql', 'r', encoding='utf-8') as f:
        seed = f.read()

    # 1. Extract created tables
    tables = re.findall(r'CREATE TABLE IF NOT EXISTS public\.(\w+)', schema)
    print(f"Total tables created in 001: {len(tables)}")
    print(f"Tables: {', '.join(tables)}")

    # 2. Extract RLS enabled tables
    rls_tables = re.findall(r'ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY', rls)
    print(f"Total tables with RLS enabled: {len(rls_tables)}")

    missing_rls = set(tables) - set(rls_tables)
    extra_rls = set(rls_tables) - set(tables)
    print(f"Tables missing RLS: {missing_rls}")
    print(f"RLS enabled on non-existent tables: {extra_rls}")

    # 3. Check Foreign Keys in 001
    fks = re.findall(r'REFERENCES public\.(\w+)\((\w+)\)', schema)
    print(f"\nForeign key references found: {len(fks)}")
    for target_table, target_col in fks:
        if target_table not in tables:
            print(f"ERROR: FK references non-existent table '{target_table}'")
        else:
            # check if target_col is primary key or unique
            pass

    # 4. Check Seed Script Products and Images
    products_seeded = re.findall(r"INSERT INTO public\.products .*?VALUES \('([^']+)'", seed)
    variants_seeded = re.findall(r"INSERT INTO public\.product_variants .*?VALUES \('([^']+)'", seed)
    images_seeded = re.findall(r"INSERT INTO public\.product_images .*?VALUES \('([^']+)'", seed)
    slides_seeded = re.findall(r"INSERT INTO public\.homepage_slides .*?VALUES \('([^']+)'", seed)

    print(f"\nSeed script counts:")
    print(f"Products: {len(products_seeded)} ({len(set(products_seeded))} unique)")
    print(f"Variants: {len(variants_seeded)}")
    print(f"Images: {len(images_seeded)}")
    print(f"Slides: {len(slides_seeded)}")

    # Check for ON CONFLICT in seed statements
    statements = [s.strip() for s in seed.split(';') if s.strip() and not s.strip().startswith('--')]
    print(f"\nTotal insert statements in seed: {len(statements)}")
    missing_conflict = []
    for s in statements:
        if 'INSERT INTO' in s and 'ON CONFLICT' not in s:
            missing_conflict.append(s[:60] + '...')
    print(f"Statements lacking ON CONFLICT ({len(missing_conflict)}):")
    for mc in missing_conflict:
        print(f" - {mc}")

if __name__ == '__main__':
    test_sql_files()
