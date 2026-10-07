#!/usr/bin/env python3
"""Generate grayscale-alpha masks for the green portions of branded raster art.

PNG sources use only the Python standard library. WebP sources are decoded with
optional Pillow during generation; the mask files are white RGBA PNGs whose
alpha channel contains the feathered green selection and source alpha coverage.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"
ASSETS = (
    "rentnerproxy-logo.png",
    "rentnerproxy-logo-long.png",
    "login-panel-background-v1.png",
    "system-error-v1-960.webp",
    "system-not-found-v1-960.webp",
)
PROTECTED_CIRCLES = {
    # Preserve the green server status LEDs and their immediate glow. The
    # chassis is already excluded naturally by its blue/navy hue.
    "system-error-v1-960.webp": (
        (735, 406, 22, 30),
        (735, 539, 22, 30),
        (735, 606, 22, 30),
        (735, 673, 22, 30),
    ),
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth(left: int, up: int, upper_left: int) -> int:
    estimate = left + up - upper_left
    left_distance = abs(estimate - left)
    up_distance = abs(estimate - up)
    upper_left_distance = abs(estimate - upper_left)
    if left_distance <= up_distance and left_distance <= upper_left_distance:
        return left
    if up_distance <= upper_left_distance:
        return up
    return upper_left


def read_rgba(path: Path) -> tuple[int, int, bytes]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"Not a PNG file: {path}")

    offset = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = interlace = None
    compressed = bytearray()
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4 : offset + 8]
        chunk = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if compression != 0 or filtering != 0:
                raise ValueError(f"Unsupported PNG compression/filter method: {path}")
        elif kind == b"IDAT":
            compressed.extend(chunk)
        elif kind == b"IEND":
            break

    if width is None or height is None or bit_depth != 8 or color_type not in (2, 6):
        raise ValueError(f"Expected 8-bit RGB/RGBA PNG: {path}")
    if interlace != 0:
        raise ValueError(f"Interlaced PNGs are unsupported: {path}")

    channels = 4 if color_type == 6 else 3
    stride = width * channels
    raw = zlib.decompress(compressed)
    if len(raw) != height * (stride + 1):
        raise ValueError(f"Unexpected decompressed PNG size: {path}")

    rows: list[bytes] = []
    previous = bytearray(stride)
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        scanline = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        for index in range(stride):
            left = scanline[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 1:
                scanline[index] = (scanline[index] + left) & 255
            elif filter_type == 2:
                scanline[index] = (scanline[index] + up) & 255
            elif filter_type == 3:
                scanline[index] = (scanline[index] + ((left + up) >> 1)) & 255
            elif filter_type == 4:
                scanline[index] = (scanline[index] + paeth(left, up, upper_left)) & 255
            elif filter_type != 0:
                raise ValueError(f"Unsupported PNG filter {filter_type}: {path}")
        rows.append(bytes(scanline))
        previous = scanline

    if channels == 4:
        return width, height, b"".join(rows)

    rgba = bytearray(width * height * 4)
    source_offset = output_offset = 0
    for row in rows:
        for _ in range(width):
            rgba[output_offset : output_offset + 3] = row[source_offset : source_offset + 3]
            rgba[output_offset + 3] = 255
            source_offset += 3
            output_offset += 4
        source_offset = 0
    return width, height, bytes(rgba)


def read_webp_rgba(path: Path) -> tuple[int, int, bytes]:
    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError(
            "Pillow is required only to generate masks from WebP source art. "
            "Install Pillow in the development environment and rerun this script."
        ) from error

    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        return rgba.width, rgba.height, rgba.tobytes()


def read_asset_rgba(path: Path) -> tuple[int, int, bytes]:
    if path.suffix.lower() == ".webp":
        return read_webp_rgba(path)
    return read_rgba(path)


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    amount = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return amount * amount * (3.0 - 2.0 * amount)


def green_coverage(red: int, green: int, blue: int, alpha: int) -> int:
    if alpha < 16:
        return 0

    maximum = max(red, green, blue) / 255.0
    minimum = min(red, green, blue)
    chroma = max(red, green, blue) - minimum
    if chroma == 0 or maximum == 0:
        return 0

    saturation = chroma / max(red, green, blue)
    if maximum == red / 255.0:
        hue = ((green - blue) / chroma) % 6.0
    elif max(red, green, blue) == green:
        hue = (blue - red) / chroma + 2.0
    else:
        hue = (red - green) / chroma + 4.0
    degrees = hue * 60.0

    # Include yellow-green through teal; feather at both ends to avoid hard
    # boundaries around antialiased edges and shaded green details.
    hue_weight = smoothstep(72.0, 90.0, degrees) * (
        1.0 - smoothstep(188.0, 202.0, degrees)
    )
    saturation_weight = smoothstep(0.20, 0.65, saturation)
    return round(alpha * hue_weight * saturation_weight)


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


def write_mask(source: Path, destination: Path) -> tuple[int, int]:
    width, height, pixels = read_asset_rgba(source)
    mask = bytearray(width * height * 4)
    protected_circles = PROTECTED_CIRCLES.get(source.name, ())
    for offset in range(0, len(pixels), 4):
        red, green, blue, alpha = pixels[offset : offset + 4]
        pixel = offset // 4
        x = pixel % width
        y = pixel // width
        mask[offset : offset + 3] = b"\xff\xff\xff"
        coverage = green_coverage(red, green, blue, alpha)
        if coverage and protected_circles:
            protection = 1.0
            for center_x, center_y, radius, feather_end in protected_circles:
                distance_squared = (x - center_x) ** 2 + (y - center_y) ** 2
                if distance_squared < feather_end**2:
                    distance = distance_squared**0.5
                    protection = min(
                        protection, smoothstep(radius, feather_end, distance)
                    )
            coverage = round(coverage * protection)
        mask[offset + 3] = coverage

    stride = width * 4
    filtered = b"".join(
        b"\x00" + mask[row * stride : (row + 1) * stride] for row in range(height)
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    compressed = zlib.compress(filtered, level=9)
    destination.write_bytes(
        PNG_SIGNATURE
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", compressed)
        + png_chunk(b"IEND", b"")
    )
    return width, height


def main() -> None:
    for asset in ASSETS:
        source = PUBLIC / asset
        destination = PUBLIC / f"{source.stem}-accent-mask.png"
        width, height = write_mask(source, destination)
        print(f"{destination.relative_to(ROOT)} ({width}x{height}, {destination.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
