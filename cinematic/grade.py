"""A colour grade for the rendered frames: fitted once to a reference picture,
then applied the same way to every frame of every layout.

The grade is a fixed rule from one colour to another. It never looks at the
frame it is applied to, so the same surface gets the same colour in every
frame and nothing can jump between frames. It is stored as a standard colour
table (a .cube file), which ffmpeg, Blender and most editing tools can use.

What the rule does, in order:

  tones    a curve from brightness to brightness, fitted so the frame's spread
           of light and dark matches the reference's: deeper blacks, fuller
           highlights, the middle left where it was
  wash     surfaces bathed in violet light (walls, ceiling, floor) are taken
           down and toward neutral, as the reference has them, while violet
           that is bright (the neon itself) is left alone
  colour   how much colour is kept, by hue and by brightness, fitted to the
           reference; the darkest areas lose more still, and the warm accents
           (red through gold) keep nearly all of theirs

The reference is a repaint of frame 0, so the two pictures line up and can be
compared place by place.

How much of the grade a frame gets is a function of how far through the move
it is. The last frame must be exactly the render: its background is the
page's own colour and its six cases are the real covers, which is what lets
it become the page. So the grade is full for most of the move and eases to
nothing over the final stretch.

usage (Blender's Python has numpy; nothing is installed):
  PY=/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13
  $PY -I cinematic/grade.py fit   <frame 0.png> <reference.png> <grade.cube>     also writes the rule as <grade.json>
  $PY -I cinematic/grade.py bake  <grade.json> <grade.cube>                     the colour table again, from the rule
  $PY -I cinematic/grade.py apply <grade.cube> <folder of f-NNN.png> <out folder>
"""

import json
import os
import subprocess
import sys

import numpy as np

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
SIZE = 33  # points along each side of the colour table
HUES, LEVELS = 24, 6  # how finely colour is treated, by hue and by brightness
FULL_UNTIL, GONE_BY = 0.78, 0.98  # the share of the move with the full grade, and where it has eased to nothing


def load(path, size=None):
    scale = ["-vf", f"scale={size[0]}:{size[1]}:flags=area"] if size else []
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
                           check=True, capture_output=True, text=True).stdout.strip().split(",")
    w, h = size or (int(probe[0]), int(probe[1]))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, *scale, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w, 3).astype(np.float32) / 255


