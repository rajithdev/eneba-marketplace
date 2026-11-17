"""Turns supplied pictures into covers for the six hero cases: 3:4, 900x1200.

Each picture is cut to the part named in a list (a JSON file), never
stretched. Where that part is wider than 3:4, cutting it down further would
lose the title, so it sits at the top of the cover at full width and the
space below it is filled with its own reflection, blurred and darkened, the
two eased into each other. The cover then ends in a dark foot instead of a
hard band.

The list: [{"file": "image.png", "name": "1-minecraft", "crop": [x, y, width, height]}, ...]
with file names relative to the list's own folder.

usage (Blender's Python has numpy; nothing is installed):
  PY=/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13
  $PY -I cinematic/prepare_covers.py <list.json> <out folder>
"""

import json
import os
import subprocess
import sys

import numpy as np

WIDTH, HEIGHT = 900, 1200
EASE = 150  # rows over which the picture gives way to its reflection
FOOT = 0.42  # how bright the reflection is left


def pixels(path, filters, width, height):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", filters, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(height, width, 3).astype(np.float32)


def prepare(source, crop, target):
    x, y, w, h = crop
    tall = round(WIDTH * h / w)  # the cut's height once it is as wide as the cover
    cut = f"crop={w}:{h}:{x}:{y},scale={WIDTH}:{tall}:flags=lanczos"
    if tall >= HEIGHT:
        # Already 3:4 or taller: the middle 3:4 of it is the cover.
        cover = pixels(source, f"{cut},crop={WIDTH}:{HEIGHT}", WIDTH, HEIGHT)
        band = 0
    else:
        band = HEIGHT - tall
        whole = f"{cut},split[a][b];[b]vflip[c];[a][c]vstack,crop={WIDTH}:{HEIGHT}:0:0"
        sharp = pixels(source, whole, WIDTH, HEIGHT)
        soft = pixels(source, f"{whole},gblur=sigma=28", WIDTH, HEIGHT) * FOOT
        rows = np.arange(HEIGHT, dtype=np.float32)
        t = np.clip((rows - (tall - EASE)) / EASE, 0, 1)
        share = (t * t * (3 - 2 * t))[:, None, None]  # 0 in the picture, 1 from its lower edge down
        cover = sharp * (1 - share) + soft * share
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-i", "-", target],
                   input=np.clip(cover + 0.5, 0, 255).astype(np.uint8).tobytes(), check=True)
    return band


if __name__ == "__main__":
    listing, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for entry in json.load(open(listing)):
        band = prepare(os.path.join(os.path.dirname(listing), entry["file"]), entry["crop"], os.path.join(out, entry["name"] + ".png"))
        print(f"{entry['name']}: from {entry['file']}, cut {entry['crop']}, " + (f"foot of {band} rows ({band / HEIGHT:.0%})" if band else "fills the cover"))
