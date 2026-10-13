import os
import shutil
from PIL import Image

BRAIN_DIR = r"C:\Users\Jazib\.gemini\antigravity\brain\fae7e6c6-7696-4122-8ddd-ee0da4b8fc73"
SRC_ICON = os.path.join(BRAIN_DIR, "tj_app_icon_1791796587730.jpg")
SRC_BANNER = os.path.join(BRAIN_DIR, "tj_brand_banner_1791796638531.jpg")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_PUBLIC = os.path.join(ROOT, "apps", "web", "public")
DESKTOP_ICONS = os.path.join(ROOT, "apps", "desktop", "src-tauri", "icons")

os.makedirs(WEB_PUBLIC, exist_ok=True)
os.makedirs(DESKTOP_ICONS, exist_ok=True)

print(f"Loading master icon from: {SRC_ICON}")
icon_img = Image.open(SRC_ICON).convert("RGBA")

print(f"Loading master banner from: {SRC_BANNER}")
banner_img = Image.open(SRC_BANNER).convert("RGBA")

# 1. Save master banner to web public
banner_img.save(os.path.join(WEB_PUBLIC, "tj-banner.png"), "PNG")
print("Saved tj-banner.png to web public")

# 2. Save master icon to web public
icon_img.save(os.path.join(WEB_PUBLIC, "tj-icon-1024.png"), "PNG")
icon_img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(WEB_PUBLIC, "icon-512.png"), "PNG")
icon_img.resize((192, 192), Image.Resampling.LANCZOS).save(os.path.join(WEB_PUBLIC, "icon-192.png"), "PNG")
icon_img.resize((180, 180), Image.Resampling.LANCZOS).save(os.path.join(WEB_PUBLIC, "apple-touch-icon.png"), "PNG")
icon_img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(WEB_PUBLIC, "favicon-32x32.png"), "PNG")
icon_img.resize((16, 16), Image.Resampling.LANCZOS).save(os.path.join(WEB_PUBLIC, "favicon-16x16.png"), "PNG")

# Multi-resolution favicon.ico
icon_img.save(
    os.path.join(WEB_PUBLIC, "favicon.ico"),
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)
print("Saved Web favicons and PWA icons")

# 3. Save Tauri desktop icons
icon_img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "32x32.png"), "PNG")
icon_img.resize((128, 128), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "128x128.png"), "PNG")
icon_img.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "128x128@2x.png"), "PNG")
icon_img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "icon.png"), "PNG")

# Windows .ico
icon_img.save(
    os.path.join(DESKTOP_ICONS, "icon.ico"),
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)

# Also create square logos for Windows Store/installer if needed
icon_img.resize((30, 30), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square30x30Logo.png"), "PNG")
icon_img.resize((44, 44), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square44x44Logo.png"), "PNG")
icon_img.resize((71, 71), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square71x71Logo.png"), "PNG")
icon_img.resize((89, 89), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square89x89Logo.png"), "PNG")
icon_img.resize((107, 107), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square107x107Logo.png"), "PNG")
icon_img.resize((142, 142), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square142x142Logo.png"), "PNG")
icon_img.resize((150, 150), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square150x150Logo.png"), "PNG")
icon_img.resize((284, 284), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square284x284Logo.png"), "PNG")
icon_img.resize((310, 310), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "Square310x310Logo.png"), "PNG")
icon_img.resize((50, 50), Image.Resampling.LANCZOS).save(os.path.join(DESKTOP_ICONS, "StoreLogo.png"), "PNG")

print("Saved all Tauri desktop icons successfully!")
