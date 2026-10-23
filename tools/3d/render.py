"""
GoBye dimensional icon family: procedural Blender renders (docs/DIMENSIONAL_ASSETS.md).

    python3 tools/3d/render.py                 # all assets
    python3 tools/3d/render.py sedan wallet    # only these
    python3 tools/3d/render.py --sheet         # rebuild the contact sheet only
    python3 tools/3d/render.py --post          # redo the WebP files from the saved 640 px renders

Every asset is built from bevelled primitives, curves and metaballs in one shared studio rig (same
orthographic three-quarter camera, lights, materials and framing), rendered with Cycles at 640 px on a
transparent background, then downsampled to 320 px WebP in apps/admin/src/assets/3d/.
Requires: pip install bpy pillow
"""
import math
import os
import sys
import time

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'apps', 'admin', 'src', 'assets', '3d')
TMP_DIR = os.path.join(ROOT, 'tools', '3d', '.renders')
SHEET = os.path.join(ROOT, 'docs', 'assets', '3d', 'contact-sheet.png')
RENDER_PX = 640
OUT_PX = 320
SAMPLES = 96
FILL = 0.72  # share of the frame the object occupies

# ---------- Palette (sRGB hex → linear) ----------


def lin(hexstr):
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


PALETTE = {
    'porcelain': ('#F4F2EE', 0.42, 0.35),
    'porcelain2': ('#E6E3DD', 0.45, 0.3),  # slightly warmer grey for secondary parts
    'jade': ('#0B7A5B', 0.38, 0.35),
    'jadeLight': ('#3FAE86', 0.4, 0.3),
    'mint': ('#CFEBDD', 0.45, 0.25),
    'aubergine': ('#251632', 0.32, 0.4),
    'glass': ('#2B2238', 0.18, 0.6),
    'tangerine': ('#FF8A3D', 0.4, 0.3),
}
MATS = {}


def material(name):
    if name in MATS:
        return MATS[name]
    hexc, rough, coat = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(hexc)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.25
    b.inputs['Specular IOR Level'].default_value = 0.4
    MATS[name] = m
    return m


# ---------- Geometry helpers ----------


