#!/usr/bin/env python3
"""Generate the MacPTT app icon (1024px master).

Design: a dark, macOS-style rounded-square ("squircle") with a subtle top-lit
gradient — the look of a native terminal app — carrying a bold white "P" with a
blue command-line cursor block (the app's system-blue accent). P is the core;
the cursor gives it BBS / terminal character.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = 1024
MARGIN = 96                       # transparent margin (macOS adds its own shadow)
RADIUS = 196                      # continuous-ish corner
ACCENT = (10, 132, 255, 255)      # #0A84FF — same blue used across the UI
BOX = [MARGIN, MARGIN, S - MARGIN, S - MARGIN]


def vertical_gradient(top, bot):
    g = Image.new("RGB", (1, S))
    for y in range(S):
        t = y / (S - 1)
        t = t * t * (3 - 2 * t)   # smoothstep
        g.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return g.resize((S, S)).convert("RGBA")


def squircle_mask():
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle(BOX, radius=RADIUS, fill=255)
    return m


def load_p_font(size):
    # Prefer SF Pro (system) at a heavy weight; fall back to Helvetica Neue Bold.
    for variation in ("Heavy", "Bold"):
        try:
            f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", size)
            try:
                f.set_variation_by_name(variation)
            except Exception:
                pass
            return f
        except Exception:
            pass
    return ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", size, index=1)


def build():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = squircle_mask()

    # Body: dark graphite gradient, top slightly lit.
    body = vertical_gradient((48, 48, 54), (18, 18, 22))
    img.paste(body, (0, 0), mask)

    # Soft top sheen for depth.
    sheen = Image.new("L", (S, S), 0)
    ImageDraw.Draw(sheen).rounded_rectangle(
        [MARGIN, MARGIN, S - MARGIN, MARGIN + (S - 2 * MARGIN) * 0.46],
        radius=RADIUS, fill=46)
    sheen = sheen.filter(ImageFilter.GaussianBlur(48))
    sheen = Image.composite(sheen, Image.new("L", (S, S), 0), mask)
    overlay = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    overlay.putalpha(sheen)
    img = Image.alpha_composite(img, overlay)

    # Hairline inner top edge (subtle bevel).
    edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        [MARGIN, MARGIN, S - MARGIN, S - MARGIN],
        radius=RADIUS, outline=(255, 255, 255, 26), width=3)
    img = Image.alpha_composite(img, edge)

    # "P" + a blue underscore cursor (terminal prompt "P_"), centered as a unit.
    draw = ImageDraw.Draw(img)
    font = load_p_font(580)
    l, t, r, b = draw.textbbox((0, 0), "P", font=font)
    pw, ph = r - l, b - t
    gap = pw * 0.20
    cw = ph * 0.52              # underscore length
    ch = ph * 0.155             # underscore thickness
    group_w = pw + gap + cw
    gx = (S - group_w) / 2
    cy_mid = S / 2 + 6          # nudge down a hair for optical centering
    py = cy_mid - ph / 2 - t

    # subtle drop shadow under the glyph for legibility on the gradient
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.text((gx - l, py + 6), "P", font=font, fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    img = Image.alpha_composite(img, shadow)

    draw = ImageDraw.Draw(img)
    draw.text((gx - l, py), "P", font=font, fill=(255, 255, 255, 255))

    # underscore cursor, sitting on the P baseline
    cx0 = gx + pw + gap
    baseline = cy_mid + ph / 2
    draw.rounded_rectangle(
        [cx0, baseline - ch, cx0 + cw, baseline],
        radius=ch * 0.4, fill=ACCENT)

    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "macptt_icon.png")
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    build()
