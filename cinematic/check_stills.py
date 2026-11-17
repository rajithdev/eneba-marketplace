"""Check repainted stills against the Blender frames they were made from.

Three pictures are meant to show one store from the animation's own camera
positions. This measures what can be measured about that; whether they
look real is judged by eye.

  structure  do the outlines sit where the Blender frame's do, and if the
             picture is shifted, by how much
  aisle      is the middle of the floor as empty of outlines as in Blender
  one store  do the three pictures share their colours, as the three
             Blender frames do with each other

usage (Blender's Python has numpy; nothing is installed):
  /Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 -I \
      cinematic/check_stills.py <folder of Blender frames> <folder of candidates>

Both folders hold three pictures whose names sort in the same order
(opening, mid-corridor, doorway).
"""

import os
import subprocess
import sys

import numpy as np

SIZE = (640, 360)


def load(path):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={SIZE[0]}:{SIZE[1]}:flags=area",
                          "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(out, np.uint8).reshape(SIZE[1], SIZE[0], 3).astype(np.float32)


def edges(rgb):
    g = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    return np.log1p(np.hypot(g[1:-1, 2:] - g[1:-1, :-2], g[2:, 1:-1] - g[:-2, 1:-1]))


def alike(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def best_shift(a, b, reach=16):
    """The shift of b, in pixels of a 1280-wide picture, at which its outlines agree best with a's."""
    m = reach + 1
    core = a[m:-m, m:-m]
    scores = {(dx, dy): alike(core, b[m + dy:b.shape[0] - m + dy, m + dx:b.shape[1] - m + dx])
              for dy in range(-reach, reach + 1, 2) for dx in range(-reach, reach + 1, 2)}
    (dx, dy), score = max(scores.items(), key=lambda item: item[1])
    return score, dx * 2, dy * 2


def colours(rgb):
    """How much of the picture is each of 512 colours."""
    cells = (rgb // 32).astype(np.int32)
    histogram = np.bincount((cells[..., 0] * 64 + cells[..., 1] * 8 + cells[..., 2]).ravel(), minlength=512).astype(np.float32)
    return histogram / histogram.sum()


def shared(a, b):
    """The share of colour two pictures have in common (1 = the same palette in the same amounts)."""
    return float(np.minimum(colours(a), colours(b)).sum())


def pictures(folder):
    names = sorted(name for name in os.listdir(folder) if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
    return [(name, load(os.path.join(folder, name))) for name in names]


def main():
    blender, candidates = pictures(sys.argv[1]), pictures(sys.argv[2])
    print("structure and aisle")
    for (name, ours), (other, theirs) in zip(blender, candidates):
        a, b = edges(ours), edges(theirs)
        score, dx, dy = best_shift(a, b)
        # The aisle: the middle fifth of the width, in the lower half, where only floor should be.
        h, w = a.shape
        floor = (slice(int(h * 0.62), int(h * 0.95)), slice(int(w * 0.42), int(w * 0.58)))
        print(f"  {other:28s} against {name:28s} outlines {alike(a, b):.2f} as given, {score:.2f} at a shift of {dx:+d},{dy:+d} px;"
              f" outlines in the aisle {b[floor].mean() / (a[floor].mean() + 1e-6):.2f} times Blender's")
    print("one store: colour shared between pictures (opening/mid, mid/doorway, opening/doorway)")
    for label, group in (("Blender", blender), ("candidates", candidates)):
        if len(group) == 3:
            print(f"  {label:11s}" + "  ".join(f"{shared(group[i][1], group[j][1]):.2f}" for i, j in ((0, 1), (1, 2), (0, 2))))


if __name__ == "__main__":
    main()