def _finish(obj, mat, bevel=0.0, segments=6, smooth=True):
    if mat:
        obj.data.materials.append(material(mat))
    if bevel > 0:
        md = obj.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = segments
        md.limit_method = 'ANGLE'
        md.harden_normals = True
    if smooth and obj.type == 'MESH':
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_from(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return _link(bpy.data.objects.new(name, me))


def tbox(size, loc=(0, 0, 0), mat='porcelain', bevel=0.08, top=(1.0, 1.0), top_dx=0.0, rot=(0, 0, 0), segments=6):
    """Rounded box (optionally tapered on top). size = full (x, y, z); loc = centre of the bottom face."""
    sx, sy, sz = (s / 2 for s in size)
    tx, ty = sx * top[0], sy * top[1]
    v = [(-sx, -sy, 0), (sx, -sy, 0), (sx, sy, 0), (-sx, sy, 0),
         (-tx + top_dx, -ty, sz * 2), (tx + top_dx, -ty, sz * 2), (tx + top_dx, ty, sz * 2), (-tx + top_dx, ty, sz * 2)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    o = mesh_from('box', v, f)
    o.location = loc
    o.rotation_euler = rot
    return _finish(o, mat, bevel, segments)


def cyl(r, depth, loc=(0, 0, 0), mat='porcelain', bevel=0.03, rot=(0, 0, 0), r2=None, verts=72):
    """Cylinder (or cone when r2 is given) standing on its base at loc (before rotation about its centre)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    me = bpy.data.meshes.new('cyl')
    bm.to_mesh(me)
    bm.free()
    o = _link(bpy.data.objects.new('cyl', me))
    o.location = loc
    o.rotation_euler = rot
    return _finish(o, mat, bevel, 5)


def sphere(r, loc=(0, 0, 0), mat='porcelain', scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=r)
    me = bpy.data.meshes.new('sph')
    bm.to_mesh(me)
    bm.free()
    o = _link(bpy.data.objects.new('sph', me))
    o.location = loc
    o.scale = scale
    return _finish(o, mat, 0)


def torus(R, r, loc=(0, 0, 0), mat='porcelain', rot=(0, 0, 0), arc=360.0, scale=(1, 1, 1)):
    """Torus or torus arc (degrees), built as a curve tube."""
    cu = bpy.data.curves.new('tor', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 8
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    n = max(8, int(96 * arc / 360))
    sp.points.add(n)
    for i in range(n + 1):
        a = math.radians(arc) * i / n
        sp.points[i].co = (R * math.cos(a), R * math.sin(a), 0, 1)
    sp.use_cyclic_u = arc >= 360
    o = _link(bpy.data.objects.new('tor', cu))
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    o.data.materials.append(material(mat))
    return o


def tube(points, r, mat='jade', flatten=1.0, loc=(0, 0, 0), cyclic=False, smooth_pts=True):
    """Smooth tube along points (x, y, z); flatten < 1 squashes the profile (road ribbons)."""
    if flatten != 1.0:
        # Flatten around the path's own height, so the ribbon stays where it was placed.
        z0 = sum(p[2] for p in points) / len(points)
        points = [(p[0], p[1], p[2] - z0) for p in points]
        loc = (loc[0], loc[1], loc[2] + z0)
    cu = bpy.data.curves.new('tube', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 8
    cu.use_fill_caps = True
    if smooth_pts:
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(points) - 1)
        for bp, p in zip(sp.bezier_points, points):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
    else:
        sp = cu.splines.new('POLY')
        sp.points.add(len(points) - 1)
        for pt, p in zip(sp.points, points):
            pt.co = (*p, 1)
    sp.use_cyclic_u = cyclic
    o = _link(bpy.data.objects.new('tube', cu))
    o.location = loc
    o.scale = (1, 1, flatten)
    o.data.materials.append(material(mat))
    return o


def outline_solid(points2d, depth, bevel, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Filled 2D outline (x, y) extruded to `depth` with rounded edges. Bezier auto handles."""
    cu = bpy.data.curves.new('sol', 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    cu.extrude = depth / 2
    cu.bevel_depth = bevel
    cu.bevel_resolution = 6
    cu.offset = -bevel / max(depth, 1e-3) * 0.0
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points2d) - 1)
    for bp, p in zip(sp.bezier_points, points2d):
        bp.co = (p[0], p[1], 0)
        kind = p[2] if len(p) > 2 else 'AUTO'
        bp.handle_left_type = bp.handle_right_type = kind
    sp.use_cyclic_u = True
    o = _link(bpy.data.objects.new('sol', cu))
    o.location = loc
    o.rotation_euler = rot
    o.data.materials.append(material(mat))
    return o


def check(loc, size=1.0, mat='porcelain', thick=0.12, rot=(0, 0, 0), depth=0.08):
    """Check mark from two rounded bars in the XZ plane (facing -Y), then placed as a group."""
    p0, p1, p2 = Vector((-0.36, 0.04)), Vector((-0.1, -0.22)), Vector((0.4, 0.3))
    bars = []
    for a, b in ((p0, p1), (p1, p2)):
        d = (b - a) * size
        mid = (a + b) / 2 * size
        L = d.length + thick * size
        bar = tbox((L, depth, thick * size), (0, 0, 0), mat, bevel=thick * size * 0.45)
        # tbox sits on its bottom face; centre it vertically, then rotate in the XZ plane
        bar.data.transform(Matrix.Translation((0, 0, -thick * size / 2)))
        bar.location = (mid.x, 0, mid.y)
        bar.rotation_euler = (0, -math.atan2(d.y, d.x), 0)
        bars.append(bar)
    return group(bars, loc, rot)


def plus(loc, size=1.0, mat='porcelain', thick=0.16, depth=0.08, rot=(0, 0, 0)):
    a = tbox((0.62 * size, depth, thick * size), (0, 0, -thick * size / 2), mat, bevel=thick * size * 0.4)
    b = tbox((thick * size, depth, 0.62 * size), (0, 0, -0.31 * size), mat, bevel=thick * size * 0.4)
    return group([a, b], loc, rot)


def arrow(length, loc, rot=(0, 0, 0), mat='jade', shaft=0.13, head=0.32):
    """Arrow along +X built at origin, then placed."""
    s = tbox((length, shaft, shaft), (length / 2 - 0.02, 0, -shaft / 2), mat, bevel=shaft * 0.45)
    h = cyl(head / 1.6, head, (0, 0, 0), mat, bevel=0.03, r2=0.0, rot=(0, math.radians(90), 0))
    h.location = (length + head / 2 - 0.05, 0, 0)
    return group([s, h], loc, rot)


def group(objs, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    e = bpy.data.objects.new('grp', None)
    _link(e)
    for o in objs:
        o.parent = e
    e.location = loc
    e.rotation_euler = rot
    e.scale = (scale, scale, scale)
    return e


def lathe(profile, mat='porcelain', loc=(0, 0, 0), rot=(0, 0, 0), steps=96, scale=(1, 1, 1)):
    """Surface of revolution around Z from a profile of (radius, z) points (bottom to top)."""
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in profile]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], cent=(0, 0, 0), axis=(0, 0, 1), angle=math.radians(360), steps=steps, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('lathe')
    bm.to_mesh(me)
    bm.free()
    o = _link(bpy.data.objects.new('lathe', me))
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    return _finish(o, mat, 0)


def metacloud(blobs, mat, loc=(0, 0, 0), resolution=0.04):
    mb = bpy.data.metaballs.new('cloud')
    mb.resolution = resolution
    mb.render_resolution = resolution
    for (x, y, z, r) in blobs:
        el = mb.elements.new()
        el.co = (x, y, z)
        el.radius = r
    o = _link(bpy.data.objects.new('cloud', mb))
    o.location = loc
    o.data.materials.append(material(mat))
    return o


def coin(loc, r=0.5, mat='jade', face='porcelain', rot=(0, 0, 0), thick=0.14, mark='ring'):
    body = cyl(r, thick, (0, 0, 0), mat, bevel=0.035)
    parts = [body]
    if mark == 'ring':
        parts.append(torus(r * 0.72, 0.022, (0, 0, thick / 2 + 0.005), face))
    return group(parts, loc, rot)


# ---------- Shared vehicle ----------