def hue_of(rgb):
    """Hue as a turn of the colour wheel, 0 to 1 (red, yellow, green, cyan, blue, magenta, red)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    top, spread = rgb.max(-1), np.maximum(rgb.max(-1) - rgb.min(-1), 1e-6)
    turn = np.where(top == r, ((g - b) / spread) % 6, np.where(top == g, (b - r) / spread + 2, (r - g) / spread + 4))
    return turn / 6


def lookup(table, hue, light):
    """Reads the hue-by-brightness table at each pixel, blending between its neighbours."""
    h = hue * HUES
    h0 = np.floor(h).astype(int) % HUES
    h1, hf = (h0 + 1) % HUES, h - np.floor(h)
    level = np.clip(light * LEVELS - 0.5, 0, LEVELS - 1)
    l0 = np.floor(level).astype(int)
    l1, lf = np.minimum(l0 + 1, LEVELS - 1), level - np.floor(level)
    return ((table[h0, l0] * (1 - hf) + table[h1, l0] * hf) * (1 - lf) + (table[h0, l1] * (1 - hf) + table[h1, l1] * hf) * lf)


def smooth_step(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def washed(rgb, light, rule):
    """How much a pixel is violet wash and not violet light: 1 for a dim,
    strongly violet surface, 0 for anything bright or any other hue."""
    hue = hue_of(rgb)
    low, high = rule["wash_hues"]
    violet = smooth_step(low - 0.04, low, hue) * (1 - smooth_step(high, high + 0.04, hue))
    coloured = smooth_step(0.15, 0.4, (rgb.max(-1) - rgb.min(-1)) / np.maximum(rgb.max(-1), 1e-4))
    return violet * coloured * (1 - smooth_step(rule["wash_until"] * 0.5, rule["wash_until"], light))


def grade(rgb, rule):
    """The rule itself: tones, wash, colour."""
    light = rgb @ LUMA
    wash = washed(rgb, light, rule)
    toned = np.interp(light, rule["tone_in"], rule["tone_out"]) * (1 - wash * (1 - rule["wash_brightness"]))
    out = rgb * (toned / np.maximum(light, 1e-4))[..., None]
    keep = lookup(np.asarray(rule["colour_kept"], np.float32), hue_of(rgb), toned) * (1 - wash * (1 - rule["wash_colour"]))
    # The darkest areas give up more of their colour still, easing in from
    # black: shadows in the reference are close to neutral, not purple.
    floor = rule["shadow_colour"]
    keep = keep * (floor + (1 - floor) * smooth_step(0, rule["shadow_until"], toned))
    return np.clip(toned[..., None] + (out - toned[..., None]) * keep[..., None], 0, 1)


def fit(frame_path, reference_path):
    # Compared small, so that what is matched is areas of the picture and not fine detail.
    ours, theirs = load(frame_path, (320, 180)), load(reference_path, (320, 180))

    # Tones: where each share of our pixels sits in brightness, against where
    # the reference's does. (Matching the two spreads, not place against
    # place: that would average the reference's detail away and flatten it.)
    shares = np.linspace(0, 1, 101)
    tone_in = np.concatenate([[0.0], np.quantile(ours @ LUMA, shares[1:-1]), [1.0]])
    tone_out = np.concatenate([[0.0], np.quantile(theirs @ LUMA, shares[1:-1]), [1.0]])
    grid = np.linspace(0, 1, 33)
    # Never below a quarter of the original brightness: the aim is depth in
    # the blacks, not a darker picture.
    curve = np.maximum(grid * 0.25, np.interp(grid, tone_in, tone_out))
    curve[0] = 0.0
    curve = np.maximum.accumulate(np.convolve(np.pad(curve, 1, mode="edge"), np.ones(3) / 3, mode="valid"))
    curve[0], curve[-1] = 0.0, max(curve[-1], 1.0)

    # Colour: with tones matched, how strong colour is in the reference
    # compared with ours, for each hue at each brightness.
    light = ours @ LUMA
    toned = np.interp(light, grid, curve)
    scaled = ours * (toned / np.maximum(light, 1e-4))[..., None]
    our_colour = np.linalg.norm(scaled - toned[..., None], axis=-1)
    their_colour = np.linalg.norm(theirs - (theirs @ LUMA)[..., None], axis=-1)
    hue = (hue_of(ours) * HUES).astype(int) % HUES
    level = np.clip((toned * LEVELS).astype(int), 0, LEVELS - 1)
    had, has = np.zeros((HUES, LEVELS)), np.zeros((HUES, LEVELS))
    np.add.at(had, (hue, level), our_colour)
    np.add.at(has, (hue, level), their_colour)
    overall = has.sum() / had.sum()
    by_hue = (has.sum(1) + overall * 2) / (had.sum(1) + 2)  # a hue seen too little leans on the whole picture
    kept = (has + by_hue[:, None] * 3) / (had + 3)  # and a brightness seen too little leans on its hue
    kept = (np.roll(kept, 1, 0) + 2 * kept + np.roll(kept, -1, 0)) / 4  # neighbouring hues are treated alike
    kept = np.clip(kept, 0.35, 1.1)
    # The warm accents keep nearly all their colour whatever the fit says:
    # they are what the violet is set against.
    warm = [0, 1, 2, 3, HUES - 1]
    kept[warm] = np.maximum(kept[warm], 0.92)

    return {
        "tone_in": grid.tolist(), "tone_out": curve.tolist(), "colour_kept": kept.tolist(),
        "shadow_colour": 0.45, "shadow_until": 0.16,
        # Violet wash: blue-violet through purple, dimmer than this, comes out
        # at this share of its brightness and this share of its colour. Set by
        # eye against the reference, where those surfaces are lit differently
        # and a fit has nothing to hold on to.
        "wash_hues": [0.68, 0.84], "wash_until": 0.42, "wash_brightness": 0.82, "wash_colour": 0.55,
        "fitted_to": os.path.basename(reference_path), "colour_kept_overall": round(float(overall), 3),
    }


def write_cube(rule, path):
    axis = np.linspace(0, 1, SIZE, dtype=np.float32)
    b, g, r = np.meshgrid(axis, axis, axis, indexing="ij")  # red changes fastest, as the format wants
    table = grade(np.stack([r, g, b], -1).reshape(-1, 3), rule)
    with open(path, "w") as out:
        out.write(f"TITLE \"vault grade, fitted to {rule['fitted_to']}\"\nLUT_3D_SIZE {SIZE}\n")
        out.writelines(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n" for p in table)
    with open(os.path.splitext(path)[0] + ".json", "w") as out:
        json.dump(rule, out, indent=1)


def strength(frame, frames):
    """How much of the grade a frame gets: all of it, easing to none at the end of the move."""
    t = min(1.0, max(0.0, (frame / (frames - 1) - FULL_UNTIL) / (GONE_BY - FULL_UNTIL)))
    return 1 - t * t * (3 - 2 * t)


def apply(cube, folder, out):
    os.makedirs(out, exist_ok=True)
    names = sorted(name for name in os.listdir(folder) if name.startswith("f-") and name.endswith(".png"))
    layout = os.path.join(folder, "layout.json")
    frames = json.load(open(layout))["frames"] if os.path.exists(layout) else len(names)
    for name in names:
        share = strength(int(name[2:5]), frames)
        source, target = os.path.join(folder, name), os.path.join(out, name)
        if share == 0:
            subprocess.run(["cp", source, target], check=True)  # untouched: the frame the page takes over from
            continue
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", source, "-filter_complex",
                        f"format=rgb24,split[plain][g];[g]lut3d=file='{cube}':interp=tetrahedral[graded];"
                        f"[plain][graded]blend=all_expr='A*{1 - share:.4f}+B*{share:.4f}'", "-pix_fmt", "rgb24", target], check=True)
    print(f"{len(names)} frames graded into {out}")


if __name__ == "__main__":
    if sys.argv[1] == "fit":
        rule = fit(sys.argv[2], sys.argv[3])
        write_cube(rule, sys.argv[4])
        print("tones (in > out):", " ".join(f"{a:.2f}>{b:.2f}" for a, b in list(zip(rule["tone_in"], rule["tone_out"]))[::4]))
        print("colour kept overall:", rule["colour_kept_overall"])
    elif sys.argv[1] == "bake":
        write_cube(json.load(open(sys.argv[2])), sys.argv[3])
    elif sys.argv[1] == "apply":
        apply(*sys.argv[2:5])
