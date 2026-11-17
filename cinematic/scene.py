# The game vault, as a Blender scene built entirely by this script.
#
#   Blender -b --factory-startup -P cinematic/scene.py -- '<json options>'
#
# (cinematic/build.mjs runs it; see there for the options.)
#
# Blender is the source of truth for geometry and camera. Nothing is
# animated with keyframes that a person tuned by hand: the whole scene is a
# function of one number, the scroll progress p from 0 to 1. pose(p) puts the
# camera and the six "hero" cases where they belong at p, and each frame is
# rendered from that pose. So frame 37 is always the same picture, forwards
# or backwards, and the final frame can be described exactly: this script
# also writes where each hero case's front lands in the last frame, which is
# what the web page lines the real product cards up with.
#
# The story, in p:
#   0.00 - 0.55  travel down a corridor lined with illuminated cases
#   0.55 - 0.70  leave the corridor; the space opens into a dark chamber
#   0.58 - 0.86  the hero cases glide into one flat row facing the camera
#   0.86 - 1.00  hold: nothing moves, the page fades the real cards in
#
# Units are metres, Z is up, the corridor runs along +Y.

import json
import math
import os
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

options = json.loads(sys.argv[sys.argv.index("--") + 1])
PORTRAIT = options["height"] > options["width"]
FRAMES = options["frames"]

# ------------------------------------------------------------------ colours

def linear(hex_colour, alpha=1.0):
    """A CSS colour as the linear RGB Blender works in."""
    def channel(value):
        value /= 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
    return tuple(channel(int(hex_colour[i:i + 2], 16)) for i in (1, 3, 5)) + (alpha,)

BAND = linear(options["background"])  # the page's band colour: the frame must end on exactly this
PURPLE = linear("#6f47d6")
TEAL = linear("#3ddcb1")
YELLOW = linear("#fad318")

# ------------------------------------------------------------------ scene

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = options["width"]
scene.render.resolution_y = options["height"]
scene.render.resolution_percentage = 100
scene.eevee.taa_render_samples = options.get("samples", 16)
scene.frame_start, scene.frame_end = 0, FRAMES - 1
# "Standard" writes the colours as given. A filmic transform would shift
# them, and the background could never equal the page colour.
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

# The camera sees the page's band colour wherever there is nothing; the
# surfaces are lit by a much dimmer version of it, so the corridor stays
# dark and its own lights do the work.
world = bpy.data.worlds.new("Vault")
world.use_nodes = True
nodes, links = world.node_tree.nodes, world.node_tree.links
seen = nodes["Background"]
seen.inputs["Color"].default_value = BAND
ambient = nodes.new("ShaderNodeBackground")
ambient.inputs["Color"].default_value = BAND
ambient.inputs["Strength"].default_value = 0.12
is_camera = nodes.new("ShaderNodeLightPath")
mix = nodes.new("ShaderNodeMixShader")
links.new(is_camera.outputs["Is Camera Ray"], mix.inputs["Fac"])
links.new(ambient.outputs["Background"], mix.inputs[1])
links.new(seen.outputs["Background"], mix.inputs[2])
links.new(mix.outputs["Shader"], nodes["World Output"].inputs["Surface"])
scene.world = world