def vehicle(kind='sedan'):
    """Car along +X (front). Porcelain body, aubergine glass and tyres, jade accents."""
    parts = []
    if kind == 'xl':
        L, W, H, cab_l, cab_h, wheel_r, roof_dx = 2.25, 1.02, 0.62, 1.78, 0.5, 0.25, -0.1
    elif kind == 'comfort':
        L, W, H, cab_l, cab_h, wheel_r, roof_dx = 2.45, 0.96, 0.42, 1.25, 0.36, 0.23, -0.12
    else:
        L, W, H, cab_l, cab_h, wheel_r, roof_dx = 2.05, 0.92, 0.44, 1.08, 0.38, 0.22, -0.08
    clear = wheel_r * 0.62
    body = tbox((L, W, H), (0, 0, clear), 'porcelain', bevel=0.16 if kind != 'xl' else 0.18, top=(0.97, 0.96))
    parts.append(body)
    top_scale = (0.92, 0.84) if kind == 'xl' else (0.66, 0.8) if kind == 'comfort' else (0.72, 0.82)
    cabin = tbox((cab_l, W * 0.9, cab_h), (roof_dx, 0, clear + H - 0.04), 'glass', bevel=0.12, top=top_scale, top_dx=-0.06 if kind == 'comfort' else 0.0)
    parts.append(cabin)
    roof = tbox((cab_l * top_scale[0] * 0.98, W * 0.9 * top_scale[1] * 1.04, 0.07), (roof_dx + (-0.06 if kind == 'comfort' else 0.0), 0, clear + H - 0.04 + cab_h - 0.04), 'porcelain', bevel=0.03)
    parts.append(roof)
    # A pillar band (porcelain) splitting the side windows, B-pillar
    parts.append(tbox((0.07, W * 0.9 * 0.96, cab_h * 0.95), (roof_dx + 0.02, 0, clear + H - 0.04), 'porcelain', bevel=0.02, top=(1.0, top_scale[1] * 1.02)))
    if kind == 'xl':
        parts.append(tbox((0.07, W * 0.9 * 0.96, cab_h * 0.95), (roof_dx - 0.5, 0, clear + H - 0.04), 'porcelain', bevel=0.02, top=(1.0, top_scale[1] * 1.02)))
        # roof rails
        for y in (-0.3, 0.3):
            parts.append(tbox((cab_l * 0.8, 0.05, 0.05), (roof_dx, y, clear + H + cab_h - 0.03), 'aubergine', bevel=0.02))
    # jade accent stripe along both sides
    stripe_h = 0.07
    parts.append(tbox((L * 0.9, W + 0.012, stripe_h), (0.02, 0, clear + H * 0.42), 'jade', bevel=0.03))
    if kind == 'comfort':
        parts.append(tbox((L * 0.94, W + 0.008, 0.14), (0, 0, clear + 0.01), 'jade', bevel=0.06))
    if kind == 'sedan':
        sign = tbox((0.34, 0.2, 0.13), (roof_dx, 0, clear + H - 0.04 + cab_h + 0.02), 'jade', bevel=0.05)
        parts.append(sign)
    # lights
    parts.append(tbox((0.05, 0.22, 0.08), (L / 2 - 0.03, -W / 2 + 0.17, clear + H * 0.62), 'mint', bevel=0.02))
    parts.append(tbox((0.05, 0.22, 0.08), (L / 2 - 0.03, W / 2 - 0.17, clear + H * 0.62), 'mint', bevel=0.02))
    parts.append(tbox((0.05, 0.2, 0.07), (-L / 2 + 0.02, -W / 2 + 0.16, clear + H * 0.62), 'tangerine', bevel=0.02))
    # wheels
    wx = L / 2 - wheel_r - 0.2
    for x in (wx, -wx):
        for y in (-W / 2 + 0.06, W / 2 - 0.06):
            t = cyl(wheel_r, 0.2, (x, y, wheel_r), 'aubergine', bevel=0.05, rot=(math.radians(90), 0, 0))
            hub = cyl(wheel_r * 0.5, 0.21, (x, y + (0.005 if y > 0 else -0.005), wheel_r), 'jade' if kind == 'comfort' else 'porcelain2', bevel=0.02, rot=(math.radians(90), 0, 0))
            parts.extend([t, hub])
    return parts


# ---------- Shared bases ----------


def tile(w=2.6, d=2.6, h=0.16, mat='porcelain'):
    return tbox((w, d, h), (0, 0, 0), mat, bevel=0.12)


# ---------- Assets ----------


def a_sedan():
    group(vehicle('sedan'), rot=(0, 0, math.radians(0)))


def a_comfort():
    group(vehicle('comfort'))


def a_xl():
    group(vehicle('xl'))


def a_activeTrips():
    tile(2.3, 1.7)
    pts = [(-0.95, 0.5, 0.2), (-0.35, 0.55, 0.2), (0.05, -0.05, 0.2), (0.5, -0.4, 0.2), (0.95, -0.38, 0.2)]
    tube(pts, 0.13, 'jadeLight', flatten=0.3)
    group(vehicle('sedan'), loc=(-0.2, 0.25, 0.22), rot=(0, 0, math.radians(-50)), scale=0.7)
    cyl(0.13, 0.08, (-0.95, 0.5, 0.18), 'aubergine', bevel=0.03)
    pin_small((0.95, -0.38, 0.2), 0.5)


def pin_small(loc, s):
    p = pin_shape('jade')
    p.scale = (s, s, s)
    p.location = loc


