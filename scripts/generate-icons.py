#!/usr/bin/env python3
"""Generate a consistent set of 8voice brand icons from the canonical logo.

Source: site/public/logo.png (512x512 white rounded square + dark dot)
Outputs:
  - src-tauri/icons/*.png (Tauri bundle + Microsoft Store sizes)
  - src-tauri/icons/icon.ico (Windows multi-size ICO)
  - src-tauri/icons/icon.icns (macOS ICNS)
  - public/logo.png (app/web fallback)
"""

from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "site" / "public" / "logo.png"
TAURI_ICONS = ROOT / "src-tauri" / "icons"
PUBLIC = ROOT / "public"

# Tauri bundle icon sizes
TAURI_PNGS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}

# Microsoft Store / Windows tile sizes (from Package.appxmanifest defaults)
STORE_PNGS = {
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

# macOS ICNS icon types and sizes (big-endian header, PNG payload)
ICNS_TYPES = [
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic11", 32),   # 16@2x
    ("ic12", 64),   # 32@2x
    ("ic07", 128),
    ("ic13", 256),  # 128@2x
    ("ic08", 256),
    ("ic14", 512),  # 256@2x
    ("ic09", 512),
    ("ic10", 1024),
]


def load_source() -> Image.Image:
    img = Image.open(SOURCE)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    return img


def render_size(img: Image.Image, size: int) -> Image.Image:
    """High-quality downscale/upscale to a square target size."""
    return img.resize((size, size), Image.LANCZOS)


def save_png(img: Image.Image, size: int, path: Path) -> None:
    render_size(img, size).save(path, "PNG", optimize=True)


def build_ico(img: Image.Image) -> bytes:
    """Build a multi-resolution ICO with PNG-encoded frames.

    Pillow's ICO writer does not produce multi-size icons from append_images,
    so we assemble the directory manually (PNG payloads are well supported
    by Windows and modern toolchains).
    """
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames: list[tuple[int, bytes]] = []
    for size in sizes:
        buf = io.BytesIO()
        render_size(img, size).save(buf, "PNG", optimize=True)
        frames.append((size, buf.getvalue()))

    count = len(frames)
    header = struct.pack("<HHH", 0, 1, count)
    directory = bytearray()
    payload = bytearray()
    offset = 6 + 16 * count
    for size, data in frames:
        # ICO directory entry: width/height are bytes; 0 means 256.
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        directory.extend(struct.pack("<BBBB", w, h, 0, 0))  # colors=0, reserved
        directory.extend(struct.pack("<HH", 1, 32))         # planes=1, bpp=32
        directory.extend(struct.pack("<II", len(data), offset))
        payload.extend(data)
        offset += len(data)

    return bytes(header) + bytes(directory) + bytes(payload)


def build_icns(img: Image.Image) -> bytes:
    """Build a minimal ICNS container from PNG-encoded frames."""
    entries: list[tuple[str, bytes]] = []
    for type_code, size in ICNS_TYPES:
        buf = io.BytesIO()
        render_size(img, size).save(buf, "PNG", optimize=True)
        entries.append((type_code, buf.getvalue()))

    # Total size = 4 (magic) + 4 (length) + sum(4 + 4 + len(data))
    total = 8 + sum(8 + len(data) for _, data in entries)
    out = io.BytesIO()
    out.write(b"icns")
    out.write(struct.pack(">I", total))
    for type_code, data in entries:
        out.write(type_code.encode("ascii"))
        out.write(struct.pack(">I", 8 + len(data)))
        out.write(data)
    return out.getvalue()


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Canonical logo not found: {SOURCE}")

    TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    img = load_source()

    # Tauri PNG icons
    for name, size in TAURI_PNGS.items():
        save_png(img, size, TAURI_ICONS / name)
        print(f"Generated {name} ({size}x{size})")

    # Microsoft Store / Windows tile icons
    for name, size in STORE_PNGS.items():
        save_png(img, size, TAURI_ICONS / name)
        print(f"Generated {name} ({size}x{size})")

    # ICO + ICNS
    (TAURI_ICONS / "icon.ico").write_bytes(build_ico(img))
    print("Generated icon.ico")
    (TAURI_ICONS / "icon.icns").write_bytes(build_icns(img))
    print("Generated icon.icns")

    # Public fallback logo (same 512x512 source)
    save_png(img, 512, PUBLIC / "logo.png")
    print("Updated public/logo.png")

    print("\nAll brand icons generated from the canonical logo.")


if __name__ == "__main__":
    main()