def material(name, colour, roughness=0.6, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def glow(name, colour, strength=1.0, image=None):
    """A surface that shows its colour (or picture) at full brightness, whatever the lighting."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.remove(nodes["Principled BSDF"])
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = colour
    emission.inputs["Strength"].default_value = strength
    if image:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        links.new(texture.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], nodes["Material Output"].inputs["Surface"])
    return mat


# "look": a better-lit version for stills that show intended appearance
# (reflections in a polished floor); the frames for the page do not use it.
LOOK = bool(options.get("look"))
if LOOK:
    try:
        scene.eevee.use_raytracing = True
    except Exception:
        pass

WALL = material("wall", linear("#160a38"), roughness=0.55)
FLOOR = material("floor", linear("#0f0728"), roughness=0.12 if LOOK else 0.3, metallic=0.6 if LOOK else 0.2)
PILLAR = material("pillar", linear("#241057"), roughness=0.4)
CASE = material("case", linear("#0b0620"), roughness=0.35)
STRIP = {"purple": glow("strip-purple", PURPLE, 2.0), "teal": glow("strip-teal", TEAL, 1.6), "yellow": glow("strip-yellow", YELLOW, 1.6)}


def box(name, centre, size, mat):
    """A box with real dimensions (no object scale, so children are not distorted)."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vert in bm.verts:
        vert.co.x *= size[0]
        vert.co.y *= size[1]
        vert.co.z *= size[2]
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = centre
    scene.collection.objects.link(obj)
    return obj


CASE_W, CASE_H, CASE_T = 0.9, 1.2, 0.07  # a case's front is 3:4, the shape of a product card's cover
covers = {}


# For a motion reference meant for a video model: no artwork or lettering
# on the cases (a model would turn it into nonsense), just a glowing panel
# in one of a few colours. The real covers are put back from this scene's
# own geometry afterwards.
PLAIN = [linear("#7b5cf0"), linear("#3ddcb1"), linear("#c84a9a"), linear("#fad318"), linear("#4a7cf0"), linear("#e8663c")]


def cover_material(path):
    if path not in covers:
        if options.get("plain"):
            covers[path] = glow("panel-" + os.path.basename(path), PLAIN[len(covers) % len(PLAIN)], 0.85)
        else:
            covers[path] = glow("cover-" + os.path.basename(path), (1, 1, 1, 1), 1.0, bpy.data.images.load(path))
    return covers[path]


def case(name, cover_path):
    """A game case whose front (the side facing -Y until it is turned) shows a cover. Returns (body, front)."""
    body = box(name, (0, 0, 0), (CASE_W, CASE_T, CASE_H), CASE)
    mesh = bpy.data.meshes.new(name + "-front")
    w, h, y = CASE_W / 2, CASE_H / 2, -CASE_T / 2 - 0.002
    mesh.from_pydata([(-w, y, -h), (w, y, -h), (w, y, h), (-w, y, h)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    for loop, coords in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = coords
    mesh.materials.append(cover_material(cover_path))
    front = bpy.data.objects.new(name + "-front", mesh)
    front.parent = body
    scene.collection.objects.link(front)
    return body, front


def area_light(name, location, colour, watts, size=1.2):
    data = bpy.data.lights.new(name, "AREA")
    data.color = colour[:3]
    data.energy = watts
    data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = (0, 0, 0)  # an area light shines down its -Z: straight at the floor
    scene.collection.objects.link(obj)

# ------------------------------------------------------------------ the corridor

LENGTH, HALF_WIDTH, HEIGHT = 30.0, 2.2, 4.0
BAYS = 11  # one case on each wall per bay
BAY = 2.5

box("floor", (0, LENGTH / 2 - 3, -0.05), (HALF_WIDTH * 2 + 0.4, LENGTH + 6, 0.1), FLOOR)
box("ceiling", (0, LENGTH / 2 - 3, HEIGHT + 0.05), (HALF_WIDTH * 2 + 0.4, LENGTH + 6, 0.1), WALL)
for side in (-1, 1):
    box("wall", (side * (HALF_WIDTH + 0.1), LENGTH / 2 - 3, HEIGHT / 2), (0.2, LENGTH + 6, HEIGHT), WALL)
    # One line of light where each wall meets the ceiling, and a fainter one at the floor.
    box("ceiling-line", (side * (HALF_WIDTH - 0.06), LENGTH / 2 - 3, HEIGHT - 0.06), (0.05, LENGTH + 6, 0.05), STRIP["purple"])
    box("floor-line", (side * (HALF_WIDTH - 0.04), LENGTH / 2 - 3, 0.03), (0.03, LENGTH + 6, 0.03), STRIP["purple"])

gallery = options["gallery"]
for bay in range(BAYS):
    y = BAY * (bay + 1)
    for index, side in enumerate((-1, 1)):
        # Pillars between the bays give the corridor its rhythm.
        box("pillar", (side * (HALF_WIDTH - 0.12), y - BAY / 2, HEIGHT / 2), (0.24, 0.3, HEIGHT), PILLAR)
        # Each case stands off the wall, turned a little toward whoever walks in.
        body, _ = case(f"gallery-{bay}-{index}", gallery[(bay * 2 + index) % len(gallery)])
        body.location = (side * (HALF_WIDTH - 0.28), y, 1.7)
        body.rotation_euler = (0, 0, -side * math.radians(62))
        # A shelf of light under each case; teal on every third bay, never two accents together.
        accent = "teal" if bay % 3 == 1 else "purple"
        box("shelf", (side * (HALF_WIDTH - 0.2), y, 1.02), (0.36, 1.25, 0.03), STRIP[accent])
    area_light(f"bay-light-{bay}", (0, y, HEIGHT - 0.3), PURPLE, 260, size=1.6)

# The way out: a thin yellow frame around the end of the corridor.
for x in (-HALF_WIDTH + 0.05, HALF_WIDTH - 0.05):
    box("portal", (x, LENGTH, HEIGHT / 2), (0.06, 0.06, HEIGHT), STRIP["yellow"])
box("portal", (0, LENGTH, HEIGHT - 0.05), (HALF_WIDTH * 2, 0.06, 0.06), STRIP["yellow"])

# ------------------------------------------------------------------ camera and hero cases

camera_data = bpy.data.cameras.new("Camera")
camera_data.sensor_width = 36
camera = bpy.data.objects.new("Camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera

slots = options["slots"]  # the products the row ends on, left to right
COUNT = len(slots)
GAP = CASE_W * options["gap_ratio"]  # the space between two card covers, in the same proportion as on the page
ROW = COUNT * CASE_W + (COUNT - 1) * GAP
ROW_Y, ROW_Z = 44.0, 2.0
FINAL_LENS = 50.0


def half_view(lens):
    """Half the width and half the height of what the camera sees, one metre away."""
    half_long = (camera_data.sensor_width / 2) / lens  # the 36 mm applies to the longer side of the picture
    aspect = options["width"] / options["height"]
    return (half_long * aspect, half_long) if PORTRAIT else (half_long, half_long / aspect)


# Where the camera must stand so the row fills the agreed share of the
# picture's width, with its middle at the agreed height. Because the row is
# a flat plane square to the camera, its fronts are exact rectangles.
half_w, half_h = half_view(FINAL_LENS)
distance = ROW / (options["row_share"] * 2 * half_w)
FINAL_CAMERA = Vector((0, ROW_Y - CASE_T / 2 - distance, ROW_Z - (0.5 - options["row_centre"]) * 2 * half_h * distance))

heroes = []
for index, slot in enumerate(slots):
    body, front = case(f"hero-{index}", slot["texture"])
    offset = index - (COUNT - 1) / 2  # -2.5 ... 2.5 for six cases
    end = Vector((offset * (CASE_W + GAP), ROW_Y, ROW_Z))
    # On display in the chamber before they move: spread wider, the outer
    # ones nearer the corridor, each turned toward it, at slightly different heights.
    start = Vector((offset * (CASE_W + GAP) * 1.45, ROW_Y - 6.5 - abs(offset) * 0.9, ROW_Z + (0.22 if index % 2 else -0.18)))
    heroes.append({"body": body, "front": front, "start": start, "end": end, "start_yaw": -offset * math.radians(11), "delay": abs(offset) * 0.012})


def smooth(edge0, edge1, x):
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


# The camera's route: (p, x, y, z, yaw in degrees, lens). Yaw turns left for
# positive values. The last two rows are the same pose: the hold.
ROUTE = [
    (0.00, -1.05 if not PORTRAIT else -0.55, 1.0, 1.35, -15 if not PORTRAIT else -9, 30),
    (0.12, -0.55 if not PORTRAIT else -0.3, 4.5, 1.5, -7 if not PORTRAIT else -4, 28),
    (0.35, 0.15, 14.0, 1.6, 2, 28),
    (0.55, 0.0, 25.5, 1.7, 0, 28),
    (0.70, 0.0, 32.5, 1.95, 0, 38),
    (0.86, FINAL_CAMERA.x, FINAL_CAMERA.y, FINAL_CAMERA.z, 0, FINAL_LENS),
    (1.00, FINAL_CAMERA.x, FINAL_CAMERA.y, FINAL_CAMERA.z, 0, FINAL_LENS),
]


def along_route(p):
    """The route's values at p: a smooth curve through the rows above (a Catmull-Rom spline), level at both ends."""
    for i in range(len(ROUTE) - 1):
        if p <= ROUTE[i + 1][0]:
            break
    a, b = ROUTE[i], ROUTE[i + 1]
    before = ROUTE[i - 1] if i > 0 else None
    after = ROUTE[i + 2] if i + 2 < len(ROUTE) else None
    span = b[0] - a[0]
    t = (p - a[0]) / span
    values = []
    for k in range(1, 6):
        # The slope through a row is the slope between its neighbours; zero at the first and last rows, and into the hold.
        slope_a = (b[k] - before[k]) / (b[0] - before[0]) if before else 0.0
        slope_b = (after[k] - a[k]) / (after[0] - a[0]) if after and after[k] != b[k] else 0.0
        h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
        values.append(h00 * a[k] + h10 * span * slope_a + h01 * b[k] + h11 * span * slope_b)
    return values


def pose(p):
    x, y, z, yaw, lens = along_route(p)
    camera.location = (x, y, z)
    camera.rotation_euler = (math.radians(90), 0, math.radians(yaw))  # looking along +Y, level
    camera_data.lens = lens
    for hero in heroes:
        t = smooth(0.58 + hero["delay"], 0.86, p)
        hero["body"].location = hero["start"].lerp(hero["end"], t)
        hero["body"].rotation_euler = (0, 0, hero["start_yaw"] * (1 - t))  # turns to face the camera; never spins


def front_rectangle(front):
    """Where a case's front is in the picture: left, top, width, height as fractions of the frame."""
    bpy.context.view_layer.update()
    points = [world_to_camera_view(scene, camera, front.matrix_world @ vert.co) for vert in front.data.vertices]
    left, right = min(p.x for p in points), max(p.x for p in points)
    bottom, top = min(p.y for p in points), max(p.y for p in points)
    return {"x": left, "y": 1 - top, "w": right - left, "h": top - bottom}

# ------------------------------------------------------------------ render

out = options["out"]
os.makedirs(out, exist_ok=True)
settings = scene.render.image_settings
FORMAT = options.get("format", "WEBP")  # "PNG" for reference material, which must not be compressed twice
EXTENSION = {"WEBP": "webp", "PNG": "png"}[FORMAT]
settings.file_format = FORMAT
settings.color_mode = "RGB"
settings.quality = options.get("quality", 75)

wanted = options.get("only")  # a few chosen frames (for measuring sizes), or every frame
for frame in (wanted if wanted is not None else range(FRAMES)):
    # First the frame number, then the pose: changing the frame makes
    # Blender re-apply recorded keyframes, which would undo a pose set before it.
    scene.frame_set(frame)
    pose(frame / (FRAMES - 1))
    # Recorded as keyframes too, so the saved .blend plays the same move for look development.
    camera.keyframe_insert("location"); camera.keyframe_insert("rotation_euler"); camera_data.keyframe_insert("lens")
    for hero in heroes:
        hero["body"].keyframe_insert("location"); hero["body"].keyframe_insert("rotation_euler")
    scene.render.filepath = os.path.join(out, f"f-{frame:03d}.{EXTENSION}")
    bpy.ops.render.render(write_still=True)
    # The same rendered picture saved at other settings, to compare file sizes.
    for variant in options.get("variants", []):
        settings.file_format, settings.quality = variant["format"], variant["quality"]
        bpy.data.images["Render Result"].save_render(os.path.join(out, f"f-{frame:03d}.{variant['name']}"), scene=scene)
    settings.file_format, settings.quality = FORMAT, options.get("quality", 75)

pose(1.0)
report = {
    "frames": FRAMES,
    "width": options["width"],
    "height": options["height"],
    "slots": [{"slug": slot["slug"], **front_rectangle(hero["front"])} for slot, hero in zip(slots, heroes)],
}
with open(os.path.join(out, "layout.json"), "w") as handle:
    json.dump(report, handle, indent=2)
if options.get("blend"):
    bpy.ops.wm.save_as_mainfile(filepath=options["blend"])
print("RENDERED", len(wanted) if wanted is not None else FRAMES, "frames to", out)
