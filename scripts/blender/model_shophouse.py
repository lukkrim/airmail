"""A detailed two-storey shop-house, in the spirit of an old Japanese street
shop: lattice storefront, plaster upper floor, clay-tile roof, rusty
corrugated awning, utility pole with sagging wires, ivy and pots.

Metres, origin at the centre of the base (top of the ground), front faces −Y.
"""
import math

from mathutils import Matrix, Vector

from kit_common import Builder, box, cone, ico, prism, T, R

W, D = 7.2, 6.0          # footprint: width (x), depth (y)
FL = 0.3                 # floor level (top of the stone plinth)
H1, H2 = 3.0, 2.7        # ground and upper storey heights
HW = H1 + H2
PITCH = 24.0
OVER = 0.7               # roof overhang
FRONT = -D / 2


# ---------- small geometry helpers ----------
def mesh(verts, faces):
    def make(bm):
        vs = [bm.verts.new(v) for v in verts]
        for f in faces:
            bm.faces.new([vs[i] for i in f])
    return make


def basis(origin, ex, ey, ez):
    """Matrix placing local x/y/z axes at origin."""
    m = Matrix((ex, ey, ez)).transposed().to_4x4()
    m.translation = origin
    return m


def tube_between(b, mat, p0, p1, r, seg=6):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    if length < 1e-4:
        return
    rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    b.part(mat, cone(seg, r, r, length, cap=True), Matrix.Translation((p0 + p1) / 2) @ rot)


def curved_tile(width=0.3, length=0.34, bulge=0.09, n=6):
    """One clay roof tile: an arched strip, open underneath (a deck sits below)."""
    verts, faces = [], []
    for j, y in enumerate((0.0, length)):
        for i in range(n + 1):
            a = math.pi * i / n
            verts.append((-math.cos(a) * width / 2, y, math.sin(a) * bulge))
    for i in range(n):
        faces.append((i, i + 1, n + 2 + i, n + 1 + i))
    return mesh(verts, faces)


def corrugated(width, depth, pitch=0.08, amp=0.022):
    """A corrugated sheet in the XY plane, waves running along X."""
    n = int(width / (pitch / 4))
    verts, faces = [], []
    for row, y in enumerate((0.0, -depth)):
        for i in range(n + 1):
            x = -width / 2 + width * i / n
            verts.append((x, y, amp * math.sin(2 * math.pi * x / pitch)))
    for i in range(n):
        faces.append((i, i + 1, n + 2 + i, n + 1 + i))
    return mesh(verts, faces)


def leaf_card(size):
    """One leaf: a flat pointed diamond, two triangles, slightly cupped."""
    w, l = size * 0.6, size
    return mesh([(0, 0, 0), (w / 2, l * 0.42, l * 0.06), (0, l, 0), (-w / 2, l * 0.42, l * 0.06)],
                [(0, 1, 2), (0, 2, 3)])


def leaves(b, rng, centre, count, spread, rmin=0.09, rmax=0.22, sink=0.0):
    """Clumps of individual leaves (count clumps, each about rmax across)."""
    cx, cy, cz = centre
    sx, sy, sz = spread
    for _ in range(count):
        r = rng.uniform(rmin, rmax)
        hub = Vector((cx + rng.uniform(-sx, sx), cy + rng.uniform(-sy, sy), cz + rng.uniform(-sz, sz) - sink))
        for _ in range(max(5, int(r * 70))):
            off = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.8, 1))) * r
            rot = (Matrix.Rotation(rng.uniform(0, 6.283), 4, "Z") @ Matrix.Rotation(rng.uniform(0.3, 1.4), 4, "X"))
            b.part("leaf", leaf_card(rng.uniform(0.07, 0.12)), Matrix.Translation(hub + off) @ rot)


