"""Turns Poly Haven rocks and ferns (assets-src/polyhaven) into one light
GLB for the close-up ground detail: public/models/props.glb, with meshes
named rock_0 …, fern_0 …, each about 1 unit across, standing on y = 0, with
the polygon count cut down and textures at 512 px.

  Blender -b --python scripts/blender/prepare_props.py
"""
import bpy, os
from mathutils import Vector

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', '..', 'assets-src', 'polyhaven')
OUT = os.path.join(HERE, '..', '..', 'public', 'models', 'props.glb')
SETS = [('rock_moss_set_01', 'rock', 900), ('rock_moss_set_02', 'rock', 900), ('fern_02', 'fern', 0)]

bpy.ops.wm.read_factory_settings(use_empty=True)
kept = []
counts = {'rock': 0, 'fern': 0}
for aid, kind, target in SETS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, aid, f'{aid}_1k.gltf'))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type != 'MESH':
            continue
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.parent = None
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if target and tris > target:
            d = o.modifiers.new('dec', 'DECIMATE')
            d.ratio = target / tris
            bpy.ops.object.modifier_apply(modifier='dec')
        # base centre at the origin, about 1 unit across
        vs = [v.co for v in o.data.vertices]
        lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
        off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        for v in o.data.vertices:
            v.co = (v.co - off) / size
        o.location = (counts[kind] * 2.0, 4.0 if kind == 'fern' else 0, 0)
        o.name = o.data.name = f'{kind}_{counts[kind]}'
        counts[kind] += 1
        kept.append(o)
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, 512)
bpy.ops.object.select_all(action='DESELECT')
for o in kept:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_image_format='JPEG',
                          export_jpeg_quality=85, export_yup=True)
print('PROPS', counts, [(o.name, sum(len(p.vertices) - 2 for p in o.data.polygons)) for o in kept])
