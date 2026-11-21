"""Bakes a Poly Haven tree into an impostor: 8 x 8 views from a hemisphere
of directions (hemi-octahedral layout), as an albedo atlas (with a little
ambient occlusion and alpha) and a normal atlas. The game draws each tree as
one camera-facing quad that shows the view nearest the camera's direction.

  Blender -b assets-src/polyhaven/fir_tree_01/fir_tree_01_1k.blend \
      --python scripts/blender/bake_impostors.py -- fir_tree_01_a_LOD1 fir_a

Writes scripts/blender/out/impostors/<name>/{albedo,normal}_<i>_<j>.png and
<name>.json (centre and radius, in game axes: x, y up, z = -blender y).
prepare_impostors.py stitches the frames into public/models/impostors/.
"""
import bpy, json, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OBJ, NAME = argv[0], argv[1]
N = 8          # frames per side
RES = 256      # pixels per frame
SAMPLES = int(argv[2]) if len(argv) > 2 else 24
OUT = os.path.join(os.path.dirname(__file__), 'out', 'impostors', NAME)
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
target = bpy.data.objects[OBJ]
for o in scene.objects:
    o.hide_render = o is not target
target.hide_render = False
# the tree must not be hidden by its collection either
for c in target.users_collection:
    c.hide_render = False
def unexclude(lc):
    for ch in lc.children:
        if any(o is target for o in ch.collection.all_objects):
            ch.exclude = False
        unexclude(ch)
unexclude(bpy.context.view_layer.layer_collection)

