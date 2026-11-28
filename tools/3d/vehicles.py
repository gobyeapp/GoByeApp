"""
The four ride types as 3D pictures, each in every paint colour a driver can pick (D-110).

    python3 tools/3d/vehicles.py                  # every type in every colour
    python3 tools/3d/vehicles.py keke car         # only these types
    python3 tools/3d/vehicles.py car:red          # one picture
    python3 tools/3d/vehicles.py --preview keke   # quick, rough look (fewer samples)
    python3 tools/3d/vehicles.py --sheet          # rebuild the contact sheet only

Types: keke (tricycle), car, comfort, xl. Each body is one lofted, subdivided shell; the paint is a
material, so a colour is a real render and not a tint. Plum roof and dark glass are the same on all four.
Same studio rig as tools/3d/render.py. Output: packages/ui/assets/vehicles/<type>-<colour>.webp (512 x 334).
Keep COLOURS in step with packages/ui/src/components/shared/vehicleColours.tsx.
Requires: pip install bpy pillow
"""
import math
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import render as R  # noqa: E402

OUT_DIR = os.path.join(R.ROOT, 'packages', 'ui', 'assets', 'vehicles')
TMP_DIR = os.path.join(R.ROOT, 'tools', '3d', '.renders', 'vehicles')
SHEET = os.path.join(R.ROOT, 'docs', 'assets', '3d', 'vehicles-sheet.png')
OUT_W, OUT_H = 512, 334

COLOURS = {
    'white': '#F5F5F5', 'silver': '#BFC3C9', 'grey': '#74787F', 'black': '#1B1B1D', 'blue': '#2456A6', 'red': '#B3261E',
    'wine': '#6E1423', 'green': '#2E7D4F', 'brown': '#6B4A3A', 'gold': '#C4A24A', 'yellow': '#F0C419', 'orange': '#E8731A',
}
TYPES = ('keke', 'car', 'comfort', 'xl')

R.PALETTE.update({
    'paint': ('#F5F5F5', 0.3, 1.0),
    'plum': ('#3A1B47', 0.5, 0.25),
    'vglass': ('#10131A', 0.06, 1.0),
    'rubber': ('#17171A', 0.75, 0.0),
    'rim': ('#C9CCD2', 0.25, 0.6),
    'trim': ('#1D1D21', 0.45, 0.2),
    'lamp': ('#FFFFFF', 0.15, 1.0),
    'tail': ('#C9211B', 0.2, 1.0),
    'amber': ('#FF751F', 0.3, 0.6),
    'seat': ('#2A2A30', 0.7, 0.0),
})

DEG90 = math.radians(90)

# Ring segments (16 per station). Going round from the bottom centre up the +Y side and back down the -Y side.
SIDE_LOW = {2, 3, 12, 13}
SIDE_WIN = {4, 5, 10, 11}
TOP = {6, 7, 8, 9}
MAT_SLOTS = ('paint', 'vglass', 'plum', 'trim')


def ring(s):
    """Cross-section of the body at one station: 9 points on the +Y half, mirrored."""
    zb, zbelt, zroof, w, wr = s['zb'], s['zbelt'], s['zroof'], s['w'], s['wr']
    zmid = zb + (zbelt - zb) * 0.55
    half = [
        (0.0, zb),
        (w * 0.62, zb),
        (w * 0.97, zb + (zbelt - zb) * 0.18),
        (w, zmid),
        (w * 0.975, zbelt),
        ((w * 0.975 + wr) / 2, (zbelt + zroof) / 2),
        (wr, zroof - (zroof - zbelt) * 0.06),
        (wr * 0.55, zroof),
        (0.0, zroof),
    ]
    return half + [(-y, z) for y, z in reversed(half[1:-1])]


def loft(stations, spans, level=2):
    """Body shell through the stations (front first). spans[i] names the look between station i and i+1:
    body (all paint), screen (glass on top), cabin (side windows, plum roof), pillar (plum roof only),
    canvas (plum sides and roof)."""
    verts, faces, mats = [], [], []
    n = 16
    for s in stations:
        verts.extend((s['x'], y, z) for y, z in ring(s))
    for i, kind in enumerate(spans):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
            m = 0
            if k in (0, 1, 14, 15):
                m = 3
            elif kind == 'screen' and k in TOP:
                m = 1
            elif kind == 'cabin':
                m = 1 if k in SIDE_WIN else 2 if k in TOP else 0
            elif kind == 'pillar' and k in TOP:
                m = 2
            elif kind == 'canvas' and (k in TOP or k in SIDE_WIN):
                m = 2
            mats.append(m)
    faces.append(tuple(range(n)))
    mats.append(0)
    last = (len(stations) - 1) * n
    faces.append(tuple(reversed(range(last, last + n))))
    mats.append(0)
    o = R.mesh_from('body', verts, faces)
    for name in MAT_SLOTS:
        o.data.materials.append(R.material(name))
    for p, m in zip(o.data.polygons, mats):
        p.material_index = m
        p.use_smooth = True
    o.data.update()
    bpy.context.view_layer.objects.active = o
    bm_fix = o.modifiers.new('sub', 'SUBSURF')
    bm_fix.levels = bm_fix.render_levels = level
    return o


