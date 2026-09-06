#!/usr/bin/env python3
"""
Regenerates the app's launcher icons from the source artwork.

Run after the logo or the brand gradient changes:  pnpm run generate:app-icons

Design: a map pin, in near-black, with the Corymbia helix cut out of it so the
brand gradient shows through, sitting on that same gradient. Chosen from thirteen
options (see docs/design-review/icon-options/) because it stays legible at 48dp —
where launcher icons are actually judged — while saying "this app records
locations" at a glance and keeping the brand's most recognisable asset.

Produces, in apps/fieldkit/assets/:
  adaptive-icon-background.png  1024x1024, the gradient, full bleed
  adaptive-icon.png             1024x1024, the pin on transparent, inside the safe zone
  icon.png                      1024x1024, the two composed (legacy launchers, Play listing)
  favicon.png                   48x48, web only

Why two layers: Android composites an adaptive icon from a background and a
foreground, then masks the result to a circle, squircle, rounded square or teardrop
depending on the launcher. Keeping the gradient as the background means it bleeds to
the edge under every mask, while the pin sits within the guaranteed-visible inner
region — so no mask can clip the pin's point. It also means the helix cut-out reveals
the background layer rather than a baked-in copy of it.

Requires: rsvg-convert (brew install librsvg) and Pillow.
"""
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:
    sys.exit("Pillow is required: pip3 install Pillow")

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "design/logo/logo.svg"
OUT = REPO / "apps/fieldkit/assets"
TMP = REPO / ".icon-build.tmp"

# Measured non-transparent bounding box of the artwork rendered at 1500x1500 —
# the same figures CorymbiaMark's containment test pins.
BBOX = (420, 2, 1080, 1498)

# ramp.brandGradient from packages/tokens/src/ramp.ts, in order.
GRADIENT = ["#ABD246", "#99D252", "#6BD371", "#22D5A3", "#1CD5A7"]
# ramp.slate[950] — the ink the pin is drawn in.
INK = "#0E1519"

CANVAS = 1024

# Pin geometry, as a fraction of a reference canvas. The helix-to-pin ratio here is
# the one chosen at review; change the pin and you change the design.
PIN_RADIUS, PIN_TOP, PIN_TIP = 0.255, 0.155, 0.845
HELIX_HEIGHT, HELIX_OFFSET = 0.385, -0.085

# How much of each output the pin occupies. The adaptive foreground is smaller
# because Android guarantees only the inner ~66% of that canvas survives masking;
# the legacy icon shows the whole square, so the pin can run larger.
ADAPTIVE_FILL, LEGACY_FILL = 0.62, 0.74


def _rgba(hex_colour: str, alpha: int = 255) -> tuple[int, int, int, int]:
    return tuple(int(hex_colour[i : i + 2], 16) for i in (1, 3, 5)) + (alpha,)


def render_mark(colour: str, size: int = 1500) -> Image.Image:
    """Render the logo flattened to one colour, cropped to its true content bounds."""
    if not SOURCE.exists():
        sys.exit(f"Source artwork not found: {SOURCE}")
    TMP.mkdir(exist_ok=True)
    svg = SOURCE.read_text().replace("fill:url(#SVGID_1_)", f"fill:{colour}")
    for css_class, original in (
        ("st0", "#84CF69"),
        ("st1", "#98D455"),
        ("st2", "#30CF9F"),
        ("st3", "#55D28C"),
    ):
        svg = svg.replace(f".{css_class}{{fill:{original};}}", f".{css_class}{{fill:{colour};}}")
    flattened = TMP / "flattened.svg"
    flattened.write_text(svg)

    png = TMP / "render.png"
    subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), str(flattened), "-o", str(png)],
        check=True,
    )
    image = Image.open(png).convert("RGBA")
    scale = size / 1500
    return image.crop(tuple(round(v * scale) for v in BBOX))


def diagonal_gradient(size: int = CANVAS) -> Image.Image:
    """A 45-degree gradient, drawn as anti-diagonal lines across the canvas."""
    canvas = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(canvas)
    colours = [_rgba(c)[:3] for c in GRADIENT]
    span = size * 2
    for i in range(span):
        position = (i / (span - 1)) * (len(colours) - 1)
        index = min(int(position), len(colours) - 2)
        blend = position - index
        draw.line(
            [(i, 0), (0, i)],
            fill=tuple(
                round(colours[index][c] + (colours[index + 1][c] - colours[index][c]) * blend)
                for c in range(3)
            )
            + (255,),
        )
    return canvas


def build_pin(mark: Image.Image, size: int = CANVAS) -> Image.Image:
    """The pin silhouette in ink, with the helix cut out of it, cropped to its bounds."""
    shape = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(shape)
    radius = int(size * PIN_RADIUS)
    cx = size // 2
    cy = int(size * PIN_TOP) + radius
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)
    draw.polygon(
        [
            (cx - radius * 0.82, cy + radius * 0.58),
            (cx + radius * 0.82, cy + radius * 0.58),
            (cx, int(size * PIN_TIP)),
        ],
        fill=255,
    )

    helix_h = round(size * HELIX_HEIGHT)
    helix_w = round(mark.width * (helix_h / mark.height))
    helix = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    helix.alpha_composite(
        mark.resize((helix_w, helix_h), Image.LANCZOS),
        ((size - helix_w) // 2, (size - helix_h) // 2 + int(size * HELIX_OFFSET)),
    )

    pin = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pin.paste(
        Image.new("RGBA", (size, size), _rgba(INK)),
        (0, 0),
        ImageChops.subtract(shape, helix.split()[3]),
    )
    return pin.crop(pin.getbbox())


def scaled_onto(pin: Image.Image, background: Image.Image, fill: float) -> Image.Image:
    target_h = round(CANVAS * fill)
    target_w = round(pin.width * (target_h / pin.height))
    out = background.copy()
    out.alpha_composite(
        pin.resize((target_w, target_h), Image.LANCZOS),
        ((CANVAS - target_w) // 2, (CANVAS - target_h) // 2),
    )
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pin = build_pin(render_mark(INK))
    gradient = diagonal_gradient()
    transparent = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    gradient.save(OUT / "adaptive-icon-background.png")
    scaled_onto(pin, transparent, ADAPTIVE_FILL).save(OUT / "adaptive-icon.png")

    composed = scaled_onto(pin, gradient, LEGACY_FILL)
    composed.save(OUT / "icon.png")
    composed.resize((48, 48), Image.LANCZOS).save(OUT / "favicon.png")

    for name in (
        "adaptive-icon-background.png",
        "adaptive-icon.png",
        "icon.png",
        "favicon.png",
    ):
        path = OUT / name
        print(f"wrote {path.relative_to(REPO)} — {Image.open(path).size[0]}px")

    for leftover in TMP.glob("*"):
        leftover.unlink()
    TMP.rmdir()


if __name__ == "__main__":
    main()
