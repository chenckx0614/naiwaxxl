"""Convert the two supplied sculpt GLBs into small, self-contained game assets.

Requires numpy, scipy, Pillow and fast-simplification. The source GLBs stay in
Downloads; only the optimized files are written into naiwa/backrooms3d/.
"""

from __future__ import annotations

import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from fast_simplification import simplify


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path.home() / "Downloads"
DEST = ROOT / "naiwa" / "backrooms3d"
MODELS = (("奶蛋", "naidan.glb"), ("奶鼠", "naishu.glb"))
TARGET_TRIANGLES = 70000


def read_glb(path: Path):
    data = path.read_bytes()
    if data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise ValueError(f"Not a glTF 2.0 GLB: {path}")
    json_len = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20 : 20 + json_len])
    bin_start = 20 + json_len + 8
    return document, memoryview(data)[bin_start:]


def accessor(document, binary, index):
    a = document["accessors"][index]
    view = document["bufferViews"][a["bufferView"]]
    types = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}
    dtype = types[a["componentType"]]
    width = widths[a["type"]]
    offset = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(binary, dtype=dtype, count=a["count"] * width, offset=offset).reshape(-1, width)


def image_bytes(document, binary, index, size=1024):
    image = document["images"][index]
    view = document["bufferViews"][image["bufferView"]]
    offset = view.get("byteOffset", 0)
    raw = binary[offset : offset + view["byteLength"]]
    picture = Image.open(io.BytesIO(raw)).convert("RGB")
    picture.thumbnail((size, size), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    picture.save(output, "JPEG", quality=86, optimize=True, subsampling=0)
    return output.getvalue()


def vertex_normals(points, triangles):
    a, b, c = points[triangles[:, 0]], points[triangles[:, 1]], points[triangles[:, 2]]
    face_normals = np.cross(b - a, c - a)
    normals = np.zeros_like(points)
    for column in range(3):
        np.add.at(normals, triangles[:, column], face_normals)
    lengths = np.linalg.norm(normals, axis=1)
    normals /= np.maximum(lengths[:, None], 1e-8)
    return normals.astype(np.float32)


def write_glb(path, points, normals, texcoords, triangles, images):
    binary = bytearray()
    views = []

    def add(payload, target=None):
        while len(binary) % 4:
            binary.append(0)
        view = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        views.append(view)
        binary.extend(payload)
        return len(views) - 1

    positions_view = add(points.astype("<f4").tobytes(), 34962)
    normals_view = add(normals.astype("<f4").tobytes(), 34962)
    uv_view = add(texcoords.astype("<f4").tobytes(), 34962)
    indices_view = add(triangles.astype("<u4").tobytes(), 34963)
    image_views = [add(blob) for blob in images]
    accessors = [
        {"bufferView": positions_view, "componentType": 5126, "count": len(points), "type": "VEC3",
         "min": points.min(axis=0).tolist(), "max": points.max(axis=0).tolist()},
        {"bufferView": normals_view, "componentType": 5126, "count": len(normals), "type": "VEC3"},
        {"bufferView": uv_view, "componentType": 5126, "count": len(texcoords), "type": "VEC2"},
        {"bufferView": indices_view, "componentType": 5125, "count": triangles.size, "type": "SCALAR"},
    ]
    document = {
        "asset": {"version": "2.0", "generator": "naiwa backrooms optimizer"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                                   "indices": 3, "material": 0}]}],
        "materials": [{"doubleSided": True, "pbrMetallicRoughness": {
            "baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.86}}],
        "textures": [{"source": 0}, {"source": 1}, {"source": 2}],
        "images": [{"bufferView": view, "mimeType": "image/jpeg"} for view in image_views],
        "bufferViews": views, "accessors": accessors,
        "buffers": [{"byteLength": len(binary)}],
    }
    # Keep the downsampled normal and roughness images available for future
    # material tuning, while the live material uses the color texture alone.
    payload = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    payload += b" " * (-len(payload) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    glb_len = 12 + 8 + len(payload) + 8 + len(binary)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, glb_len)
                     + struct.pack("<I4s", len(payload), b"JSON") + payload
                     + struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for name, output_name in MODELS:
        source = SOURCE / f"{name}.glb"
        document, binary = read_glb(source)
        primitive = document["meshes"][0]["primitives"][0]
        positions = accessor(document, binary, primitive["attributes"]["POSITION"]).copy()
        uv = accessor(document, binary, primitive["attributes"]["TEXCOORD_0"]).copy()
        faces = accessor(document, binary, primitive["indices"]).reshape(-1, 3).astype(np.int32)
        print(f"{name}: {len(positions):,} vertices, {len(faces):,} triangles", flush=True)
        new_points, new_faces = simplify(positions, faces, target_count=TARGET_TRIANGLES,
                                          agg=9, preserve_border=True)
        # The simplifier changes vertex locations. Map each new vertex to the
        # nearest source UV; this is accurate enough at the characters' game size.
        nearest = cKDTree(positions).query(new_points, workers=-1)[1]
        new_uv = uv[nearest]
        new_normals = vertex_normals(new_points, new_faces)
        color_index = document["textures"][document["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]]["source"]
        images = [image_bytes(document, binary, color_index),
                  image_bytes(document, binary, 0), image_bytes(document, binary, 2)]
        output = DEST / output_name
        write_glb(output, new_points.astype(np.float32), new_normals, new_uv, new_faces, images)
        print(f"  -> {len(new_points):,} vertices, {len(new_faces):,} triangles, {output.stat().st_size / 1e6:.2f} MB", flush=True)


if __name__ == "__main__":
    main()