def cut(body, cutter):
    """Cut `cutter` out of the body; the cut faces take the cutter's material."""
    cutter.hide_render = True
    cutter['ground'] = True  # keeps it out of the framing
    cutter.display_type = 'WIRE'
    md = body.modifiers.new('cut', 'BOOLEAN')
    md.operation = 'DIFFERENCE'
    md.object = cutter
    md.solver = 'EXACT'
    try:
        md.material_mode = 'TRANSFER'
    except (AttributeError, TypeError):
        pass


def wheel(x, y, r, width=0.24, alloy=5):
    """Tyre, rim and a ring of dark openings on the outer face (the side away from the car's centre)."""
    out = 1 if y > 0 else -1
    parts = [R.cyl(r, width, (x, y, r), 'rubber', bevel=0.07, rot=(DEG90, 0, 0))]
    parts.append(R.cyl(r * 0.66, 0.03, (x, y + out * (width / 2 - 0.005), r), 'rim', bevel=0.012, rot=(DEG90, 0, 0)))
    parts.append(R.cyl(r * 0.2, 0.05, (x, y + out * (width / 2), r), 'trim', bevel=0.015, rot=(DEG90, 0, 0)))
    for i in range(alloy):
        a = math.tau * i / alloy + 0.3
        parts.append(R.cyl(r * 0.13, 0.036, (x + math.cos(a) * r * 0.42, y + out * (width / 2 - 0.003), r + math.sin(a) * r * 0.42), 'trim', bevel=0.0, rot=(DEG90, 0, 0), verts=24))
    return parts


def arches(body, xs, w, r):
    for x in xs:
        for y in (-w, w):
            c = R.cyl(r * 1.2, 0.62, (x, y, r * 0.98), 'trim', bevel=0.0, rot=(DEG90, 0, 0))
            cut(body, c)


def st(x, zb, zbelt, zroof, w, wr):
    return {'x': x, 'zb': zb, 'zbelt': zbelt, 'zroof': zroof, 'w': w, 'wr': wr}


def lamps(front_x, w, z, tail_x, tail_z):
    """Head and tail lamps as shallow domes sunk into the corners, so nothing sticks out of the body."""
    parts = []
    for y in (-1, 1):
        parts.append(R.sphere(0.17, (front_x, y * (w - 0.2), z + 0.05), 'lamp', scale=(1.35, 1.0, 0.42)))
        parts.append(R.sphere(0.15, (tail_x, y * (w - 0.2), tail_z + 0.05), 'tail', scale=(1.1, 1.0, 0.45)))
    return parts


def mirrors(x, w, z):
    return [R.tbox((0.12, 0.2, 0.1), (x, y * (w + 0.02), z), 'paint', bevel=0.04) for y in (-1, 1)]


def pillar(x, s):
    """A body-colour post across the side windows at x, following the lean of the glass at station s."""
    out = []
    for y in (-1, 1):
        a = (x, y * s['w'] * 0.972, s['zbelt'] - 0.02)
        m = (x, y * ((s['w'] * 0.975 + s['wr']) / 2 - 0.008), (s['zbelt'] + s['zroof']) / 2)
        b = (x, y * (s['wr'] - 0.02), s['zroof'] - (s['zroof'] - s['zbelt']) * 0.1)
        out.append(R.tube([a, m, b], 0.04, 'paint', smooth_pts=False))
    return out


def handles(xs, w, z):
    return [R.tbox((0.16, 0.03, 0.035), (x, y * (w + 0.005), z), 'trim', bevel=0.012) for x in xs for y in (-1, 1)]