def pin_shape(mat):
    """Teardrop map pin standing on its (slightly rounded) tip at the origin; lathed for a clean surface."""
    R, C = 0.56, 1.3
    al = math.asin(R / C)
    prof = [(0.0, 0.0), (0.03, 0.025)]
    tx, tz = R * math.cos(al), C - R * math.sin(al)
    for i in range(1, 9):
        f = i / 9
        prof.append((0.03 + (tx - 0.03) * f, 0.025 + (tz - 0.025) * f))
    for i in range(0, 41):
        phi = -al + (math.pi / 2 + al) * i / 40
        prof.append((max(R * math.cos(phi), 0.0), C + R * math.sin(phi)))
    body = lathe(prof, mat)
    hole = lathe([(0.0, -0.02), (0.2, -0.02), (0.22, 0.0), (0.2, 0.02), (0.0, 0.03)], 'porcelain', loc=(0, -R * 0.97, C), rot=(math.radians(90), 0, 0), steps=64)
    return group([body, hole])


def a_routePin():
    disc = cyl(0.62, 0.06, (0, 0, 0), 'mint', bevel=0.02)
    disc.scale = (1, 1, 1)
    p = pin_shape('jade')
    p.location = (0, 0, 0.06)
    p.rotation_euler = (0, 0, math.radians(30))


def a_navigationPath():
    cyl(1.05, 0.06, (0, 0, 0), 'mint', bevel=0.02)
    pts = [Vector((-0.8, 0.45, 0.07)), Vector((-0.35, 0.05, 0.07)), Vector((0.1, -0.05, 0.07)), Vector((0.55, -0.4, 0.07))]
    samples = []
    for i in range(len(pts) - 1):
        for k in range(4):
            samples.append(pts[i].lerp(pts[i + 1], k / 4))
    samples.append(pts[-1])
    for i in range(0, len(samples) - 1, 2):
        tube([tuple(samples[i]), tuple(samples[i].lerp(samples[i + 1], 0.8))], 0.1, 'jade', flatten=0.5, smooth_pts=False)
    cyl(0.14, 0.06, (-0.8, 0.45, 0.06), 'aubergine', bevel=0.02)
    # navigation arrow standing up, leaning forward along the route
    arrow_pts = [(0, 0.62, 'VECTOR'), (0.45, -0.5, 'VECTOR'), (0, -0.27, 'VECTOR'), (-0.45, -0.5, 'VECTOR')]
    nav = outline_solid(arrow_pts, 0.22, 0.05, 'jade', loc=(0.6, -0.45, 0.5), rot=(math.radians(72), 0, math.radians(38)))
    nav.scale = (0.7, 0.7, 0.7)


def a_completedTrips():
    tile(2.1, 1.6)
    pts = [(-0.85, -0.45, 0.2), (-0.3, -0.4, 0.2), (0.0, 0.1, 0.2), (0.55, 0.25, 0.2)]
    tube(pts, 0.13, 'jadeLight', flatten=0.3)
    cyl(0.13, 0.08, (-0.85, -0.45, 0.18), 'aubergine', bevel=0.03)
    cyl(0.16, 0.07, (0.55, 0.25, 0.18), 'porcelain2', bevel=0.02)
    cyl(0.045, 1.5, (0.55, 0.25, 0.18 + 0.75), 'aubergine', bevel=0.012)
    tbox((0.9, 0.08, 0.6), (0.55 + 0.46, 0.25, 1.0), 'jade', bevel=0.05)
    check((0.55 + 0.48, 0.25 - 0.06, 1.3), 0.55, 'porcelain', thick=0.13, depth=0.05)


def a_driverAvailability():
    wheel = []
    wheel.append(torus(0.9, 0.12, (0, 0, 0), 'porcelain'))
    hub = cyl(0.3, 0.2, (0, 0, -0.1), 'aubergine', bevel=0.05)
    wheel.append(hub)
    wheel.append(cyl(0.12, 0.22, (0, 0, -0.1), 'jade', bevel=0.03))
    for ang in (90, 210, 330):
        a = math.radians(ang)
        sp = tbox((0.62, 0.16, 0.09), (0, 0, -0.045), 'porcelain', bevel=0.04)
        sp.location = (math.cos(a) * 0.6, math.sin(a) * 0.6, -0.045)
        sp.rotation_euler = (0, 0, a)
        wheel.append(sp)
    # jade grip sections
    wheel.append(torus(0.9, 0.128, (0, 0, 0), 'jade', rot=(0, 0, math.radians(150)), arc=60))
    wheel.append(torus(0.9, 0.128, (0, 0, 0), 'jade', rot=(0, 0, math.radians(-30)), arc=60))
    group(wheel, loc=(0, 0, 1.05), rot=(math.radians(68), 0, math.radians(-15)))
    # online badge, outside the rim at the upper right
    sphere(0.17, (1.3, -0.2, 2.15), 'jade')
    torus(0.28, 0.035, (1.3, -0.2, 2.15), 'jadeLight', rot=(math.radians(68), 0, math.radians(-15)))
    cyl(0.75, 0.06, (0, 0.1, 0), 'mint', bevel=0.02)


def wallet_body(loc=(0, 0, 0), rot=(0, 0, 0)):
    parts = []
    parts.append(tbox((1.9, 0.62, 1.3), (0, 0, 0), 'porcelain', bevel=0.16))
    # notes peeking out of the top
    parts.append(tbox((1.55, 0.16, 0.3), (-0.05, 0.08, 1.12), 'mint', bevel=0.05))
    parts.append(tbox((1.5, 0.16, 0.3), (0.05, -0.06, 1.1), 'jadeLight', bevel=0.05))
    flap = tbox((1.92, 0.3, 0.62), (0, -0.2, 0.42), 'jade', bevel=0.12)
    parts.append(flap)
    parts.append(cyl(0.12, 0.08, (0.62, -0.36, 0.73), 'porcelain', bevel=0.025, rot=(math.radians(90), 0, 0)))
    return group(parts, loc, rot)


