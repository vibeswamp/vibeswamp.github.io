"""Motion masks for the clicker's living backdrop (src/swamp/backdrop-gl.mjs). No new pictures: the shader moves the
painting's own pixels a little, and these masks say how much and where.

R = foliage, moss and reeds that sway in gusts (stronger at the tips), G = water that ripples and wobbles the
reflection, B = sky where cloud light drifts. Polygons are in percent of the painting (all stage paintings share
bg.webp's composition). mask-stage3 is the same with the furnished hut kept still.

Run:  python -I scripts/swamp-motion-masks.py [--preview DIR]  -> public/brand/swamp/motion/mask-{bg,stage3}.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "brand" / "swamp" / "motion"
W, H = 384, 256  # smooth masks need little resolution; the shader filters them


def poly(points, blur=4.0):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(x * W / 100, y * H / 100) for x, y in points], fill=255)
    return np.asarray(m.filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32) / 255


ys = (np.arange(H, dtype=np.float32) + 0.5)[:, None] / H * 100   # row position in %
down = lambda top, bottom: np.clip((ys - top) / (bottom - top), 0, 1) * np.ones((1, W), np.float32)   # 0 at top -> 1 at bottom
up = lambda top, bottom: 1 - down(top, bottom)                                                          # 1 at top -> 0 at bottom

# --- R: what sways. Hanging moss swings more toward its tips; reeds and leaves more toward their tops.
# the big limb (y 3-10) stays put, the moss hanging from it swings more toward its ends
moss_left = poly([(14, 5), (56, 2), (56, 8), (46, 14), (40, 24), (30, 27), (22, 24), (16, 16)]) * down(6, 25)
# only the leaves and moss at the top right; the trunk below (x 88-100, y 12-35) stays put
canopy_right = poly([(76, 0), (100, 0), (100, 9), (95, 12), (90, 16), (84, 13), (78, 8)]) * (0.4 + 0.6 * down(0, 14))
# reeds below the left trunk; a little blur keeps the trunk behind the cattail heads almost still
reeds_left = poly([(0, 28), (12, 26), (19, 32), (21, 50), (17, 72), (0, 74)]) * (0.2 + 0.8 * up(26, 74))
# right reeds below the right trunk (x 90-100 down to y 34)
reeds_right = poly([(88, 33), (100, 34), (100, 76), (92, 76), (86, 50)]) * (0.25 + 0.75 * up(33, 76))
front_left = poly([(0, 86), (14, 88), (12, 100), (0, 100)]) * (0.3 + 0.7 * up(86, 100))
front_right = poly([(86, 70), (100, 70), (100, 100), (90, 100)]) * (0.3 + 0.7 * up(70, 100))
far_reeds = poly([(14, 28), (36, 30), (36, 42), (14, 42)], blur=3) * 0.35 + poly([(80, 30), (94, 30), (94, 42), (80, 42)], blur=3) * 0.35
tussock_grass = poly([(25, 72), (75, 72), (75, 78), (25, 78)], blur=3) * 0.3
R = np.clip(moss_left + canopy_right + reeds_left + reeds_right + front_left + front_right + far_reeds + tussock_grass, 0, 1)

# --- G: water below the horizon, minus the tussock and the reeds (they sway on their own)
water = poly([(0, 37), (100, 37), (100, 100), (0, 100)], blur=5) * np.clip(down(35, 44), 0, 1)
tussock = poly([(22, 74), (78, 74), (79, 94), (21, 94)], blur=5)
G = np.clip(water - tussock - R * 1.4, 0, 1)

# --- B: open sky between the crowns (the shader shows cloud light only where the sky is bright)
B = poly([(14, 0), (90, 0), (90, 34), (14, 34)], blur=8) * up(22, 36)

def save(name, r, g, b):
    rgb = np.stack([r, g, b], axis=-1)
    Image.fromarray(np.uint8(np.clip(rgb, 0, 1) * 255 + 0.5), "RGB").save(OUT / name, optimize=True)


OUT.mkdir(parents=True, exist_ok=True)
save("mask-bg.png", R, G, B)
# the furnished hut (v2-stage-3) is part of that painting: keep it still, roof to deck
hut = poly([(20, 14), (50, 8), (80, 14), (80, 44), (74.5, 46), (74.5, 92), (24, 92), (24, 46), (20, 44)], blur=3)
keep = 1 - hut
save("mask-stage3.png", R * keep, G * keep, B * keep)

if "--preview" in sys.argv:
    out = Path(sys.argv[sys.argv.index("--preview") + 1])
    for name, painting in (("bg", "bg"), ("stage3", "v2-stage-3")):
        base = Image.open(ROOT / "public" / "brand" / "swamp" / f"{painting}.webp").convert("RGB").resize((768, 512))
        mask = Image.open(OUT / f"mask-{name}.png").convert("RGB").resize((768, 512))
        Image.blend(base, mask, 0.55).save(out / f"mask-preview-{name}.png")
print("ok", sorted(p.name for p in OUT.iterdir()))
