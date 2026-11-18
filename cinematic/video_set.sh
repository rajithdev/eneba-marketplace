#!/bin/bash
# Makes a set of frames for the scroll section from a finished video (a
# filmed or generated shot) instead of Blender renders.
#
# Every frame is kept while the camera moves (EVERY=2 keeps every second
# one: half the download, twice the jump between frames), then a few from
# the stretch where it has all but stopped (TAIL of them, the last frame
# among them). Scrolling then passes through the still end quickly instead
# of waiting on it. The sound, if any, is left behind. Frames are cut as PNG and saved as WebP by
# Blender (cinematic/to_webp.py), because this ffmpeg cannot write WebP.
#
# A showroom: when the shot ends on the products themselves, each on a
# panel, a list of those panels makes the last frame the place to buy from
# (web/src/cinematic/Showroom.tsx). The list names the game on each panel
# and its four corners in the video's own pixels: top left, top right,
# bottom right, bottom left. A showroom is made for wide windows only.
#
# Without a list, a phone layout is made too (the middle of the picture,
# 9:16), and the page dissolves from the last frame into the real block.
#
# usage: bash cinematic/video_set.sh <video> <version name> [last moving frame, default 200] [panels.json]
#        QUALITY=70 is the WebP quality; EVERY=1 and TAIL=8 are described above.
set -e
cd "$(dirname "$0")/.."
VIDEO=$1; VERSION=$2; MOVING=${3:-200}; PANELS=$4
OUT=web/public/cinematic/$VERSION; WORK=cinematic/build/$VERSION-frames
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
LAST=$(($(ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$VIDEO") - 1))
EVERY=${EVERY:-1}; TAIL=${TAIL:-8}
STEP=$(((LAST - MOVING) / TAIL))
PICK="lte(n\,$MOVING)*not(mod(n\,$EVERY))+eq(n\,$LAST)"
for i in $(seq 1 $((TAIL - 1))); do PICK="$PICK+eq(n\,$((MOVING + i * STEP)))"; done
rm -rf "$OUT" "$WORK"; mkdir -p "$OUT" "$WORK/wide"

ffmpeg -v error -y -i "$VIDEO" -an -vf "select='$PICK',scale=1440:-2:flags=lanczos" -fps_mode passthrough -start_number 0 "$WORK/wide/f-%03d.png"
"$BLENDER" -b --factory-startup -P cinematic/to_webp.py -- "$WORK/wide" "$OUT/wide" "${QUALITY:-70}" 2>/dev/null | grep WROTE
if [ -z "$PANELS" ]; then
  mkdir -p "$WORK/narrow"
  ffmpeg -v error -y -i "$VIDEO" -an -vf "select='$PICK',crop=trunc(ih*9/32)*2:ih,scale=720:1280:flags=lanczos" -fps_mode passthrough -start_number 0 "$WORK/narrow/f-%03d.png"
  "$BLENDER" -b --factory-startup -P cinematic/to_webp.py -- "$WORK/narrow" "$OUT/narrow" "${QUALITY:-70}" 2>/dev/null | grep WROTE
fi

SIZE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$VIDEO")
python3 - "$OUT" "$WORK" "$SIZE" "$PANELS" <<'PY'
import json, os, subprocess, sys
out, work = sys.argv[1], sys.argv[2]
video_width, video_height = map(int, sys.argv[3].split(","))
def layout(name):
    files = sorted(os.listdir(f"{out}/{name}"))
    width, height = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f"{work}/{name}/f-000.png"], check=True, capture_output=True, text=True).stdout.strip().split(",")
    return {"frames": len(files), "width": int(width), "height": int(height), "path": name + "/f-{frame}.webp", "bytes": sum(os.path.getsize(f"{out}/{name}/{f}") for f in files), "travel": 0.86, "slots": []}
manifest = {"version": os.path.basename(out), "background": "#341281", "layouts": {name: layout(name) for name in sorted(os.listdir(out), reverse=True)}}
if sys.argv[4]:
    manifest["layouts"]["wide"]["panels"] = [{"game": panel["game"], "quad": [[round(x / video_width, 5), round(y / video_height, 5)] for x, y in panel["quad"]]} for panel in json.load(open(sys.argv[4]))]
json.dump(manifest, open(f"{out}/manifest.json", "w"), indent=2)
for name, made in manifest["layouts"].items():
    print(f"{name}: {made['frames']} frames, {made['width']}x{made['height']}, {made['bytes'] / 1048576:.1f} MB" + (f", {len(made['panels'])} panels" if "panels" in made else ""))
PY
