# Makes a 960 px wide "name.mid.jpg" next to every big picture in public/assets, for phones and narrow screens.
# The build (build.mjs, picture()) puts small, mid and full sizes into srcset, so a phone does not load the full file.
# Run after adding pictures: python scripts/make-mid.py   (needs Pillow). Existing mids are kept unless the source is newer.
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "assets")
made = 0
for base, _, files in os.walk(ROOT):
    for f in files:
        low = f.lower()
        if not low.endswith((".jpg", ".jpeg", ".png", ".webp")) or ".small." in low or ".mid." in low:
            continue
        src = os.path.join(base, f)
        dst = os.path.join(base, os.path.splitext(f)[0] + ".mid.jpg")
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            continue
        im = Image.open(src)
        if im.width <= 1100:
            continue
        im = im.convert("RGB")
        im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS).save(dst, quality=80, optimize=True, progressive=True)
        made += 1
print(f"mid pictures made: {made}")
