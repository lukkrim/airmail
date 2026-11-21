"""Builds the realistic house set for the game's towns and farms.

Eight styles (cottage, plastered house, brick house, Nordic red wooden house,
Mediterranean villa, American clapboard house with a porch, barn, apartment
block), built from code with Poly Haven photo materials (CC0, downloaded by
scripts/assets/polyhaven.py into assets-src/), each baked into one colour
texture (with soft crease shading) and one normal map, and exported together
as public/models/houses.glb. Window glass is marked in the vertex colour so
the game can light it up at night. Also writes houses.json beside the
script's output (sizes) and a preview render.

  Blender -b --factory-startup --python scripts/blender/build_houses.py [-- --only cottage --size 1024 --no-preview]

Metres, origin at the centre of the base, front faces -Y (+Z in the game).
"""
import argparse, json, math, os, sys, time
import bpy, bmesh
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
PH = os.path.join(ROOT, 'assets-src', 'polyhaven')
OUT = os.path.join(HERE, 'out')
PREVIEWS = os.path.join(HERE, 'previews')
MODELS = os.path.join(ROOT, 'public', 'models')
for d in (OUT, PREVIEWS, MODELS):
    os.makedirs(d, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--only', default='')
ap.add_argument('--size', type=int, default=1024)
ap.add_argument('--samples', type=int, default=64)
ap.add_argument('--no-preview', action='store_true')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

UP = Vector((0, 0, 1))


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (1.0,)


# ---------------- materials ----------------
# name: (Poly Haven id or None, tile size in metres, tint, roughness, rotate 90°)
def material(name, tex=None, tile=2.0, tint='#ffffff', rough=0.85, rotate=False, solid=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    m['tile'] = tile
    if tex:
        uvm = nt.nodes.new('ShaderNodeUVMap')
        uvm.uv_map = 'map'
        mapping = nt.nodes.new('ShaderNodeMapping')
        if rotate:
            mapping.inputs['Rotation'].default_value[2] = math.pi / 2
        nt.links.new(uvm.outputs['UV'], mapping.inputs['Vector'])
        img = nt.nodes.new('ShaderNodeTexImage')
        img.image = bpy.data.images.load(os.path.join(PH, tex, f'{tex}_diff_1k.jpg'), check_existing=True)
        nt.links.new(mapping.outputs['Vector'], img.inputs['Vector'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(img.outputs['Color'], mul.inputs['A'])
        mul.inputs['B'].default_value = srgb(tint)
        nt.links.new(mul.outputs['Result'], bsdf.inputs['Base Color'])
        nimg = nt.nodes.new('ShaderNodeTexImage')
        nimg.image = bpy.data.images.load(os.path.join(PH, tex, f'{tex}_nor_gl_1k.jpg'), check_existing=True)
        nimg.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mapping.outputs['Vector'], nimg.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.uv_map = 'map'
        nt.links.new(nimg.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    else:
        bsdf.inputs['Base Color'].default_value = srgb(solid or tint)
    return m


def palette():
    P = {}
    P['plaster_white'] = material('plaster_white', 'painted_plaster_wall', 2.0, '#f4f1ea')
    P['plaster_cream'] = material('plaster_cream', 'painted_plaster_wall', 2.0, '#ecdcbc')
    P['plaster_ochre'] = material('plaster_ochre', 'painted_plaster_wall', 2.0, '#dfa35f')
    P['plaster_grey'] = material('plaster_grey', 'painted_plaster_wall', 2.0, '#d6d2ca')
    P['plinth'] = material('plinth', 'painted_plaster_wall', 1.5, '#8a8680')
    P['brick'] = material('brick', 'brick_wall_006', 2.2, '#ffffff')
    P['roof_clay'] = material('roof_clay', 'clay_roof_tiles_02', 2.6, '#e6d6cc')
    P['roof_slate'] = material('roof_slate', 'grey_roof_tiles', 3.0, '#5c5e62')
    P['roof_old'] = material('roof_old', 'roof_slates_02', 3.0, '#77706a')
    P['planks_red'] = material('planks_red', 'distressed_painted_planks', 1.6, '#9a3326')
    P['planks_siding'] = material('planks_siding', 'distressed_painted_planks', 1.6, '#cdd6dc', rotate=True)
    P['planks_dark'] = material('planks_dark', 'dark_planks', 2.0, '#b89c84')
    P['trim'] = material('trim', 'distressed_painted_planks', 1.2, '#f7f5ef')
    P['trim_dark'] = material('trim_dark', 'distressed_painted_planks', 1.2, '#4b4b48')
    P['shutter'] = material('shutter', 'distressed_painted_planks', 1.0, '#5f7f5a')
    P['metal_red'] = material('metal_red', 'box_profile_metal_sheet', 2.0, '#ffffff', 0.6)
    P['metal_grey'] = material('metal_grey', 'corrugated_iron_02', 2.0, '#ffffff', 0.6)
    P['door'] = material('door', 'rough_pine_door', 2.2, '#c8a27c')
    P['glass'] = material('glass', solid='#1d2429', rough=0.1)
    P['flat'] = material('flat', 'painted_plaster_wall', 3.0, '#77746e')
    return P


# ---------------- geometry builder ----------------
class B:
    """Collects faces with a material each; planar UVs at the material's tile size."""

    def __init__(self, mats):
        self.mats = mats
        self.order = []
        self.faces = []  # (verts[list of Vector], material name, glow)

    def quad(self, vs, mat, glow=0.0, out=None):
        """A face; out: a direction it should face (the winding is fixed to match)."""
        vs = [Vector(v) for v in vs]
        if out is not None:
            n = (vs[1] - vs[0]).cross(vs[2] - vs[0])
            if len(vs) > 3 and n.length < 1e-9:
                n = (vs[2] - vs[0]).cross(vs[3] - vs[0])
            if n.dot(Vector(out)) < 0:
                vs.reverse()
        self.faces.append((vs, mat, glow))

    def solid(self, faces, mat, skip=()):
        """Faces of a closed shape, each turned to face away from its centre."""
        allv = [v for f in faces for v in f]
        c = sum(allv, Vector()) / len(allv)
        for i, f in enumerate(faces):
            if i in skip:
                continue
            fc = sum(f, Vector()) / len(f)
            self.quad(f, mat, out=fc - c)

    def box(self, c, s, mat, bottom=False, glow=0.0):
        cx, cy, cz = c
        sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
        p = [Vector((cx + dx * sx, cy + dy * sy, cz + dz * sz)) for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)]
        F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        self.solid([[p[k] for k in f] for f in F], mat, skip=() if bottom else (0,))

    def prism_x(self, x0, x1, poly, mat):
        """A solid made by sweeping a polygon in the y-z plane from x0 to x1."""
        n = len(poly)
        a = [Vector((x0, y, z)) for y, z in poly]
        b = [Vector((x1, y, z)) for y, z in poly]
        faces = [a, b] + [[a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]] for i in range(n)]
        self.solid(faces, mat)

    def slab(self, top, thick, mat, edge_mat=None):
        """A sloped roof board: top quad, with thickness straight down."""
        top = [Vector(v) for v in top]
        bot = [v - Vector((0, 0, thick)) for v in top]
        c = (sum(top, Vector()) + sum(bot, Vector())) / (2 * len(top))
        self.quad(top, mat, out=Vector((0, 0, 1)))
        self.quad(bot, edge_mat or mat, out=Vector((0, 0, -1)))
        for i in range(len(top)):
            j = (i + 1) % len(top)
            f = [bot[i], bot[j], top[j], top[i]]
            fc = sum(f, Vector()) / 4
            o = fc - c
            o.z = 0
            self.quad(f, edge_mat or mat, out=o)

    def build(self, name):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('map')
        glow = bm.loops.layers.color.new('glow')
        names = []
        for vs, mat, g in self.faces:
            if mat not in names:
                names.append(mat)
            verts = [bm.verts.new(v) for v in vs]
            try:
                f = bm.faces.new(verts)
            except ValueError:
                continue
            f.material_index = names.index(mat)
            f.normal_update()
            n = f.normal
            if abs(n.z) > 0.98:
                u, v = Vector((1, 0, 0)), Vector((0, 1, 0))
            else:
                u = UP.cross(n).normalized()
                v = n.cross(u).normalized()
            tile = self.mats[mat]['tile']
            for loop in f.loops:
                p = loop.vert.co
                loop[uvl].uv = (p.dot(u) / tile, p.dot(v) / tile)
                loop[glow] = (g, g, g, 1.0)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bm.to_mesh(me)
        bm.free()
        if 'glow' in me.color_attributes:
            me.color_attributes.active_color = me.color_attributes['glow']
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        for nme in names:
            me.materials.append(self.mats[nme])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ---------------- house parts ----------------
def window(b, wall, along, z0, w, h, st, shutters=False, frame='trim', deep=0.0):
    """A window on a wall. wall: ('y', y, outward sign) or ('x', x, sign)."""
    axis, pos, sg = wall
    o = pos + sg * 0.012

    def P(a, z, out=0.0):
        return (a, o + sg * out, z) if axis == 'y' else (o + sg * out, a, z)

    # glass
    g = [P(along - w / 2, z0), P(along + w / 2, z0), P(along + w / 2, z0 + h), P(along - w / 2, z0 + h)]
    b.quad(g, 'glass', glow=1.0, out=(0, sg, 0) if axis == 'y' else (sg, 0, 0))
    fw, fd = 0.09, 0.07

    def bar(a, z, sa, sz):
        c = P(a, z, fd / 2)
        s = (sa, fd, sz) if axis == 'y' else (fd, sa, sz)
        b.box(c, s, frame, bottom=True)
    bar(along, z0 + h + fw / 2, w + 2 * fw, fw)            # head
    bar(along - w / 2 - fw / 2, z0 + h / 2, fw, h)          # sides
    bar(along + w / 2 + fw / 2, z0 + h / 2, fw, h)
    bar(along, z0 + h * 0.62, w, 0.045)                     # transom bar
    if w > 0.8:
        bar(along, z0 + h / 2, 0.045, h)                    # mullion
    # sill
    c = P(along, z0 - 0.04, 0.09)
    b.box(c, (w + 0.3, 0.18, 0.08) if axis == 'y' else (0.18, w + 0.3, 0.08), 'plinth', bottom=True)
    if shutters:
        for s in (-1, 1):
            c = P(along + s * (w / 2 + fw + w * 0.27), z0 + h / 2, 0.03)
            b.box(c, (w * 0.5, 0.04, h + 0.1) if axis == 'y' else (0.04, w * 0.5, h + 0.1), 'shutter', bottom=True)


def door(b, wall, along, w=1.0, h=2.15, z0=0.45, mat='door', frame='trim'):
    axis, pos, sg = wall
    o = pos + sg * 0.03

    def P(a, z, out=0.0):
        return (a, o + sg * out, z) if axis == 'y' else (o + sg * out, a, z)
    c = P(along, z0 + h / 2)
    b.box(c, (w, 0.05, h) if axis == 'y' else (0.05, w, h), mat, bottom=True)
    for s in (-1, 1):
        c = P(along + s * (w / 2 + 0.06), z0 + h / 2 + 0.03, 0.03)
        b.box(c, (0.12, 0.1, h + 0.06) if axis == 'y' else (0.1, 0.12, h + 0.06), frame, bottom=True)
    c = P(along, z0 + h + 0.08, 0.03)
    b.box(c, (w + 0.36, 0.1, 0.14) if axis == 'y' else (0.1, w + 0.36, 0.14), frame, bottom=True)
    # step
    c = P(along, z0 - 0.12, 0.25)
    b.box(c, (w + 0.6, 0.5, 0.24) if axis == 'y' else (0.5, w + 0.6, 0.24), 'plinth', bottom=True)


def gable_roof(b, W, D, E, pitch, over, mat, fascia='trim'):
    t = math.tan(math.radians(pitch))
    R = E + D / 2 * t
    xe = W / 2 + over * 0.7
    ye = D / 2 + over
    ze = E - over * t
    th = 0.16
    # two boards meeting at the ridge (ridge a touch proud so they close)
    b.slab([Vector((-xe, -ye, ze)), Vector((xe, -ye, ze)), Vector((xe, 0.02, R + 0.02)), Vector((-xe, 0.02, R + 0.02))], th, mat, fascia)
    b.slab([Vector((xe, ye, ze)), Vector((-xe, ye, ze)), Vector((-xe, -0.02, R + 0.02)), Vector((xe, -0.02, R + 0.02))], th, mat, fascia)
    # ridge cap
    b.box((0, 0, R + 0.06), (2 * xe, 0.26, 0.12), mat)
    return R


def hip_roof(b, W, D, E, pitch, over, mat, fascia='trim'):
    t = math.tan(math.radians(pitch))
    xe, ye = W / 2 + over, D / 2 + over
    ze = E - over * t
    R = ze + ye * t
    rx = max(0.0, xe - ye)
    c = [Vector((-xe, -ye, ze)), Vector((xe, -ye, ze)), Vector((xe, ye, ze)), Vector((-xe, ye, ze))]
    r0, r1 = Vector((-rx, 0, R)), Vector((rx, 0, R))
    up = lambda f: (sum(f, Vector()) / len(f)) - Vector((0, 0, ze - 3))
    for f in ([c[0], c[1], r1, r0], [c[2], c[3], r0, r1], [c[1], c[2], r1], [c[3], c[0], r0]):
        b.quad(f, mat, out=up(f))
    # soffit and fascia
    dn = [v - Vector((0, 0, 0.15)) for v in c]
    b.quad(dn, fascia, out=(0, 0, -1))
    for i in range(4):
        j = (i + 1) % 4
        f = [dn[i], dn[j], c[j], c[i]]
        o = sum(f, Vector()) / 4
        o.z = 0
        b.quad(f, fascia, out=o)
    return R


def walls(b, W, D, E, mat, gable=None):
    """Walls from the plinth to the eaves; gable: ridge height for gable ends (ends at ±x)."""
    b.box((0, 0, E / 2), (W, D, E), mat)
    if gable:
        # kept just under the roof boards so the wall never pokes through the tiles
        b.prism_x(-W / 2, W / 2, [(-D / 2, E - 0.03), (D / 2, E - 0.03), (0, gable - 0.12)], mat)


def facade_windows(b, W, D, plinth, floors, storey, n_front, n_side, size, gable_R=None, shutters=False,
                   frame='trim', door_at=None, back_n=None, side_doors=False):
    ww, wh = size
    for f in range(floors):
        z0 = plinth + f * storey + 0.9 if f == 0 else plinth + f * storey + 0.75
        for side, n in (('front', n_front), ('back', back_n if back_n is not None else n_front)):
            sg = -1 if side == 'front' else 1
            for i in range(n):
                a = -W / 2 + W * (i + 0.5) / n
                if side == 'front' and f == 0 and door_at is not None and abs(a - door_at) < ww * 0.9 + 0.5:
                    continue
                window(b, ('y', sg * D / 2, sg), a, z0, ww, wh, storey, shutters, frame)
        for sg in (-1, 1):
            for i in range(n_side):
                a = -D / 2 + D * (i + 0.5) / n_side
                window(b, ('x', sg * W / 2, sg), a, z0, ww, wh, storey, shutters, frame)
    if gable_R:
        E = plinth + floors * storey
        if gable_R - E > 2.2:
            for sg in (-1, 1):
                window(b, ('x', sg * W / 2, sg), 0, E + 0.5, ww * 0.75, min(wh, (gable_R - E) * 0.45), storey, False, frame)
    if door_at is not None:
        door(b, ('y', -D / 2, -1), door_at, z0=plinth)


def chimney(b, x, y, top, mat='brick'):
    b.box((x, y, top - 2.0), (0.7, 0.6, 4.0), mat)
    b.box((x, y, top + 0.05), (0.85, 0.75, 0.12), 'plinth')


# ---------------- the house styles ----------------
def cottage(b):
    W, D, PL, ST = 9.0, 7.0, 0.45, 2.8
    E = PL + ST
    walls(b, W, D, E, 'plaster_white', gable=E + D / 2 * math.tan(math.radians(45)))
    b.box((0, 0, PL / 2), (W + 0.12, D + 0.12, PL), 'plinth')
    R = gable_roof(b, W, D, E, 45, 0.45, 'roof_clay')
    facade_windows(b, W, D, PL, 1, ST, 3, 2, (1.0, 1.25), gable_R=R, door_at=-0.6)
    chimney(b, W * 0.28, 0.9, R + 0.8)
    return dict(W=W, D=D, eave=E, ridge=R)


def plastered(b):
    W, D, PL, ST = 10.0, 8.0, 0.5, 2.75
    E = PL + 2 * ST
    walls(b, W, D, E, 'plaster_cream', gable=E + D / 2 * math.tan(math.radians(38)))
    b.box((0, 0, PL / 2), (W + 0.12, D + 0.12, PL), 'plinth')
    R = gable_roof(b, W, D, E, 38, 0.5, 'roof_slate')
    facade_windows(b, W, D, PL, 2, ST, 4, 2, (0.95, 1.35), gable_R=R, door_at=0.0)
    chimney(b, -W * 0.3, -0.8, R + 0.7, 'plaster_grey')
    return dict(W=W, D=D, eave=E, ridge=R)


def brick(b):
    W, D, PL, ST = 9.0, 8.0, 0.35, 2.7
    E = PL + 2 * ST
    walls(b, W, D, E, 'brick', gable=E + D / 2 * math.tan(math.radians(40)))
    b.box((0, 0, PL / 2), (W + 0.1, D + 0.1, PL), 'plinth')
    R = gable_roof(b, W, D, E, 40, 0.35, 'roof_old')
    facade_windows(b, W, D, PL, 2, ST, 3, 2, (1.0, 1.45), gable_R=R, door_at=2.2)
    chimney(b, W / 2 - 0.5, 0.0, R + 0.9)
    chimney(b, -W / 2 + 0.5, 0.0, R + 0.9)
    return dict(W=W, D=D, eave=E, ridge=R)


def nordic(b):
    W, D, PL, ST = 10.0, 7.5, 0.5, 2.7
    E = PL + 2 * ST
    walls(b, W, D, E, 'planks_red', gable=E + D / 2 * math.tan(math.radians(36)))
    b.box((0, 0, PL / 2), (W + 0.1, D + 0.1, PL), 'plinth')
    for x in (-1, 1):
        for y in (-1, 1):
            b.box((x * (W / 2 + 0.02), y * (D / 2 + 0.02), PL + (E - PL) / 2), (0.2, 0.2, E - PL), 'trim')
    R = gable_roof(b, W, D, E, 36, 0.45, 'roof_slate')
    facade_windows(b, W, D, PL, 2, ST, 4, 2, (0.85, 1.3), gable_R=R, door_at=-1.4)
    chimney(b, 0.6, 0.5, R + 0.6, 'plaster_grey')
    return dict(W=W, D=D, eave=E, ridge=R)


def villa(b):
    W, D, PL, ST = 10.0, 9.0, 0.35, 3.0
    E = PL + 2 * ST
    walls(b, W, D, E, 'plaster_ochre')
    b.box((0, 0, PL / 2), (W + 0.12, D + 0.12, PL), 'plinth')
    R = hip_roof(b, W, D, E, 22, 0.55, 'roof_clay', 'plaster_white')
    facade_windows(b, W, D, PL, 2, ST, 3, 3, (0.9, 1.5), shutters=True, door_at=0.0)
    chimney(b, W * 0.22, 1.2, R + 0.5, 'plaster_ochre')
    return dict(W=W, D=D, eave=E, ridge=R)


def clapboard(b):
    W, D, PL, ST = 10.0, 8.0, 0.6, 2.7
    E = PL + 2 * ST
    walls(b, W, D, E, 'planks_siding', gable=E + D / 2 * math.tan(math.radians(35)))
    b.box((0, 0, PL / 2), (W + 0.1, D + 0.1, PL), 'plinth')
    for x in (-1, 1):
        for y in (-1, 1):
            b.box((x * (W / 2 + 0.02), y * (D / 2 + 0.02), PL + (E - PL) / 2), (0.18, 0.18, E - PL), 'trim')
    R = gable_roof(b, W, D, E, 35, 0.45, 'roof_old')
    facade_windows(b, W, D, PL, 2, ST, 4, 2, (0.9, 1.45), gable_R=R, door_at=-0.2)
    # porch: deck, posts and a lean-to roof across the front
    pd = 2.2
    b.box((0, -D / 2 - pd / 2, PL - 0.1), (W * 0.8, pd, 0.2), 'planks_dark', bottom=True)
    for i in range(4):
        x = -W * 0.38 + i * W * 0.76 / 3
        b.box((x, -D / 2 - pd + 0.15, PL + 1.35), (0.16, 0.16, 2.7), 'trim')
    t = math.tan(math.radians(14))
    z1 = PL + 2.85
    b.slab([Vector((-W * 0.42, -D / 2 - pd - 0.2, z1 - (pd + 0.2) * t)), Vector((W * 0.42, -D / 2 - pd - 0.2, z1 - (pd + 0.2) * t)),
            Vector((W * 0.42, -D / 2, z1)), Vector((-W * 0.42, -D / 2, z1))], 0.12, 'roof_old', 'trim')
    chimney(b, W / 2 - 0.6, 1.0, R + 0.8)
    return dict(W=W, D=D, eave=E, ridge=R)


def barn(b):
    W, D, PL = 14.0, 10.0, 0.3
    E = 5.0
    walls(b, W, D, E, 'planks_dark', gable=E + D / 2 * math.tan(math.radians(30)))
    b.box((0, 0, PL / 2), (W + 0.1, D + 0.1, PL), 'plinth')
    R = gable_roof(b, W, D, E, 30, 0.5, 'metal_red', 'trim')
    # big doors on the gable end, small windows on the long sides
    for sg in (-1, 1):
        door(b, ('x', sg * W / 2, sg), 0.0, w=3.6, h=3.8, z0=PL, mat='planks_red', frame='trim')
    for sg in (-1, 1):
        for i in range(4):
            window(b, ('y', sg * D / 2, sg), -W / 2 + W * (i + 0.5) / 4, 2.6, 0.8, 0.7, 3, False, 'trim')
    return dict(W=W, D=D, eave=E, ridge=R)


def block(b):
    W, D, PL, ST, F = 16.0, 11.0, 0.5, 2.9, 4
    E = PL + F * ST
    walls(b, W, D, E, 'plaster_grey')
    b.box((0, 0, PL / 2), (W + 0.12, D + 0.12, PL), 'plinth')
    # flat roof with a parapet
    b.box((0, 0, E + 0.05), (W - 0.1, D - 0.1, 0.1), 'flat')
    for sx, sy, lx, ly in ((0, -1, W, 0.25), (0, 1, W, 0.25), (-1, 0, 0.25, D), (1, 0, 0.25, D)):
        b.box((sx * (W / 2 - 0.12), sy * (D / 2 - 0.12), E + 0.45), (lx, ly, 0.9), 'plaster_grey')
    facade_windows(b, W, D, PL, F, ST, 6, 3, (1.1, 1.4), frame='trim_dark', door_at=0.0)
    # balconies on the front
    for f in range(1, F):
        for i in (1, 4):
            a = -W / 2 + W * (i + 0.5) / 6
            z = PL + f * ST
            b.box((a, -D / 2 - 0.6, z + 0.05), (2.2, 1.2, 0.14), 'plaster_grey', bottom=True)
            b.box((a, -D / 2 - 1.18, z + 0.55), (2.2, 0.06, 0.9), 'trim_dark', bottom=True)
    b.box((W * 0.25, D * 0.2, E + 1.3), (2.0, 2.0, 2.6), 'plaster_grey')  # stair tower
    return dict(W=W, D=D, eave=E, ridge=E + 0.9)


def church(b):
    # the nave: long axis along x, entrance on the -x gable end
    W, D, PL = 22.0, 12.0, 0.6
    E = 9.0
    R0 = E + D / 2 * math.tan(math.radians(50))
    walls(b, W, D, E, 'plaster_white', gable=R0)
    b.box((0, 0, PL / 2), (W + 0.2, D + 0.2, PL), 'plinth')
    R = gable_roof(b, W, D, E, 50, 0.4, 'roof_slate')
    for sg in (-1, 1):
        for i in range(5):
            window(b, ('y', sg * D / 2, sg), -W / 2 + W * (i + 0.5) / 5, 2.6, 1.3, 4.6, 3, False, 'plinth')
    door(b, ('x', -W / 2, -1), 0.0, w=2.0, h=3.4, z0=PL, mat='door', frame='plinth')
    window(b, ('x', -W / 2, -1), 0.0, E + 1.2, 1.6, 2.4, 3, False, 'plinth')
    window(b, ('x', W / 2, 1), 0.0, 3.0, 2.2, 4.4, 3, False, 'plinth')
    # buttresses
    for sg in (-1, 1):
        for i in range(6):
            x = -W / 2 + W * i / 5
            b.box((x, sg * (D / 2 + 0.3), 2.6), (0.7, 0.6, 5.2), 'plinth')
    return dict(W=W, D=D, eave=E, ridge=R)


def tower(b):
    W = D = 7.0
    PL, E = 0.6, 24.0
    walls(b, W, D, E, 'plaster_white')
    b.box((0, 0, PL / 2), (W + 0.2, D + 0.2, PL), 'plinth')
    b.box((0, 0, E - 5.6), (W + 0.3, D + 0.3, 0.35), 'plinth')   # cornice under the belfry
    b.box((0, 0, E + 0.1), (W + 0.5, D + 0.5, 0.3), 'plinth')
    for axis, sg in (('y', -1), ('y', 1), ('x', -1), ('x', 1)):
        pos = sg * (D / 2 if axis == 'y' else W / 2)
        window(b, (axis, pos, sg), -1.2, E - 4.6, 1.3, 3.4, 3, False, 'plinth')   # belfry openings
        window(b, (axis, pos, sg), 1.2, E - 4.6, 1.3, 3.4, 3, False, 'plinth')
        window(b, (axis, pos, sg), 0.0, 9.0, 0.9, 2.2, 3, False, 'plinth')
    R = hip_roof(b, W, D, E, 74, 0.3, 'roof_slate', 'plinth')
    b.box((0, 0, R + 0.9), (0.12, 0.12, 1.8), 'trim_dark')            # the cross
    b.box((0, 0, R + 1.35), (0.9, 0.12, 0.12), 'trim_dark')
    return dict(W=W, D=D, eave=E, ridge=R + 1.8)


STYLES = [('cottage', cottage), ('plastered', plastered), ('brick', brick), ('nordic', nordic),
          ('villa', villa), ('clapboard', clapboard), ('barn', barn), ('block', block),
          ('church', church), ('tower', tower)]


# ---------------- bake and export ----------------
def use_gpu(scene):
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception as e:
        print('GPU not used:', e)


def bake(obj, size, name):
    scene = bpy.context.scene
    scene.cycles.samples = args.samples
    me = obj.data
    uv = me.uv_layers.new(name='bake')
    me.uv_layers.active = uv
    for o in scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    imgs = {}
    for kind in ('albedo', 'ao', 'normal'):
        im = bpy.data.images.new(f'{name}_{kind}', size, size)
        if kind != 'albedo':
            im.colorspace_settings.name = 'Non-Color'
        imgs[kind] = im

    def target(im):
        for m in me.materials:
            nodes = m.node_tree.nodes
            node = nodes.get('bake_target') or nodes.new('ShaderNodeTexImage')
            node.name = 'bake_target'
            node.image = im
            nodes.active = node
    # bake from the photo-mapped UVs into the bake UVs
    for m in me.materials:
        for n in m.node_tree.nodes:
            if n.type == 'UVMAP':
                n.uv_map = 'map'
    target(imgs['albedo'])
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=8, use_clear=True, uv_layer='bake')
    target(imgs['ao'])
    bpy.ops.object.bake(type='AO', margin=8, use_clear=True, uv_layer='bake')
    target(imgs['normal'])
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=8, use_clear=True, uv_layer='bake')
    a = np.array(imgs['albedo'].pixels[:], dtype=np.float32).reshape(-1, 4)
    o = np.array(imgs['ao'].pixels[:], dtype=np.float32).reshape(-1, 4)[:, :1]
    a[:, :3] *= 0.55 + 0.45 * o
    final = bpy.data.images.new(f'{name}_color', size, size)
    final.pixels = a.ravel()
    final.file_format = 'JPEG'
    nrm = imgs['normal']
    nrm.file_format = 'JPEG'
    # one plain material for the game: colour + normal map on the bake UVs
    game = bpy.data.materials.new(f'house_{name}')
    game.use_nodes = True
    nt = game.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    t1 = nt.nodes.new('ShaderNodeTexImage')
    t1.image = final
    nt.links.new(t1.outputs['Color'], bsdf.inputs['Base Color'])
    t2 = nt.nodes.new('ShaderNodeTexImage')
    t2.image = nrm
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(t2.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    me.materials.clear()
    me.materials.append(game)
    for p in me.polygons:
        p.material_index = 0
    me.uv_layers.remove(me.uv_layers['map'])
    me.uv_layers['bake'].active = True
    me.uv_layers['bake'].active_render = True
    # PNG copies for checking
    final.filepath_raw = os.path.join(PREVIEWS, f'house_{name}_color.png')
    final.file_format = 'PNG'
    final.save()


def preview(objs):
    scene = bpy.context.scene
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.7, 0.9, 1)
    bg.inputs['Strength'].default_value = 0.6
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=200)
    ground = bpy.context.active_object
    gm = material('ground', solid='#55663a')
    ground.data.materials.append(gm)
    x = 0
    for o in objs:
        o.location = (x, 0, 0)
        x += max(o.dimensions.x, 10) + 5
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 35
    mid = x / 2 - 7
    cam.location = (mid, -125, 38)
    cam.rotation_euler = ((Vector((mid, 0, 3)) - cam.location).to_track_quat('-Z', 'Y').to_euler())
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 600
    scene.render.filepath = os.path.join(PREVIEWS, 'houses.png')
    scene.view_settings.view_transform = 'AgX'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground)
    bpy.data.objects.remove(sun)
    for i, o in enumerate(objs):
        o.location = (i * 30, 0, 0)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
