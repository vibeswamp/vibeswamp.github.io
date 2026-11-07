# Klyop, the VibeSwamp toad, as a whole character: a sitting body, eight emotions for stickers and a "vibing" pose.
# Run: python -I scripts/make-klyop.py  -> public/brand/klyop-*.svg and public/brand/stickers/*.svg
# The head is the same toad as scripts/make-toad.py (amber slit eyes, raised right brow, earth-wire headband),
# now with a squat body, big knees at the sides, short front legs and tails of different length.
import os, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "#1E2619"; SKIN = "#6A9A3C"; SKIN_D = "#4E7A2C"; JAW = "#A9C46A"; AMBER = "#E8B04A"
WIRE = "#D9B300"; WIRE_G = "#4E7A2B"; FACE = "#1E2618"; WHITE = "#FFFFFF"

EYES = [(64, 54), (136, 54)]
BAND = "M20 80 Q 100 56 180 80"
HEAD = "M14 96 C 14 66 52 60 100 60 C 148 60 186 66 186 96 C 186 140 150 160 100 160 C 50 160 14 140 14 96 Z"

# Each emotion: brows (left, right), lid cover 0..1 per eye, pupil shift, mouth path, tail angles (short, long) in degrees.
EMO = {
  "smug":    dict(name=("Ну давай", "Ну давай", "Go on then"),
                  brows=("M44 20 Q 64 16 84 19", "M116 13 Q 138 -4 158 13"), lids=(0.36, 0.30), look=(0, 0),
                  mouth="M58 122 C 90 132 128 130 156 112", tails=(0, 0)),
  "fixed":   dict(name=("Починил", "Полагодив", "Fixed it"),
                  brows=("M44 19 Q 64 11 84 17", "M116 16 Q 138 6 158 14"), lids=(0.45, 0.45), look=(0, 0),
                  mouth="M40 118 C 76 140 124 140 160 118", tails=(-14, -10)),
  "shocked": dict(name=("Оно работает?!", "Воно працює?!", "It works?!"),
                  brows=("M44 11 Q 64 -1 84 9", "M116 4 Q 138 -13 158 4"), lids=(0, 0), look=(0, 0),
                  mouth="M92 124 C 92 112 108 112 108 124 C 108 136 92 136 92 124 Z", tails=(-26, 18)),
  "stop":    dict(name=("Не трогай, собирается", "Не чіпай, збирається", "Don't touch, it's building"),
                  brows=("M44 15 Q 66 17 86 27", "M114 27 Q 134 17 156 15"), lids=(0.3, 0.3), look=(0, 5),
                  mouth="M84 124 L 116 124", tails=(22, 26)),
  "vibe":    dict(name=("Это мой трек", "Це мій трек", "That's my track"),
                  brows=("M44 18 Q 64 11 84 17", "M116 12 Q 138 1 158 12"), lids=(0.58, 0.58), look=(0, 2),
                  mouth="M76 122 C 92 132 112 132 126 120", tails=(12, 18)),
  "broken":  dict(name=("Всё сломалось", "Усе зламалося", "It all broke"),
                  brows=("M44 12 Q 64 3 84 12", "M116 22 Q 138 27 158 24"), lids=(0.2, 0.35), look=(None, None),
                  mouth="M92 124 L 108 124", tails=(40, 46)),
  "hug":     dict(name=("Обнял", "Обійняв", "Hug"),
                  brows=("M44 20 Q 60 18 82 9", "M118 9 Q 140 18 156 20"), lids=(1, 1), look=(0, 0),
                  mouth="M66 120 C 86 134 114 134 134 120", tails=(30, 34)),
  "fly":     dict(name=("Муха моя", "Муха моя", "That fly is mine"),
                  brows=("M44 15 Q 64 19 86 27", "M114 27 Q 136 19 158 15"), lids=(0.5, 0.5), look=(5, -3),
                  mouth="M98 124 a 3 3 0 1 0 0.1 0", tails=(-30, -24)),
  # round 4: the rock ones
  "rock":    dict(name=("Собрал — врубил", "Зібрав — увімкнув", "Built it, cranked it"),
                  brows=("M44 13 Q 66 15 86 25", "M114 25 Q 136 15 158 13"), lids=(0.28, 0.28), look=(0, -2),
                  mouth="M50 114 C 78 150 126 150 152 112 C 126 126 78 128 50 114 Z", tails=(-34, -40), paw="horns"),
  "beat":    dict(name=("Это мой билд", "Це мій білд", "That's my build"),
                  brows=("M44 18 Q 64 12 84 17", "M116 12 Q 138 2 158 12"), lids=(0.62, 0.62), look=(0, 2),
                  mouth="M72 120 C 90 134 114 134 130 118", tails=(16, 22), acc="phones"),
}
METAL = "#3A3D33"; METAL_D = "#20221C"; RIVET = "#797866"; TONGUE = "#B04A5A"
TAILS = [("M176 79 C 183 70 190 66 199 63", (176, 79)), ("M178 81 C 189 80 198 76 206 70", (178, 81))]


