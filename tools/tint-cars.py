"""Makes the car picture in each paint colour (D-108): python3 tools/tint-cars.py

Reads packages/ui/assets/brand/sedan.webp (white body) and writes packages/ui/assets/cars/sedan-<colour>.webp.
Only the paint changes: glass, roof, tyres, rims, grille, lights and the orange line stay as they are.
Needs Pillow. Run again after changing the colours in packages/ui/src/components/shared/vehicleColours.ts.
"""
import colorsys
from PIL import Image

COLOURS = {'black': '#1B1B1D', 'silver': '#BFC3C9', 'grey': '#74787F', 'blue': '#2456A6', 'red': '#B3261E', 'wine': '#6E1423', 'green': '#2E7D4F', 'brown': '#6B4A3A', 'gold': '#C4A24A', 'yellow': '#F0C419', 'orange': '#E8731A'}
# The two rims (they stay silver) and, around them, the tyres: ellipses measured on the 512 x 334 render.
RIMS = ((236, 256, 28, 34), (444, 193, 22, 28))
TYRES = ((236, 254, 46, 54), (444, 192, 36, 46))

src = Image.open('packages/ui/assets/brand/sedan.webp').convert('RGBA')
W, H = src.size
px = src.load()
inside = lambda x, y, shapes: any(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 for cx, cy, rx, ry in shapes)
step = lambda lo, hi, v: max(0.0, min(1.0, (v - lo) / (hi - lo)))

for name, hexc in COLOURS.items():
    r0, g0, b0 = [int(hexc[k:k + 2], 16) / 255 for k in (1, 3, 5)]
    out = src.copy()
    o = out.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if inside(x, y, RIMS):
                continue
            # How much of this pixel is paint: paint is light and nearly colourless. The weight fades in, so
            # the soft pixels where a white panel meets a dark line are tinted too (no pale outline is left).
            w = step(0.26, 0.50, v) * (1 - step(0.14, 0.24, s))
            # Dark grey on the tyres is rubber, not a shadow on paint.
            if v < 0.55 and inside(x, y, TYRES):
                w = 0.0
            if w <= 0:
                continue
            # The white render's light and shade, stretched so the panels keep their shape in a dark colour.
            shade = 0.30 + 0.70 * step(0.25, 1.0, v) ** 2.2
            spec = step(0.965, 1.0, v) ** 2 * 0.30      # a touch of white on the brightest highlights
            n = [min(1.0, c * shade + spec) for c in (r0, g0, b0)]
            o[x, y] = tuple(int(round((p / 255 * (1 - w) + q * w) * 255)) for p, q in zip((r, g, b), n)) + (a,)
    out.save(f'packages/ui/assets/cars/sedan-{name}.webp', quality=86, method=6)
    print('wrote', name)
