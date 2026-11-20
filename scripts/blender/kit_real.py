"""Realistic procedural materials for the detailed models (no image files).

Each material is a small node tree around Principled BSDF: colour variation
from noise, grime towards the ground, ambient-occlusion darkening in creases,
and fine bump. The game can't run these node trees, so build_shophouse.py
bakes them into a single texture for the game version.
"""
import bpy

from kit_common import srgb_to_linear


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return (*[srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)], 1.0)


class Nodes:
    def __init__(self, mat):
        self.t = mat.node_tree
        self.n = self.t.nodes
        self.l = self.t.links
        self.n.clear()
        self.out = self.add("ShaderNodeOutputMaterial", 900, 0)
        self.bsdf = self.add("ShaderNodeBsdfPrincipled", 600, 0)
        self.link(self.bsdf, "BSDF", self.out, "Surface")
        self.coord = self.add("ShaderNodeTexCoord", -900, 0)

    def add(self, kind, x=0, y=0, **inputs):
        node = self.n.new(kind)
        node.location = (x, y)
        for k, v in inputs.items():
            node.inputs[k].default_value = v
        return node

    def link(self, a, out, b, inp):
        self.l.new(a.outputs[out], b.inputs[inp])

    def noise(self, scale, detail=6.0, rough=0.6, x=-600, y=0, coords="Object"):
        n = self.add("ShaderNodeTexNoise", x, y)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        self.link(self.coord, coords, n, "Vector")
        return n

    def ramp(self, fac_socket, c0, c1, x=-300, y=0, p0=0.3, p1=0.7):
        r = self.add("ShaderNodeValToRGB", x, y)
        r.color_ramp.elements[0].position = p0
        r.color_ramp.elements[0].color = rgb(c0)
        r.color_ramp.elements[1].position = p1
        r.color_ramp.elements[1].color = rgb(c1)
        self.l.new(fac_socket, r.inputs["Fac"])
        return r

    def mix(self, a_socket, b_socket, fac, blend="MIX", x=200, y=0):
        m = self.add("ShaderNodeMix", x, y)
        m.data_type = "RGBA"
        m.blend_type = blend
        if isinstance(fac, float):
            m.inputs["Factor"].default_value = fac
        else:
            self.l.new(fac, m.inputs["Factor"])
        self.l.new(a_socket, m.inputs[6])
        self.l.new(b_socket, m.inputs[7])
        return m

    def colour(self, hexstr, x=-100, y=0):
        node = self.add("ShaderNodeRGB", x, y)
        node.outputs[0].default_value = rgb(hexstr)
        return node.outputs[0]

    def grime(self, colour_socket, height=1.2, dark="#5e584c", amount=0.55, ao_amount=0.65, x=350, y=200):
        """Darker towards the ground (splash, dirt), plus darkening in creases."""
        sep = self.add("ShaderNodeSeparateXYZ", -600, y + 300)
        self.link(self.coord, "Object", sep, "Vector")
        mr = self.add("ShaderNodeMapRange", -350, y + 300)
        mr.inputs["From Min"].default_value = height
        mr.inputs["From Max"].default_value = 0.0
        mr.inputs["To Max"].default_value = amount
        self.link(sep, "Z", mr, "Value")
        ground = self.mix(colour_socket, self.colour(dark, -100, y + 420), mr.outputs["Result"], "MIX", x - 150, y)
        ao = self.add("ShaderNodeAmbientOcclusion", -100, y - 250)
        ao.inputs["Distance"].default_value = 0.35
        return self.mix(ground.outputs[2], ao.outputs["Color"], ao_amount, "MULTIPLY", x, y).outputs[2]

    def bump(self, height_socket, strength=0.2, distance=0.02):
        b = self.add("ShaderNodeBump", 300, -350)
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.l.new(height_socket, b.inputs["Height"])
        self.link(b, "Normal", self.bsdf, "Normal")


