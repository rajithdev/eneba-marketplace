#!/bin/bash
# Assembles a set of frames for trying the handoff in a browser, from draft
# renders: nothing here is the final render, and the set is not committed.
#
#   wide    the earlier 1280x720 draft of the whole move for the first 40%,
#           then the draft frames with the chosen covers (build.mjs --lookdev --chamber --from=0.4)
#   narrow  only the frames from 40% of the move on: the phone's preview starts there
#
# Every frame gets the colour grade, then becomes a JPEG (this ffmpeg cannot write WebP).
# usage: bash cinematic/preview_set.sh <version name>
set -e
cd "$(dirname "$0")/.."
PY=/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13
B=cinematic/build; L=$B/v2-lookdev; W=$B/preview-set; OUT=web/public/cinematic/$1
CUBE=design-review/cinematic/grade/vault-grade.cube
rm -rf "$W" "$OUT"; mkdir -p "$W/wide" "$W/narrow" "$OUT/wide" "$OUT/narrow"

# wide: 120 frames at 1440x810
first=$(ls $L/wide-tail | grep png | head -1 | tr -dc 0-9 | sed 's/^0*//')
for f in $(seq 0 $((first - 1))); do n=$(printf %03d $f); ffmpeg -v error -y -i $L/reference-frames/f-$n.png -vf scale=1440:810:flags=lanczos $W/wide/f-$n.png; done
cp $L/wide-tail/f-*.png $W/wide/
echo '{"frames": 120}' > $W/wide/layout.json
$PY -I cinematic/grade.py apply $CUBE $W/wide $W/wide-graded
for f in $W/wide-graded/f-*.png; do ffmpeg -v error -y -i $f -q:v 3 $OUT/wide/$(basename ${f%.png}).jpg; done

# narrow: the frames from 40% on, graded by their place in the whole move, then numbered from 0
# (left out while its frames are still being drawn)
i=0
if [ -f $L/narrow-tail/layout.json ]; then
  cp $L/narrow-tail/f-*.png $W/narrow/
  echo '{"frames": 96}' > $W/narrow/layout.json
  $PY -I cinematic/grade.py apply $CUBE $W/narrow $W/narrow-graded
  for f in $(ls $W/narrow-graded/f-*.png); do ffmpeg -v error -y -i $f -q:v 3 $OUT/narrow/f-$(printf %03d $i).jpg; i=$((i + 1)); done
fi

python3 - "$L" "$OUT" "$i" <<'PY'
import json, os, sys
L, out, narrow_frames = sys.argv[1], sys.argv[2], int(sys.argv[3])
def layout(name, frames):
    made = json.load(open(f"{L}/{name}-tail/layout.json"))
    size = sum(os.path.getsize(f"{out}/{name}/{f}") for f in os.listdir(f"{out}/{name}"))
    return {"frames": frames, "width": made["width"], "height": made["height"], "path": name + "/f-{frame}.jpg", "bytes": size, "travel": 0.86, "slots": made["slots"]}
layouts = {"wide": layout("wide", 120)}
if narrow_frames:
    layouts["narrow"] = layout("narrow", narrow_frames)
json.dump({"version": os.path.basename(out), "background": "#341281", "layouts": layouts}, open(f"{out}/manifest.json", "w"), indent=2)
PY
du -sh $OUT; ls $OUT/wide | wc -l; ls $OUT/narrow | wc -l