def a_wallet():
    wallet_body(rot=(0, 0, math.radians(18)))


def a_walletFunding():
    wallet_body(loc=(-0.25, 0.2, 0), rot=(0, 0, math.radians(18)))
    c = coin((0.95, -0.55, 0.55), 0.52, 'jade', rot=(math.radians(80), 0, math.radians(25)))
    plus((0.95, -0.55 - 0.1, 0.55 + 0.02), 0.62, 'porcelain', thick=0.17, depth=0.08, rot=(0, 0, math.radians(25)))


def a_withdrawal():
    parts = []
    parts.append(tbox((1.9, 1.3, 0.16), (0, 0, 0), 'porcelain2', bevel=0.05))
    parts.append(tbox((1.75, 1.15, 0.12), (0, 0, 0.16), 'porcelain', bevel=0.04))
    for x in (-0.6, -0.2, 0.2, 0.6):
        parts.append(cyl(0.11, 0.85, (x, -0.3, 0.28 + 0.425), 'porcelain', bevel=0.03))
        parts.append(cyl(0.11, 0.85, (x, 0.3, 0.28 + 0.425), 'porcelain', bevel=0.03))
    parts.append(tbox((1.85, 1.25, 0.14), (0, 0, 1.13), 'porcelain', bevel=0.04))
    roof = tbox((1.95, 1.35, 0.5), (0, 0, 1.27), 'jade', bevel=0.06, top=(0.06, 0.92))
    parts.append(roof)
    group(parts, loc=(-0.35, 0.2, 0), rot=(0, 0, math.radians(10)))
    arrow(0.7, (0.75, -0.65, 0.75), rot=(0, 0, math.radians(40)), mat='jade', shaft=0.15, head=0.36)
    coin((1.75, 0.35, 0.45), 0.42, 'jade', rot=(math.radians(84), 0, math.radians(40)))


def a_payment():
    # phone with a transfer confirmation (no cards)
    ph = []
    ph.append(tbox((1.05, 0.16, 2.0), (0, 0, 0), 'porcelain', bevel=0.12))
    ph.append(tbox((0.9, 0.04, 1.8), (0, -0.075, 0.1), 'glass', bevel=0.06))
    ph.append(tbox((0.7, 0.03, 0.18), (0, -0.1, 0.3), 'jade', bevel=0.06))
    ph.append(cyl(0.22, 0.03, (0, -0.105, 1.25), 'jade', bevel=0.01, rot=(math.radians(90), 0, 0)))
    ph.append(check((0, -0.13, 1.23), 0.28, 'porcelain', thick=0.13, depth=0.03))
    ph.append(tbox((0.5, 0.03, 0.06), (0, -0.1, 0.8), 'porcelain2', bevel=0.02))
    ph.append(tbox((0.36, 0.03, 0.06), (0, -0.1, 0.66), 'porcelain2', bevel=0.02))
    group(ph, loc=(-0.15, 0, 0.0), rot=(math.radians(-8), 0, math.radians(14)))
    # transfer slip
    slip = tbox((0.75, 0.05, 1.0), (0, 0, 0), 'porcelain', bevel=0.05)
    l1 = tbox((0.5, 0.02, 0.05), (0, -0.03, 0.72), 'jade', bevel=0.015)
    l2 = tbox((0.42, 0.02, 0.04), (-0.04, -0.03, 0.55), 'porcelain2', bevel=0.012)
    l3 = tbox((0.42, 0.02, 0.04), (-0.04, -0.03, 0.42), 'porcelain2', bevel=0.012)
    group([slip, l1, l2, l3], loc=(0.75, -0.3, 0.0), rot=(math.radians(-14), 0, math.radians(-12)))


def a_earnings():
    for i in range(5):
        coin((0.0 + (i % 2) * 0.04, 0, 0.07 + i * 0.15), 0.55, 'jade' if i % 2 == 0 else 'jadeLight', thick=0.14)
    for i in range(3):
        coin((-1.05 + (i % 2) * 0.03, 0.35, 0.07 + i * 0.15), 0.5, 'jadeLight' if i % 2 == 0 else 'jade', thick=0.14)
    coin((0.95, -0.35, 0.5), 0.48, 'jade', rot=(math.radians(78), 0, math.radians(20)))
    arrow(0.55, (0.95, -0.35, 1.05), rot=(0, math.radians(-90), 0), mat='aubergine', shaft=0.12, head=0.3)