def _new(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat


def plaster(name="plaster", c0="#d7cfbe", c1="#eee8da"):
    mat = _new(name); g = Nodes(mat)
    blot = g.noise(4.0, 8, 0.65, y=200)
    col = g.ramp(blot.outputs["Fac"], c0, c1, y=200)
    final = g.grime(col.outputs[0], height=1.6, dark="#6f6656", amount=0.6)
    g.l.new(final, g.bsdf.inputs["Base Color"])
    g.bsdf.inputs["Roughness"].default_value = 0.92
    g.bump(g.noise(60.0, 4, 0.7, y=-450).outputs["Fac"], 0.25)
    return mat


def wood(name="wood", c0="#4c3322", c1="#7a5839"):
    """Weathered timber: fine grain streaks running along Z, knots of colour."""
    mat = _new(name); g = Nodes(mat)
    stretch = g.add("ShaderNodeMapping", -750, 200)
    stretch.inputs["Scale"].default_value = (14.0, 14.0, 0.9)
    g.link(g.coord, "Object", stretch, "Vector")
    grain = g.add("ShaderNodeTexNoise", -550, 200)
    grain.inputs["Scale"].default_value = 6.0
    grain.inputs["Detail"].default_value = 10.0
    grain.inputs["Roughness"].default_value = 0.7
    g.link(stretch, "Vector", grain, "Vector")
    col = g.ramp(grain.outputs["Fac"], c0, c1, y=200, p0=0.25, p1=0.75)
    blotch = g.noise(1.2, 4, 0.5, y=-60)
    weather = g.add("ShaderNodeMath", -250, -60)   # silvery weathering in patches
    weather.operation = "MULTIPLY"
    weather.inputs[1].default_value = 0.35
    g.link(blotch, "Fac", weather, 0)
    patchy = g.mix(col.outputs[0], g.colour("#8f8a7c", -100, -150), weather.outputs[0], "MIX", 50, 100)
    final = g.grime(patchy.outputs[2], height=0.8, dark="#3a2e24", amount=0.4)
    g.l.new(final, g.bsdf.inputs["Base Color"])
    g.bsdf.inputs["Roughness"].default_value = 0.85
    g.bump(grain.outputs["Fac"], 0.25)
    return mat


def tile(name="tile"):
    mat = _new(name); g = Nodes(mat)
    var = g.noise(2.2, 2, 0.5, y=200)            # tile-to-tile shade
    col = g.ramp(var.outputs["Fac"], "#3a322d", "#6b5f55", y=200)
    moss_n = g.noise(1.1, 6, 0.7, y=-100)
    moss_f = g.add("ShaderNodeMapRange", -350, -100)
    moss_f.inputs["From Min"].default_value = 0.55
    moss_f.inputs["From Max"].default_value = 0.72
    g.link(moss_n, "Fac", moss_f, "Value")
    moss = g.mix(col.outputs[0], g.colour("#5c6638", -100, -250), moss_f.outputs["Result"], "MIX", 0, 0)
    ao = g.add("ShaderNodeAmbientOcclusion", -100, -450)
    ao.inputs["Distance"].default_value = 0.2
    final = g.mix(moss.outputs[2], ao.outputs["Color"], 0.75, "MULTIPLY", 300, 0)
    g.l.new(final.outputs[2], g.bsdf.inputs["Base Color"])
    g.bsdf.inputs["Roughness"].default_value = 0.55
    g.bump(g.noise(30, 3, 0.5, y=-600).outputs["Fac"], 0.12)
    return mat


def metal(name="metal"):
    mat = _new(name); g = Nodes(mat)
    rust_n = g.noise(2.5, 10, 0.75, y=200)
    rf = g.add("ShaderNodeMapRange", -350, 200)
    rf.inputs["From Min"].default_value = 0.45
    rf.inputs["From Max"].default_value = 0.68
    g.link(rust_n, "Fac", rf, "Value")
    m = g.mix(g.colour("#8b8e8c", -100, 350), g.colour("#7b4024", -100, 150), rf.outputs["Result"], "MIX", 100, 200)
    final = g.grime(m.outputs[2], height=0.6, dark="#4d4a46", amount=0.2, ao_amount=0.5)
    g.l.new(final, g.bsdf.inputs["Base Color"])
    g.bsdf.inputs["Roughness"].default_value = 0.6
    g.bsdf.inputs["Metallic"].default_value = 0.25
    return mat


def solid(name, hexcol, rough=0.8, noise_amt=0.12):
    mat = _new(name); g = Nodes(mat)
    n = g.noise(5.0, 6, 0.6, y=200)
    dark = "#" + "".join("%02x" % int(int(hexcol[i:i + 2], 16) * (1 - noise_amt)) for i in (1, 3, 5))
    col = g.ramp(n.outputs["Fac"], dark, hexcol, y=200)
    final = g.grime(col.outputs[0], height=0.6, dark="#4a453c", amount=0.35)
    g.l.new(final, g.bsdf.inputs["Base Color"])
    g.bsdf.inputs["Roughness"].default_value = rough
    return mat


def glass(name="glass"):
    mat = _new(name); g = Nodes(mat)
    g.n.remove(g.coord)
    g.bsdf.inputs["Base Color"].default_value = rgb("#33434b")
    g.bsdf.inputs["Roughness"].default_value = 0.04
    g.bsdf.inputs["Specular IOR Level"].default_value = 0.8
    return mat


def leaf(name="leaf"):
    mat = _new(name); g = Nodes(mat)
    n = g.noise(8.0, 4, 0.6, y=200)
    col = g.ramp(n.outputs["Fac"], "#3f5a22", "#7f9b45", y=200)
    ao = g.add("ShaderNodeAmbientOcclusion", -100, -250)
    ao.inputs["Distance"].default_value = 0.4
    final = g.mix(col.outputs[0], ao.outputs["Color"], 0.8, "MULTIPLY", 300, 0)
    g.l.new(final.outputs[2], g.bsdf.inputs["Base Color"])
    g.bsdf.inputs["Roughness"].default_value = 0.65
    return mat


def library():
    """Name → material for every surface the detailed models use."""
    return {
        "plaster": plaster(),
        "plaster_side": plaster("plaster_side", "#cfc6b3", "#e6dfcf"),
        "wood": wood(),
        "wood_light": wood("wood_light", "#806649", "#b09875"),
        "tile": tile(),
        "metal": metal(),
        "glass": glass(),
        "interior": solid("interior", "#1d1916", 0.9, 0.3),
        "stone": solid("stone", "#a7a194", 0.9, 0.25),
        "concrete": solid("concrete", "#b5afa3", 0.9, 0.15),
        "terracotta": solid("terracotta", "#a45a3d", 0.85, 0.2),
        "sign_red": solid("sign_red", "#a8342c", 0.6, 0.1),
        "sign_cream": solid("sign_cream", "#efe4cc", 0.7, 0.08),
        "dark": solid("dark", "#2a2826", 0.6, 0.1),
        "leaf": leaf(),
    }
