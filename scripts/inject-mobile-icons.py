import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN_DIR = r"C:\Users\Jazib\.gemini\antigravity\brain\fae7e6c6-7696-4122-8ddd-ee0da4b8fc73"
SRC_ICON = os.path.join(BRAIN_DIR, "tj_app_icon_1791796587730.jpg")
SRC_BANNER = os.path.join(BRAIN_DIR, "tj_brand_banner_1791796638531.jpg")

icon = Image.open(SRC_ICON).convert("RGBA")
banner = Image.open(SRC_BANNER).convert("RGBA")

# Android mipmaps
android_res = os.path.join(ROOT, "apps", "web", "android", "app", "src", "main", "res")
sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for folder, sz in sizes.items():
    target_dir = os.path.join(android_res, folder)
    if os.path.exists(target_dir):
        resized = icon.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(os.path.join(target_dir, "ic_launcher.png"), "PNG")
        resized.save(os.path.join(target_dir, "ic_launcher_round.png"), "PNG")
        resized.save(os.path.join(target_dir, "ic_launcher_foreground.png"), "PNG")
        print(f"Updated Android {folder} ({sz}x{sz})")

# iOS App Icon
ios_icon_dir = os.path.join(ROOT, "apps", "web", "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
if os.path.exists(ios_icon_dir):
    icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(os.path.join(ios_icon_dir, "AppIcon-512@2x.png"), "PNG")
    print("Updated iOS 1024x1024 AppIcon-512@2x.png")

# Sync splash screens
drawable_dir = os.path.join(android_res, "drawable")
os.makedirs(drawable_dir, exist_ok=True)
banner.save(os.path.join(drawable_dir, "splash.png"), "PNG")
print("Updated Android splash.png")

print("All mobile icons and splash assets injected successfully!")