def a_refund():
    """Coin with a return arrow curving around it, built facing -Y then turned as one group."""
    parts = [coin((0, 0, 0), 0.6, 'jade', rot=(math.radians(90), 0, 0), thick=0.18)]
    a0, a1, R = math.radians(-35), math.radians(215), 0.95
    parts.append(torus(R, 0.075, (0, 0, 0), 'aubergine', rot=(math.radians(90), 0, 0), arc=math.degrees(a1 - a0)))
    parts[-1].rotation_euler = (math.radians(90), math.radians(-math.degrees(a0)), 0)
    tip = Vector((R * math.cos(a1), 0, R * math.sin(a1)))
    tangent = Vector((-math.sin(a1), 0, math.cos(a1)))
    head = cyl(0.19, 0.34, (0, 0, 0), 'aubergine', bevel=0.02, r2=0.0)
    head.rotation_mode = 'QUATERNION'
    head.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(tangent)
    head.location = tip + tangent * 0.12
    parts.append(head)
    group(parts, loc=(0, 0, 1.15), rot=(0, 0, math.radians(18)))
    cyl(0.85, 0.05, (0, 0, 0), 'mint', bevel=0.02)


def a_subscription():
    parts = []
    parts.append(tbox((1.7, 0.4, 1.6), (0, 0, 0), 'porcelain', bevel=0.14))
    parts.append(tbox((1.72, 0.42, 0.42), (0, 0, 1.2), 'jade', bevel=0.12))
    for x in (-0.45, 0.45):
        parts.append(torus(0.13, 0.04, (x, 0, 1.64), 'aubergine', rot=(math.radians(90), 0, 0)))
    for r in range(3):
        for c in range(4):
            mat = 'jade' if (r, c) == (1, 2) else 'porcelain2'
            parts.append(tbox((0.24, 0.05, 0.18), (-0.51 + c * 0.34, -0.2, 0.2 + r * 0.3), mat, bevel=0.04))
    group(parts, rot=(0, 0, math.radians(18)))


def a_verification():
    card = []
    card.append(tbox((2.0, 0.14, 1.35), (0, 0, 0), 'porcelain', bevel=0.1))
    card.append(tbox((0.62, 0.03, 0.72), (-0.55, -0.075, 0.33), 'mint', bevel=0.05))
    card.append(sphere(0.15, (-0.55, -0.1, 0.78), 'jade'))
    card.append(tbox((0.4, 0.05, 0.2), (-0.55, -0.095, 0.4), 'jade', bevel=0.08, top=(0.75, 1.0)))
    for i, w in enumerate((0.8, 0.6, 0.7)):
        card.append(tbox((w, 0.03, 0.08), (0.2 + w / 2 - 0.35, -0.08, 0.85 - i * 0.22), 'porcelain2', bevel=0.03))
    card.append(tbox((2.02, 0.15, 0.16), (0, 0, 1.15), 'jade', bevel=0.06))
    group(card, rot=(math.radians(-6), 0, math.radians(14)))
    badge = cyl(0.36, 0.14, (0, 0, 0), 'jade', bevel=0.05, rot=(math.radians(90), 0, 0))
    badge.location = (0.95, -0.35, 0.3)
    badge.rotation_euler = (math.radians(90), 0, math.radians(14))
    check((0.95, -0.44, 0.31), 0.42, 'porcelain', thick=0.14, depth=0.06, rot=(0, 0, math.radians(14)))


def a_riderAccount():
    cyl(0.95, 0.06, (0, 0, 0), 'mint', bevel=0.02)
    # shoulders: a lathed dome, flattened front to back; head resting on top
    prof = [(0.0, 0.06)] + [(0.9 * math.cos(t), 0.06 + 0.95 * math.sin(t)) for t in [i * (math.pi / 2) / 24 for i in range(25)]]
    lathe(sorted(prof, key=lambda p: (p[1], p[0])), 'jade', scale=(1, 0.74, 1))
    sphere(0.52, (0, 0, 1.45), 'porcelain')


def a_safetyShield():
    pts = [(-0.93, 0.72), (-0.89, 0.93), (-0.72, 1.0), (0.72, 1.0), (0.89, 0.93), (0.93, 0.72), (0.84, -0.02), (0.0, -1.08, 'VECTOR'), (-0.84, -0.02)]
    s = outline_solid(pts, 0.3, 0.08, 'jade', loc=(0, 0, 1.15), rot=(math.radians(90), 0, math.radians(18)))
    inner = outline_solid([(x * 0.74, y * 0.74 + 0.02, *rest) for (x, y, *rest) in pts], 0.32, 0.05, 'porcelain', loc=(0, -0.03, 1.15), rot=(math.radians(90), 0, math.radians(18)))
    check((0.03, -0.27, 1.2), 0.8, 'jade', thick=0.15, depth=0.06, rot=(0, 0, math.radians(18)))
    cyl(0.75, 0.05, (0, 0, 0), 'mint', bevel=0.02)


def a_supportTicket():
    hs = []
    hs.append(torus(0.75, 0.09, (0, 0, 0), 'porcelain', rot=(math.radians(90), 0, 0), arc=180))
    for x in (-0.75, 0.75):
        hs.append(cyl(0.3, 0.26, (x, 0, -0.05), 'jade', bevel=0.08, rot=(0, math.radians(90), 0)))
        hs.append(cyl(0.24, 0.3, (x * 0.92, 0, -0.05), 'aubergine', bevel=0.06, rot=(0, math.radians(90), 0)))
    hs.append(tube([(-0.85, 0, -0.25), (-0.75, -0.25, -0.5), (-0.35, -0.45, -0.55)], 0.04, 'aubergine'))
    hs.append(sphere(0.09, (-0.32, -0.46, -0.55), 'jade'))
    group(hs, loc=(-0.2, 0, 0.95), rot=(0, 0, math.radians(18)))
    # chat bubble
    bub = tbox((0.9, 0.2, 0.6), (0, 0, 0), 'jade', bevel=0.2)
    tail = tbox((0.2, 0.18, 0.2), (-0.25, 0, -0.1), 'jade', bevel=0.06, rot=(0, math.radians(45), 0))
    dots = [sphere(0.06, (x, -0.11, 0.3), 'porcelain') for x in (-0.22, 0, 0.22)]
    group([bub, tail, *dots], loc=(0.85, -0.65, 1.55), rot=(0, 0, math.radians(18)))
    cyl(0.7, 0.05, (-0.2, 0, 0), 'mint', bevel=0.02)


