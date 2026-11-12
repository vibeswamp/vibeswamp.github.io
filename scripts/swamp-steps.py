"""Cut the clicker's building steps out of the existing stage paintings (no new generation).

The four paintings share one composition: bg (open swamp), v2-stage-1 (a plank on two posts over a round deck),
v2-stage-2 (the closed hut with a window and a door), v2-stage-3 (the same hut cut open, furnished inside).
Every step becomes a full-canvas transparent WebP (1536x1024 and 960x640) with a soft-edged mask, so the page can
stack them over the painting with no positioning. Polygons are in percent of the canvas (x, y).

Run:  python -I scripts/swamp-steps.py            -> public/brand/swamp/steps/*.webp + a preview sheet
      python -I scripts/swamp-steps.py --sheet DIR -> also writes the step-by-step preview into DIR
Writes the boxes used by the shop preview to stdout as JSON (paste into content/swamp-v2.json art.steps).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "brand" / "swamp"
OUT = SRC / "steps"
W, H = 1536, 1024


def load(name):
    return Image.open(SRC / f"{name}.webp").convert("RGBA").resize((W, H))


def px(points):
    return [(x * W / 100, y * H / 100) for x, y in points]


def mask(*polygons, feather=1.6, ellipses=()):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    for poly in polygons:
        d.polygon(px(poly), fill=255)
    for (cx, cy, rx, ry) in ellipses:
        d.ellipse([(cx - rx) * W / 100, (cy - ry) * H / 100, (cx + rx) * W / 100, (cy + ry) * H / 100], fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather)) if feather else m


def cut(image, m):
    layer = image.copy()
    layer.putalpha(ImageChops.multiply(image.getchannel("A"), m))
    return layer


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


bg, s1, s2, s3 = load("bg"), load("v2-stage-1"), load("v2-stage-2"), load("v2-stage-3")
layers = {}

# ---- era 0: lily pads by the tussock, cloned from a pad the painting already has (stage-1, left water)
pad_src = s1.crop((int(W * .185), int(H * .618), int(W * .238), int(H * .668)))
pad_mask = Image.new("L", pad_src.size, 0)
ImageDraw.Draw(pad_mask).ellipse([1, 1, pad_src.width - 2, pad_src.height - 2], fill=255)
pad_mask = pad_mask.filter(ImageFilter.GaussianBlur(1.4))
pads = Image.new("RGBA", (W, H), (0, 0, 0, 0))
for cx, cy, scale, flip in ((29.6, 87.2, 1.5, False), (36.8, 90.4, 1.1, True), (62.0, 90.6, 1.0, False), (68.2, 88.4, 1.35, True), (74.0, 85.4, .95, False)):
    piece = pad_src.copy()
    piece.putalpha(pad_mask)
    if flip:
        piece = piece.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    piece = piece.resize((int(piece.width * scale), int(piece.height * scale)), Image.Resampling.LANCZOS)
    pads.alpha_composite(piece, (int(W * cx / 100 - piece.width / 2), int(H * cy / 100 - piece.height / 2)))
layers["pads"] = pads

# ---- era 1: the round deck, then a plank on two posts (stage-1)
DECK = [(23.8, 80), (25, 76), (29, 73), (35, 71.2), (42, 70.2), (50, 69.8), (58, 70.2), (65, 71.2), (71, 73), (75.2, 76),
        (76.6, 80), (75.4, 83.2), (71.5, 85.6), (64, 87.6), (50, 88.6), (36, 87.6), (28.5, 85.6), (24.8, 83.2)]
layers["deck"] = cut(s1, mask(DECK))
PLANK = [(18.6, 39.6), (21, 37), (30, 35.4), (50, 34.6), (70, 35), (77, 36.2), (77.8, 38.6), (74, 41.4), (60, 42.2), (40, 42.6), (25, 42.8), (19.6, 41.6)]
POSTS_1 = [rect(29.6, 40, 33.8, 76.2), rect(67.8, 40, 71.6, 76.2)]
layers["plank"] = cut(s1, mask(PLANK, *POSTS_1))

# ---- era 2: the hut (stage-2). Posts and the eave beam, then the moss roof, walls, window, door
POSTS_2 = [rect(28.4, 37.6, 33.8, 76), rect(66.2, 37.6, 71.2, 76), rect(23.5, 36.6, 76.5, 41.6)]
layers["poles"] = cut(s2, mask(*POSTS_2))
ROOF = [(21.3, 40.6), (22, 37.2), (30, 31.2), (38, 26), (46, 20), (50, 16.6), (54, 20), (62, 26), (70, 31.2), (78.2, 37.2),
        (79, 40.6), (76.4, 43), (70.5, 41.6), (64, 40.2), (50, 40), (36, 40.2), (29.5, 41.6), (23.8, 43)]
layers["awning"] = cut(s2, mask(ROOF))

# The front wall before it gets a window: the boards right of the hanging plant, tiled over the panel.
# Boards run sideways, so a clean strip stretched along them shows no seams; stacked strips meet on a board gap.
band = s2.crop((int(W * .438), int(H * .622), int(W * .503), int(H * .695)))
boards = Image.new("RGBA", (W, H), (0, 0, 0, 0))
x0, y0, x1, y1 = int(W * .335), int(H * .405), int(W * .507), int(H * .699)
band = band.resize((x1 - x0, band.height), Image.Resampling.LANCZOS)
for i, y in enumerate(range(y1 - band.height, y0 - band.height, -band.height)):
    strip = band.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if i % 2 else band
    boards.alpha_composite(ImageEnhance.Brightness(strip).enhance(1 - .03 * (i % 3)), (x0, y))
side_l = cut(s2, mask([(25.6, 42.6), (28.6, 41.6), (28.8, 72.4), (26.4, 70.4)]))
wall_l = cut(boards, mask(rect(33.5, 40.6, 50.6, 69.9)))
wall_l = Image.alpha_composite(side_l, ImageEnhance.Brightness(wall_l).enhance(.94))
layers["wall_l"] = wall_l

WINDOW = rect(36.3, 41.8, 49.4, 61.6)
DOOR = [(51.6, 70), (51.6, 50), (52.6, 45.8), (55, 42.8), (57.8, 41.8), (60.6, 42.8), (62.8, 45.8), (63.8, 50), (63.8, 70)]
side_r = cut(s2, mask([(70.9, 41.6), (73.8, 42.6), (73.4, 70.4), (71, 72.4)]))
panel_r = cut(s2, mask(rect(50.4, 40.4, 66.6, 69.9)))
doorway = ImageEnhance.Brightness(cut(s2, mask(DOOR, feather=1))).enhance(.16)
layers["wall_r"] = Image.alpha_composite(Image.alpha_composite(side_r, panel_r), doorway)
layers["window_hole"] = ImageEnhance.Brightness(cut(s2, mask(WINDOW))).enhance(.22)
layers["window"] = cut(s2, mask([(35.8, 41.4), (49.8, 41.4), (49.8, 62.4), (45, 62.4), (43.4, 66.4), (37.6, 66.4), (35.8, 62.4)]))
layers["door"] = cut(s2, mask(DOOR))

# ---- era 3: inside the hut (stage-3). The step "floor" switches the painting and dims the room; each next step
# lights up its corner.
ROOM = [(28.4, 36), (71, 36), (71, 71.6), (28.4, 71.6)]
dark = Image.new("RGBA", (W, H), (12, 9, 6, 255))
dark.putalpha(mask(ROOM, feather=6).point(lambda v: int(v * .8)))
layers["interior-dark"] = dark
layers["floor"] = cut(s3, mask([(33, 61), (67, 61), (71, 71.8), (29, 71.8)], feather=8))
layers["lamp"] = cut(s3, mask(rect(41.6, 41.2, 61.4, 60.6), rect(32.6, 50.4, 36.6, 58.2), feather=8, ellipses=((74.2, 48.4, 2.6, 4.4),)))
layers["furniture"] = cut(s3, mask([(28.6, 41), (41, 41), (41.2, 73.6), (28.6, 73.6)], feather=8))
layers["chair"] = cut(s3, mask([(61.4, 55.6), (70.8, 55.6), (70.8, 73), (61.4, 73)], feather=8))
layers["tea_corner"] = cut(s3, mask([(60.6, 40.6), (70.8, 40.6), (70.8, 62.4), (60.6, 62.4)], feather=8, ellipses=((75, 48.6, 3.4, 5),)))

OUT.mkdir(parents=True, exist_ok=True)
boxes = {}
for name, layer in layers.items():
    layer.save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
    layer.resize((960, 640), Image.Resampling.LANCZOS).save(OUT / f"{name}-960.webp", "WEBP", quality=82, method=6)
    left, top, right, bottom = layer.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    boxes[name] = [round(left / W * 100, 1), round(top / H * 100, 1), round((right - left) / W * 100, 1), round((bottom - top) / H * 100, 1)]
print(json.dumps(boxes))

if "--sheet" in sys.argv:
    out_dir = Path(sys.argv[sys.argv.index("--sheet") + 1])
    order = ["pads", "deck", "plank", "poles", "awning", "wall_l", "wall_r", "window_hole", "window", "door",
             "floor", "lamp", "furniture", "chair", "tea_corner"]
    frames, shown = [], []
    for i, step in enumerate(order):
        if step == "floor":
            canvas = Image.alpha_composite(s3, layers["interior-dark"])
            shown = []
        elif not frames:
            canvas = bg.copy()
        else:
            canvas = frames[-1][1].copy() if step != "floor" else canvas
        if step == "poles":  # the posts replace the plank frame
            canvas = bg.copy()
            for s in ("pads", "deck"):
                canvas.alpha_composite(layers[s])
        if step == "window" or step == "door":
            pass
        canvas.alpha_composite(layers[step])
        frames.append((step, canvas))
    thumbs = [c.crop((int(W * .15), int(H * .1), int(W * .85), int(H * .95))).resize((360, 292)) for _, c in frames]
    sheet = Image.new("RGB", (360 * 5, 292 * 3), (20, 20, 20))
    for i, t in enumerate(thumbs):
        sheet.paste(t.convert("RGB"), ((i % 5) * 360, (i // 5) * 292))
        ImageDraw.Draw(sheet).text(((i % 5) * 360 + 6, (i // 5) * 292 + 4), f"{i + 1} {order[i]}", fill=(255, 230, 120))
    sheet.save(out_dir / "steps-sheet.png")
