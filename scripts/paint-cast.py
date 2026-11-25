"""Optional CC0 texture adaptation for the prologue cast; requires Pillow + numpy.

Inputs are the Quaternius light-skin body textures in .cache/character-source. Every UV triangle is
classified by its bind-pose position (T-pose, metres) and repainted as everyday clothing: T-shirts,
jeans/chinos, a hoodie with a pouch pocket and sneakers. Skin, face and hands keep the original art.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

root = Path('.cache/character-source')
out = Path('public/models')
size = 1024
rng = np.random.default_rng(1991)


def load(name):
    doc = json.loads((root / f'{name}.gltf').read_text())
    binary = (root / doc['buffers'][0]['uri']).read_bytes()

    def accessor(index):
        a = doc['accessors'][index]
        view = doc['bufferViews'][a['bufferView']]
        dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
        components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', np.dtype(dtype).itemsize * components)
        return np.ndarray((a['count'], components), dtype=dtype, buffer=binary, offset=offset,
                          strides=(stride, np.dtype(dtype).itemsize)).copy()

    node = next(n for n in doc['nodes'] if 'mesh' in n and 'superhero' in n.get('name', '').lower())
    mesh = doc['meshes'][node['mesh']]
    primitive = mesh['primitives'][0]
    return (accessor(primitive['attributes']['POSITION']),
            accessor(primitive['attributes']['TEXCOORD_0']) * (size - 1),
            accessor(primitive['indices']).reshape(-1, 3))


def fabric(shape, scale=1.0, twill=False):
    """Fine weave/twill and low-frequency fading, multiplicative around 1."""
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    noise = np.array(Image.fromarray((rng.random(shape) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), dtype=float) / 255 - .5
    fade = np.array(Image.fromarray((rng.random((shape[0] // 32, shape[1] // 32)) * 255).astype(np.uint8)).resize(shape[::-1], Image.BICUBIC), dtype=float) / 255 - .5
    weave = ((xx + yy) % 4 < 2) * .05 - .025 if twill else ((xx % 2) ^ (yy % 2)) * .03 - .015
    return 1 + noise * .12 * scale + fade * .14 * scale + weave


def paint(body, skin_file, outfit, file):
    points, uv, indices = body
    skin = np.array(Image.open(root / skin_file).convert('RGB').resize((size, size), Image.LANCZOS), dtype=float)
    result = skin.copy()
    covered = np.zeros((size, size), bool)
    weave = fabric((size, size)); twill = fabric((size, size), 1.2, True)
    for tri in indices:
        triangle = uv[tri]
        x0, y0 = np.maximum(np.floor(triangle.min(axis=0)).astype(int) - 1, 0)
        x1, y1 = np.minimum(np.ceil(triangle.max(axis=0)).astype(int) + 1, size - 1)
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
        # Slight overdraw so UV seams do not show skin at lower mip levels.
        inside = (wa >= -0.02) & (wb >= -0.02) & (wc >= -0.02)
        pos = wa[..., None] * points[tri[0]] + wb[..., None] * points[tri[1]] + wc[..., None] * points[tri[2]]
        color, mask = outfit(pos[..., 0], pos[..., 1], pos[..., 2], weave[y0:y1 + 1, x0:x1 + 1], twill[y0:y1 + 1, x0:x1 + 1])
        covered[y0:y1 + 1, x0:x1 + 1] |= inside
        tile = result[y0:y1 + 1, x0:x1 + 1]
        keep = inside & mask
        tile[keep] = color[keep]
    # Grow every island into the unused gutter so mip levels never sample the grey source background.
    for _ in range(12):
        grown = result.copy(); count = covered.astype(float)
        acc = result * covered[..., None]
        total = np.zeros_like(result); weight = np.zeros(covered.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            total += np.roll(acc, (dy, dx), (0, 1)); weight += np.roll(count, (dy, dx), (0, 1))
        fill = (~covered) & (weight > 0)
        grown[fill] = total[fill] / weight[fill][:, None]
        result, covered = grown, covered | fill
    Image.fromarray(np.clip(result, 0, 255).astype(np.uint8)).save(out / file, quality=88, subsampling=0)
    print('baked', file)


def solid(rgb, shape):
    return np.broadcast_to(np.array(rgb, dtype=float), shape + (3,)).copy()


def shade_folds(color, x, y, z, joints):
    """Darker creases where fabric bunches: behind knees, inside elbows, under the arms, at the waist."""
    k = np.ones_like(y)
    for jx, jy, radius, depth in joints:
        d = np.sqrt((np.abs(x) - jx) ** 2 + (y - jy) ** 2)
        k -= np.clip(1 - d / radius, 0, 1) * depth
    return color * k[..., None]


def male_base(x, y, z, shirt, pants, shoe, sole, weave, twill, sleeve=.355, stripes=None):
    shape = y.shape
    ax = np.abs(x)
    color = np.zeros(shape + (3,))
    shoes = (y < .105) & (ax < .3)
    soles = (y < .03) & (ax < .3)
    trousers = (y >= .105) & (y < .995) & (ax < .3)
    # Crew neck: the tee covers shoulders and trapezius, leaving a round opening around the neck.
    neck = ((x / .078) ** 2 + ((z + .045) / .078) ** 2 < 1) & (y > np.where(z > 0, 1.445, 1.49))
    neckline = np.where(z > 0, 1.445, 1.49)
    tee = (y >= .975) & (y < 1.585) & (ax < sleeve) & ~neck
    color[trousers] = (solid(pants, shape) * twill[..., None])[trousers]
    # Seam lines down the outer leg, waistband, belt and back pockets.
    seam = trousers & (np.abs(ax - .17) < .006) & (z < .02) & (z > -.06)
    color[seam] *= .78
    band = trousers & (y > .955)
    color[band] = (solid(pants, shape) * .82)[band]
    belt = trousers & (y > .965) & (y < .985)
    color[belt] = solid((48, 36, 26), shape)[belt]
    pocket = trousers & (z < -.06) & (y > .84) & (y < .93) & (ax > .04) & (ax < .14)
    color[pocket] *= .9
    t = solid(shirt, shape) * weave[..., None]
    if stripes is not None:
        stripe = ((y * 100).astype(int) % 6) < 2
        t[stripe] = (solid(stripes, shape) * weave[..., None])[stripe]
    color[tee] = t[tee]
    collar = tee & ((x / .095) ** 2 + ((z + .045) / .095) ** 2 < 1) & (y > neckline - .03)
    color[collar] *= .84
    cuff = tee & (ax > sleeve - .02)
    color[cuff] *= .86
    hem = tee & (y < .995)
    color[hem] *= .88
    color[shoes] = solid(shoe, shape)[shoes]
    color[soles] = solid(sole, shape)[soles]
    color = shade_folds(color, x, y, z, [(.114, .55, .07, .18), (.46, 1.43, .06, .12), (.2, 1.39, .07, .16), (.07, .99, .1, .08)])
    return color, shoes | trousers | tee


def female_base(x, y, z, weave, twill):
    shape = y.shape
    ax = np.abs(x)
    color = np.zeros(shape + (3,))
    shoes = (y < .095) & (ax < .3)
    soles = (y < .025) & (ax < .3)
    jeans = (y >= .095) & (y < .965) & (ax < .3)
    neck = ((x / .072) ** 2 + ((z + .05) / .072) ** 2 < 1) & (y > np.where(z > 0, 1.42, 1.46))
    hoodie = (y >= .94) & (y < 1.55) & (ax < .625) & ~neck
    color[jeans] = (solid((62, 82, 112), shape) * twill[..., None])[jeans]
    knee_wear = jeans & (np.abs(y - .55) < .06) & (z > .0)
    color[knee_wear] = color[knee_wear] * .85 + 32
    seam = jeans & (np.abs(ax - .16) < .006) & (z < .02) & (z > -.06)
    color[seam] *= .78
    color[hoodie] = (solid((70, 84, 64), shape) * weave[..., None])[hoodie]
    pouch = hoodie & (z > 0) & (y > 1.0) & (y < 1.12) & (ax < .13)
    color[pouch] *= .9
    pouch_edge = pouch & ((np.abs(y - 1.12) < .006) | (np.abs(ax - .13) < .006))
    color[pouch_edge] *= .75
    strings = hoodie & (z > 0) & (np.abs(ax - .035) < .005) & (y > 1.33) & (y < 1.44)
    color[strings] = solid((214, 210, 196), shape)[strings]
    rib = hoodie & ((y < .975) | (ax > .595))
    color[rib] *= .83
    color[shoes] = solid((150, 40, 34), shape)[shoes]
    color[soles] = solid((226, 222, 210), shape)[soles]
    color = shade_folds(color, x, y, z, [(.111, .54, .07, .16), (.39, 1.40, .06, .14), (.15, 1.36, .07, .16)])
    return color, shoes | jeans | hoodie


male = load('Superhero_Male_FullBody')
female = load('Superhero_Female_FullBody')
# Director: faded navy tee, washed jeans, white sneakers.
paint(male, 'T_Superhero_Male_Ligh.png', lambda x, y, z, w, t: male_base(x, y, z, (52, 72, 104), (74, 96, 128), (214, 212, 202), (150, 146, 138), w, t), 'cast-director.jpg')
# Friend at the fence: rust-and-cream striped tee, khaki chinos, dark sneakers.
paint(male, 'T_Superhero_Male_Ligh.png', lambda x, y, z, w, t: male_base(x, y, z, (164, 78, 52), (150, 134, 98), (54, 52, 50), (196, 192, 182), w, t, stripes=(214, 200, 168)), 'cast-friend.jpg')
# Lena: olive hoodie, jeans, red canvas shoes (her head is hidden by the paper-bag mask).
paint(female, 'T_Superhero_Female_Light_BaseColor.png', female_base, 'cast-lena.jpg')
for index in (1, 2):
    Image.open(root / f'T_Hair_{index}_BaseColor.png').convert('RGB').resize((512, 512), Image.LANCZOS).save(out / f'cast-hair-{index}.jpg', quality=88)
print('Cast textures baked.')