def g_outline(paths, width=7):
    return f'<g fill="{OUT}" stroke="{OUT}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round">' + "".join(paths) + "</g>"


def eye(x, y, lid, look, uid, side):
    o = [f'<circle cx="{x}" cy="{y}" r="28" fill="{SKIN}" stroke="{OUT}" stroke-width="3.5"/>',
         f'<circle cx="{x}" cy="{y-2}" r="18" fill="{AMBER}" stroke="{OUT}" stroke-width="2.5"/>']
    dx, dy = look
    if dx is None:  # eyes drift apart a little
        dx, dy = (-4, 1) if side == 0 else (4, -1)
    o.append(f'<ellipse cx="{x+dx}" cy="{y-2+dy}" rx="10" ry="3.8" fill="{OUT}"/>')
    o.append(f'<circle cx="{x-7+dx*0.3}" cy="{y-9+dy*0.3}" r="3.2" fill="{WHITE}"/>')
    if lid > 0:
        cut = (y - 28) + 56 * min(lid, 1) * 0.92
        o.append(f'<clipPath id="{uid}"><circle cx="{x}" cy="{y}" r="26.3"/></clipPath>')
        o.append(f'<rect x="{x-30}" y="{y-31}" width="60" height="{cut-(y-31):.1f}" fill="{SKIN}" clip-path="url(#{uid})"/>')
        half = math.sqrt(max(0, 26.3**2 - (cut - y)**2))
        if lid >= 1:
            o.append(f'<path d="M{x-14} {y+2} Q {x} {y+12} {x+14} {y+2}" fill="none" stroke="{OUT}" stroke-width="4" stroke-linecap="round"/>')
        else:
            o.append(f'<path d="M{x-half:.1f} {cut:.1f} Q {x} {cut+3:.1f} {x+half:.1f} {cut:.1f}" fill="none" stroke="{OUT}" stroke-width="3.2" stroke-linecap="round"/>')
    return "".join(o)


def tails(angles):
    o = ['<g class="k-tails">']
    for (d, (px, py)), a in zip(TAILS, angles):
        tr = f' transform="rotate({a} {px} {py})"' if a else ""
        o.append(f'<g{tr}><path d="{d}" fill="none" stroke="{OUT}" stroke-width="14" stroke-linecap="round"/>'
                 f'<path d="{d}" fill="none" stroke="{WIRE}" stroke-width="8" stroke-linecap="round"/>'
                 f'<path d="{d}" fill="none" stroke="{WIRE_G}" stroke-width="8" stroke-dasharray="5 5"/></g>')
    o.append('</g>')
    return "".join(o)


def head(emo, uid):
    e = EMO[emo]
    o = [g_outline([f'<path d="{HEAD}"/>', f'<path d="{BAND}" fill="none" stroke-width="20"/>']),
         f'<path d="{HEAD}" fill="{SKIN}"/>',
         f'<path d="M30 126 C 50 150 150 150 170 126 C 160 152 130 160 100 160 C 70 160 40 152 30 126 Z" fill="{JAW}"/>']
    for (x, y, r) in [(34, 104, 5), (168, 112, 4), (56, 96, 3), (152, 98, 3.5), (178, 96, 2.5)]:
        o.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{SKIN_D}"/>')
    o.append(f'<ellipse cx="90" cy="100" rx="3" ry="2" fill="{FACE}"/><ellipse cx="110" cy="100" rx="3" ry="2" fill="{FACE}"/>')
    mouth = e["mouth"]
    closed = mouth.rstrip().endswith("Z")
    o.append(f'<path d="{mouth}" fill="{FACE if closed else "none"}" stroke="{FACE}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>')
    o.append(f'<path d="{BAND}" fill="none" stroke="{WIRE}" stroke-width="13" stroke-linecap="round"/>')
    o.append(f'<path d="{BAND}" fill="none" stroke="{WIRE_G}" stroke-width="13" stroke-dasharray="7 7"/>')
    o.append(tails(e["tails"]))
    for k, (x, y) in enumerate(EYES):
        o.append(eye(x, y, e["lids"][k], e["look"], f"{uid}-e{k}", k))
    o += [f'<path d="{b}" fill="none" stroke="{OUT}" stroke-width="4.5" stroke-linecap="round"/>' for b in e["brows"]]
    if closed and e.get("paw") == "horns":   # the roaring grin shows a tongue
        o.append(f'<path d="M84 132 C 92 142 112 142 120 132 C 112 128 92 128 84 132 Z" fill="{TONGUE}"/>')
    if e.get("acc") == "phones":
        o.append(phones())
    return "".join(o)


