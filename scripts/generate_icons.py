#!/usr/bin/env python3
"""Generate TokenFlow's cross-platform icon set.

Requires Pillow (already used only for build-time asset generation, not at
runtime). The source artwork is rendered at 1024px and downsampled with Lanczos.

The brand mandate: transparent icons everywhere. No opaque background tile,
no rounded-square mask, no glow, no drop shadow. The 3D F mark floats on
whatever background the OS/browser/README provides.
"""

from __future__ import annotations

import io
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
SOURCE = ROOT / "src-tauri" / "icons" / "tokenflow_logo_full_alpha.png"
SIZE = 1024
PADDING_PCT = 0.06  # 6% padding on each side; mark occupies 88%


def load_source() -> Image.Image:
    """Load the source RGBA logo and trim to the mark bounds."""
    img = Image.open(SOURCE)
    assert img.mode == "RGBA", f"Expected RGBA, got {img.mode}"
    # Build a mask from alpha > 8 (near-transparent edge pixels)
    alpha = img.getchannel("A")
    mask = Image.new("L", img.size, 0)
    mask.paste(255, alpha.point(lambda a: 255 if a > 8 else 0))
    bbox = mask.getbbox()
    if bbox is None:
        # Fallback: use the full image if nothing detected
        return img
    # Crop to the mark, then add padding
    padded_img = img.crop(bbox)
    # Calculate padded canvas size so the mark occupies 84-88% of the final square
    mark_w, mark_h = padded_img.size
    # Use the larger dimension to determine canvas size, then center
    canvas_size = int(max(mark_w, mark_h) / (1 - 2 * PADDING_PCT))
    # Create transparent canvas
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    # Center the mark
    x = (canvas_size - mark_w) // 2
    y = (canvas_size - mark_h) // 2
    canvas.paste(padded_img, (x, y), padded_img)
    return canvas


def resize_lanczos(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def make_silhouette(image: Image.Image, size: int) -> Image.Image:
    """For sizes <= 32px: produce a silhouette filled with accent (#00D4C0)."""
    alpha = image.getchannel("A")
    resized_alpha = resize_lanczos(alpha, size)
    # Create transparent canvas, draw the resized mask, then fill with accent
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Create a proper silhouette: resize the mask and use it as alpha
    # while having accent as the fill color
    accent = (0, 212, 192, 255)  # #00D4C0
    # Create base with accent color
    base = Image.new("RGBA", (size, size), accent)
    # Resize and apply the alpha mask
    result = Image.alpha_composite(
        result, Image.new("RGBA", (size, size), (0, 0, 0, 0))
    )
    # Actually let's do it differently - create a mask image and apply it
    mask_img = Image.new("L", (size, size), 0)
    mask_img.paste(255, resized_alpha)
    # Create result with accent background and mask as alpha
    result = Image.new("RGBA", (size, size), accent)
    result.putalpha(mask_img)
    return result


def make_full_color(image: Image.Image, size: int) -> Image.Image:
    """For sizes >= 44px: use the full-color 3D mark."""
    return resize_lanczos(image, size)


def generate_icons() -> None:
    """Generate the full icon set from the source artwork.

    Per the branding handover (§6.1):
    - Transparent backgrounds everywhere
    - Sizes <= 32px: simplified silhouette in #00D4C0 (accent)
    - Sizes >= 44px: full-color 3D mark
    - All outputs are RGBA with transparent corners
    """
    canvas = load_source()
    ICONS.mkdir(parents=True, exist_ok=True)

    # Full-color 1024px icon (src-tauri/icons/icon.png)
    full_color_1024 = make_full_color(canvas, 1024)
    full_color_1024.save(ICONS / "icon.png", format="PNG", optimize=True)

    # Generate all sizes
    # 32px: silhouette
    icon_32 = make_silhouette(canvas, 32)
    icon_32.save(ICONS / "32x32.png")

    # 128px: full color
    icon_128 = make_full_color(canvas, 128)
    icon_128.save(ICONS / "128x128.png")

    # 128x2 (256px): full color
    icon_128x2 = make_full_color(canvas, 256)
    icon_128x2.save(ICONS / "128x128@2x.png")

    # 256px: full color
    icon_256 = make_full_color(canvas, 256)
    icon_256.save(ICONS / "256x256.png")

    # 512px: full color
    icon_512 = make_full_color(canvas, 512)
    icon_512.save(ICONS / "512x512.png")

    # ICCO ICO format with multiple sizes
    icon_sizes_ico = [16, 24, 32, 48, 64, 128, 256]
    ico_images = []
    for s in icon_sizes_ico:
        if s <= 32:
            img = make_silhouette(canvas, s)
        else:
            img = make_full_color(canvas, s)
        ico_images.append((s, img))
    # Save ICO: first image as base with all sizes
    if ico_images:
        first_size, first_img = ico_images[0]
        first_img.save(
            ICONS / "icon.ico",
            format="ICO",
            sizes=[(s, s) for s in icon_sizes_ico],
        )

    # macOS ICNS
    icns_entries = [
        (b"icp4", resize_lanczos(canvas, 16)),
        (b"icp5", resize_lanczos(canvas, 32)),
        (b"icp6", resize_lanczos(canvas, 64)),
        (b"ic07", resize_lanczos(canvas, 128)),
        (b"ic08", resize_lanczos(canvas, 256)),
        (b"ic09", resize_lanczos(canvas, 512)),
        (b"ic10", resize_lanczos(canvas, 1024)),
    ]
    icns_body = bytearray()
    for code, entry in icns_entries:
        buf = io.BytesIO()
        entry.save(buf, format="PNG", optimize=True)
        payload = buf.getvalue()
        icns_body.extend(code)
        icns_body.extend(len(payload).to_bytes(4, "big"))
        icns_body.extend(payload)
    with open(ICONS / "icon.icns", "wb") as f:
        f.write(b"ICNS")
        f.write(len(icns_body).to_bytes(4, "big"))
        f.write(icns_body)

    # Store logos for Windows/macOS flatpak (silhouette <= 32px, full color >= 44px)
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
        if size <= 32:
            img = make_silhouette(canvas, size)
        elif size <= 44:
            # For sizes between 32 and 44, use silhouette
            img = make_silhouette(canvas, size)
        else:
            img = make_full_color(canvas, size)
        img.save(ICONS / name, format="PNG", optimize=True)

    # Tray icons
    tray_64 = make_full_color(canvas, 64)
    tray_64.save(ICONS / "tray-64.png")
    tray_128 = make_full_color(canvas, 128)
    tray_128.save(ICONS / "tray-128.png")

    # Generate the web UI logo mark (512px, transparent, goes to src/assets/)
    web_logo = load_source()
    web_logo_path = ROOT / "src" / "assets" / "logo-mark.png"
    web_logo_path.parent.mkdir(parents=True, exist_ok=True)
    web_logo.save(web_logo_path, format="PNG")

    print(f"Wrote icons to {ICONS}")
    print(f"Web logo written to {web_logo_path}")


if __name__ == "__main__":
    generate_icons()
