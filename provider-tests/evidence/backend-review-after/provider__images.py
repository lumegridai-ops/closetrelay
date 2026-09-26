"""Conservative PNG/JPEG container checks, not a full image decoder or vision QA."""

import struct
import zlib

MAX_IMAGE_BYTES = 10_000_000  # Strictly below 10MB, conservatively decimal.
MAX_SIDE = 4096


class ImageValidationError(ValueError):
    pass


def _png_dimensions(data):
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ImageValidationError("image_type_mismatch")
    pos, dimensions, saw_data, saw_end = 8, None, False, False
    while pos + 12 <= len(data):
        size = struct.unpack_from(">I", data, pos)[0]
        kind = data[pos + 4:pos + 8]
        end = pos + 12 + size
        if end > len(data):
            raise ImageValidationError("invalid_image_container")
        payload = data[pos + 8:pos + 8 + size]
        crc = struct.unpack_from(">I", data, pos + 8 + size)[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != crc:
            raise ImageValidationError("invalid_image_container")
        if dimensions is None:
            if kind != b"IHDR" or size != 13:
                raise ImageValidationError("invalid_image_container")
            width, height, depth, colour, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            allowed_depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
            if depth not in allowed_depths.get(colour, set()) or compression or filtering or interlace not in (0, 1):
                raise ImageValidationError("invalid_image_container")
            dimensions = (width, height)
        elif kind == b"IHDR":
            raise ImageValidationError("invalid_image_container")
        if kind == b"acTL":
            raise ImageValidationError("animated_image_unsupported")
        if kind == b"IDAT":
            saw_data = saw_data or size > 0
        if kind == b"IEND":
            if size != 0 or end != len(data):
                raise ImageValidationError("invalid_image_container")
            saw_end = True
            break
        pos = end
    if not dimensions or not saw_data or not saw_end:
        raise ImageValidationError("invalid_image_container")
    return dimensions


def _jpeg_dimensions(data):
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise ImageValidationError("image_type_mismatch")
    pos, dimensions = 2, None
    # Validate bounded marker segments up to the first scan; entropy decoding and
    # EXIF orientation are intentionally outside this stdlib container check.
    while pos < len(data) - 2:
        if data[pos] != 0xFF:
            raise ImageValidationError("invalid_image_container")
        while pos < len(data) and data[pos] == 0xFF:
            pos += 1
        if pos >= len(data):
            break
        marker = data[pos]
        pos += 1
        if marker in (0x00, 0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            raise ImageValidationError("invalid_image_container")
        if pos + 2 > len(data):
            break
        size = struct.unpack_from(">H", data, pos)[0]
        if size < 2 or pos + size > len(data) - 2:
            raise ImageValidationError("invalid_image_container")
        if marker in (0xC0, 0xC1, 0xC2):
            if dimensions is not None or size < 8:
                raise ImageValidationError("invalid_image_container")
            precision, height, width, components = struct.unpack_from(">BHHB", data, pos + 2)
            if precision != 8 or components not in (1, 3) or size != 8 + 3 * components:
                raise ImageValidationError("unsupported_jpeg_encoding")
            dimensions = (width, height)
        if marker == 0xDA:
            if dimensions is None or pos + size >= len(data) - 2:
                raise ImageValidationError("invalid_image_container")
            return dimensions
        pos += size
    raise ImageValidationError("invalid_image_container")


def validate_image(data, mime_type, *, is_input=True):
    if type(data) is not bytes or not data or len(data) >= MAX_IMAGE_BYTES:
        raise ImageValidationError("invalid_image_size")
    if mime_type == "image/png":
        dimensions = _png_dimensions(data)
    elif mime_type in ("image/jpeg", "image/jpg"):
        dimensions = _jpeg_dimensions(data)
    else:
        raise ImageValidationError("unsupported_image_type")
    width, height = dimensions
    if width < 1 or height < 1 or max(dimensions) > MAX_SIDE:
        raise ImageValidationError("invalid_image_dimensions")
    # Treat the documented 512x384 minimum as long/short side, accepting either
    # orientation. This is a conservative local policy, not pose validation.
    if is_input and (max(dimensions) < 512 or min(dimensions) < 384):
        raise ImageValidationError("image_below_minimum")
    return dimensions
