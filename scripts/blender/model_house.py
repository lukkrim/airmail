"""A paper cottage: cream walls with a gable, a folded-card roof that overhangs,
a door, windows on every side (the game lights them at night), a chimney and a
stone plinth. Footprint 8 m x 6 m, ridge about 7.3 m."""
import math

from kit_common import Builder, box, prism, T, R

W, D, H = 8.0, 6.0, 3.6        # length (x), depth (y), wall height
PITCH = 38.0                   # roof pitch in degrees
OVER = 0.45                    # roof overhang
CARD = 0.16                    # roof thickness, like thick card


def build_house(collection, seed=7):
    b = Builder("house_cottage", seed)
    ridge = (D / 2) * math.tan(math.radians(PITCH))

    # walls: a five-sided profile (gable ends) pushed along the length
    profile = [(-D / 2, 0.0), (D / 2, 0.0), (D / 2, H), (0.0, H + ridge), (-D / 2, H)]
    b.part("wall", prism(profile, W))

    # stone plinth
    b.part("stone", box(W + 0.3, D + 0.3, 0.35), T(z=0.175))

    # roof: two folded cards meeting at the ridge, overhanging all round
    slope = (D / 2 + OVER) / math.cos(math.radians(PITCH))
    for side in (-1, 1):
        cx = side * (D / 4 + OVER / 2 - CARD / 2 * math.sin(math.radians(PITCH)))
        cz = H + ridge / 2 - OVER / 2 * math.tan(math.radians(PITCH)) + CARD / 2
        b.part("roof", box(W + 2 * OVER, slope, CARD),
               T(y=cx, z=cz) @ R("X", -side * PITCH), edge_mat="card_edge")
    # ridge cap
    b.part("roof_dark", box(W + 2 * OVER + 0.1, 0.35, 0.22), T(z=H + ridge + CARD * 0.8) @ R("X", 45))

    # chimney
    b.part("roof_dark", box(0.6, 0.6, 2.0), T(x=W * 0.28, y=D * 0.18, z=H + ridge * 0.75 + 0.6))

    # door on the front (−y) and windows: front, back, the gable ends
    front, back = -D / 2 - 0.04, D / 2 + 0.04
    b.part("door", box(1.1, 0.1, 2.1), T(x=-W * 0.18, y=front, z=1.05 + 0.35))
    for x in (W * 0.15, W * 0.36):
        b.part("window", box(0.95, 0.1, 1.05), T(x=x, y=front, z=2.1))
    for x in (-W * 0.3, 0.0, W * 0.3):
        b.part("window", box(0.95, 0.1, 1.05), T(x=x, y=back, z=2.1))
    for sx in (-1, 1):
        b.part("window", box(0.1, 1.0, 1.05), T(x=sx * (W / 2 + 0.04), z=2.1))
        b.part("window", box(0.1, 0.7, 0.75), T(x=sx * (W / 2 + 0.04), z=H + ridge * 0.42))
    return b.finish(collection)
