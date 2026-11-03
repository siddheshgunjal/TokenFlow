#!/usr/bin/env python3
"""Generate TokenFlow's cross-platform icon set.

Requires Pillow (already used only for build-time asset generation, not at
runtime). The source artwork is rendered at 1024px and downsampled with Lanczos.
"""

from __future__ import annotations

import io
import pathlib
import struct

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
SIZE = 1024


def gradient_image() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(image)
    top = (45, 212, 191)
    bottom = (2, 132, 199)

    for y in range(SIZE):
        ratio = y / (SIZE - 1)
        color = tuple(
            round(top[channel] + (bottom[channel] - top[channel]) * ratio)
            for channel in range(3)
        )
        draw.line([(0, y), (SIZE, y)], fill=(*color, 255))

    return image


def rounded_mask() -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (26, 26, SIZE - 26, SIZE - 26),
        radius=218,
        fill=255,
    )
    return mask


def build_icon() -> Image.Image:
    mask = rounded_mask()
    base = gradient_image()
    base.putalpha(mask)

    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        (-SIZE * 0.15, -SIZE * 0.30, SIZE * 0.72, SIZE * 0.58),
        fill=(255, 255, 255, 60),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(SIZE * 0.10))
    base = Image.alpha_composite(base, glow)
    base.putalpha(ImageChops.multiply(base.getchannel("A"), mask))

    border = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (42, 42, SIZE - 42, SIZE - 42),
        radius=196,
        outline=(255, 255, 255, 52),
        width=8,
    )
    base = Image.alpha_composite(base, border)

    glyph = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glyph_draw = ImageDraw.Draw(glyph)
    ink = (5, 18, 28)
    bars = [
        ((246, 330, 758, 410), 246),
        ((246, 472, 832, 552), 208),
        ((246, 614, 690, 694), 164),
    ]
    for box, alpha in bars:
        glyph_draw.rounded_rectangle(box, radius=40, fill=(*ink, alpha))

    base = Image.alpha_composite(base, glyph)
    return base


def resized(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def write_icns(path: pathlib.Path, image: Image.Image) -> None:
    # Standard PNG-backed ICNS entries. 16px is included even though modern
    # macOS rarely requests it, for compatibility with older icon caches.
    entries = [
        (b"icp4", resized(image, 16)),
        (b"icp5", resized(image, 32)),
        (b"icp6", resized(image, 64)),
        (b"ic07", resized(image, 128)),
        (b"ic08", resized(image, 256)),
        (b"ic09", resized(image, 512)),
        (b"ic10", resized(image, 1024)),
    ]

    body = bytearray()
    for code, entry in entries:
        payload = png_bytes(entry)
        body.extend(code)
        body.extend(struct.pack(">I", len(payload) + 8))
        body.extend(payload)

    with path.open("wb") as handle:
        handle.write(b"icns")
        handle.write(struct.pack(">I", len(body) + 8))
        handle.write(body)


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    icon = build_icon()

    icon.save(ICONS / "icon.png")
    resized(icon, 32).save(ICONS / "32x32.png")
    resized(icon, 128).save(ICONS / "128x128.png")
    resized(icon, 256).save(ICONS / "128x128@2x.png")
    resized(icon, 256).save(ICONS / "256x256.png")
    resized(icon, 512).save(ICONS / "512x512.png")
    icon.save(
        ICONS / "icon.ico",
        format="ICO",
        sizes=[
            (16, 16),
            (24, 24),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )
    write_icns(ICONS / "icon.icns", icon)

    store_sizes = {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in store_sizes.items():
        resized(icon, size).save(ICONS / name)

    print(f"Wrote icons to {ICONS}")


if __name__ == "__main__":
    main()