def gear(r, teeth, thick, mat):
    parts = [cyl(r, thick, (0, 0, 0), mat, bevel=0.04)]
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        t = tbox((0.26 * r * 1.3, 0.34 * r, thick * 0.98), (0, 0, -thick * 0.49), mat, bevel=0.04)
        t.location = (math.cos(a) * r * 1.02, math.sin(a) * r * 1.02, -thick * 0.49)
        t.rotation_euler = (0, 0, a)
        parts.append(t)
    parts.append(cyl(r * 0.36, thick * 1.05, (0, 0, 0), 'porcelain2' if mat != 'porcelain2' else 'jade', bevel=0.03))
    return parts


def a_automation():
    group(gear(0.72, 10, 0.28, 'jade'), loc=(-0.35, 0.15, 0.95), rot=(math.radians(75), 0, math.radians(15)))
    group(gear(0.48, 8, 0.24, 'porcelain'), loc=(0.62, -0.28, 0.58), rot=(math.radians(75), 0, math.radians(15 + 20)))
    cyl(0.95, 0.05, (0, 0, 0), 'mint', bevel=0.02)


def a_server():
    for i in range(3):
        z = i * 0.52
        tbox((1.7, 1.1, 0.44), (0, 0, z), 'porcelain', bevel=0.09)
        tbox((1.0, 0.03, 0.08), (-0.2, -0.555, z + 0.18), 'aubergine', bevel=0.02)
        sphere(0.06, (0.55, -0.56, z + 0.22), 'jade' if i != 1 else 'jadeLight')
        sphere(0.06, (0.72, -0.56, z + 0.22), 'porcelain2' if i != 2 else 'tangerine')


def a_cloudStorage():
    metacloud([(-0.55, 0, 0.0, 0.62), (0.05, 0, 0.25, 0.78), (0.6, 0, 0.0, 0.6), (0.0, 0, -0.15, 0.62), (-0.25, 0.1, -0.2, 0.5), (0.35, -0.1, -0.2, 0.5)], 'porcelain', loc=(0, 0.1, 1.75))
    box = tbox((0.95, 0.75, 0.55), (0, -0.15, 0.0), 'jade', bevel=0.08)
    lid = tbox((1.0, 0.8, 0.1), (0, -0.15, 0.55), 'jadeLight', bevel=0.04)
    handle = tbox((0.34, 0.03, 0.08), (0, -0.54, 0.3), 'porcelain', bevel=0.02)
    arrow(0.28, (0, -0.15, 1.42), rot=(0, math.radians(90), 0), mat='jadeLight', shaft=0.1, head=0.26)


def a_analytics():
    tile(1.95, 1.25)
    heights = (0.5, 0.85, 0.65, 1.3)
    for i, h in enumerate(heights):
        tbox((0.34, 0.55, h), (-0.6 + i * 0.4, 0, 0.16), 'jade' if i == 3 else 'porcelain2' if i % 2 else 'porcelain', bevel=0.07)


ASSETS = {
    'sedan': a_sedan, 'comfort': a_comfort, 'xl': a_xl, 'activeTrips': a_activeTrips, 'completedTrips': a_completedTrips,
    'driverAvailability': a_driverAvailability, 'routePin': a_routePin, 'navigationPath': a_navigationPath,
    'wallet': a_wallet, 'subscription': a_subscription, 'walletFunding': a_walletFunding, 'withdrawal': a_withdrawal,
    'payment': a_payment, 'earnings': a_earnings, 'refund': a_refund,
    'verification': a_verification, 'riderAccount': a_riderAccount, 'safetyShield': a_safetyShield, 'supportTicket': a_supportTicket,
    'automation': a_automation, 'server': a_server, 'cloudStorage': a_cloudStorage, 'analytics': a_analytics,
}

# ---------- Studio rig ----------

AZIMUTH = math.radians(38)   # camera to the front-right
ELEVATION = math.radians(32)


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.resolution_x = sc.render.resolution_y = RENDER_PX
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.55
    return sc


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def add_light(name, kind, energy, size, loc, target=(0, 0, 0.6)):
    l = bpy.data.lights.new(name, kind)
    l.energy = energy
    if kind == 'AREA':
        l.size = size
    o = bpy.data.objects.new(name, l)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


def visible_objects():
    return [o for o in bpy.context.scene.objects if o.type in {'MESH', 'CURVE', 'META'} and not o.get('ground')]


