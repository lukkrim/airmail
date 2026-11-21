"""Turns the Poly Haven ground textures (assets-src/polyhaven) into the
game's ground set: public/textures/ground/<layer>.jpg (colour) and
<layer>_n.jpg (normal map), plus src/environment/groundSet.json with each colour texture's
average linear colour (the shader uses it to keep the map's own colours and
take only the photo's detail).

  python3 scripts/assets/prepare_ground.py
"""
import json, os
from PIL import Image

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', '..', 'assets-src', 'polyhaven')
OUT = os.path.join(HERE, '..', '..', 'public', 'textures', 'ground')
LAYERS = {
    'grass': ('leafy_grass', '1k'),
    'forest': ('forest_leaves_04', '1k'),
    'rock': ('aerial_rocks_02', '1k'),
    'snow': ('snow_02', '1k'),
    'sand': ('coast_sand_01', '1k'),
    'macro': ('rocky_terrain_02', '2k'),
}
SIZE = 1024

def lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

os.makedirs(OUT, exist_ok=True)
info = {}
for layer, (aid, res) in LAYERS.items():
    d = Image.open(os.path.join(SRC, aid, f'{aid}_diff_{res}.jpg')).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    d.save(os.path.join(OUT, f'{layer}.jpg'), quality=84, optimize=True)
    n = Image.open(os.path.join(SRC, aid, f'{aid}_nor_gl_{res}.jpg')).convert('RGB').resize((SIZE // 2, SIZE // 2), Image.LANCZOS)
    n.save(os.path.join(OUT, f'{layer}_n.jpg'), quality=88, optimize=True)
    small = d.resize((64, 64), Image.BOX)
    px = list(small.get_flattened_data()) if hasattr(small, 'get_flattened_data') else list(small.getdata())
    avg = [sum(lin(float(p[i])) for p in px) / len(px) for i in range(3)]
    info[layer] = {'source': aid, 'avg': [round(a, 4) for a in avg]}
    print(layer, aid, info[layer]['avg'])
with open(os.path.join(HERE, '..', '..', 'src', 'environment', 'groundSet.json'), 'w') as f:
    json.dump(info, f, indent=1)
