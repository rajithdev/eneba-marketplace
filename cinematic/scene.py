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
#
# The same move can be dressed three ways (the "look" option):
#   (none)    the blockout: flat shapes, drawn by EEVEE in about a second a frame
#   true      the blockout with a polished floor
#   "vault"   stone, brushed metal and glass under physically based light,
#             drawn by Cycles. Only the surroundings differ: the camera
#             route, the hero cases and the last frame are the same code.

import json
import math
import os
import sys
import time

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

options = json.loads(sys.argv[sys.argv.index("--") + 1])
PORTRAIT = options["height"] > options["width"]
FRAMES = options["frames"]
VAULT = options.get("look") == "vault"
POLISHED = options.get("look") is True

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

if VAULT:
    # Cycles follows light as it bounces, so reflections, soft shadows and
    # the glow a lit surface throws on its neighbours come out on their own.
    # It stops early where a part of the picture is already clean, and a
    # denoiser removes the grain that is left.
    scene.render.engine = "CYCLES"
    scene.cycles.samples = options.get("samples", 256)
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = options.get("noise", 0.02)
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.caustics_reflective = scene.cycles.caustics_refractive = False
    try:  # the graphics processor, where there is one Blender can use
        preferences = bpy.context.preferences.addons["cycles"].preferences
        preferences.compute_device_type = "METAL"
        preferences.refresh_devices()
        for device in preferences.devices:
            device.use = device.type == "METAL"
        scene.cycles.device = "GPU"
    except Exception:
        pass

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
ambient.inputs["Strength"].default_value = 0.02 if VAULT else 0.12  # the vault is closed in and lit by its own lamps
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


if POLISHED:
    try:
        scene.eevee.use_raytracing = True
    except Exception:
        pass

WALL = material("wall", linear("#160a38"), roughness=0.55)
FLOOR = material("floor", linear("#0f0728"), roughness=0.12 if POLISHED else 0.3, metallic=0.6 if POLISHED else 0.2)
PILLAR = material("pillar", linear("#241057"), roughness=0.4)
CASE = material("case", linear("#0b0620"), roughness=0.35)
STRIP = {"purple": glow("strip-purple", PURPLE, 2.0), "teal": glow("strip-teal", TEAL, 1.6), "yellow": glow("strip-yellow", YELLOW, 1.6)}


def box(name, centre, size, mat, bevel=0.0):
    """A box with real dimensions (no object scale, so children are not distorted).
    `bevel` rounds its edges by that many metres: no real edge is perfectly
    sharp, and a rounded one catches a line of light."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vert in bm.verts:
        vert.co.x *= size[0]
        vert.co.y *= size[1]
        vert.co.z *= size[2]
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(bevel, min(size) / 4), segments=2, affect="EDGES", profile=0.5)
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


def case(name, cover_path, cover=None):
    """A game case whose front (the side facing -Y until it is turned) shows a cover. Returns (body, front)."""
    body = box(name, (0, 0, 0), (CASE_W, CASE_T, CASE_H), CASE)
    mesh = bpy.data.meshes.new(name + "-front")
    w, h, y = CASE_W / 2, CASE_H / 2, -CASE_T / 2 - 0.002
    mesh.from_pydata([(-w, y, -h), (w, y, -h), (w, y, h), (-w, y, h)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    for loop, coords in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = coords
    mesh.materials.append(cover or cover_material(cover_path))
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

# ------------------------------------------------------------------ the vault look: materials

def surface(name):
    """A new material, its shader, and the point being shaded in metres (so a
    pattern runs on across neighbouring blocks instead of repeating on each)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    return mat, nodes, links, nodes["Principled BSDF"], nodes.new("ShaderNodeNewGeometry").outputs["Position"]


def clouds(nodes, links, position, scale, detail=6.0, stretch=None):
    """Soft random variation between 0 and 1; `stretch` pulls it out into streaks."""
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    if stretch:
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = stretch
        links.new(position, mapping.inputs["Vector"])
        position = mapping.outputs["Vector"]
    links.new(position, noise.inputs["Vector"])
    return noise.outputs[0]