def saloon(kind):
    comfort = kind == 'comfort'
    if comfort:
        r, w = 0.35, 0.92
        stations = [
            st(2.42, 0.36, 0.60, 0.63, 0.50, 0.42), st(2.3, 0.24, 0.68, 0.71, 0.82, 0.68), st(1.7, 0.2, 0.78, 0.81, 0.90, 0.76),
            st(1.0, 0.2, 0.86, 0.90, w, 0.78), st(0.2, 0.2, 0.90, 1.36, w, 0.64), st(-0.4, 0.2, 0.91, 1.40, w, 0.66),
            st(-1.15, 0.2, 0.93, 1.33, w, 0.63), st(-1.95, 0.2, 0.95, 1.0, 0.90, 0.74),
            st(-2.3, 0.26, 0.93, 0.97, 0.84, 0.70), st(-2.44, 0.4, 0.84, 0.88, 0.58, 0.48),
        ]
        axle = (1.5, -1.45)
    else:
        r, w = 0.32, 0.86
        stations = [
            st(2.12, 0.36, 0.62, 0.65, 0.48, 0.40), st(2.0, 0.25, 0.70, 0.73, 0.78, 0.64), st(1.5, 0.2, 0.80, 0.83, 0.84, 0.70),
            st(0.9, 0.2, 0.88, 0.92, w, 0.73), st(0.3, 0.2, 0.92, 1.42, w, 0.61), st(-0.27, 0.2, 0.93, 1.46, w, 0.63),
            st(-0.95, 0.2, 0.94, 1.42, w, 0.61), st(-1.5, 0.2, 0.96, 1.01, 0.85, 0.70),
            st(-1.95, 0.26, 0.94, 0.98, 0.80, 0.66), st(-2.1, 0.4, 0.85, 0.89, 0.56, 0.46),
        ]
        axle = (1.3, -1.25)
    spans = ['body', 'body', 'body', 'screen', 'cabin', 'cabin', 'screen', 'body', 'body']
    body = loft(stations, spans)
    arches(body, axle, w, r)
    parts = [body] + pillar(stations[5]['x'], stations[5])
    for x in axle:
        for y in (-1, 1):
            parts += wheel(x, y * (w - 0.13), r, alloy=7 if comfort else 5)
    L2 = stations[0]['x']
    parts += lamps(L2 - 0.3, w - 0.06, 0.6, stations[-1]['x'] + 0.24, 0.8)
    parts.append(R.tbox((0.08, 0.7, 0.13), (L2 - 0.03, 0, 0.42), 'trim', bevel=0.04))
    parts += mirrors(0.72 if not comfort else 0.68, w, 0.93)
    parts += handles((0.0, -0.7) if not comfort else (-0.1, -0.85), w, 0.82)
    return parts


def xl():
    r, w = 0.36, 0.95
    stations = [
        st(2.36, 0.4, 0.72, 0.75, 0.52, 0.44), st(2.24, 0.28, 0.82, 0.85, 0.84, 0.70), st(1.75, 0.24, 0.94, 0.97, 0.92, 0.78),
        st(1.2, 0.24, 1.02, 1.06, w, 0.80), st(0.62, 0.24, 1.06, 1.72, w, 0.70), st(-0.07, 0.24, 1.07, 1.78, w, 0.72),
        st(-0.91, 0.24, 1.08, 1.78, w, 0.72),
        st(-1.85, 0.24, 1.09, 1.74, w, 0.70), st(-2.28, 0.3, 1.08, 1.5, 0.9, 0.66), st(-2.4, 0.44, 0.98, 1.2, 0.62, 0.5),
    ]
    spans = ['body', 'body', 'body', 'screen', 'cabin', 'cabin', 'cabin', 'screen', 'body']
    body = loft(stations, spans)
    axle = (1.45, -1.4)
    arches(body, axle, w, r)
    parts = [body] + pillar(stations[5]['x'], stations[5]) + pillar(stations[6]['x'], stations[6])
    for x in axle:
        for y in (-1, 1):
            parts += wheel(x, y * (w - 0.13), r, width=0.27, alloy=6)
    parts += lamps(2.06, w - 0.06, 0.74, -2.2, 1.06)
    parts.append(R.tbox((0.08, 0.8, 0.16), (2.33, 0, 0.47), 'trim', bevel=0.04))
    parts += mirrors(1.0, w, 1.1)
    parts += handles((0.3, -0.5), w, 0.96)
    for y in (-1, 1):  # roof rails
        parts.append(R.tube([(0.35, y * 0.5, 1.7), (0.2, y * 0.5, 1.8), (-1.5, y * 0.5, 1.8), (-1.65, y * 0.5, 1.7)], 0.025, 'rim', smooth_pts=False))
    return parts


