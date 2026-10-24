import re

with open('supabase/seed.sql', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern for product_images
# INSERT INTO public.product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES ('...', '...', '...', true/false, 0/1/2);
img_pattern = r"(INSERT INTO public\.product_images \([^\)]+\) VALUES \([^\)]+\));"
def replace_img(match):
    stmt = match.group(1)
    if 'ON CONFLICT' in stmt:
        return stmt + ';'
    return stmt + " ON CONFLICT (product_id, sort_order) DO UPDATE SET image_url = EXCLUDED.image_url, alt_text = EXCLUDED.alt_text, is_primary = EXCLUDED.is_primary;"

content_updated, img_count = re.subn(img_pattern, replace_img, content)
print(f"Product images updated with ON CONFLICT: {img_count}")

# Pattern for homepage_slides
slide_pattern = r"(INSERT INTO public\.homepage_slides \([^\)]+\) VALUES \([^\)]+\));"
def replace_slide(match):
    stmt = match.group(1)
    if 'ON CONFLICT' in stmt:
        return stmt + ';'
    return stmt + " ON CONFLICT (sort_order) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, cta_label = EXCLUDED.cta_label, cta_url = EXCLUDED.cta_url, desktop_image_url = EXCLUDED.desktop_image_url, product_id = EXCLUDED.product_id, is_active = EXCLUDED.is_active;"

content_updated, slide_count = re.subn(slide_pattern, replace_slide, content_updated)
print(f"Homepage slides updated with ON CONFLICT: {slide_count}")

with open('supabase/seed.sql', 'w', encoding='utf-8') as f:
    f.write(content_updated)

print("seed.sql successfully updated and saved.")
