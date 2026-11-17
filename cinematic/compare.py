"""Compare a generated clip with the Blender motion reference it was made from.

The question is whether a video model kept the camera move and the layout that
Blender decided. Nothing here judges beauty; that is done by looking at the
pictures this writes. It measures what can be measured:

  opening    whether the first frame is the reference's first frame
  timing     which reference frame each generated frame resembles most
  doorway    how long the doorway's top edge is (how far the camera got)
  flicker    brightness that jumps from frame to frame, and movement after
             the panels have settled, where the reference stands still
  panels     where the six panels end up, against the reference and against
             the positions Blender exported for the real cards

usage (Blender's Python has numpy; nothing is installed):
  /Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 -I \
      cinematic/compare.py <reference.mp4> <generated.mp4> <out dir> [manifest.json]
"""

import json
import os
import subprocess
import sys

import numpy as np

FPS = 24
SMALL = (640, 360)
FULL = (1280, 720)
HOLD_FROM = 96  # the last second, in which the panels settle
STILL_FROM = 104  # the reference does not move at all from here


def run(args, **kw):
    return subprocess.run(args, check=True, capture_output=True, **kw)


def probe(path):
    out = run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path])
    data = json.loads(out.stdout)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    num, den = (int(x) for x in video["r_frame_rate"].split("/"))
    return {
        "codec": video["codec_name"],
        "width": video["width"],
        "height": video["height"],
        "fps": round(num / den, 3),
        "frames": int(video.get("nb_frames") or 0),
        "seconds": round(float(data["format"]["duration"]), 3),
        "kbit_per_second": round(int(data["format"]["bit_rate"]) / 1000),
        "bytes": int(data["format"]["size"]),
        "audio_streams": sum(1 for s in data["streams"] if s["codec_type"] == "audio"),
    }


def frames(path, size, first=0):
    """Every frame from `first` on, resampled to 24 a second, as uint8 RGB."""
    w, h = size
    chain = f"fps={FPS},select='gte(n\\,{first})',scale={w}:{h}:flags=area"
    out = run(["ffmpeg", "-v", "error", "-i", path, "-vf", chain, "-fps_mode", "passthrough",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    return np.frombuffer(out.stdout, np.uint8).reshape(-1, h, w, 3)


def save_png(rgb, path):
    h, w = rgb.shape[:2]
    run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
         "-i", "-", "-frames:v", "1", path], input=np.ascontiguousarray(rgb, np.uint8).tobytes())


def luma(rgb):
    return rgb.astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def edges(rgb):
    """Outlines only, at a quarter of the working size, so that new materials
    and lighting matter less than where the walls and panels are."""
    g = luma(rgb)
    h, w = g.shape
    g = g.reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))
    gx = g[1:-1, 2:] - g[1:-1, :-2]
    gy = g[2:, 1:-1] - g[:-2, 1:-1]
    return np.log1p(np.hypot(gx, gy))


