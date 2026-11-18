"""Saves the pictures in a folder as WebP, for the frames cut from a video.

The ffmpeg on this machine cannot write WebP; Blender can. The pictures are
passed through unchanged: the scene's colour handling is set so that what
is read is what is written.

usage: Blender -b --factory-startup -P cinematic/to_webp.py -- <folder of f-NNN.png> <out folder> [quality, default 70]
"""

import os
import sys

import bpy

source, out = sys.argv[sys.argv.index("--") + 1:][:2]
quality = int((sys.argv[sys.argv.index("--") + 1:] + ["70"])[2])
os.makedirs(out, exist_ok=True)

scene = bpy.context.scene
scene.display_settings.display_device = "sRGB"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
settings = scene.render.image_settings
settings.file_format = "WEBP"
settings.color_mode = "RGB"
settings.quality = quality

names = sorted(name for name in os.listdir(source) if name.startswith("f-") and name.endswith(".png"))
for name in names:
    image = bpy.data.images.load(os.path.join(source, name))
    image.save_render(os.path.join(out, name[:-4] + ".webp"), scene=scene)
    bpy.data.images.remove(image)
print("WROTE", len(names), "pictures to", out, "at quality", quality)