def phones():
    """Big worn headphones over the headband: a metal band with rivets and two cups with an amber light."""
    band = "M10 104 C 0 -70 200 -70 190 104"
    o = [f'<path d="{band}" fill="none" stroke="{OUT}" stroke-width="17" stroke-linecap="round"/>',
         f'<path d="{band}" fill="none" stroke="{METAL}" stroke-width="10" stroke-linecap="round"/>']
    for x, y in [(25.8, 20.4), (100, -26.5), (174.2, 20.4)]:
        o.append(f'<circle cx="{x}" cy="{y}" r="2.6" fill="{RIVET}"/>')
    for cx in (12, 188):
        o.append(f'<rect x="{cx-17}" y="78" width="34" height="52" rx="13" fill="{METAL}" stroke="{OUT}" stroke-width="4"/>')
        o.append(f'<rect x="{cx-10}" y="86" width="20" height="36" rx="8" fill="{METAL_D}"/>')
        o.append(f'<circle cx="{cx}" cy="118" r="3.2" fill="{AMBER}"/>')
    return "".join(o)


def horns(cx, cy):
    """A paw doing the horns: index and little finger up, the middle two folded under the thumb."""
    fingers = [(cx - 11, cy - 24, -16), (cx + 11, cy - 24, 16)]
    o = []
    for x, y, a in fingers:
        o.append(f'<ellipse cx="{x}" cy="{y}" rx="6.5" ry="15" transform="rotate({a} {x} {y})" fill="{SKIN}" stroke="{OUT}" stroke-width="3.5"/>')
        o.append(f'<circle cx="{x + a * 0.3:.1f}" cy="{y - 13}" r="4.4" fill="{SKIN}" stroke="{OUT}" stroke-width="2.5"/>')
    o.append(f'<circle cx="{cx}" cy="{cy}" r="16" fill="{SKIN}" stroke="{OUT}" stroke-width="3.5"/>')
    for dx in (-4, 4):   # the folded middle fingers
        o.append(f'<circle cx="{cx+dx}" cy="{cy-12}" r="5.2" fill="{SKIN}" stroke="{OUT}" stroke-width="2.8"/>')
    o.append(f'<path d="M{cx+13} {cy+3} Q {cx+2} {cy-4} {cx-8} {cy-6}" fill="none" stroke="{OUT}" stroke-width="3" stroke-linecap="round"/>')
    return f'<g transform="translate({cx} {cy}) scale(1.3) translate({-cx} {-cy})">' + "".join(o) + "</g>"


