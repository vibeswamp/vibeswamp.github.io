# Draws the VibeSwamp toad mascot as SVG files in public/brand/ and the favicon.
# Run: python -I scripts/make-toad.py   (needs nothing but Python). The site itself inlines the same drawing from build.mjs.
#
# The toad: a squat wide head, amber eyes with horizontal slit pupils, the right brow raised, and a headband made of
# yellow-green earth wire with the knot ends sticking out on the right. When only the top of the head is above water
# (the "peek"), the eyes, the brow and the band are still there, so it stays recognisable at 16 pixels.
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "#1E2619"      # ink
SKIN = "#6A9A3C"     # toad green
SKIN_D = "#4E7A2B"   # warts, water line
JAW = "#A9C46A"
AMBER = "#E8B04A"
WIRE = "#D9B300"
WIRE_G = "#4E7A2B"
PAPER = "#F4F6F0"
FACE_INK = "#1E2618"   # mouth and nostrils: ink in colour, holes in the one-colour mark
WART = "#4E7A2C"       # warts: holes in the one-colour mark

HEAD_CAP = "M16 84 C 22 66 52 60 100 60 C 148 60 178 66 184 84 Z"
HEAD_FULL = "M14 96 C 14 66 52 60 100 60 C 148 60 186 66 186 96 C 186 140 150 160 100 160 C 50 160 14 140 14 96 Z"
BAND = "M20 80 Q 100 56 180 80"
TAILS = ["M176 79 C 183 70 190 66 199 63", "M178 81 C 187 79 194 75 199 70"]
EYES = [(64, 54), (136, 54)]
BROWS = ["M42 33 Q 64 23 84 32", "M116 25 Q 138 10 158 25"]


def top(inline=False):
    """Everything above the water line: head top, band, knot, eyes, brows."""
    o = []
    o.append(f'<g fill="{OUT}" stroke="{OUT}" stroke-linejoin="round" stroke-linecap="round">')
    o.append(f'<path d="{HEAD_CAP}" stroke-width="7"/>')
    o.append(f'<path d="{BAND}" fill="none" stroke-width="20"/>')
    o += [f'<path d="{t}" fill="none" stroke-width="14"/>' for t in TAILS]
    o.append("</g>")
    o.append(f'<path d="{HEAD_CAP}" fill="{SKIN}"/>')
    o.append(f'<path d="{BAND}" fill="none" stroke="{WIRE}" stroke-width="13" stroke-linecap="round"/>')
    o.append(f'<path d="{BAND}" fill="none" stroke="{WIRE_G}" stroke-width="13" stroke-dasharray="7 7"/>')
    o.append('<g class="tails">' if inline else '<g>')
    for t in TAILS:
        if inline:
            o.append(f'<path d="{t}" fill="none" stroke="{OUT}" stroke-width="14" stroke-linecap="round"/>')
        o.append(f'<path d="{t}" fill="none" stroke="{WIRE}" stroke-width="8" stroke-linecap="round"/>')
        o.append(f'<path d="{t}" fill="none" stroke="{WIRE_G}" stroke-width="8" stroke-dasharray="5 5"/>')
    o.append('</g>')
    for (x, y) in EYES:
        o.append(f'<circle cx="{x}" cy="{y}" r="28" fill="{SKIN}" stroke="{OUT}" stroke-width="3.5"/>')
        o.append(f'<circle cx="{x}" cy="{y - 2}" r="18" fill="{AMBER}" stroke="{OUT}" stroke-width="2.5"/>')
        if inline:
            o.append(f'<ellipse class="pupil" data-ex="{x}" data-ey="{y - 2}" cx="{x}" cy="{y - 2}" rx="10" ry="3.8" fill="{OUT}"/>')
        else:
            o.append(f'<ellipse cx="{x}" cy="{y - 2}" rx="10" ry="3.8" fill="{OUT}"/>')
        o.append(f'<circle cx="{x - 7}" cy="{y - 9}" r="3.2" fill="#FFFFFF"/>')
        if inline:
            o.append(f'<circle class="lid" cx="{x}" cy="{y}" r="28" fill="{SKIN}" stroke="{OUT}" stroke-width="3.5"/>')
    o += [f'<path d="{b}" fill="none" stroke="{OUT}" stroke-width="4.5" stroke-linecap="round"/>' for b in BROWS]
    return "\n".join(o)