def keke():
    r = 0.23
    stations = [
        st(1.42, 0.62, 0.76, 0.79, 0.10, 0.08), st(1.3, 0.54, 0.86, 0.89, 0.26, 0.22), st(1.02, 0.5, 0.96, 1.0, 0.46, 0.4),
        st(0.72, 0.3, 1.0, 1.66, 0.6, 0.5), st(0.56, 0.24, 1.0, 1.7, 0.63, 0.55), st(-0.3, 0.24, 1.0, 1.72, 0.66, 0.6),
        st(-1.15, 0.24, 1.0, 1.7, 0.66, 0.6), st(-1.34, 0.34, 1.0, 1.62, 0.6, 0.52),
    ]
    spans = ['body', 'body', 'screen', 'canvas', 'canvas', 'canvas', 'canvas']
    body = loft(stations, spans)
    # Open sides: one doorway through the cabin, front to the rear seat.
    door = R.tbox((1.02, 3.0, 1.02), (0.02, 0, 0.5), 'seat', bevel=0.0)
    cut(body, door)
    rear_x, rear_y = -0.82, 0.6
    for y in (-rear_y, rear_y):
        c = R.cyl(r * 1.22, 0.4, (rear_x, y * 1.12, r), 'trim', bevel=0.0, rot=(DEG90, 0, 0))
        cut(body, c)
    parts = [body]
    for y in (-1, 1):
        parts += wheel(rear_x, y * (rear_y - 0.04), r, width=0.2, alloy=4)
    # Front wheel, fork and mudguard
    fx = 1.08
    parts.append(R.cyl(r, 0.16, (fx, 0, r), 'rubber', bevel=0.06, rot=(DEG90, 0, 0)))
    for y in (-1, 1):
        parts.append(R.cyl(r * 0.6, 0.02, (fx, y * 0.085, r), 'rim', bevel=0.008, rot=(DEG90, 0, 0)))
        parts.append(R.tube([(fx, y * 0.12, r), (fx - 0.04, y * 0.12, 0.56)], 0.03, 'trim', smooth_pts=False))
    parts.append(R.torus(r + 0.045, 0.045, (fx, 0, r), 'paint', rot=(DEG90, 0, 0), arc=170.0, scale=(1, 1, 2.6)))
    # Headlight, windscreen frame and wiper-less plain face
    parts.append(R.cyl(0.1, 0.06, (1.36, 0, 0.84), 'trim', bevel=0.02, rot=(0, DEG90, 0)))
    parts.append(R.cyl(0.075, 0.07, (1.37, 0, 0.84), 'lamp', bevel=0.02, rot=(0, DEG90, 0)))
    for y in (-1, 1):
        parts.append(R.sphere(0.04, (1.12, y * 0.36, 0.93), 'amber'))
        parts.append(R.tbox((0.06, 0.16, 0.09), (-1.34, y * 0.44, 0.78), 'tail', bevel=0.03))
        # mirrors on stalks
        parts.append(R.tube([(0.78, y * 0.56, 1.12), (0.86, y * 0.74, 1.2)], 0.014, 'trim', smooth_pts=False))
        parts.append(R.tbox((0.03, 0.13, 0.17), (0.87, y * 0.76, 1.13), 'trim', bevel=0.012))
    # Inside the cabin: floor, driver seat, handlebar, passenger bench
    parts.append(R.tbox((1.5, 1.16, 0.06), (0.0, 0, 0.44), 'trim', bevel=0.02))
    parts.append(R.tbox((0.36, 0.5, 0.12), (0.22, 0, 0.74), 'seat', bevel=0.05))
    parts.append(R.tbox((0.1, 0.5, 0.4), (0.04, 0, 0.8), 'seat', bevel=0.04))
    parts.append(R.tbox((0.3, 0.42, 0.26), (0.22, 0, 0.5), 'trim', bevel=0.03))
    parts.append(R.tube([(0.66, 0, 0.7), (0.52, 0, 1.02)], 0.022, 'trim', smooth_pts=False))
    parts.append(R.tube([(0.52, -0.26, 1.02), (0.52, 0.26, 1.02)], 0.022, 'trim', smooth_pts=False))
    parts.append(R.tbox((0.4, 1.12, 0.14), (-0.42, 0, 0.72), 'seat', bevel=0.05))
    parts.append(R.tbox((0.12, 1.12, 0.5), (-0.6, 0, 0.78), 'seat', bevel=0.05))
    parts.append(R.tbox((0.44, 1.12, 0.26), (-0.44, 0, 0.48), 'trim', bevel=0.03))
    # Rear bumper bar
    parts.append(R.tbox((0.06, 1.0, 0.07), (-1.38, 0, 0.36), 'trim', bevel=0.025))
    return parts


