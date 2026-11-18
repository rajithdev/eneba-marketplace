"""Prepares the homepage's pictures from crops of a design mock-up.

The crops carry more than artwork: a rank badge, a few letters of a
headline, carousel dots, a card's border, text. This keeps only the
artwork. What it does to each picture:

  hero     the right-hand artwork of the featured banner, with the two
           letters of the headline and the dots painted out
  scenes   the picture at the top of each best-seller card, with the rank
           badge painted out (the page draws its own over the same spot)
  promos   the little illustration in each promotional tile, cut out with
           soft edges so it sits on the page's own tile

"Painted out" means filled in from the surrounding pixels, smoothly. The
crops are small (a card's picture is about 200 pixels wide), so everything
is saved at twice its size, which is as sharp as these sources can be.

usage (Blender's Python has numpy; nothing is installed):
  PY=/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13
  $PY -I scripts/design/home_art.py <folder with the crops> web/public/covers/art
"""

import os
import subprocess
import sys

import numpy as np


def load(path):
    w, h = map(int, subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], check=True, capture_output=True, text=True).stdout.strip().split(","))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w, 3).astype(np.float32)


def paint_out(picture, boxes):
    """Fills each box (left, top, right, bottom) from what surrounds it: every pixel inside settles to the average of its neighbours."""
    hidden = np.zeros(picture.shape[:2], bool)
    for left, top, right, bottom in boxes:
        hidden[top:bottom, left:right] = True
    out = picture.copy()
    out[hidden] = out[~hidden].mean(0)
    for _ in range(600):
        around = (np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 4
        out[hidden] = around[hidden]
    return out


def save(picture, path, scale=2, alpha=None):
    """Writes the picture at `scale` times its size: JPEG, or PNG when it has soft edges."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    h, w = picture.shape[:2]
    data = np.clip(picture + 0.5, 0, 255).astype(np.uint8)
    if alpha is not None:
        data = np.dstack([data, np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)])
    kind = "rgba" if alpha is not None else "rgb24"
    quality = [] if alpha is not None else ["-q:v", "3"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", kind, "-s", f"{w}x{h}", "-i", "-", "-vf", f"scale={w * scale}:{h * scale}:flags=lanczos", *quality, path], input=data.tobytes(), check=True)
    print(f"{path}: {w * scale}x{h * scale}, {os.path.getsize(path) // 1024} KB")


source, out = sys.argv[1], sys.argv[2]

# The featured banner's artwork. "he" of the headline and the carousel dots are in its left edge.
hero = paint_out(load(f"{source}/02_hero_art_right.png"), [(0, 84, 82, 152), (4, 344, 78, 371)])
save(hero[4:367, 0:446], f"{out}/hero/elden-ring-shadow-of-the-erdtree.jpg")

# The best-seller pictures: inside the card's border, down to where the text begins.
for name, game in [("05_best_seller_GTA_V", "grand-theft-auto-v"), ("06_best_seller_Minecraft", "minecraft"), ("07_best_seller_EA_Sports_FC25", "ea-sports-fc-25"),
                   ("08_best_seller_Elden_Ring", "elden-ring"), ("09_best_seller_Baldurs_Gate_3", "baldurs-gate-3"), ("10_best_seller_Cyberpunk_2077", "cyberpunk-2077")]:
    card = paint_out(load(f"{source}/{name}.png"), [(8, 14, 66, 60)])
    save(card[9:172, 7:card.shape[1] - 7], f"{out}/scene/{game}.jpg")

# The tiles' illustrations: a square around each, fading out toward its edges.
for name, promo, (left, top) in [("03_gift_cards_tile", "gift-cards", (32, 16)), ("04_subscriptions_tile", "subscriptions", (36, 14))]:
    side = 162
    tile = load(f"{source}/{name}.png")[top:top + side, left:left + side]
    y, x = np.mgrid[0:side, 0:side]
    far = np.maximum(np.abs(x - (side - 1) / 2), np.abs(y - (side - 1) / 2)) / (side / 2)  # 0 in the middle, 1 at the edge
    t = np.clip((1 - far) / 0.22, 0, 1)
    save(tile, f"{out}/promo/{promo}.png", alpha=t * t * (3 - 2 * t))
