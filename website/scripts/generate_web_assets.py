#!/usr/bin/env python3
"""Generate the website's favicons and Open Graph image from the brand mark."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src" / "assets" / "logo-mark.png"
OUT = ROOT / "website" / "public"

CANVAS = (7, 11, 20, 255)
INK = (232, 237, 244, 255)
MUTED = (140, 154, 174, 255)
ACCENT = (0, 212, 192, 255)
ACCENT_BLUE = (47, 107, 255, 255)
PANEL = (13, 20, 32, 235)
BORDER = (255, 255, 255, 22)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    path = Path("/usr/share/fonts/truetype/dejavu") / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def make_icon(size: int) -> Image.Image:
    logo = Image.open(SOURCE).convert("RGBA")
    logo.thumbnail((size, size), Image.Resampling.LANCZOS)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    left = (size - logo.width) // 2
    top = (size - logo.height) // 2
    icon.alpha_composite(logo, (left, top))
    return icon


def make_og_image() -> Image.Image:
    width, height = 1200, 630
    image = Image.new("RGBA", (width, height), CANVAS)
    draw = ImageDraw.Draw(image)

    for x in range(0, width, 60):
        draw.line([(x, 0), (x, height)], fill=(255, 255, 255, 8))
    for y in range(0, height, 60):
        draw.line([(0, y), (width, y)], fill=(255, 255, 255, 8))

    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse([-260, -320, 620, 380], fill=(0, 212, 192, 48))
    glow_draw.ellipse([700, -260, 1450, 430], fill=(47, 107, 255, 42))
    image = Image.alpha_composite(image, glow.filter(ImageFilter.GaussianBlur(110)))
    draw = ImageDraw.Draw(image)

    logo = Image.open(SOURCE).convert("RGBA")
    logo.thumbnail((92, 92), Image.Resampling.LANCZOS)
    image.alpha_composite(logo, (80, 76))

    draw.text((188, 86), "TokenFlow", font=font(54, bold=True), fill=INK)
    draw.text(
        (82, 200),
        "Private analytics for Ollama & DeepSeek",
        font=font(28),
        fill=MUTED,
    )

    draw.text((82, 280), "Know exactly where", font=font(58, bold=True), fill=INK)
    draw.text((82, 350), "your tokens go.", font=font(58, bold=True), fill=ACCENT)

    chips = [
        "Token accounting",
        "Cache visibility",
        "Model breakdown",
        "Private by design",
    ]
    chip_font = font(20)
    x, y = 84, 470
    for label in chips:
        box = draw.textbbox((0, 0), label, font=chip_font)
        chip_width = box[2] - box[0] + 28
        if x + chip_width > 700:
            x = 84
            y += 44
        draw.rounded_rectangle(
            [x, y, x + chip_width, y + 34],
            radius=17,
            fill=(16, 26, 40, 255),
            outline=(255, 255, 255, 40),
        )
        draw.text((x + 14, y + 7), label, font=chip_font, fill=MUTED)
        x += chip_width + 10

    card = [760, 268, 1120, 520]
    draw.rounded_rectangle(card, radius=24, fill=PANEL, outline=BORDER, width=2)
    draw.text((790, 296), "30-day usage", font=font(20, bold=True), fill=MUTED)
    draw.text((790, 326), "1.2M", font=font(40, bold=True), fill=INK)
    draw.text((790, 374), "tokens processed", font=font(18), fill=MUTED)

    bar_values = [38, 52, 30, 64, 44, 72, 58, 80, 46, 68]
    bar_x = 790
    bar_width = 18
    gap = 12
    base_y = 482
    for index, value in enumerate(bar_values):
        top = base_y - int(value * 0.9)
        color = ACCENT if index % 3 else ACCENT_BLUE
        draw.rounded_rectangle(
            [bar_x, top, bar_x + bar_width, base_y],
            radius=4,
            fill=color,
        )
        bar_x += bar_width + gap

    draw.text(
        (82, 566),
        "Private by design  ·  Loopback only  ·  Open source",
        font=font(20),
        fill=MUTED,
    )
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size, name in [
        (16, "favicon-16.png"),
        (32, "favicon-32.png"),
        (192, "favicon-192.png"),
        (512, "favicon-512.png"),
        (180, "apple-touch-icon.png"),
    ]:
        make_icon(size).save(OUT / name)
    make_og_image().convert("RGB").save(OUT / "og-image.png", quality=95)
    print(f"Generated website assets in {OUT}")


if __name__ == "__main__":
    main()