def face():
    """Below the band, for the full head: jaw, mouth with a half smile, nostrils, warts."""
    o = []
    o.append(f'<path d="M30 126 C 50 150 150 150 170 126 C 160 152 130 160 100 160 C 70 160 40 152 30 126 Z" fill="{JAW}"/>')
    for (x, y, r) in [(34, 104, 5), (168, 112, 4), (56, 96, 3), (152, 98, 3.5), (178, 96, 2.5)]:
        o.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{WART}"/>')
    o.append(f'<ellipse cx="90" cy="100" rx="3" ry="2" fill="{FACE_INK}"/><ellipse cx="110" cy="100" rx="3" ry="2" fill="{FACE_INK}"/>')
    o.append(f'<path d="M34 118 C 70 136 130 136 162 114 C 166 111 169 106 170 101" fill="none" stroke="{FACE_INK}" stroke-width="4.5" stroke-linecap="round"/>')
    return "\n".join(o)


def water():
    return (f'<path d="M0 84 Q 25 79 50 84 T 100 84 T 150 84 T 200 84" fill="none" stroke="{SKIN_D}" stroke-width="4" stroke-linecap="round"/>'
            f'<path d="M8 91 q 9 -4 18 0 M172 91 q 9 -4 18 0" fill="none" stroke="{SKIN_D}" stroke-width="2.5" stroke-linecap="round"/>')


def peek_inline(cls="toad"):
    """For build.mjs: the peek without its own water, with classes for the moving pupils and the blink."""
    return f'<svg class="{cls}" viewBox="0 0 200 86" aria-hidden="true">{top(inline=True)}</svg>'


def full_head():
    body = f'<g fill="{OUT}" stroke="{OUT}" stroke-linejoin="round"><path d="{HEAD_FULL}" stroke-width="7"/></g><path d="{HEAD_FULL}" fill="{SKIN}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 170" width="420" height="340">{body}\n{face()}\n{top()}</svg>\n'


def peek():
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 96" width="400" height="192">{top()}\n{water()}</svg>\n'


def mono(svg, colour):
    """One colour: every fill and stroke becomes the colour, the eyes and band stripes stay cut out (transparent)."""
    CUT = "#010203"  # marker for the parts that become holes: eye whites, highlights, band stripes
    s = svg.replace(AMBER, CUT).replace(WIRE_G, CUT).replace("#FFFFFF", CUT).replace(FACE_INK, CUT).replace(WART, CUT)
    for c in [SKIN, SKIN_D, JAW, WIRE, OUT]:
        s = s.replace(c, "#0A0B0C")  # marker for the solid parts
    # holes go through a mask, so the mark works on any picture
    body = s[s.index(">") + 1:s.rindex("</svg>")]
    head = s[:s.index(">") + 1]
    mask = body.replace(CUT, "#000000").replace("#0A0B0C", "#FFFFFF")
    keep = body.replace(CUT, colour).replace("#0A0B0C", colour)
    return f'{head}<defs><mask id="m" maskUnits="userSpaceOnUse">{mask}</mask></defs><g mask="url(#m)">{keep}</g></svg>\n'


if __name__ == "__main__":
    out = os.path.join(ROOT, "public", "brand")
    os.makedirs(out, exist_ok=True)
    files = {
        "toad-head.svg": full_head(),
        "toad-peek.svg": peek(),
        "toad-head-white.svg": mono(full_head(), "#FFFFFF"),
        "toad-peek-white.svg": mono(peek(), "#FFFFFF"),
        "toad-peek-ink.svg": mono(peek(), OUT),
    }
    for name, svg in files.items():
        open(os.path.join(out, name), "w", encoding="utf-8", newline="\n").write(svg)
        print("wrote public/brand/" + name)
    fav = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 4 188 82" width="48" height="21">{top()}</svg>\n'
    open(os.path.join(ROOT, "public", "favicon.svg"), "w", encoding="utf-8", newline="\n").write(fav)
    print("wrote public/favicon.svg")
    open(os.path.join(ROOT, "src", "toad-inline.svg"), "w", encoding="utf-8", newline="\n").write(peek_inline())
    print("wrote src/toad-inline.svg")
