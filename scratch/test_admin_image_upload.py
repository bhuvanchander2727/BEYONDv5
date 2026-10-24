import subprocess
import json
import time

def test_admin_product_image_ui():
    # Run Chrome headless to dump DOM of admin portal
    cmd = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "--headless=new",
        "--disable-gpu",
        "--run-all-compositor-stages-before-draw",
        "--dump-dom",
        "http://localhost:3030/admin/index.html"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    dom = res.stdout
    print("Admin HTML loaded, length:", len(dom))
    
    # Check if CSS has image-upload-dropzone
    with open('admin/admin.css', 'r', encoding='utf-8') as f:
        css = f.read()
    assert '.image-upload-dropzone' in css, "Missing .image-upload-dropzone in admin.css"
    assert '.image-preview-grid' in css, "Missing .image-preview-grid in admin.css"
    assert '.image-preview-card' in css, "Missing .image-preview-card in admin.css"
    print("PASS: admin.css contains image upload styles.")

    # Check admin.js functions
    with open('admin/admin.js', 'r', encoding='utf-8') as f:
        js = f.read()
    assert 'resolveAdminImageUrl' in js, "Missing resolveAdminImageUrl in admin.js"
    assert 'renderModalImagePreviews' in js, "Missing renderModalImagePreviews in admin.js"
    assert 'setupImagePickerListeners' in js, "Missing setupImagePickerListeners in admin.js"
    assert 'uploadProductImagesToStorage' in js, "Missing uploadProductImagesToStorage in admin.js"
    assert 'productImageFiles' in js, "Missing productImageFiles in admin.js"
    assert 'imageDropzone' in js, "Missing imageDropzone in admin.js"
    assert 'imagePreviewGrid' in js, "Missing imagePreviewGrid in admin.js"
    print("PASS: admin.js contains all image picker and upload functions.")

if __name__ == '__main__':
    test_admin_product_image_ui()
