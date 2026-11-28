"""Makes the car picture in each paint colour (D-108): python3 tools/tint-cars.py

Reads packages/ui/assets/brand/sedan.webp (white body) and writes packages/ui/assets/cars/sedan-<colour>.webp.
Only the paint changes: glass, roof, tyres, rims, grille, lights and the orange line stay as they are.
Needs Pillow. Run again after changing the colours in packages/ui/src/components/shared/vehicleColours.ts.
"""
import colorsys
from PIL import Image

COLOURS = {'black': '#1B1B1D', 'silver': '#BFC3C9', 'grey': '#74787F', 'blue': '#2456A6', 'red': '#B3261E', 'wine': '#6E1423', 'green': '#2E7D4F', 'brown': '#6B4A3A', 'gold': '#C4A24A', 'yellow': '#F0C419', 'orange': '#E8731A'}
# The two rims (they stay silver): ellipses measured on the 512 x 334 render.
RIMS = ((236, 256, 28, 34), (444, 193, 22, 28))

src = Image.open('packages/ui/assets/brand/sedan.webp').convert('RGBA')
W, H = src.size
px = src.load()
rim = lambda x, y: any(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 for cx, cy, rx, ry in RIMS)

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
            # Paint is light and nearly colourless; everything else on the car is dark or coloured.
            if s < 0.16 and v > 0.50 and not rim(x, y):
                t = (v - 0.50) / 0.50                      # 0 in the deepest shadow, 1 on the brightest panel
                shade = 0.42 + 0.58 * t                    # keeps folds and panel lines
                spec = max(0.0, (t - 0.9) / 0.1) ** 2 * 0.35  # a little white on the highlights
                edge = min(1.0, (v - 0.50) / 0.08) * min(1.0, (0.16 - s) / 0.05)  # soft edge, no hard outline
                n = [min(1.0, c * shade + spec) for c in (r0, g0, b0)]
                o[x, y] = tuple(int((p / 255 * (1 - edge) + q * edge) * 255) for p, q in zip((r, g, b), n)) + (a,)
    out.save(f'packages/ui/assets/cars/sedan-{name}.webp', quality=86, method=6)
    print('wrote', name)
