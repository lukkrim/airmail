"""Stitches the baked impostor frames (scripts/blender/out/impostors/<name>/)
into the game's atlases: public/models/impostors/<name>.webp (colour with
alpha), <name>_n.webp (normals, half size) and <name>_s.webp (colour at half
size, for phones), plus src/environment/impostorSet.json with each tree's
size and frame layout.

  python3 scripts/assets/prepare_impostors.py fir_a fir_b broad_a broad_b
"""
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', 'blender', 'out', 'impostors')
OUT = os.path.join(HERE, '..', '..', 'public', 'models', 'impostors')
os.makedirs(OUT, exist_ok=True)

def bleed(im):
    """Spread edge colours into the see-through area, so mipmaps and
    filtering don't drag dark fringes around the leaves."""
    a = np.asarray(im, dtype=np.float32)
    rgb, alpha = a[..., :3], a[..., 3]
    known = (alpha > 8).astype(np.float32)
    col = rgb * known[..., None]
    for _ in range(24):
        s_col = np.zeros_like(col)
        s_k = np.zeros_like(known)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                s_col += np.roll(np.roll(col, dy, 0), dx, 1)
                s_k += np.roll(np.roll(known, dy, 0), dx, 1)
        grow = (known == 0) & (s_k > 0)
        col[grow] = s_col[grow] / s_k[grow][:, None]
        known[grow] = 1
    rest = known == 0
    if rest.any():
        col[rest] = rgb[alpha > 8].mean(axis=0) if (alpha > 8).any() else 0
    out = np.dstack([np.clip(col, 0, 255), alpha]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

info = {}
for name in sys.argv[1:]:
    meta = json.load(open(os.path.join(SRC, f'{name}.json')))
    N = meta['grid']
    FW, FH = meta['frame']
    for mode in ('albedo', 'normal'):
        atlas = Image.new('RGBA', (N * FW, N * FH), (0, 0, 0, 0))
        for j in range(N):
            for i in range(N):
                im = Image.open(os.path.join(SRC, name, f'{mode}_{i}_{j}.png')).convert('RGBA')
                atlas.paste(im, (i * FW, (N - 1 - j) * FH))
        atlas = bleed(atlas)
        if mode == 'albedo':
            atlas.save(os.path.join(OUT, f'{name}.webp'), quality=88, method=6)
            atlas.resize((atlas.width // 2, atlas.height // 2), Image.LANCZOS).save(os.path.join(OUT, f'{name}_s.webp'), quality=86, method=6)
        else:
            atlas.convert('RGB').resize((atlas.width // 2, atlas.height // 2), Image.LANCZOS).save(os.path.join(OUT, f'{name}_n.webp'), quality=90, method=6)
    info[name] = {k: meta[k] for k in ('grid', 'frame', 'centre', 'radius', 'halfWidth', 'height', 'width')}
    info[name]['source'] = meta['object']
    print(name, info[name])
with open(os.path.join(HERE, '..', '..', 'src', 'environment', 'impostorSet.json'), 'w') as f:
    json.dump(info, f, indent=1)
