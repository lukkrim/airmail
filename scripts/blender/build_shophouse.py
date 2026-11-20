"""Builds the detailed shop-house, renders it, bakes it and exports it.

Runs in a separate, headless Blender so long renders can't freeze or crash
the Blender you're working in:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
        --python scripts/blender/build_shophouse.py -- [--samples 128] [--no-render]

Outputs
    scripts/blender/previews/shophouse_render.png   film-quality render (Cycles)
    scripts/blender/previews/shophouse_texture.png  the baked texture
    scripts/blender/out/shophouse.blend             the full scene, to open and inspect
    public/models/house_shop.glb                    the game version
"""
import argparse
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import kit_common  # noqa: E402,F401
import kit_real  # noqa: E402
import model_shophouse  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--texture", type=int, default=2048)
args = ap.parse_args(argv)

OUT = os.path.join(HERE, "out")
PREVIEWS = os.path.join(HERE, "previews")
MODELS = os.path.join(ROOT, "public", "models")
for d in (OUT, PREVIEWS, MODELS):
    os.makedirs(d, exist_ok=True)
report = {}
t0 = time.time()


def use_gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        scene.cycles.device = "GPU"
    except Exception as ex:  # no GPU: CPU is fine, just slower
        report["gpu"] = str(ex)


def stage(scene):
    """Grass ground, a physical sky with a low warm sun, an eye-level camera."""
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    sky = nt.nodes.new("ShaderNodeTexSky")
    for kind in ("MULTIPLE_SCATTERING", "NISHITA", "SINGLE_SCATTERING"):
        try:
            sky.sky_type = kind
            break
        except TypeError:
            continue
    for prop, val in (("sun_elevation", math.radians(30)), ("sun_rotation", math.radians(140)), ("sun_disc", False)):
        if hasattr(sky, prop):
            setattr(sky, prop, val)
    nt.links.new(sky.outputs[0], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.35
    scene.world = world
    world.light_settings.distance = 0.6  # for the AO bake

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.2
    sun.data.angle = math.radians(1.5)
    sun.data.color = (1.0, 0.92, 0.8)
    sun.rotation_euler = (math.radians(60), 0, math.radians(-38))  # from the front-left, low and warm
    scene.collection.objects.link(sun)

    g = bpy.data.meshes.new("ground")
    s = 60
    g.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("ground", g)
    gm = kit_real.solid("ground", "#6f7c3c", 1.0, 0.45)
    g.materials.append(gm)
    scene.collection.objects.link(ground)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 30
    cam.location = (-7.5, -15.0, 2.4)
    target = Vector((0.2, -1.0, 3.6))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    return ground, sun


def render(scene, path):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def bake(scene, obj, size):
    """Bakes colour + weathering + crease shading into one texture for the game."""
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    mesh = obj.data
    old_uv = mesh.uv_layers.active.name
    uv = mesh.uv_layers.new(name="bake")
    mesh.uv_layers.active = uv
    for o in scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0015)
    bpy.ops.object.mode_set(mode="OBJECT")

    albedo = bpy.data.images.new("shop_albedo", size, size)
    ao = bpy.data.images.new("shop_ao", size, size)
    ao.colorspace_settings.name = "Non-Color"

    def target(image):
        for mat in mesh.materials:
            nodes = mat.node_tree.nodes
            node = nodes.get("bake_target") or nodes.new("ShaderNodeTexImage")
            node.name = "bake_target"
            node.image = image
            nodes.active = node

    target(albedo)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=6, use_clear=True)
    target(ao)
    bpy.ops.object.bake(type="AO", margin=6, use_clear=True)

    a = np.array(albedo.pixels[:], dtype=np.float32).reshape(-1, 4)
    o = np.array(ao.pixels[:], dtype=np.float32).reshape(-1, 4)[:, :1]
    a[:, :3] *= 0.68 + 0.32 * o  # gentle: the materials already darken their own creases
    final = bpy.data.images.new("house_shop_texture", size, size)
    final.pixels = a.ravel()
    final.filepath_raw = os.path.join(PREVIEWS, "shophouse_texture.png")
    final.file_format = "PNG"
    final.save()

    # one simple material for the game: the baked texture, matte
    game = bpy.data.materials.new("house_shop")
    game.use_nodes = True
    nt = game.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = final
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    game.use_backface_culling = False
    mesh.materials.clear()
    mesh.materials.append(game)
    for p in mesh.polygons:
        p.material_index = 0
    mesh.uv_layers.remove(mesh.uv_layers[old_uv])
    mesh.uv_layers["bake"].active = True
    mesh.uv_layers["bake"].active_render = True
    for attr in list(mesh.color_attributes):
        mesh.color_attributes.remove(attr)
    return final


def export(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=86,
        export_texcoords=True, export_normals=True, export_vertex_color="NONE",
        export_cameras=False, export_lights=False,
    )


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
use_gpu(scene)
lib = kit_real.library()
house = model_shophouse.build_shophouse(scene.collection, lib)
bpy.context.view_layer.update()
report["triangles"] = sum(len(p.vertices) - 2 for p in house.data.polygons)
report["size_m"] = [round(d, 2) for d in house.dimensions]
ground, sun = stage(scene)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "shophouse.blend"))
report["built_s"] = round(time.time() - t0, 1)

if not args.no_render:
    render(scene, os.path.join(PREVIEWS, "shophouse_render.png"))
    report["render_s"] = round(time.time() - t0, 1)

# the ground mustn't occlude the bake's AO underneath the plinth edge too much: keep it, it's realistic
bake(scene, house, args.texture)
report["baked_s"] = round(time.time() - t0, 1)
glb = os.path.join(MODELS, "house_shop.glb")
export(house, glb)
report["glb_bytes"] = os.path.getsize(glb)
print("SHOPHOUSE_REPORT " + json.dumps(report))
