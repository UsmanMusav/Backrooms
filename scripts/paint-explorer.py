"""Optional CC0 texture adaptation; requires Pillow + numpy. Inputs are art sources in .cache/character-source."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path('.cache/character-source')
out = Path('public/models')
out.mkdir(parents=True, exist_ok=True)
doc = json.loads((root / 'Superhero_Male_FullBody.gltf').read_text())
binary = (root / 'Superhero_Male_FullBody.bin').read_bytes()

def accessor(index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = view.get('byteStride', np.dtype(dtype).itemsize * components)
    return np.ndarray((a['count'], components), dtype=dtype, buffer=binary, offset=offset,
                      strides=(stride, np.dtype(dtype).itemsize)).copy()

size = 1024
base = np.array(Image.open(root / 'T_Superhero_Male_Dark.png').convert('RGB').resize((size, size)), dtype=float)
paint = np.full_like(base, [151., 144., 112.])
roughness = np.full((size, size), 228, dtype=np.uint8)
primitive = doc['meshes'][2]['primitives'][0]
points = accessor(primitive['attributes']['POSITION'])
uv = accessor(primitive['attributes']['TEXCOORD_0']) * (size - 1)
indices = accessor(primitive['indices']).reshape(-1, 3)
for tri in indices:
    triangle = uv[tri]
    x0, y0 = np.maximum(np.floor(triangle.min(axis=0)).astype(int), 0)
    x1, y1 = np.minimum(np.ceil(triangle.max(axis=0)).astype(int), size - 1)
    if x1 < x0 or y1 < y0:
        continue
    xx, yy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
    a, b, c = triangle
    denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(denom) < 1e-9:
        continue
    wa = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / denom
    wb = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / denom
    wc = 1 - wa - wb
    inside = (wa >= -0.005) & (wb >= -0.005) & (wc >= -0.005)
    pos = wa[..., None] * points[tri[0]] + wb[..., None] * points[tri[1]] + wc[..., None] * points[tri[2]]
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    face = (y > 1.665) & (y < 1.74) & (z > .045)
    glove = (np.abs(x) > 0.74) | (y < 0.28)
    harness = ((np.abs(np.abs(x) - 0.135) < 0.026) & (y > 1.0) & (y < 1.44) & (z > 0.025)) | ((y > 0.92) & (y < 0.98))
    zipper = (np.abs(x) < 0.009) & (y > 0.99) & (y < 1.47) & (z > 0.025)
    reflective = (y > 1.29) & (y < 1.315) & (np.abs(x) < 0.34) & (z > 0.025)
    mask = ((y > 1.57) & (y < 1.665) & (z > 0.035)) | ((y > 1.50) & (y < 1.57))
    weave = ((xx % 3) == 0).astype(float) * 1.5 - ((yy % 3) == 0).astype(float) * 1.2
    wear = 0.92 + np.sin(x * 31 + y * 9) * 0.025 + np.sin(y * 88) * 0.018
    color = np.array([151., 144., 112.])[None, None, :] * wear[..., None] + weave[..., None]
    color[harness | zipper] = np.array([69., 76., 59.])
    color[glove | mask] = np.array([40., 46., 40.])
    color[reflective] = np.array([195., 199., 171.])
    tile = paint[y0:y1 + 1, x0:x1 + 1]
    tile[inside] = color[inside]
    tile[inside & face] = base[y0:y1 + 1, x0:x1 + 1][inside & face]
    rr = roughness[y0:y1 + 1, x0:x1 + 1]
    rr[inside & reflective] = 145
    rr[inside & (glove | harness)] = 205

# UV triangles are slightly overdrawn to avoid naked seams at lower mip levels.
Image.fromarray(np.clip(paint, 0, 255).astype(np.uint8)).save(out / 'explorer-albedo.jpg', quality=90, subsampling=0)
Image.fromarray(roughness).save(out / 'explorer-roughness.png', optimize=True)
# Workwear gets fabric normals, not the anatomy/abs normal map of the base body.
yy, xx = np.mgrid[0:512, 0:512]
nx = np.sin(xx * np.pi) * 3 + np.cos(yy * np.pi * .5) * 5
ny = np.cos(xx * np.pi * .5) * 5 + np.sin(yy * np.pi) * 3
normal = np.stack([128 + nx, 128 + ny, np.full_like(nx, 254)], axis=-1)
Image.fromarray(normal.astype(np.uint8)).save(out / 'explorer-normal.jpg', quality=92, subsampling=0)
Image.open(root / 'T_Eye_Brown.png').convert('RGB').resize((128, 128)).save(out / 'explorer-eyes.jpg', quality=90)
print('Explorer suit textures baked; the continuous mesh is fully clothed, with gloves, boots, a hood and harness.')