use_gpu(scene)
P = palette()
info = {}
objs = []
t0 = time.time()
for name, fn in STYLES:
    if args.only and name not in args.only.split(','):
        continue
    b = B(P)
    dims = fn(b)
    ob = b.build(f'house_{name}')
    ob.location = (len(objs) * 30, 0, 0)
    objs.append(ob)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    info[name] = {k: round(v, 3) for k, v in dims.items()}
    info[name]['triangles'] = tris
    print('BUILT', name, tris)
if not args.no_preview:
    preview(objs)
for ob in objs:
    bake(ob, args.size, ob.name.replace('house_', ''))
    print('BAKED', ob.name, round(time.time() - t0, 1))
for o in scene.objects:
    o.select_set(o in objs)
for o in objs:
    o.location = (0, 0, 0)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(MODELS, 'houses.glb'), export_format='GLB', use_selection=True, export_yup=True,
    export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=84,
    export_texcoords=True, export_normals=True, export_tangents=False,
    export_vertex_color='ACTIVE', export_all_vertex_colors=True, export_active_vertex_color_when_no_material=True, export_cameras=False, export_lights=False)
with open(os.path.join(ROOT, 'src', 'environment', 'houseSet.json'), 'w') as f:
    json.dump(info, f, indent=1)
print('HOUSES_DONE', json.dumps(info))