# bounds (world), in blender axes
dg = bpy.context.evaluated_depsgraph_get()
ev = target.evaluated_get(dg)
pts = [ev.matrix_world @ v.co for v in ev.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2
radius = max((p - centre).length for p in pts) * 1.01
# every view's horizontal axis is level, so the frame only needs to be as
# wide as the tree's widest horizontal reach: frames are narrow for tall trees
reach = max(math.hypot(p.x - centre.x, p.y - centre.y) for p in pts) * 1.02
FW = max(32, int(math.ceil(RES * reach / radius / 8)) * 8)
base_z = lo.z

# ---- render settings ----
r = scene.render
r.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 2
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU not used:', e)
r.resolution_x = FW
r.resolution_y = RES
r.resolution_percentage = 100
r.film_transparent = True
r.use_persistent_data = True
r.image_settings.file_format = 'PNG'
r.image_settings.color_mode = 'RGBA'
r.image_settings.color_depth = '8'
scene.world = scene.world or bpy.data.worlds.new('w')
scene.world.use_nodes = True

cam_data = bpy.data.cameras.new('impostor_cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = radius * 2  # the frame's height (the longer side)
cam_data.sensor_fit = 'VERTICAL'
cam_data.clip_start = 0.01
cam_data.clip_end = radius * 6
cam = bpy.data.objects.new('impostor_cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# ---- materials: albedo (with AO) or normal, as emission over transparency ----
mats = [s.material for s in target.material_slots if s.material]
originals = {}
def principled(m):
    """The node holding the surface inputs: a Principled BSDF, or a node
    group with Diffuse / Alpha / Normal inputs (Poly Haven leaves)."""
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    for n in m.node_tree.nodes:
        if n.type == 'GROUP' and 'Diffuse' in n.inputs:
            return n
    return None

def socket(p, *names):
    for k in names:
        if p is not None and k in p.inputs:
            return p.inputs[k]
    return None

def build(m, mode):
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    if m.name not in originals:
        originals[m.name] = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
    p = principled(m)
    L = nt.links
    transp = nt.nodes.new('ShaderNodeBsdfTransparent')
    emit = nt.nodes.new('ShaderNodeEmission')
    mix = nt.nodes.new('ShaderNodeMixShader')
    alpha_in = socket(p, 'Alpha')
    if alpha_in is not None and alpha_in.links:
        L.new(alpha_in.links[0].from_socket, mix.inputs['Fac'])
    else:
        mix.inputs['Fac'].default_value = alpha_in.default_value if alpha_in else 1.0
    if mode == 'albedo':
        base = socket(p, 'Base Color', 'Diffuse')
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
        ao.samples = 16
        ao.inputs['Distance'].default_value = radius * 0.12
        rng = nt.nodes.new('ShaderNodeMapRange')
        rng.inputs['To Min'].default_value = 0.3
        L.new(ao.outputs['AO'], rng.inputs['Value'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        if base is not None and base.links:
            L.new(base.links[0].from_socket, mul.inputs['A'])
        else:
            mul.inputs['A'].default_value = base.default_value if base else (0.5, 0.5, 0.5, 1)
        L.new(rng.outputs['Result'], mul.inputs['B'])
        L.new(mul.outputs['Result'], emit.inputs['Color'])
    else:
        nin = socket(p, 'Normal')
        if nin is not None and nin.links:
            src = nin.links[0].from_socket
            if src.node.type == 'TEX_IMAGE':  # a raw normal-map image: decode it
                nm = nt.nodes.new('ShaderNodeNormalMap')
                L.new(src, nm.inputs['Color'])
                src = nm.outputs['Normal']
        else:
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            src = geo.outputs['Normal']
        ma = nt.nodes.new('ShaderNodeVectorMath')
        ma.operation = 'MULTIPLY_ADD'
        ma.inputs[1].default_value = (0.5, 0.5, 0.5)
        ma.inputs[2].default_value = (0.5, 0.5, 0.5)
        L.new(src, ma.inputs[0])
        L.new(ma.outputs['Vector'], emit.inputs['Color'])
    L.new(transp.outputs[0], mix.inputs[1])
    L.new(emit.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs['Surface'])
    m['impostor_nodes'] = [transp.name, emit.name, mix.name]

def decode(u, v):
    """Grid position (0..1) to a direction in game axes (y up)."""
    ox, oy = u * 2 - 1, v * 2 - 1
    x, z = (ox + oy) * 0.5, (ox - oy) * 0.5
    y = 1 - abs(x) - abs(z)
    d = Vector((x, max(y, 0.0), z))
    return d.normalized()

def g2b(v):
    return Vector((v.x, -v.z, v.y))

def frame_basis(d):
    up_w = Vector((0, 1, 0)) if abs(d.y) < 0.999 else Vector((0, 0, -1))
    right = up_w.cross(d).normalized()
    up = d.cross(right).normalized()
    return right, up

def render(mode):
    for m in mats:
        build(m, mode)
    vs = scene.view_settings
    vs.view_transform = 'Standard' if mode == 'albedo' else 'Raw'
    vs.look = 'None'
    vs.exposure = 0
    vs.gamma = 1
    for j in range(N):
        for i in range(N):
            d = decode((i + 0.5) / N, (j + 0.5) / N)
            right, up = frame_basis(d)
            rb, ub, db = g2b(right), g2b(up), g2b(d)
            m = Matrix((rb, ub, db)).transposed().to_4x4()
            m.translation = centre + db * radius * 3
            cam.matrix_world = m
            r.filepath = os.path.join(OUT, f'{mode}_{i}_{j}.png')
            bpy.ops.render.render(write_still=True)

render('albedo')
render('normal')
c = Vector((centre.x, centre.z - base_z, -centre.y))
with open(os.path.join(OUT, '..', f'{NAME}.json'), 'w') as f:
    json.dump({'name': NAME, 'object': OBJ, 'grid': N, 'frame': [FW, RES], 'halfWidth': round(radius * FW / RES, 4),
               'centre': [round(c.x, 4), round(c.y, 4), round(c.z, 4)],
               'radius': round(radius, 4), 'height': round(hi.z - lo.z, 4),
               'width': round(max(hi.x - lo.x, hi.y - lo.y), 4)}, f)
print('IMPOSTOR DONE', NAME)
