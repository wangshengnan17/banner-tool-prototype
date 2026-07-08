from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/assets/atmosphere-1.png"
OUTPUT = ROOT / "src/assets/atmosphere-portrait-240x432.png"

CANVAS_W = 240
CANVAS_H = 432


def make_background() -> Image.Image:
    bg = Image.new("RGB", (CANVAS_W, CANVAS_H), "#050723")
    draw = ImageDraw.Draw(bg)

    for y in range(CANVAS_H):
        t = y / (CANVAS_H - 1)
        r = int(5 + 26 * t)
        g = int(7 + 2 * t)
        b = int(35 + 55 * t)
        draw.line([(0, y), (CANVAS_W, y)], fill=(r, g, b))

    glow = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((-92, 176, 294, 520), fill=(122, 28, 190, 58))
    glow_draw.ellipse((26, 236, 328, 518), fill=(0, 116, 255, 44))
    glow = glow.filter(ImageFilter.GaussianBlur(38))
    bg = Image.alpha_composite(bg.convert("RGBA"), glow)
    return bg.convert("RGBA")


def make_subject() -> tuple[Image.Image, Image.Image]:
    source = Image.open(SOURCE).convert("RGBA")
    scale_width = 568
    scale_height = round(source.height * scale_width / source.width)
    subject = source.resize((scale_width, scale_height), Image.Resampling.LANCZOS)
    subject = ImageEnhance.Contrast(subject).enhance(1.04)
    subject = ImageEnhance.Color(subject).enhance(1.03)

    mask = Image.new("L", subject.size, 255)
    mask_pixels = mask.load()
    feather_top = 54
    feather_left = 28
    for y in range(subject.height):
        for x in range(subject.width):
            alpha = 255
            if y < feather_top:
                alpha = min(alpha, int(255 * y / feather_top))
            if x < feather_left:
                alpha = min(alpha, int(255 * x / feather_left))
            mask_pixels[x, y] = alpha

    return subject, mask


def main() -> None:
    canvas = make_background()
    subject, mask = make_subject()

    # Place the original horizontal composition as a downsized subject.
    # This keeps the wallet complete in the vertical banner and leaves the
    # top text-safe area intentionally calm.
    canvas.paste(subject, (-304, 142), mask)

    top_overlay = Image.new("RGBA", (CANVAS_W, 152), (3, 5, 28, 96))
    canvas.alpha_composite(top_overlay, (0, 0))

    canvas.convert("RGB").save(OUTPUT, "PNG", optimize=True)


if __name__ == "__main__":
    main()
