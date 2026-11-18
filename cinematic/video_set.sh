#!/bin/bash
# Makes a set of frames for the scroll section from a finished video (a
# filmed or generated shot) instead of Blender renders. Such a shot does
# not end on a row of cases placed for the cards, so its manifest lists no
# slots, and the page dissolves from the last frame into the real block.
#
#   wide    the whole picture, 1440 pixels wide
#   narrow  the middle of the picture, 9:16, for a phone
#
# Not every frame is kept: every second one while the camera moves, then a
# few from the stretch where it has all but stopped, and the last. Scrolling
# then passes through the still end quickly instead of waiting on it.
# The sound, if any, is left behind. JPEG, because this ffmpeg cannot write WebP.
#
# A showroom: when the shot ends on the products themselves, each on a
# panel, a list of those panels makes the last frame the place to buy from
# (web/src/cinematic/Showroom.tsx). The list names the game on each panel
# and its four corners in the video's own pixels: top left, top right,
# bottom right, bottom left.
#
# usage: bash cinematic/video_set.sh <video> <version name> [last moving frame, default 200] [panels.json]
set -e
cd "$(dirname "$0")/.."
VIDEO=$1; OUT=web/public/cinematic/$2; MOVING=${3:-200}
LAST=$(($(ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$VIDEO") - 1))
STEP=$(((LAST - MOVING) / 4))
PICK="lte(n\,$MOVING)*not(mod(n\,2))+eq(n\,$((MOVING + STEP)))+eq(n\,$((MOVING + 2 * STEP)))+eq(n\,$((MOVING + 3 * STEP)))+eq(n\,$LAST)"
rm -rf "$OUT"; mkdir -p "$OUT/wide" "$OUT/narrow"
ffmpeg -v error -y -i "$VIDEO" -an -vf "select='$PICK',scale=1440:-2:flags=lanczos" -fps_mode passthrough -start_number 0 -q:v 4 "$OUT/wide/f-%03d.jpg"
ffmpeg -v error -y -i "$VIDEO" -an -vf "select='$PICK',crop=trunc(ih*9/32)*2:ih,scale=720:1280:flags=lanczos" -fps_mode passthrough -start_number 0 -q:v 4 "$OUT/narrow/f-%03d.jpg"

SIZE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$VIDEO")
python3 - "$OUT" "$SIZE" "$4" <<'PY'
import json, os, subprocess, sys
out = sys.argv[1]
video_width, video_height = map(int, sys.argv[2].split(","))
def layout(name):
    files = sorted(os.listdir(f"{out}/{name}"))
    width, height = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f"{out}/{name}/{files[0]}"], check=True, capture_output=True, text=True).stdout.strip().split(",")
    return {"frames": len(files), "width": int(width), "height": int(height), "path": name + "/f-{frame}.jpg", "bytes": sum(os.path.getsize(f"{out}/{name}/{f}") for f in files), "travel": 0.86, "slots": []}
manifest = {"version": os.path.basename(out), "background": "#341281", "layouts": {"wide": layout("wide"), "narrow": layout("narrow")}}
if sys.argv[3]:
    manifest["layouts"]["wide"]["panels"] = [{"game": panel["game"], "quad": [[round(x / video_width, 5), round(y / video_height, 5)] for x, y in panel["quad"]]} for panel in json.load(open(sys.argv[3]))]
json.dump(manifest, open(f"{out}/manifest.json", "w"), indent=2)
for name, made in manifest["layouts"].items():
    print(f"{name}: {made['frames']} frames, {made['width']}x{made['height']}, {made['bytes'] / 1048576:.1f} MB")
PY