# ---------- the house ----------
def build_shophouse(collection, materials, seed=11):
    b = Builder("house_shop", seed)
    rng = b.rng
    pr = math.radians(PITCH)
    ridge = (D / 2) * math.tan(pr)
    top = FL + HW

    # stone plinth (deep, so it sits on sloping ground)
    b.part("stone", box(W + 0.4, D + 0.4, 1.3), T(z=FL - 0.65))

    # walls: plaster mass with gable ends
    profile = [(-D / 2, FL), (D / 2, FL), (D / 2, top), (0.0, top + ridge), (-D / 2, top)]
    b.part("plaster", prism(profile, W))

    # timber frame: corner posts, floor band, top plates
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.part("wood", box(0.24, 0.24, HW), T(sx * W / 2, sy * D / 2, FL + HW / 2))
    b.part("wood", box(W + 0.12, 0.18, 0.3), T(y=FRONT - 0.05, z=FL + H1))
    b.part("wood", box(W + 0.12, 0.18, 0.24), T(y=FRONT - 0.05, z=top - 0.12))
    b.part("wood", box(W + 0.12, 0.18, 0.3), T(y=D / 2 + 0.05, z=FL + H1))
    for sx in (-1, 1):
        b.part("wood", box(0.18, D + 0.12, 0.3), T(x=sx * (W / 2 + 0.05), z=FL + H1))

    # ---- ground floor: four bays, three lattice doors and an open shop ----
    b.part("interior", box(W - 0.3, 0.06, H1 - 0.15), T(y=FRONT - 0.03, z=FL + (H1 - 0.15) / 2))
    bays = 4
    bw = (W - 0.3) / bays
    x0 = -W / 2 + 0.15
    for k in range(bays + 1):
        b.part("wood", box(0.16, 0.22, H1), T(x0 + k * bw, FRONT - 0.08, FL + H1 / 2))
    for k in range(bays):
        cx = x0 + (k + 0.5) * bw
        if k == bays - 1:
            # open bay: shelves of goods inside, a counter outside
            for z in (FL + 0.9, FL + 1.6, FL + 2.2):
                b.part("wood_light", box(bw - 0.3, 0.35, 0.05), T(cx, FRONT + 0.25, z))
                for i in range(5):
                    b.part(rng.choice(["sign_cream", "terracotta", "leaf", "sign_red"]),
                           box(0.18, 0.18, rng.uniform(0.15, 0.32)),
                           T(cx - bw / 2 + 0.35 + i * 0.25, FRONT + 0.25, z + 0.12))
            continue
        b.part("wood", box(bw - 0.16, 0.08, 0.45), T(cx, FRONT - 0.07, FL + 0.225))
        b.part("wood", box(bw - 0.16, 0.1, 0.1), T(cx, FRONT - 0.09, FL + 0.5))
        b.part("wood", box(bw - 0.16, 0.1, 0.12), T(cx, FRONT - 0.09, FL + H1 - 0.35))
        slats = int((bw - 0.2) / 0.075)
        for i in range(slats):
            sx = cx - (bw - 0.2) / 2 + (i + 0.5) * (bw - 0.2) / slats
            b.part("wood_light", box(0.03, 0.04, H1 - 0.95), T(sx, FRONT - 0.1, FL + 0.55 + (H1 - 0.95) / 2))
    # counter with goods in front of the open bay
    ccx = x0 + (bays - 0.5) * bw
    b.part("wood", box(1.5, 0.6, 0.08), T(ccx, FRONT - 0.55, FL + 0.82))
    for dx in (-0.65, 0.65):
        for dy in (-0.22, 0.22):
            b.part("wood", box(0.06, 0.06, 0.82), T(ccx + dx, FRONT - 0.55 + dy, FL + 0.41))
    for i in range(6):
        b.part(rng.choice(["terracotta", "sign_cream", "leaf"]), box(0.2, 0.2, rng.uniform(0.12, 0.25)),
               T(ccx - 0.55 + i * 0.22, FRONT - 0.55 + rng.uniform(-0.12, 0.12), FL + 0.92))

    # ---- awning: rusty corrugated sheet on brackets ----
    aw_depth, aw_slope = 1.45, math.radians(13)
    aw_z = FL + H1 + 0.4
    b.part("metal", corrugated(W + 0.7, aw_depth),
           T(y=FRONT - 0.05, z=aw_z) @ R("X", math.degrees(aw_slope)))  # tips down and out
    edge_y = FRONT - 0.05 - aw_depth * math.cos(aw_slope)
    edge_z = aw_z - aw_depth * math.sin(aw_slope)
    b.part("wood", box(W + 0.7, 0.08, 0.14), T(y=edge_y, z=edge_z - 0.05))
    for x in (-W / 2 + 0.2, 0.0, W / 2 - 0.2):
        tube_between(b, "wood", (x, FRONT - 0.1, FL + H1 - 0.45), (x, edge_y + 0.1, edge_z - 0.08), 0.045, 4)

    # ---- upper floor: windows, sills, a planter ----
    def window(cx, y, w, h, cz, face=-1, sideways=False):
        d = 0.12
        if sideways:
            put = lambda x, z, sx, sz, mat, dy=0.0: b.part(mat, box(d, sx, sz), T(cx + face * dy, x, z))
        else:
            put = lambda x, z, sx, sz, mat, dy=0.0: b.part(mat, box(sx, d, sz), T(x, y + face * dy, z))
        base = cx if not sideways else y
        put(base, cz, w, h, "glass", 0.01)
        put(base, cz + h / 2, w + 0.12, 0.1, "wood", 0.06)
        put(base, cz - h / 2, w + 0.12, 0.1, "wood", 0.06)
        put(base - w / 2, cz, 0.1, h, "wood", 0.06)
        put(base + w / 2, cz, 0.1, h, "wood", 0.06)
        for f in (-1 / 6, 1 / 6):
            put(base + f * w * 3 / 2 * 0.66, cz, 0.04, h, "wood_light", 0.07)
        put(base, cz + h * 0.1, w, 0.04, "wood_light", 0.07)
        put(base, cz - h / 2 - 0.08, w + 0.3, 0.06, "wood", 0.14)

    wz = FL + H1 + 1.35
    window(-1.65, FRONT - 0.02, 1.9, 1.1, wz)
    window(1.7, FRONT - 0.02, 1.6, 1.1, wz)
    window(-1.6, D / 2 + 0.02, 1.6, 1.0, wz, face=1)
    window(1.6, D / 2 + 0.02, 1.6, 1.0, wz, face=1)
    window(W / 2 + 0.02, 0.6, 1.3, 1.0, wz, face=1, sideways=True)
    window(-W / 2 - 0.02, -0.8, 0.9, 0.8, FL + 1.6, face=-1, sideways=True)
    # planter box under the left window, overflowing
    b.part("wood", box(1.8, 0.38, 0.32), T(-1.65, FRONT - 0.3, wz - 0.72))
    leaves(b, rng, (-1.65, FRONT - 0.32, wz - 0.42), 26, (0.85, 0.16, 0.12))
    leaves(b, rng, (-1.65, FRONT - 0.5, wz - 0.75), 10, (0.8, 0.05, 0.25), 0.07, 0.14)

    # ---- roof: deck, ~700 clay tiles, ridge, end ornaments, fascia, gutter ----
    ridge_z = top + ridge + 0.14
    slope_len = (D / 2 + OVER) / math.cos(pr)
    span = W + 2 * OVER
    for s in (-1, 1):
        down = Vector((0, s * math.cos(pr), -math.sin(pr)))
        normal = Vector((0, s * math.sin(pr), math.cos(pr)))
        mid = Vector((0, 0, ridge_z)) + down * (slope_len / 2)
        b.part("wood", box(span, slope_len, 0.09), Matrix.Translation(mid - normal * 0.05) @ R("X", -s * PITCH))
        rows = int((slope_len - 0.15) / 0.27)
        cols = int(span / 0.29)
        for r in range(rows):
            for c in range(cols):
                x = -span / 2 + 0.15 + c * 0.29 + rng.uniform(-0.008, 0.008)
                origin = Vector((x, 0, ridge_z)) + down * (0.12 + r * 0.27) + normal * 0.02
                ex = Vector((1, 0, 0))
                ey = down
                ez = normal
                tilt = Matrix.Rotation(math.radians(rng.uniform(-1.2, 1.2)), 4, "Y")
                b.part("tile", curved_tile(), basis(origin, ex, ey, ez) @ tilt)
        # fascia board along the eave, and a gutter on the front
        eave = Vector((0, 0, ridge_z)) + down * slope_len
        b.part("wood", box(span, 0.06, 0.22), Matrix.Translation(eave + Vector((0, s * 0.03, -0.12))))
        if s < 0:
            tube_between(b, "metal", (-span / 2, eave.y - 0.08, eave.z - 0.2), (span / 2, eave.y - 0.08, eave.z - 0.2), 0.065, 6)
            dx = span / 2 - 0.25
            tube_between(b, "metal", (dx, eave.y - 0.08, eave.z - 0.2), (dx, eave.y - 0.08, 0.1), 0.045, 6)
        # barge boards up the gable ends
        for gx in (-span / 2, span / 2):
            b.part("wood", box(0.06, slope_len, 0.24),
                   Matrix.Translation(Vector((gx, 0, ridge_z)) + down * (slope_len / 2) - normal * 0.02) @ R("X", -s * PITCH))
    tube_between(b, "tile", (-span / 2 - 0.05, 0, ridge_z + 0.12), (span / 2 + 0.05, 0, ridge_z + 0.12), 0.14, 8)
    b.part("tile", box(span, 0.3, 0.16), T(z=ridge_z + 0.02))
    for gx in (-span / 2 - 0.08, span / 2 + 0.08):
        b.part("tile", box(0.14, 0.55, 0.6), T(gx, 0, ridge_z + 0.25))

    # ---- shop sign hanging off the awning ----
    sx_, sy_ = W / 2 - 0.55, edge_y - 0.1
    b.part("sign_red", box(0.46, 0.07, 1.5), T(sx_, sy_, edge_z - 0.95))
    b.part("sign_cream", box(0.34, 0.075, 1.25), T(sx_, sy_ - 0.003, edge_z - 0.95))
    b.part("dark", box(0.04, 0.04, 0.2), T(sx_, sy_, edge_z - 0.12))

    # ---- air conditioner on the right wall ----
    b.part("concrete", box(0.32, 0.85, 0.6), T(W / 2 + 0.22, -1.4, FL + H1 + 0.7))
    b.part("dark", box(0.02, 0.6, 0.45), T(W / 2 + 0.39, -1.4, FL + H1 + 0.7))
    tube_between(b, "dark", (W / 2 + 0.2, -0.95, FL + H1 + 0.5), (W / 2 + 0.2, -0.95, FL + 0.1), 0.025, 4)

    # ---- utility pole with transformer and sagging wires ----
    px, py = -W / 2 - 1.3, FRONT - 1.7
    b.part("concrete", cone(10, 0.16, 0.11, 9.6), T(px, py, 4.3))
    b.part("wood", box(1.9, 0.12, 0.12), T(px, py, 8.4))
    for ix in (-0.8, 0.0, 0.8):
        b.part("dark", cone(6, 0.05, 0.04, 0.14), T(px + ix, py, 8.53))
    b.part("metal", cone(10, 0.3, 0.3, 0.95), T(px + 0.42, py, 6.6))
    b.part("dark", box(0.08, 0.08, 0.6), T(px + 0.42, py, 6.0))
    leaves(b, rng, (px, py, 0.5), 22, (0.35, 0.35, 0.5), 0.08, 0.2)
    leaves(b, rng, (px + 0.12, py - 0.1, 2.2), 14, (0.18, 0.18, 1.3), 0.06, 0.14)

    def wire(p0, p1, sag, segs=10, r=0.014):
        p0, p1 = Vector(p0), Vector(p1)
        pts = [p0.lerp(p1, i / segs) - Vector((0, 0, sag * 4 * (i / segs) * (1 - i / segs))) for i in range(segs + 1)]
        for a, c in zip(pts, pts[1:]):
            tube_between(b, "dark", a, c, r, 4)

    for ix in (-0.8, 0.0, 0.8):
        wire((px + ix, py, 8.6), (px + ix - 24, py - 3, 8.7), 1.1)
        wire((px + ix, py, 8.6), (px + ix + 26, py - 2, 8.5), 1.0)
    wire((px + 0.42, py, 6.6), (-W / 2 - 0.05, FRONT + 0.4, top - 0.3), 0.35, 6, 0.012)

    # ---- stone apron in front, pots, crates, a bench, a bucket ----
    for i in range(11):
        for j in range(4):
            x = -4.6 + i * 0.85 + rng.uniform(-0.08, 0.08)
            y = FRONT - 0.5 - j * 0.75 + rng.uniform(-0.08, 0.08)
            b.part("stone", box(rng.uniform(0.6, 0.8), rng.uniform(0.55, 0.7), 0.12),
                   T(x, y, 0.04) @ R("Z", rng.uniform(-8, 8)))
    for (x, y, s) in [(-W / 2 + 0.5, FRONT - 0.5, 1.0), (-W / 2 + 1.1, FRONT - 0.45, 0.8),
                      (px + 0.6, py + 0.5, 1.2), (1.2, FRONT - 0.5, 0.9)]:
        b.part("terracotta", cone(8, 0.17 * s, 0.24 * s, 0.38 * s), T(x, y, 0.19 * s))
        leaves(b, rng, (x, y, 0.5 * s), int(8 * s), (0.22 * s, 0.22 * s, 0.15 * s), 0.07, 0.15 * s)
    for k in range(3):
        b.part("wood_light", box(0.55, 0.42, 0.34), T(W / 2 + 0.5, FRONT - 0.2 - (k % 2) * 0.5, 0.17 + (k // 2) * 0.34) @ R("Z", rng.uniform(-6, 6)))
    b.part("wood", box(1.6, 0.4, 0.06), T(-0.9, FRONT - 0.65, 0.45))
    for dx in (-0.7, 0.7):
        b.part("wood", box(0.06, 0.34, 0.42), T(-0.9 + dx, FRONT - 0.65, 0.21))
    b.part("metal", cone(10, 0.16, 0.19, 0.32), T(-2.0, FRONT - 0.55, 0.16))

    # ---- ivy: up the left wall and along the awning edge ----
    for _ in range(9):
        y = rng.uniform(FRONT + 0.2, D / 2 - 0.4)
        h = rng.uniform(1.2, 4.2)
        leaves(b, rng, (-W / 2 - 0.08, y, h / 2), int(h * 6), (0.06, 0.35, h / 2), 0.08, 0.2)
    leaves(b, rng, (-W / 2 + 0.6, edge_y + 0.05, edge_z - 0.15), 30, (0.7, 0.08, 0.12), 0.07, 0.18)
    leaves(b, rng, (-W / 2 + 0.3, edge_y + 0.05, edge_z - 0.65), 12, (0.3, 0.06, 0.45), 0.06, 0.14)
    leaves(b, rng, (W / 2 + 0.05, D / 2 - 0.5, 0.6), 30, (0.12, 0.5, 0.55), 0.08, 0.2)

    return b.finish(collection, materials=materials)
