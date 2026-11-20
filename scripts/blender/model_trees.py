"""Paper trees: a conifer of stacked folded cones and a broadleaf of crumpled
paper balls, each on a folded kraft-paper trunk. About 10 m tall."""
from kit_common import Builder, cone, ico, jitter, T, R


def build_conifer(collection, seed=3):
    b = Builder("tree_conifer", seed)
    rng = b.rng
    # trunk: a folded five-sided strip of kraft paper
    b.part("trunk", cone(5, 0.42, 0.3, 2.4), T(z=1.2))
    # three folded cones, each a little turned and tilted like hand-made paper
    layers = [(3.0, 4.6, 1.6), (2.4, 4.0, 3.6), (1.6, 3.4, 5.6)]
    for i, (radius, height, base) in enumerate(layers):
        verts = b.part("needle" if i != 1 else "leaf_b", cone(7, radius, 0.0, height, cap=True),
                       T(z=base + height / 2) @ R("Z", rng.uniform(0, 51)) @ R("X", rng.uniform(-3, 3)))
        jitter(verts, rng, 0.12, keep_base=False)
    return b.finish(collection)


def build_broadleaf(collection, seed=5):
    b = Builder("tree_broadleaf", seed)
    rng = b.rng
    b.part("trunk", cone(5, 0.45, 0.28, 4.2), T(z=2.1))
    # a forked branch so the crown sits on something
    b.part("trunk", cone(4, 0.22, 0.1, 2.0), T(x=0.5, z=4.4) @ R("Y", 28))
    # three overlapping crumpled paper balls
    blobs = [((0.0, 0.0, 6.4), 2.9, "leaf_a"), ((1.3, 0.6, 5.5), 2.1, "leaf_c"), ((-1.1, -0.5, 5.7), 2.2, "leaf_b")]
    for (x, y, z), r, ink in blobs:
        verts = b.part(ink, ico(1, r), T(x, y, z) @ R("Z", rng.uniform(0, 360)))
        # crumple: push each point in or out from the ball's centre
        centre = sum((v.co for v in verts), verts[0].co * 0) / len(verts)
        for v in verts:
            d = v.co - centre
            v.co = centre + d * rng.uniform(0.82, 1.1)
            if v.co.z < centre.z - r * 0.45:  # flatter underneath, like a tree crown
                v.co.z = centre.z - r * 0.45 + (v.co.z - (centre.z - r * 0.45)) * 0.4
    return b.finish(collection)
