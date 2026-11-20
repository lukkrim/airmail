"""Shared helpers for the Airmail model kit (run inside Blender via build_kit.py).

Models are built from code so they can be regenerated and tweaked. Everything
is in metres, origin at the centre of the base, Blender +Z up (the glTF
exporter turns that into +Y up for three.js). Faces are flat-shaded so the
folds read like creased paper. Colours are the game's paper inks.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

# Paper inks (sRGB hex). Material names are what the game looks for.
PALETTE = {
    "leaf_a": "#6f9c5c",
    "leaf_b": "#5f8f55",
    "leaf_c": "#86ad6a",
    "needle": "#4e7d4c",
    "trunk": "#8b6a45",
    "wall": "#f1e6cf",
    "wall_shade": "#e6d6b6",
    "roof": "#b9533f",
    "roof_dark": "#9a4434",
    "door": "#4f607f",
    "window": "#cfe0e3",   # glows warm at night in the game
    "stone": "#c9bfa9",
    "card_edge": "#f7efdc",  # the pale core of cut card, seen on edges
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    """One flat paper material per ink, reused across models."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
    h = PALETTE[name].lstrip("#")
    rgb = [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    mat.diffuse_color = (*rgb, 1.0)
    return mat


class Builder:
    """Collects parts into one mesh, each part with its own material."""

    def __init__(self, name, seed=1):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.rng = random.Random(seed)

    def _mat_index(self, mat_name):
        if mat_name not in self.mats:
            self.mats.append(mat_name)
        return self.mats.index(mat_name)

    def part(self, mat_name, make, matrix=Matrix.Identity(4), edge_mat=None):
        """make(bm) adds geometry; it's given the material and transformed.
        edge_mat: paint the thin faces (a card's cut edges) in this ink."""
        before = set(self.bm.faces)
        make(self.bm)
        new = [f for f in self.bm.faces if f not in before]
        idx = self._mat_index(mat_name)
        biggest = max((f.calc_area() for f in new), default=0)
        edge_idx = self._mat_index(edge_mat) if edge_mat else None
        for f in new:
            f.material_index = idx
            if edge_idx is not None and f.calc_area() < biggest * 0.12:
                f.material_index = edge_idx
        verts = list({v for f in new for v in f.verts})
        bmesh.ops.transform(self.bm, matrix=matrix, verts=verts)
        return verts

    def finish(self, collection, uv_metres=4.0, tone=0.07):
        """uv_metres: the game's paper grain repeats every this many metres.
        tone: how much each facet's shade varies, like hand-cut pieces."""
        bm = self.bm
        bm.normal_update()
        uv = bm.loops.layers.uv.new("UVMap")
        col = bm.loops.layers.color.new("Color")
        for f in bm.faces:
            n = f.normal
            axis = max(range(3), key=lambda i: abs(n[i]))
            shade = 1.0 - self.rng.uniform(0, tone)
            for loop in f.loops:
                c = loop.vert.co
                a, b = ((c.y, c.z), (c.x, c.z), (c.x, c.y))[axis]
                loop[uv].uv = (a / uv_metres, b / uv_metres)
                loop[col] = (shade, shade, shade, 1.0)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        mesh.color_attributes.active_color = mesh.color_attributes["Color"]
        self.bm.free()
        for p in mesh.polygons:
            p.use_smooth = False  # crisp paper folds
        for m in self.mats:
            mesh.materials.append(material(m))
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


# ---------- shapes ----------
def cone(segments, r_bottom, r_top, height, cap=True):
    def make(bm):
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments,
                              radius1=r_bottom, radius2=r_top, depth=height)
    return make


def box(sx, sy, sz):
    def make(bm):
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((sx, sy, sz, 1)))
    return make


def ico(subdiv, radius):
    def make(bm):
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    return make


def prism(points_yz, length):
    """Extrudes a 2D profile (y, z) along X, centred on x = 0."""
    def make(bm):
        half = length / 2
        left = [bm.verts.new((-half, y, z)) for y, z in points_yz]
        right = [bm.verts.new((half, y, z)) for y, z in points_yz]
        bm.faces.new(list(reversed(left)))
        bm.faces.new(right)
        n = len(points_yz)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((left[i], left[j], right[j], right[i]))
    return make


def jitter(verts, rng, amount, keep_base=True):
    """Small hand-folded irregularity."""
    for v in verts:
        if keep_base and v.co.z < 1e-4:
            continue
        v.co.x += rng.uniform(-amount, amount)
        v.co.y += rng.uniform(-amount, amount)
        v.co.z += rng.uniform(-amount, amount) * 0.5


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation(Vector((x, y, z)))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)