def frame_and_light(sc):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in visible_objects():
        # Real geometry, not bound boxes: curve bound boxes include Bézier handles and overshoot.
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        mw = ev.matrix_world
        step = max(1, len(me.vertices) // 4000)
        pts.extend(mw @ v.co for v in me.vertices[::step])
        ev.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length, 1.0) * 3
    cam_dir = Vector((math.sin(AZIMUTH) * math.cos(ELEVATION), -math.cos(AZIMUTH) * math.cos(ELEVATION), math.sin(ELEVATION)))
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.location = centre + cam_dir * radius
    look_at(co, centre)
    bpy.context.view_layer.update()
    inv = co.matrix_world.inverted()
    xs, ys = [], []
    for p in pts:
        q = inv @ p
        xs.append(q.x)
        ys.append(q.y)
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    # shift the camera so the projected box is centred (slightly low, leaving room for the shadow)
    co.location = co.location + co.matrix_world.to_3x3() @ Vector((cx, cy - h * 0.02, 0))
    cam.ortho_scale = max(w, h) / FILL
    sc.camera = co
    # ground shadow catcher
    bpy.ops.mesh.primitive_plane_add(size=60, location=(centre.x, centre.y, lo.z if lo.z > -0.01 else 0))
    g = bpy.context.object
    g['ground'] = True
    g.is_shadow_catcher = True
    # lights: large soft key upper-left (relative to camera), fill right, rim behind
    s = max((hi - lo).length, 2.0)
    right = co.matrix_world.to_3x3() @ Vector((1, 0, 0))
    back = -cam_dir
    up = Vector((0, 0, 1))
    add_light('key', 'AREA', 260 * s * s / 4, s * 2.2, centre + (-right * 1.4 + up * 2.2 + cam_dir * 0.8).normalized() * s * 2.2, centre)
    add_light('fill', 'AREA', 70 * s * s / 4, s * 2.5, centre + (right * 1.5 + up * 0.6 + cam_dir).normalized() * s * 2.4, centre)
    add_light('rim', 'AREA', 120 * s * s / 4, s * 1.4, centre + (back * 1.2 + up * 1.2 + right * 0.3).normalized() * s * 2.2, centre)


def render(name):
    from PIL import Image

    sc = setup_scene()
    ASSETS[name]()
    frame_and_light(sc)
    os.makedirs(TMP_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    png = os.path.join(TMP_DIR, f'{name}.png')
    sc.render.filepath = png
    bpy.ops.render.render(write_still=True)
    return postprocess(name)


def postprocess(name):
    """Downsample the 640 px render to 320 px WebP, fading the soft ground shadow out before the image
    edge so no box shows on a white page (the object itself sits well inside the faded margin)."""
    from PIL import Image, ImageChops

    png = os.path.join(TMP_DIR, f'{name}.png')
    im = Image.open(png).convert('RGBA').resize((OUT_PX, OUT_PX), Image.LANCZOS)
    margin = int(OUT_PX * 0.14)
    ramp = [min(1.0, min(i, OUT_PX - 1 - i) / margin) for i in range(OUT_PX)]
    ramp = [r * r * (3 - 2 * r) for r in ramp]  # smoothstep
    fade = Image.new('L', (OUT_PX, OUT_PX))
    fade.putdata([int(255 * ramp[x] * ramp[y]) for y in range(OUT_PX) for x in range(OUT_PX)])
    r, g, b, a = im.split()
    # Soften the shadow catcher's broad ambient haze (partial alpha) while keeping the contact shadow
    # under the object; the object itself is fully opaque and unchanged.
    a = a.point([int(255 * (v / 255) ** 1.8) for v in range(256)])
    im = Image.merge('RGBA', (r, g, b, ImageChops.multiply(a, fade)))
    out = os.path.join(OUT_DIR, f'{name}.webp')
    im.save(out, 'WEBP', quality=90, method=6)
    return out


def contact_sheet():
    from PIL import Image, ImageDraw, ImageFont

    names = list(ASSETS)
    cols = 6
    cell = 220
    pad = 28
    rows = math.ceil(len(names) / cols)
    sheet = Image.new('RGB', (cols * cell, rows * (cell + pad) + 60), 'white')
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(os.path.join(ROOT, 'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'), 18)
        title = ImageFont.truetype(os.path.join(ROOT, 'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'), 22)
    except OSError:
        font = title = ImageFont.load_default()
    d.text((20, 18), 'GoBye dimensional icons (procedural renders, tools/3d/render.py)', fill=(37, 22, 50), font=title)
    for i, n in enumerate(names):
        p = os.path.join(OUT_DIR, f'{n}.webp')
        x, y = (i % cols) * cell, 60 + (i // cols) * (cell + pad)
        if os.path.exists(p):
            im = Image.open(p).convert('RGBA').resize((cell - 30, cell - 30), Image.LANCZOS)
            sheet.paste(im, (x + 15, y), im)
        tw = d.textlength(n, font=font)
        d.text((x + (cell - tw) / 2, y + cell - 22), n, fill=(86, 96, 91), font=font)
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    sheet.save(SHEET, optimize=True)
    return SHEET


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--post' in sys.argv:
        for n in args or list(ASSETS):
            print(n, os.path.getsize(postprocess(n)) // 1024, 'KB')
    elif '--sheet' not in sys.argv:
        names = args or list(ASSETS)
        unknown = [n for n in names if n not in ASSETS]
        if unknown:
            raise SystemExit(f'Unknown asset(s): {unknown}. Known: {list(ASSETS)}')
        t0 = time.time()
        for n in names:
            t = time.time()
            out = render(n)
            print(f'{n}: {os.path.getsize(out) // 1024} KB in {time.time() - t:.0f}s', flush=True)
        print(f'total {time.time() - t0:.0f}s')
    print('sheet', contact_sheet())
