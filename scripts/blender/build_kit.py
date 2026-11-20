"""Builds the Airmail model kit in Blender, renders previews and exports glTF.

Run inside Blender (Scripting tab, or through the Blender MCP connection):

    exec(open('/path/to/airmail/scripts/blender/build_kit.py').read())

It works in its own scene, "Airmail Kit", and never touches other scenes.
Outputs:
    public/models/<name>.glb          the models the game loads
    scripts/blender/previews/*.png    a render of each model, for review
"""
import importlib
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
if HERE is None:  # exec()'d from the MCP: find ourselves from the repo path given below
    HERE = KIT_DIR  # noqa: F821  (set by the caller)
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "public", "models")
PREVIEWS = os.path.join(HERE, "previews")

if HERE not in sys.path:
    sys.path.insert(0, HERE)
import kit_common, model_trees, model_house  # noqa: E402
for m in (kit_common, model_trees, model_house):
    importlib.reload(m)

SCENE = "Airmail Kit"
BUILDERS = [model_trees.build_conifer, model_trees.build_broadleaf, model_house.build_house]


def fresh_scene():
    """A brand-new kit scene, shown in the window.

    Two Blender crashes shaped this:
    - deleting objects from the scene on screen crashes its next redraw, so an
      old kit scene is only deleted once it is no longer on screen;
    - the glTF exporter crashes when run on a scene that isn't on screen, so
      the new scene is shown before anything is exported.
    Returns None when it had to switch away first; run the build again.
    """
    win = bpy.context.window
    old = bpy.data.scenes.get(SCENE)
    if old is not None:
        if win.scene == old:
            win.scene = next((sc for sc in bpy.data.scenes if sc != old), None) or bpy.data.scenes.new("Scene")
            return None
        objs = list(old.objects)
        bpy.data.scenes.remove(old)
        for o in objs:
            if o.users == 0:
                bpy.data.objects.remove(o)
        for mesh in [m for m in bpy.data.meshes if m.users == 0]:
            bpy.data.meshes.remove(mesh)
    scene = bpy.data.scenes.new(SCENE)
    scene.unit_settings.system = "METRIC"
    win.scene = scene
    return scene


def preview_stage(scene):
    """Paper-coloured ground, a low warm sun and a soft sky, like the game."""
    world = bpy.data.worlds.get("Airmail Kit Sky") or bpy.data.worlds.new("Airmail Kit Sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.78, 0.84, 0.88, 1)
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world

    ground_mesh = bpy.data.meshes.new("preview_ground")
    s = 40
    ground_mesh.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("preview_ground", ground_mesh)
    mat = bpy.data.materials.get("preview_paper") or bpy.data.materials.new("preview_paper")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.74, 0.72, 0.55, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    ground_mesh.materials.append(mat)
    scene.collection.objects.link(ground)

    sun_data = bpy.data.lights.get("preview_sun") or bpy.data.lights.new("preview_sun", "SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(6)
    sun_data.color = (1.0, 0.95, 0.86)
    sun = bpy.data.objects.new("preview_sun", sun_data)
    sun.rotation_euler = (math.radians(52), 0, math.radians(-38))
    scene.collection.objects.link(sun)

    cam_data = bpy.data.cameras.get("preview_cam") or bpy.data.cameras.new("preview_cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 900, 640
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    return cam


def frame(cam, objs):
    """Aim the camera at the objects from a three-quarter view."""
    lo = Vector((1e9, 1e9, 1e9)); hi = -lo
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    centre = (lo + hi) / 2
    size = (hi - lo).length
    direction = Vector((0.75, -1.0, 0.55)).normalized()
    cam.location = centre + direction * size * 1.55
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=scene.name)


def export(scene, obj, path):
    vl = bpy.context.view_layer
    for o in scene.objects:
        o.select_set(False)
    obj.select_set(True)
    vl.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_materials="EXPORT", export_normals=True,
        export_texcoords=True, export_vertex_color="ACTIVE", export_cameras=False, export_lights=False,
    )


def main(do_render=True, do_export=True):
    os.makedirs(MODELS, exist_ok=True)
    os.makedirs(PREVIEWS, exist_ok=True)
    scene = fresh_scene()
    if scene is None:
        return {"status": "switched away from the old kit scene; run the build again"}
    cam = preview_stage(scene)
    made = [build(scene.collection) for build in BUILDERS]
    scene.view_layers[0].update()
    report = {}
    for obj in made:
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        dims = [round(d, 2) for d in obj.dimensions]
        report[obj.name] = {"triangles": tris, "size_m": dims}
        if do_export:
            export(scene, obj, os.path.join(MODELS, f"{obj.name}.glb"))
            report[obj.name]["bytes"] = os.path.getsize(os.path.join(MODELS, f"{obj.name}.glb"))
    if do_render:
        # one render per model, then all three together
        for obj in made:
            for o in made:
                o.hide_render = o is not obj
            frame(cam, [obj])
            render(scene, os.path.join(PREVIEWS, f"{obj.name}.png"))
        spacing = [-11, 0, 12]
        for o, x in zip(made, spacing):
            o.hide_render = False
            o.location.x = x
        bpy.context.view_layer.update()
        frame(cam, made)
        render(scene, os.path.join(PREVIEWS, "kit.png"))
        for o in made:
            o.location.x = 0
    return report


result = main()