BUILD = {'keke': keke, 'car': lambda: saloon('car'), 'comfort': lambda: saloon('comfort'), 'xl': xl}


def render(kind, colour, preview=False):
    R.SAMPLES = 24 if preview else 40
    R.RENDER_PX = 512 if preview else 768
    R.AZIMUTH = math.radians(-36)
    R.ELEVATION = math.radians(20)
    R.FILL = 0.9
    R.PALETTE['paint'] = ('#E4E4E6' if colour == 'white' else COLOURS[colour], 0.3, 1.0)
    sc = R.setup_scene()
    # Front (+X) is turned to face the lower left, as the old car picture did.
    R.group(BUILD[kind](), rot=(0, 0, math.radians(180)))
    for m in ('paint', 'vglass', 'lamp', 'tail'):
        b = R.material(m).node_tree.nodes['Principled BSDF']
        b.inputs['Coat Roughness'].default_value = 0.04
    R.material('rim').node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.9
    if colour in ('silver', 'grey', 'gold', 'blue', 'wine', 'brown', 'green'):
        R.material('paint').node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.35
    R.frame_and_light(sc)
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    for o in sc.objects:
        if o.type == 'LIGHT':
            o.data.energy *= 0.42
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    os.makedirs(TMP_DIR, exist_ok=True)
    png = os.path.join(TMP_DIR, f'{kind}-{colour}.png')
    sc.render.filepath = png
    bpy.ops.render.render(write_still=True)
    return postprocess(kind, colour)


def postprocess(kind, colour):
    """Crop to the vehicle and its contact shadow, then fit on a 512 x 334 canvas (the old picture's size)."""
    from PIL import Image

    im = Image.open(os.path.join(TMP_DIR, f'{kind}-{colour}.png')).convert('RGBA')
    r, g, b, a = im.split()
    a = a.point([0 if v < 24 else int(255 * (v / 255) ** 3) for v in range(256)])  # thin the shadow's haze
    im = Image.merge('RGBA', (r, g, b, a))
    solid = a.point([255 if v > 150 else 0 for v in range(256)]).getbbox()
    pad = int((solid[2] - solid[0]) * 0.04)
    box = (max(0, solid[0] - pad), max(0, solid[1] - pad), min(im.width, solid[2] + pad), min(im.height, solid[3] + pad * 2))
    im = im.crop(box)
    k = min(OUT_W / im.width, OUT_H / im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    canvas = Image.new('RGBA', (OUT_W, OUT_H), (0, 0, 0, 0))
    canvas.paste(im, ((OUT_W - im.width) // 2, (OUT_H - im.height) // 2))
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f'{kind}-{colour}.webp')
    canvas.save(out, 'WEBP', quality=88, method=6)
    return out


def sheet():
    from PIL import Image

    cw, ch = 256, 167
    names = list(COLOURS)
    img = Image.new('RGB', (cw * len(names), ch * len(TYPES)), 'white')
    for row, kind in enumerate(TYPES):
        for col, colour in enumerate(names):
            p = os.path.join(OUT_DIR, f'{kind}-{colour}.webp')
            if os.path.exists(p):
                im = Image.open(p).convert('RGBA').resize((cw, ch), Image.LANCZOS)
                img.paste(im, (col * cw, row * ch), im)
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    img.save(SHEET, optimize=True)
    return SHEET


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview = '--preview' in sys.argv
    if '--sheet' not in sys.argv:
        jobs = []
        for a in args or TYPES:
            kind, _, colour = a.partition(':')
            if kind not in BUILD or (colour and colour not in COLOURS):
                raise SystemExit(f'Unknown: {a}. Types: {TYPES}. Colours: {list(COLOURS)}')
            jobs += [(kind, colour)] if colour else [(kind, c) for c in COLOURS]
        if '--missing' in sys.argv:
            jobs = [j for j in jobs if not os.path.exists(os.path.join(OUT_DIR, f'{j[0]}-{j[1]}.webp'))]
        for kind, colour in jobs:
            t = time.time()
            out = render(kind, colour, preview)
            print(f'{kind}-{colour}: {os.path.getsize(out) // 1024} KB in {time.time() - t:.0f}s', flush=True)
    print('sheet', sheet())