def spread(nodes, links, value, low, high):
    """`value`, which hovers around a half, stretched to run from low to high."""
    node = nodes.new("ShaderNodeMapRange")
    node.inputs["From Min"].default_value, node.inputs["From Max"].default_value = 0.3, 0.7
    node.inputs["To Min"].default_value, node.inputs["To Max"].default_value = low, high
    links.new(value, node.inputs["Value"])
    return node.outputs["Result"]


def relief(nodes, links, bsdf, height, depth):
    """Lets light catch a surface as if it rose and fell by `depth` metres, without changing its shape."""
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = depth
    links.new(height, bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def stone(name, dark, light, vein, polish, grain):
    """Dark stone: two close tones in slow clouds, thin pale veins wandering
    through it, a polish that is not quite even (`polish` is the smoothest
    and roughest it gets) and a fine grain."""
    mat, nodes, links, bsdf, position = surface(name)
    tone = nodes.new("ShaderNodeValToRGB")
    tone.color_ramp.elements[0].position, tone.color_ramp.elements[0].color = 0.3, dark
    tone.color_ramp.elements[1].position, tone.color_ramp.elements[1].color = 0.7, light
    links.new(clouds(nodes, links, position, 0.8), tone.inputs[0])
    # A vein is the thin line along which a second, warped pattern crosses its own middle value.
    warped = nodes.new("ShaderNodeTexNoise")
    warped.inputs["Scale"].default_value, warped.inputs["Detail"].default_value, warped.inputs["Distortion"].default_value = 0.7, 5.0, 2.2
    links.new(position, warped.inputs["Vector"])
    line = nodes.new("ShaderNodeValToRGB")
    for element, (at, colour) in zip(line.color_ramp.elements, ((0.495, (0, 0, 0, 1)), (0.5, (1, 1, 1, 1)))):
        element.position, element.color = at, colour
    after = line.color_ramp.elements.new(0.505)
    after.color = (0, 0, 0, 1)
    links.new(warped.outputs[0], line.inputs[0])
    veined = nodes.new("ShaderNodeMix")
    veined.data_type = "RGBA"
    links.new(line.outputs["Color"], veined.inputs[0])
    links.new(tone.outputs["Color"], veined.inputs[6])
    veined.inputs[7].default_value = vein
    links.new(veined.outputs[2], bsdf.inputs["Base Color"])
    links.new(spread(nodes, links, clouds(nodes, links, position, 2.7), *polish), bsdf.inputs["Roughness"])
    relief(nodes, links, bsdf, clouds(nodes, links, position, 150.0, 2.0), grain)
    return mat


def brushed(name, colour, roughness, along):
    """Brushed metal: fine scratches all running along one axis, which is what
    draws a reflection out into a soft streak across them."""
    mat, nodes, links, bsdf, position = surface(name)
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Metallic"].default_value = 1.0
    stretch = [260.0, 260.0, 260.0]
    stretch["xyz".index(along)] = 1.2
    scratches = clouds(nodes, links, position, 1.0, 3.0, tuple(stretch))
    links.new(spread(nodes, links, scratches, roughness - 0.07, roughness + 0.09), bsdf.inputs["Roughness"])
    relief(nodes, links, bsdf, scratches, 0.0002)
    return mat


def glass(name):
    """A pane of clear glass: seen straight on it is nearly invisible, at a
    glancing angle it mirrors the room. Light passes through it unbent, so
    what stands behind it is lit as if the pane were not there."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.remove(nodes["Principled BSDF"])
    clear = nodes.new("ShaderNodeBsdfTransparent")
    mirror = nodes.new("ShaderNodeBsdfGlossy")
    mirror.inputs["Roughness"].default_value = 0.02
    glancing = nodes.new("ShaderNodeFresnel")
    glancing.inputs["IOR"].default_value = 1.5
    mix = nodes.new("ShaderNodeMixShader")
    links.new(glancing.outputs[0], mix.inputs[0])
    links.new(clear.outputs[0], mix.inputs[1])
    links.new(mirror.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes["Material Output"].inputs["Surface"])
    return mat


def neon(name, colour, shown, true):
    """A tube of light. A picture cannot show a tube as bright as it is (it
    would come out plain white), so the camera sees it at `shown`. Its
    reflection in a floor or a pane of glass is far dimmer than the tube
    and can be shown, so that is worked out from its `true` brightness."""
    mat = glow(name, colour, shown)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    strength = nodes.new("ShaderNodeMapRange")
    strength.inputs["To Min"].default_value, strength.inputs["To Max"].default_value = shown, true
    links.new(nodes.new("ShaderNodeLightPath").outputs["Is Glossy Ray"], strength.inputs["Value"])
    links.new(strength.outputs["Result"], nodes["Emission"].inputs["Strength"])
    return mat


def stock_cover(path, strength):
    """A cover as stock on a shelf wears it: lit from within like the display
    cases, a little dimmer."""
    if (path, strength) not in covers:
        covers[(path, strength)] = glow("stock-" + os.path.basename(path), (1, 1, 1, 1), strength, bpy.data.images.load(path, check_existing=True))
    return covers[(path, strength)]


def small_case(name, path, location, yaw, lean=0.0):
    """A game case at a third of the display size: the stock on the shelves.
    `lean` tips it back; a quarter turn back lays it flat, cover up."""
    body, _ = case(name, path, stock_cover(path, 0.8))
    body.scale = (0.3, 0.3, 0.3)
    body.location = location
    body.rotation_euler = (lean, 0, yaw)
    return body


def lightbox(name, side, y, z, width, height, path, frame):
    """A lit picture panel on the wall, facing the aisle: a wide slice of a cover drawing in a metal frame."""
    x = side * (HALF_WIDTH - 0.022)
    block(name + "-frame", (side * (HALF_WIDTH - 0.02), side * HALF_WIDTH), (y - width / 2 - 0.02, y + width / 2 + 0.02), (z - 0.02, z + height + 0.02), frame, 0.003)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, y - width / 2, z), (x, y + width / 2, z), (x, y + width / 2, z + height), (x, y - width / 2, z + height)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    for loop, coords in zip(uv.data, [(0, 0.42), (1, 0.42), (1, 0.72), (0, 0.72)]):
        loop.uv = coords
    mesh.materials.append(stock_cover(path, 0.9))
    scene.collection.objects.link(bpy.data.objects.new(name, mesh))


def fade_to_band(mat, start, end):
    """Between `start` and `end` along the corridor's axis the surface turns
    into the page's band colour, so a floor can run out into the backdrop
    without an edge."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(nodes.new("ShaderNodeNewGeometry").outputs["Position"], split.inputs[0])
    share = nodes.new("ShaderNodeMapRange")
    share.inputs["From Min"].default_value, share.inputs["From Max"].default_value = start, end
    links.new(split.outputs["Y"], share.inputs["Value"])
    band = nodes.new("ShaderNodeEmission")
    band.inputs["Color"].default_value = BAND
    mix = nodes.new("ShaderNodeMixShader")
    links.new(share.outputs["Result"], mix.inputs[0])
    links.new(nodes["Principled BSDF"].outputs[0], mix.inputs[1])
    links.new(band.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes["Material Output"].inputs["Surface"])


def block(name, x, y, z, mat, bevel=0.004):
    """A box given by where it starts and ends on each axis."""
    centre = ((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2)
    return box(name, centre, (abs(x[1] - x[0]), abs(y[1] - y[0]), abs(z[1] - z[0])), mat, bevel)


def lamp(name, location, colour, watts, across, along, up=False):
    """A strip of light set deep in a recess: it lights the room, but neither
    the camera nor a reflection ever shows the lamp itself, only what it
    lights. `across` is its size across the corridor, `along` its size along it."""
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.size, data.size_y = across, along
    data.color = colour[:3]
    data.energy = watts
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = (math.pi if up else 0, 0, 0)  # an area light shines down unless turned over
    obj.visible_camera = obj.visible_glossy = False
    scene.collection.objects.link(obj)


def dress(body, frame, pane, edge):
    """What turns a gallery case into a display case: a metal frame around
    its front with a hair of light along its inner edge, a pane of glass
    before the cover, and a foot to stand on."""
    y = -CASE_T / 2 - 0.012
    parts = [box("case-foot", (0, 0, -CASE_H / 2 - 0.025), (0.36, 0.11, 0.05), frame, 0.004)]
    for side in (-1, 1):
        parts.append(box("case-frame", (side * (CASE_W / 2 - 0.009), y, 0), (0.018, 0.024, CASE_H), frame, 0.002))
        parts.append(box("case-frame", (0, y, side * (CASE_H / 2 - 0.009)), (CASE_W, 0.024, 0.018), frame, 0.002))
        parts.append(box("case-edge", (side * (CASE_W / 2 - 0.021), y - 0.011, 0), (0.005, 0.003, CASE_H - 0.036), edge))
        parts.append(box("case-edge", (0, y - 0.011, side * (CASE_H / 2 - 0.021)), (CASE_W - 0.036, 0.003, 0.005), edge))
    mesh = bpy.data.meshes.new("case-glass")
    w, h, y = CASE_W / 2 - 0.018, CASE_H / 2 - 0.018, -CASE_T / 2 - 0.016
    mesh.from_pydata([(-w, y, -h), (w, y, -h), (w, y, h), (-w, y, h)], [], [(0, 1, 2, 3)])
    mesh.materials.append(pane)
    parts.append(bpy.data.objects.new("case-glass", mesh))
    scene.collection.objects.link(parts[-1])
    for part in parts:
        part.parent = body

# ------------------------------------------------------------------ the vault look: architecture
#
# Seen from above, one side of the corridor (the other mirrors it):
#
#     centre line          WALL_X  BACK_X
#         |   floor           |######|=|     ###  stone, in front
#         |              +----|      |=|     =    brushed metal, behind
#         |      shelf   |    niche  |=|
#         |              +----|      |=|
#         |                 [pilaster]#|=|
#
# Each bay is a niche cut into the stone, with a metal shelf standing out of
# it and a glass-fronted case on the shelf. Around that case the niche is
# stocked like a shop: rows of small cases below the shelf, beside the case
# and above it, a pile of them on the shelf, a lit picture panel over the
# niche. Everything stands at the walls, no nearer the middle than the
# shelves' front edge, so the aisle the camera travels is as wide as before.
# Light comes from neon tubes
# (rectangles under the ceiling, a line along each shelf and niche, a frame
# around the doorway) and from where a builder would hide it: above a ledge
# under the ceiling, in the top of each niche, under each shelf and in a gap
# at the foot of the wall.

def stock(side, y, seed, shelf, frame, led):
    """Fills one niche with products. `seed` is different for every niche, so no two are stocked alike."""
    facing = -side * math.radians(90)  # toward the aisle
    back = math.radians(-8)  # leaning back a little, as cases do on a shop shelf
    numbers = iter(range(1000))

    def pick():
        # Three drawings on from the last one, so neighbours on a shelf, and the rows above and below, never match.
        return decor[(seed * 7 + next(numbers) * 3) % len(decor)]

    # Below the main shelf, in front of the stone: a plinth and a low shelf, six cases on each.
    block("plinth", (side * 1.84, side * 2.2), (y - 0.88, y + 0.88), (0.0, 0.1), shelf, 0.003)
    block("plinth-led", (side * 1.832, side * 1.84), (y - 0.86, y + 0.86), (0.03, 0.05), led["gold"], 0)
    block("low-shelf", (side * 1.84, side * 2.2), (y - 0.88, y + 0.88), (0.5, 0.52), shelf, 0.002)
    block("low-shelf-led", (side * 1.832, side * 1.84), (y - 0.86, y + 0.86), (0.503, 0.517), led["violet"], 0)
    for z in (0.1, 0.52):
        for place in range(6):
            small_case("stock", pick(), (side * 1.95, y + (place - 2.5) * 0.29, z + 0.18), facing, back)
    # On the main shelf: a case at each end of the niche's back, and one above each on a ledge of its own.
    for along in (-0.7, 0.7):
        small_case("stock", pick(), (side * 2.42, y + along, 1.05 + 0.18), facing)
        block("ledge", (side * 2.3, side * 2.62), (y + along - 0.17, y + along + 0.17), (1.7, 1.72), shelf, 0.002)
        small_case("stock", pick(), (side * 2.42, y + along, 1.72 + 0.18), facing)
    # A pile of cases lying on the near end of the shelf, none quite square to the next.
    for layer in range(3 + seed % 3):
        turn = math.radians((seed * 13 + layer * 29) % 30 - 15)
        small_case("stock", pick(), (side * 1.82, y - 0.58, 1.05 + 0.0105 + layer * 0.021), facing + turn, -math.pi / 2)
    # At the far end, a small block of lit acrylic, as shops stand among their stock.
    block("acrylic", (side * 1.74, side * 1.9), (y + 0.5, y + 0.66), (1.05, 1.21), led[("gold", "violet", "teal")[seed % 3] + "-dim"], 0.006)
    # High in the niche: a narrow shelf with a line of gold along it and six cases.
    block("high-shelf", (side * 2.24, side * 2.62), (y - 0.88, y + 0.88), (2.5, 2.53), shelf, 0.002)
    block("high-shelf-led", (side * 2.232, side * 2.24), (y - 0.86, y + 0.86), (2.505, 2.525), led["gold"], 0)
    for place in range(6):
        small_case("stock", pick(), (side * 2.36, y + (place - 2.5) * 0.29, 2.53 + 0.18), facing, back)
    # Over the niche, on the stone: a lit picture panel.
    lightbox("panel", side, y, 3.2, 1.5, 0.3, pick(), frame)


def build_vault():
    WALL_X, BACK_X, OUTER_X = HALF_WIDTH, 2.62, 2.82
    START, DOOR, DOOR_END = -6.25, LENGTH - 0.15, LENGTH + 0.3  # along the corridor; the doorway is 45 cm deep
    NICHE_Z, NICHE_HALF = (0.55, 3.1), 0.9
    GAP = 0.002  # half the joint between two slabs
    ROOM_X, ROOM_Z, ROOM_END, FLOOR_END = 5.0, 5.4, 47.0, 42.5  # the chamber beyond the doorway

    wall = stone("stone", linear("#2c2a34"), linear("#57526a"), linear("#6f6a7e"), (0.3, 0.55), 0.0008)
    floor = stone("floor", linear("#0c0b11"), linear("#1f1d29"), linear("#2f2c3a"), (0.05, 0.14), 0.00015)
    fade_to_band(floor, FLOOR_END - 4.5, FLOOR_END - 0.5)
    upright = brushed("metal-upright", linear("#5a5664"), 0.3, "z")
    lengthwise = brushed("metal-lengthwise", linear("#5a5664"), 0.3, "y")
    backing = brushed("metal-backing", linear("#1d1c22"), 0.42, "z")
    bronze = brushed("bronze", linear("#7a6248"), 0.32, "z")
    overhead = material("overhead", linear("#17161d"), roughness=0.7)
    pane = glass("glass")
    SOFT = (0.62, 0.55, 1.0, 1.0)  # the white of the lamps: violet, not neutral
    VIOLET = linear("#a03cff")  # the neon leans toward magenta; the page's own purple stays on the backdrop
    GOLD = linear("#ffb02e")
    # Each tube: how bright the camera sees it, and how bright it is. The
    # light a tube gives the room comes from a lamp placed beside it.
    led = {
        "violet": neon("led-violet", VIOLET, 2.2, 14.0),
        "teal": neon("led-teal", TEAL, 1.4, 10.0),
        "gold": neon("led-gold", GOLD, 1.4, 12.0),
        "soft": neon("led-soft", SOFT, 2.0, 6.0),
        "violet-dim": glow("acrylic-violet", VIOLET, 0.8),
        "teal-dim": glow("acrylic-teal", TEAL, 0.6),
        "gold-dim": glow("acrylic-gold", GOLD, 0.7),
    }
    joints = [START + BAY * i for i in range(15)] + [DOOR]  # where wall and ceiling panels meet
    tiles = [START + BAY / 2 * i for i in range(29)] + [DOOR]  # the floor is laid in smaller tiles

    # Floor, ceiling and the wall behind the camera.
    block("bed", (-ROOM_X - 0.6, ROOM_X + 0.6), (START - 0.3, FLOOR_END), (-0.3, -0.1), overhead, 0)
    for a, b in zip(tiles, tiles[1:]):
        for x0, x1 in ((-OUTER_X, -1.1), (-1.1, 0.0), (0.0, 1.1), (1.1, OUTER_X)):
            block("tile", (x0 + GAP, x1 - GAP), (a + GAP, b - GAP), (-0.1, 0.0), floor, 0.0015)
    for a, b in zip(joints, joints[1:]):
        block("ceiling", (-OUTER_X, OUTER_X), (a + GAP, b - GAP), (HEIGHT, HEIGHT + 0.1), overhead, 0.002)
    for bay in range(BAYS):
        # Over each bay hangs a rectangle of neon tube. A picture cannot show
        # a tube as bright as it is, so a lamp beside it gives the light it would.
        y = BAY * (bay + 1)
        for side in (-1, 1):
            block("ring", (side * 0.93, side * 0.97), (y - 0.65, y + 0.65), (HEIGHT - 0.07, HEIGHT - 0.03), led["violet"], 0)
            block("ring", (-0.97, 0.97), (y + side * 0.63, y + side * 0.67), (HEIGHT - 0.07, HEIGHT - 0.03), led["violet"], 0)
        lamp("ring-light", (0, y, HEIGHT - 0.08), VIOLET, 120, 1.8, 1.2)
    # A track of small spotlights along each side of the ceiling, turned toward the shelves.
    for side in (-1, 1):
        block("track", (side * 1.42, side * 1.46), (START, DOOR), (HEIGHT - 0.04, HEIGHT - 0.015), backing, 0)
        for spot in range(BAYS * 2):
            can = block("spot", (side * 1.39, side * 1.49), (1.9 + BAY / 2 * spot - 0.05, 1.9 + BAY / 2 * spot + 0.05), (HEIGHT - 0.2, HEIGHT - 0.05), backing, 0.01)
            can.rotation_euler = (0, side * math.radians(-28), 0)
            box("spot-lens", (0, 0, -0.077), (0.07, 0.07, 0.004), led["soft"]).parent = can
    block("end", (-OUTER_X, OUTER_X), (START - 0.2, START), (0.0, HEIGHT), wall, 0)

    for side in (-1, 1):
        def x(near, far):
            return (side * near, side * far)

        block("backing", x(BACK_X, OUTER_X), (START, DOOR), (0.0, HEIGHT), backing, 0)
        for a, b in zip(joints, joints[1:]):
            # Stone below and above the niches, one panel per bay.
            block("dado", x(WALL_X, BACK_X), (a + GAP, b - GAP), (0.07, NICHE_Z[0]), wall)
            block("frieze", x(WALL_X, BACK_X), (a + GAP, b - GAP), (NICHE_Z[1], HEIGHT), wall)
            # The ledge under the ceiling, and the light lying on top of it.
            block("ledge", x(WALL_X - 0.24, WALL_X), (a + GAP, b - GAP), (3.56, 3.62), lengthwise, 0.003)
            lamp("ledge-light", (side * (WALL_X - 0.11), (a + b) / 2, 3.64), VIOLET, 140, 0.12, b - a - 0.1, up=True)
        # A warm line of light in the gap at the foot of the wall.
        block("foot-led", x(2.3, 2.32), (START, DOOR), (0.02, 0.045), led["gold"], 0)

        # The stone between one niche and the next.
        edge = START
        for bay in range(BAYS + 1):
            until = BAY * (bay + 1) - NICHE_HALF if bay < BAYS else DOOR
            block("pier", x(WALL_X, BACK_X), (edge, until), NICHE_Z, wall)
            edge = until + 2 * NICHE_HALF
            # A pilaster stands out from each pier, with a strip of metal let into its face.
            y = BAY * bay + BAY / 2
            block("pilaster", x(WALL_X - 0.2, WALL_X), (y - 0.22, y + 0.22), (0.0, 3.56), wall, 0.006)
            block("inlay", x(WALL_X - 0.206, WALL_X - 0.198), (y - 0.035, y + 0.035), (0.12, 3.44), upright, 0.002)
            block("pilaster-led", x(WALL_X - 0.21, WALL_X - 0.206), (y - 0.012, y + 0.012), (0.3, 3.3), led["teal" if bay % 2 else "violet"], 0)

    for bay in range(BAYS):
        y = BAY * (bay + 1)
        for index, side in enumerate((-1, 1)):
            # The shelf: teal light along its front edge and from underneath.
            block("shelf", (side * 1.62, side * BACK_X), (y - 0.74, y + 0.74), (1.0, 1.05), lengthwise, 0.003)
            block("shelf-edge", (side * 1.612, side * 1.622), (y - 0.72, y + 0.72), (1.012, 1.032), led["teal"], 0)
            block("shelf-led", (side * 1.66, side * 1.69), (y - 0.7, y + 0.7), (0.99, 1.0), led["teal"], 0)
            lamp("shelf-light", (side * 1.95, y, 0.985), TEAL, 16, 0.5, 1.3)
            # The niche: a line of violet along its head, and a soft light down its back.
            block("niche-led", (side * 2.215, side * 2.235), (y - 0.86, y + 0.86), (NICHE_Z[1] - 0.02, NICHE_Z[1]), led["violet"], 0)
            lamp("niche-light", (side * 2.42, y, NICHE_Z[1] - 0.03), SOFT, 45, 0.25, 1.3)
            # The case on the shelf, where the blockout has it.
            # Its cover is chosen so that the next bay, and the case across the aisle, show different ones.
            body, _ = case(f"gallery-{bay}-{index}", gallery[(bay * 3 + index * 4) % len(gallery)])
            body.location = (side * (HALF_WIDTH - 0.28), y, 1.7)
            body.rotation_euler = (0, 0, -side * math.radians(62))
            dress(body, upright, pane, led["soft"])
            stock(side, y, bay * 2 + index, lengthwise, upright, led)

    # The doorway: a bronze frame with a line of warm light around its opening.
    for side in (-1, 1):
        block("jamb", (side * 2.0, side * OUTER_X), (DOOR, DOOR_END), (0.0, HEIGHT), bronze, 0.004)
        block("door-led", (side * 2.03, side * 2.07), (DOOR - 0.012, DOOR), (0.03, 3.77), led["gold"], 0)
    block("lintel", (-2.0, 2.0), (DOOR, DOOR_END), (3.8, HEIGHT + 0.1), bronze, 0.004)
    block("door-led", (-2.07, 2.07), (DOOR - 0.012, DOOR), (3.73, 3.77), led["gold"], 0)
    lamp("door-light", (0, DOOR - 0.3, 3.7), GOLD, 260, 3.6, 0.3)
    block("threshold", (-2.0, 2.0), (DOOR + GAP, DOOR_END), (-0.1, 0.0), lengthwise, 0.002)

    # The chamber. It is wider and taller than the corridor, and it ends in a
    # wall of light the colour of the page's band. Nothing of it stands where
    # the camera looks in its last position, so the last frame is the six
    # cases on that colour and nothing else.
    rows = [DOOR_END, 32.5, 35.0, 37.5, 40.0, FLOOR_END, 45.0, ROOM_END]
    columns = [-5.5 + 1.1 * i for i in range(11)]
    beyond = [DOOR_END + (FLOOR_END - DOOR_END) / 10 * i for i in range(11)]  # floor tiles, as far as the floor goes
    for a, b in zip(beyond, beyond[1:]):
        for x0, x1 in zip(columns, columns[1:]):
            block("tile", (x0 + GAP, x1 - GAP), (a + GAP, b - GAP), (-0.1, 0.0), floor, 0.0015)
    for a, b in zip(rows, rows[1:]):
        for side in (-1, 1):
            block("room-wall", (side * ROOM_X, side * (ROOM_X + 0.2)), (a + GAP, b - GAP), (0.0, ROOM_Z), wall)
            # A slot of light up the wall at each joint.
            block("room-led", (side * (ROOM_X - 0.012), side * ROOM_X), (a - 0.02, a + 0.02), (0.4, ROOM_Z - 0.4), led["violet"], 0)
    for side in (-1, 1):
        block("room-front", (side * OUTER_X, side * (ROOM_X + 0.2)), (LENGTH, DOOR_END), (0.0, ROOM_Z), wall, 0)
        block("room-foot-led", (side * (ROOM_X - 0.03), side * ROOM_X), (DOOR_END, ROOM_END), (0.02, 0.05), led["teal"], 0)
    block("room-front", (-OUTER_X, OUTER_X), (LENGTH, DOOR_END), (HEIGHT + 0.1, ROOM_Z), wall, 0)
    block("room-ceiling", (-ROOM_X - 0.2, ROOM_X + 0.2), (LENGTH, ROOM_END), (ROOM_Z, ROOM_Z + 0.1), overhead, 0)
    # Two rings of neon under the chamber's ceiling, gold inside violet, and the light they give.
    for radius, colour in ((2.4, "gold"), (3.3, "violet")):
        bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=0.03, major_segments=96, minor_segments=8, location=(0, 37.0, ROOM_Z - 0.12))
        bpy.context.object.data.materials.append(led[colour])
    lamp("room-light", (0, 37.0, ROOM_Z - 0.2), SOFT, 700, 4.0, 4.0)
    # The camera looks through this to the background, which is the same colour; it is here to light the room and to be reflected.
    block("light-wall", (-ROOM_X, ROOM_X), (ROOM_END, ROOM_END + 0.05), (-2.0, ROOM_Z), glow("light-wall", BAND, 1.0), 0).visible_camera = False

    # Haze: air that scatters a little light, so the far end of the corridor
    # softens and the lamps glow into it. It stops at the doorway.
    density = options.get("haze", 0)
    if density:
        haze = bpy.data.materials.new("haze")
        haze.use_nodes = True
        nodes, links = haze.node_tree.nodes, haze.node_tree.links
        nodes.remove(nodes["Principled BSDF"])
        air = nodes.new("ShaderNodeVolumePrincipled")
        air.inputs["Density"].default_value = density
        air.inputs["Anisotropy"].default_value = 0.3
        links.new(air.outputs[0], nodes["Material Output"].inputs["Volume"])
        block("haze", (-WALL_X, WALL_X), (START, DOOR), (0.0, HEIGHT), haze, 0)

# ------------------------------------------------------------------ the corridor

LENGTH, HALF_WIDTH, HEIGHT = 30.0, 2.2, 4.0
BAYS = 11  # one case on each wall per bay
BAY = 2.5
gallery = options["gallery"]
decor = options.get("decor") or gallery  # drawings for the stock on the shelves

if VAULT:
    CASE = brushed("case", linear("#3a3840"), 0.34, "z")  # the hero cases too are metal in this look
    build_vault()
else:
    box("floor", (0, LENGTH / 2 - 3, -0.05), (HALF_WIDTH * 2 + 0.4, LENGTH + 6, 0.1), FLOOR)
    box("ceiling", (0, LENGTH / 2 - 3, HEIGHT + 0.05), (HALF_WIDTH * 2 + 0.4, LENGTH + 6, 0.1), WALL)
    for side in (-1, 1):
        box("wall", (side * (HALF_WIDTH + 0.1), LENGTH / 2 - 3, HEIGHT / 2), (0.2, LENGTH + 6, HEIGHT), WALL)
        # One line of light where each wall meets the ceiling, and a fainter one at the floor.
        box("ceiling-line", (side * (HALF_WIDTH - 0.06), LENGTH / 2 - 3, HEIGHT - 0.06), (0.05, LENGTH + 6, 0.05), STRIP["purple"])
        box("floor-line", (side * (HALF_WIDTH - 0.04), LENGTH / 2 - 3, 0.03), (0.03, LENGTH + 6, 0.03), STRIP["purple"])

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
seconds = []  # how long each frame took to draw
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
    started = time.time()
    bpy.ops.render.render(write_still=True)
    seconds.append(round(time.time() - started, 1))
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
    "seconds": seconds,
}
with open(os.path.join(out, "layout.json"), "w") as handle:
    json.dump(report, handle, indent=2)
if options.get("blend"):
    bpy.ops.wm.save_as_mainfile(filepath=options["blend"])
print("RENDERED", len(wanted) if wanted is not None else FRAMES, "frames to", out)