def alike(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def timing(ref_edges, out_edges, reach=30):
    """For each generated frame, the reference frame it looks most like."""
    rows = []
    last = min(len(ref_edges), len(out_edges))
    for i in range(0, last, 2):
        lo, hi = max(0, i - reach), min(len(ref_edges), i + reach + 1)
        scores = [alike(out_edges[i], ref_edges[j]) for j in range(lo, hi)]
        best = lo + int(np.argmax(scores))
        rows.append({"frame": i, "same_frame": round(alike(out_edges[i], ref_edges[i]), 3),
                     "best_frame": best, "best": round(max(scores), 3), "lag": best - i})
    return rows


def runs(flags, min_len, gap=3):
    found, start, last = [], None, None
    for i, on in enumerate(flags):
        if on:
            if start is None:
                start = i
            elif i - last > gap:
                found.append((start, last))
                start = i
            last = i
    if start is not None:
        found.append((start, last))
    return [(a, b) for a, b in found if b - a + 1 >= min_len]


def doorway(rgb):
    """Length of the doorway's yellow top edge, as a share of the picture's
    width: how far down the corridor the camera has come. The edge is a long,
    thin, centred yellow line; the yellow panels are thick, so they are not it."""
    h, w = rgb.shape[:2]
    r, g, b = (rgb[..., c].astype(np.int16) for c in range(3))
    yellow = (r > 150) & (g > 105) & (b < 130) & (r - b > 70)
    best = []
    for row in yellow:
        spans = [s for s in runs(row, int(0.05 * w), gap=2) if abs(s[0] + s[1] - w) < 0.08 * w]
        best.append(max(spans, key=lambda s: s[1] - s[0]) if spans else None)
    lines = [(a, c) for a, c in runs([s is not None for s in best], 1, gap=0) if c - a + 1 <= 0.03 * h]
    if not lines:
        return None
    a, c = max(lines, key=lambda line: max(best[y][1] - best[y][0] for y in range(line[0], line[1] + 1)))
    length = max(best[y][1] - best[y][0] + 1 for y in range(a, c + 1))
    return round(length / w, 3)


def panels(rgb):
    """The glowing panels in a settled frame, left to right: x, y, w, h."""
    h, w = rgb.shape[:2]
    # A panel is whatever differs from the chamber behind it. The chamber is
    # most of the picture, so its colour is the picture's median colour.
    behind = np.median(rgb.reshape(-1, 3), axis=0)
    mask = np.sqrt(((rgb.astype(np.float32) - behind) ** 2).sum(axis=2)) > 28
    band = mask[int(h * 0.15):int(h * 0.80)]
    found = []
    for x0, x1 in runs(band.mean(axis=0) > 0.25, int(w * 0.03)):
        rows = runs(mask[:, x0:x1 + 1].mean(axis=1) > 0.3, int(h * 0.05))
        if not rows:
            continue
        y0, y1 = max(rows, key=lambda r: r[1] - r[0])
        found.append({"x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1})
    return found


def outline(rgb, boxes, colour):
    out = rgb.copy()
    for b in boxes:
        x0, y0 = int(round(b["x"])), int(round(b["y"]))
        x1, y1 = int(round(b["x"] + b["w"])) - 1, int(round(b["y"] + b["h"])) - 1
        for t in range(2):
            out[max(y0 + t, 0), x0:x1 + 1] = colour
            out[min(y1 - t, out.shape[0] - 1), x0:x1 + 1] = colour
            out[y0:y1 + 1, max(x0 + t, 0)] = colour
            out[y0:y1 + 1, min(x1 - t, out.shape[1] - 1)] = colour
    return out


def box_difference(found, wanted):
    """Largest distance between matching edges, in pixels of the full picture."""
    if len(found) != len(wanted):
        return None
    worst = 0.0
    for f, t in zip(found, wanted):
        worst = max(worst, abs(f["x"] - t["x"]), abs(f["y"] - t["y"]),
                    abs(f["x"] + f["w"] - t["x"] - t["w"]), abs(f["y"] + f["h"] - t["y"] - t["h"]))
    return round(worst, 1)


def flicker(rgb_frames):
    mean = np.array([luma(f).mean() for f in rgb_frames])
    wobble = np.abs(mean[1:-1] - (mean[:-2] + mean[2:]) / 2)
    return {"mean_brightness_first_last": [round(float(mean[0]), 1), round(float(mean[-1]), 1)],
            "frame_to_frame_wobble_mean": round(float(wobble.mean()), 3),
            "frame_to_frame_wobble_worst": round(float(wobble.max()), 3),
            "worst_at_frame": int(wobble.argmax()) + 1}


def stillness(rgb_frames):
    """Average change per pixel between neighbouring frames (0 to 255)."""
    g = np.stack([luma(f) for f in rgb_frames])
    step = np.abs(g[1:] - g[:-1]).mean(axis=(1, 2))
    return {"mean": round(float(step.mean()), 3), "worst": round(float(step.max()), 3)}


def strip(ref, out, indexes, path, width=320):
    """Reference above, generated below, one column per moment."""
    def row(source):
        cells = []
        for i in indexes:
            f = source[min(i, len(source) - 1)]
            height = width * f.shape[0] // f.shape[1]
            ys = np.linspace(0, f.shape[0] - 1, height).round().astype(int)
            xs = np.linspace(0, f.shape[1] - 1, width).round().astype(int)
            cells.append(f[ys][:, xs])
        return np.concatenate(cells, axis=1)
    top, bottom = row(ref), row(out)
    gap = np.full((6, top.shape[1], 3), 255, np.uint8)
    save_png(np.concatenate([top, gap, bottom], axis=0), path)


def edge_overlay(ref_rgb, out_rgb, path):
    """Reference outlines in cyan over the generated frame's outlines in red."""
    def strong(rgb):
        e = edges(rgb)
        return np.clip(e / (np.percentile(e, 99) + 1e-6), 0, 1)
    a, b = strong(ref_rgb), strong(out_rgb)
    picture = np.zeros(a.shape + (3,), np.float32)
    picture[..., 0] = b
    picture[..., 1] = a
    picture[..., 2] = a
    big = np.repeat(np.repeat(picture, 3, axis=0), 3, axis=1)
    save_png((big * 255).astype(np.uint8), path)


def main():
    ref_path, out_path, out_dir = sys.argv[1:4]
    manifest = sys.argv[4] if len(sys.argv) > 4 else None
    os.makedirs(out_dir, exist_ok=True)
    report = {"reference": probe(ref_path), "generated": probe(out_path)}

    ref, out = frames(ref_path, SMALL), frames(out_path, SMALL)
    report["frames_compared"] = [len(ref), len(out)]
    ref_edges, out_edges = [edges(f) for f in ref], [edges(f) for f in out]

    # The very first frame: does the clip begin where the move begins?
    report["opening"] = {
        "outline_match_first_frame": round(alike(ref_edges[0], out_edges[0]), 3),
        "colour_difference_first_frame": round(float(np.abs(ref[0].astype(np.float32) - out[0].astype(np.float32)).mean()), 1),
        "outline_match_first_frame_against_reference_one_second_in": round(alike(ref_edges[24], out_edges[0]), 3),
    }

    rows = timing(ref_edges, out_edges)
    moving = [r for r in rows if r["frame"] < HOLD_FROM]
    lags = np.array([r["lag"] for r in moving])
    report["timing"] = {
        "how": "outline match of each generated frame against reference frames up to 30 frames either side",
        "match_same_frame_mean": round(float(np.mean([r["same_frame"] for r in rows])), 3),
        "match_same_frame_by_second": [
            round(float(np.mean([r["same_frame"] for r in rows if s * FPS <= r["frame"] < (s + 1) * FPS])), 3)
            for s in range(5)],
        "lag_frames_median": float(np.median(lags)),
        "lag_frames_worst": int(lags[np.abs(lags).argmax()]),
        "lag_frames_by_second": [
            float(np.median([r["lag"] for r in moving if s * FPS <= r["frame"] < (s + 1) * FPS] or [0]))
            for s in range(4)],
        "rows": rows,
    }
    # What "no relation at all" scores, so the numbers above can be read.
    report["timing"]["match_between_unrelated_reference_frames"] = round(
        float(np.mean([alike(ref_edges[i], ref_edges[(i + 60) % len(ref_edges)]) for i in range(0, 60, 6)])), 3)

    report["doorway_width"] = [
        {"frame": i, "reference": doorway(ref[i]), "generated": doorway(out[i])}
        for i in range(0, min(len(ref), len(out)), 3)]

    report["flicker"] = {"reference": flicker(ref), "generated": flicker(out)}
    report["movement_once_settled"] = {"reference": stillness(ref[STILL_FROM:]), "generated": stillness(out[STILL_FROM:])}
    report["movement_per_frame_reference"] = [
        round(float(np.abs(luma(ref[i + 1]) - luma(ref[i])).mean()), 2) for i in range(88, len(ref) - 1)]

    # Panels, at full size, from the moment they should have settled.
    ref_full, out_full = frames(ref_path, FULL, HOLD_FROM), frames(out_path, FULL, HOLD_FROM)
    ref_boxes, out_boxes = panels(ref_full[-1]), panels(out_full[-1])
    report["panels"] = {
        "reference_last_frame": ref_boxes,
        "generated_last_frame": out_boxes,
        "found": [len(ref_boxes), len(out_boxes)],
        "generated_against_reference_px": box_difference(out_boxes, ref_boxes),
    }
    if manifest:
        slots = json.load(open(manifest))["layouts"]["wide"]["slots"]
        wanted = [{"x": s["x"] * FULL[0], "y": s["y"] * FULL[1], "w": s["w"] * FULL[0], "h": s["h"] * FULL[1]}
                  for s in slots]
        report["panels"]["blender_slots_px"] = [{k: round(v, 1) for k, v in b.items()} for b in wanted]
        report["panels"]["reference_against_blender_slots_px"] = box_difference(ref_boxes, wanted)
        report["panels"]["generated_against_blender_slots_px"] = box_difference(out_boxes, wanted)
        save_png(outline(outline(out_full[-1], wanted, (0, 255, 255)), out_boxes, (255, 60, 60)),
                 os.path.join(out_dir, "panels-last-frame.png"))
    during = []
    for i, f in enumerate(out_full):
        found = panels(f)
        during.append({"frame": HOLD_FROM + i, "found": len(found),
                       "against_reference_last_px": box_difference(found, ref_boxes)})
    report["panels"]["generated_through_last_second"] = during

    count = min(len(ref), len(out))
    strip(ref, out, [round(i * (count - 1) / 9) for i in range(10)], os.path.join(out_dir, "strip-whole-shot.png"), 192)
    strip(ref, out, list(range(54, 90, 4)), os.path.join(out_dir, "strip-doorway.png"), 213)
    strip(ref, out, list(range(92, count, 4)), os.path.join(out_dir, "strip-settle.png"), 213)
    for i in (12, 48, 72, 96, count - 1):
        edge_overlay(ref[i], out[i], os.path.join(out_dir, f"outlines-frame-{i:03d}.png"))
    for i in (0, 36, 60, 72, 84, count - 1):
        save_png(frames(out_path, FULL, i)[0], os.path.join(out_dir, f"generated-frame-{i:03d}.png"))

    run(["ffmpeg", "-v", "error", "-y", "-i", ref_path, "-i", out_path, "-filter_complex",
         f"[0:v]fps={FPS},scale=960:540[a];[1:v]fps={FPS},scale=960:540[b];[a][b]hstack=inputs=2",
         "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
         os.path.join(out_dir, "side-by-side.mp4")])

    with open(os.path.join(out_dir, "comparison.json"), "w") as f:
        json.dump(report, f, indent=1)
    brief = {k: v for k, v in report.items() if k != "timing"}
    brief["timing"] = {k: v for k, v in report["timing"].items() if k != "rows"}
    print(json.dumps(brief, indent=1))


if __name__ == "__main__":
    main()
