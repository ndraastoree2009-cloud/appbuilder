#!/usr/bin/env python3
"""
Menyiapkan proyek Android untuk satu pesanan: menulis res/values/app_config.xml dan ikon launcher.
Input lewat environment (diisi workflow dari input yang sudah divalidasi server, divalidasi ulang di sini):
  ORDER_ID, APP_NAME, APP_URL, PACKAGE_NAME, THEME_COLOR, ICON_URL (opsional)
Keluaran: APK_NAME ditulis ke $GITHUB_ENV.
"""
import io
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont

RES = Path(__file__).resolve().parents[1] / "android" / "app" / "src" / "main" / "res"
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
NAME_OK = set(" .,&'+!_-")
PKG_RE = re.compile(r"^[a-z][a-z0-9_]{0,19}(\.[a-z][a-z0-9_]{0,19}){2,4}$")
RESERVED = ("android.", "com.android.", "com.google.android.", "java.", "javax.", "kotlin.")
FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
MAX_ICON_BYTES = 3 * 1024 * 1024


def die(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def check_inputs(env):
    order = env.get("ORDER_ID", "")
    if not re.fullmatch(r"[0-9A-F]{16}", order):
        die("ORDER_ID tidak valid")

    name = " ".join(env.get("APP_NAME", "").split())
    if not (2 <= len(name) <= 30) or not all(c.isalnum() or c in NAME_OK for c in name):
        die("APP_NAME tidak valid")

    url = env.get("APP_URL", "").strip()
    if not url.startswith("https://") or len(url) > 300 or re.search(r"[\s\"<>\\]", url):
        die("APP_URL tidak valid")

    color = env.get("THEME_COLOR", "").strip()
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        die("THEME_COLOR tidak valid")

    pkg = env.get("PACKAGE_NAME", "").strip()
    if len(pkg) > 60 or not PKG_RE.fullmatch(pkg) or pkg.startswith(RESERVED):
        die("PACKAGE_NAME tidak valid")

    icon = env.get("ICON_URL", "").strip()
    if icon and not icon.startswith("https://"):
        die("ICON_URL harus https")
    return name, url, color.lower(), pkg, icon


def android_string(s):
    """Escape untuk isi <string> di resource Android."""
    s = s.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')
    s = escape(s)
    return "\\" + s if s[:1] in "@?" else s


def write_config(name, url, color):
    values = RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "app_config.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <string name="app_name" formatted="false">{android_string(name)}</string>\n'
        f'    <string name="start_url" translatable="false" formatted="false">{android_string(url)}</string>\n'
        f'    <string name="theme_color" translatable="false" formatted="false">{color}</string>\n'
        "</resources>\n",
        encoding="utf-8",
    )


def rounded(img):
    s = img.size[0]
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=s // 5, fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def icon_from_bytes(data):
    """Gambar apa pun (png/jpeg/webp) -> kotak 512x512 dengan sudut membulat."""
    img = Image.open(io.BytesIO(data))
    img.load()
    img = img.convert("RGBA")
    w, h = img.size
    side = min(w, h)
    img = img.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
    return rounded(img.resize((512, 512), Image.LANCZOS))


def default_icon(name, color):
    s = 512
    img = Image.new("RGBA", (s, s), color)
    letter = next((c for c in name if c.isalnum()), "A").upper()
    font = None
    for path in FONTS:
        try:
            font = ImageFont.truetype(path, 300)
            break
        except OSError:
            continue
    if font is None:
        try:
            font = ImageFont.load_default(size=300)
        except TypeError:
            font = ImageFont.load_default()
    d = ImageDraw.Draw(img)
    d.text((s / 2, s / 2), letter, fill="white", font=font, anchor="mm")
    return rounded(img)


def download_icon(url):
    req = urllib.request.Request(url, headers={"User-Agent": "web2apk-builder"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(MAX_ICON_BYTES + 1)
    if len(data) > MAX_ICON_BYTES:
        raise ValueError("ikon terlalu besar")
    return data


def write_icons(icon512):
    for density, px in SIZES.items():
        d = RES / f"mipmap-{density}"
        d.mkdir(parents=True, exist_ok=True)
        icon512.resize((px, px), Image.LANCZOS).save(d / "ic_launcher.png", "PNG")


def apk_name(name):
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")[:40] or "app"
    return f"{slug}.apk"


def main():
    name, url, color, pkg, icon_url = check_inputs(os.environ)
    write_config(name, url, color)

    icon = None
    if icon_url:
        try:
            icon = icon_from_bytes(download_icon(icon_url))
        except Exception as e:  # ikon bermasalah tidak boleh menggagalkan build
            print(f"::warning::Ikon tidak bisa dipakai ({type(e).__name__}), memakai ikon bawaan")
    write_icons(icon or default_icon(name, color))

    apk = apk_name(name)
    gh_env = os.environ.get("GITHUB_ENV")
    if gh_env:
        with open(gh_env, "a", encoding="utf-8") as f:
            f.write(f"APK_NAME={apk}\n")
    print(f"Siap: {name} -> {url} ({pkg}) -> {apk}")


if __name__ == "__main__":
    main()