def body(pose):
    """Squat body, big knees at the sides, short front legs between them, flat back feet."""
    lift = 10 if pose == "vibe" else 0          # the right knee comes up with the beat
    paw = -8 if pose == "vibe" else 0           # and the right front paw taps
    feet = [f'<ellipse cx="34" cy="226" rx="26" ry="8"/>', f'<ellipse cx="176" cy="{226-lift}" rx="26" ry="8"/>']
    knees = [f'<circle cx="38" cy="196" r="28"/>', f'<circle cx="172" cy="{196-lift}" r="28"/>']
    trunk = '<path d="M44 150 C 30 196 54 228 105 230 C 156 228 180 196 166 150 Z"/>'
    legs = [f'<ellipse cx="82" cy="212" rx="12" ry="17"/>', f'<ellipse cx="128" cy="{212+paw}" rx="12" ry="17"/>']
    if pose == "rock":                          # the right front leg goes up as an arm (the paw is drawn after the head)
        legs = legs[1:]
        arm = "M76 200 C 52 186 26 168 12 140"
        o = [g_outline(feet + knees + [trunk] + legs), f'<path d="{arm}" fill="none" stroke="{OUT}" stroke-width="27" stroke-linecap="round"/>']
        o += [s.replace("/>", f' fill="{SKIN}"/>') for s in feet + knees]
        o.append(trunk.replace("/>", f' fill="{SKIN}"/>'))
        o.append(f'<path d="{arm}" fill="none" stroke="{SKIN}" stroke-width="20" stroke-linecap="round"/>')
        o.append(f'<ellipse cx="105" cy="200" rx="38" ry="22" fill="{JAW}"/>')
        o += [s.replace("/>", f' fill="{SKIN}" stroke="{OUT}" stroke-width="3.5"/>') for s in legs]
        for dx in (-7, 0, 7):
            o.append(f'<circle cx="{128+dx}" cy="228" r="4.2" fill="{SKIN}" stroke="{OUT}" stroke-width="2.5"/>')
        o.append(f'<circle cx="38" cy="196" r="5" fill="{SKIN_D}"/><circle cx="172" cy="200" r="4" fill="{SKIN_D}"/>')
        return "".join(o)
    o = [g_outline(feet + knees + [trunk] + legs)]
    o += [s.replace("/>", f' fill="{SKIN}"/>') for s in feet + knees]
    o.append(trunk.replace("/>", f' fill="{SKIN}"/>'))
    o.append(f'<ellipse cx="105" cy="200" rx="38" ry="22" fill="{JAW}"/>')
    o += [s.replace("/>", f' fill="{SKIN}" stroke="{OUT}" stroke-width="3.5"/>') for s in legs]
    for cx, cy in [(82, 228), (128, 228 + paw)]:   # toes
        for dx in (-7, 0, 7):
            o.append(f'<circle cx="{cx+dx}" cy="{cy}" r="4.2" fill="{SKIN}" stroke="{OUT}" stroke-width="2.5"/>')
    o.append(f'<circle cx="38" cy="196" r="5" fill="{SKIN_D}"/><circle cx="172" cy="{200-lift}" r="4" fill="{SKIN_D}"/>')
    return "".join(o)


def figure(pose, emo, uid):
    tilt = ' transform="rotate(-8 100 150)"' if pose == "vibe" else ' transform="rotate(5 100 150)"' if pose == "rock" else ""
    paw = horns(4, 128) if pose == "rock" else ""
    return f'{body(pose)}<g class="k-head"><g{tilt}>{head(emo, uid)}</g></g>{paw}'


def sticker(emo):
    paw = horns(8, 140) if EMO[emo].get("paw") == "horns" else ""
    return head(emo, emo) + paw


def svg(inner, vb, w, h):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}">{inner}</svg>\n'


if __name__ == "__main__":
    out = os.path.join(ROOT, "public", "brand")
    st = os.path.join(out, "stickers")
    os.makedirs(st, exist_ok=True)
    open(os.path.join(out, "klyop-sit.svg"), "w", encoding="utf-8", newline="\n").write(svg(figure("sit", "smug", "sit"), "-6 -22 226 264", 452, 528))
    open(os.path.join(out, "klyop-vibe.svg"), "w", encoding="utf-8", newline="\n").write(svg(figure("vibe", "vibe", "vibe"), "-6 -22 226 264", 452, 528))
    open(os.path.join(out, "klyop-rock.svg"), "w", encoding="utf-8", newline="\n").write(svg(figure("rock", "rock", "rock"), "-26 -22 246 264", 492, 528))
    for emo in EMO:
        open(os.path.join(st, f"{emo}.svg"), "w", encoding="utf-8", newline="\n").write(svg(sticker(emo), "-22 -46 246 216", 492, 432))
    inline = f'<svg class="klyop" viewBox="-6 -22 226 264" aria-hidden="true">{figure("sit", "beat", "kp")}</svg>'
    open(os.path.join(ROOT, "src", "klyop-inline.svg"), "w", encoding="utf-8", newline=chr(10)).write(inline)
    # names of the stickers for the site, in three languages
    import json
    json.dump({k: {"ru": v["name"][0], "uk": v["name"][1], "en": v["name"][2]} for k, v in EMO.items()},
              open(os.path.join(st, "names.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote klyop-sit.svg, klyop-vibe.svg,", len(EMO), "stickers, src/klyop-inline.svg")
