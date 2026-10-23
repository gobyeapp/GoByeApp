# GoBye dimensional icons (3D-style assets)

The owner's brief (§5.2) asks for a second icon layer: small, tactile, almost three-dimensional objects for
the dashboard's most important moments. This document covers what exists, where to use it and how it is
made.

**Status:**
- These are **procedural renders produced in this repository** (`tools/3d/render.py`, Blender + Cycles). They are a cohesive working family for the admin dashboard.
- They are **not final brand art.** A designer or art director may refine shapes, proportions or materials later, and can replace any file at the same path without code changes.
- Review sheet: `docs/assets/3d/contact-sheet.png`.

## Where they may be used

- **Use them in:**
  - featured KPI cards (one asset per card, beside the number, never covering text);
  - key operational summaries and feature introductions;
  - empty states and success states.
- **Never use them in:**
  - table rows or list items;
  - buttons, navigation or form controls (those use MingCute functional icons);
  - anything smaller than about 48 px.
- At most one or two per screen region; they support the information, they don't decorate it.
- Display sizes: 64 to 120 px. Files are 320 × 320 px, enough for 2× screens at 160 px.
- They are decorative: `alt=""` / `aria-hidden`, with the meaning carried by the text next to them.
- In the admin they are loaded by the `<Dimensional name="…" />` component, which falls back to a neutral placeholder when a file is missing.

## The family

| Group | Names |
|---|---|
| Mobility | `sedan`, `comfort`, `xl`, `activeTrips`, `completedTrips`, `driverAvailability`, `routePin`, `navigationPath` |
| Financial | `wallet`, `subscription`, `walletFunding`, `withdrawal`, `payment`, `earnings`, `refund` |
| Operations | `verification`, `riderAccount`, `safetyShield`, `supportTicket`, `automation`, `server`, `cloudStorage`, `analytics` |

Files: `apps/admin/src/assets/3d/<name>.webp`, all 320 × 320, transparent, 10–20 KB each (about 270 KB on disk for the whole family).

## Art direction (shared by every asset)

- **Camera:**
  - orthographic three-quarter view, 38° azimuth from the front-right, 32° elevation;
  - framed automatically so the object fills about 72% of the frame, centred;
  - the same rules for every asset, so they sit together at equal visual weight.
- **Lighting:**
  - large soft area key from the upper left (relative to the camera);
  - soft fill from the right;
  - subtle rim from behind;
  - white world light for gentle ambient occlusion.
- **Ground:** a shadow-catcher plane gives a soft contact shadow; the background is transparent.
- **Colour:** AgX view transform with the Medium High Contrast look.
- **Materials** (sRGB values converted to linear in the script):

| Material | Colour | Used for |
|---|---|---|
| Porcelain | `#F4F2EE` | Bodies. Matte (roughness 0.42) with a light clear coat for a polished highlight. |
| Warm grey | `#E6E3DD` | Secondary parts |
| Jade | `#0B7A5B` | The main accent |
| Jade light | `#3FAE86` | Secondary accent |
| Mint | `#CFEBDD` | Small bases and plates |
| Aubergine | `#251632` | Small dark details: tyres, hubs, arrows |
| Dark glass | `#2B2238` | Windows and screens |
| Tangerine | `#FF8A3D` | One tiny detail at most (tail light, status LED) |

- **Geometry:**
  - bevelled primitives, lathed profiles, curve tubes and metaballs;
  - rounded and restrained;
  - realistic proportions, nothing rubbery or toy-like;
  - no text, logos, card numbers or credit cards (GoBye has no cards, D-023).

## Regenerate or change

```bash
pip install --break-system-packages bpy pillow    # Blender as a Python module + Pillow
python3 tools/3d/render.py                        # all 23 (about 25 minutes on CPU)
python3 tools/3d/render.py sedan wallet           # only these
python3 tools/3d/render.py --sheet                # rebuild the contact sheet
python3 tools/3d/render.py --post                 # redo the WebP files from the saved 640 px renders
```

How the script works:
- Renders 640 px with 96 samples and denoising, then downsamples to 320 px WebP (quality 90). About 65 seconds per asset on CPU.
- Post-processing softens the shadow catcher's broad ambient haze (partial alpha raised to the power 1.8) and fades the outer 14% of the image to transparent, so no shadow box shows on a white page. The objects themselves stay fully opaque.
- Intermediate PNGs go to `tools/3d/.renders/` (git-ignored).
- Each asset is one function (`a_<name>`). The rig (`setup_scene`, `frame_and_light`) and materials (`PALETTE`) are shared, so a change there updates the whole family consistently.

## Known weaker assets (candidates for art direction)

- `xl`: the dark window band is heavy at small sizes.
- `comfort`: reads as "a nicer sedan" mainly through its jade skirt and rims; a designer may want a more distinct silhouette.
- `navigationPath` and `activeTrips`: the most detailed scenes, so they lose detail below about 64 px. Prefer `routePin` or `sedan` at small sizes.
- `payment`: phone plus transfer slip; legible, but it is the least iconic of the financial set.
