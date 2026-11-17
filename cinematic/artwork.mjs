// A library of original game-cover illustrations for the shop in the
// cinematic scene. Each is a 600x800 drawing (3:4, the shape of a product
// card's cover) made here from shapes and gradients: no lettering, no
// logos, nothing taken from an existing game. They are decoration for the
// corridor's shelves; the six cases the animation ends on keep the real
// products' covers.
//
// The order is the ranking: the first eight are the ones bold enough to
// read from across the corridor, and go on the large display cases.

// A repeatable "random" number between 0 and 1, so a drawing is the same every time it is made.
const dice = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296

const defs = `
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="22"/></filter>
  <filter id="haze" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="45"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0"/></filter>
  <radialGradient id="edges" cx="0.5" cy="0.45" r="0.8"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>`

let count = 0
const gradient = (stops, radial = false) => {
  const id = `g${(count += 1)}`
  const body = stops.map(([offset, colour, opacity = 1]) => `<stop offset="${offset}" stop-color="${colour}" stop-opacity="${opacity}"/>`).join('')
  return { id: `url(#${id})`, def: radial ? `<radialGradient id="${id}">${body}</radialGradient>` : `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${body}</linearGradient>` }
}

// The pieces most covers are built from. Each returns SVG; `fill` helpers add their gradient to the drawing's definitions.
function kit() {
  const extra = []
  const fill = (stops, radial) => {
    const made = gradient(stops, radial)
    extra.push(made.def)
    return made.id
  }
  return {
    extra,
    fill,
    sky: (...stops) => `<rect width="600" height="800" fill="${fill(stops)}"/>`,
    stars: (seed, n, below = 500) => {
      const next = dice(seed)
      return Array.from({ length: n }, () => `<circle cx="${(next() * 600).toFixed(0)}" cy="${(next() * below).toFixed(0)}" r="${(0.5 + next() * 1.4).toFixed(1)}" fill="#fff" opacity="${(0.35 + next() * 0.65).toFixed(2)}"/>`).join('')
    },
    // A sun, moon or planet: a soft halo behind a shaded disc.
    orb: (cx, cy, r, light, dark, halo = light) => `<circle cx="${cx}" cy="${cy}" r="${r * 1.5}" fill="${halo}" opacity="0.45" filter="url(#haze)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill([[0, light], [1, dark]])}"/>`,
    light: (cx, cy, r, colour, opacity = 0.6) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}" opacity="${opacity}" filter="url(#glow)"/>`,
    // A line of hills or mountains across the picture; `rough` makes peaks, 0 makes rolling ground.
    ridge: (seed, y, height, colour, rough = 1, steps = 14) => {
      const next = dice(seed)
      let d = `M-20,800 L-20,${y}`
      for (let i = 0; i <= steps; i += 1) {
        const x = -20 + (640 / steps) * i
        const up = height * (0.25 + 0.75 * next()) * (i % 2 ? 1 : 0.45 + 0.4 * (1 - rough))
        d += rough ? ` L${x.toFixed(0)},${(y - up).toFixed(0)}` : ` Q${(x - 320 / steps).toFixed(0)},${(y - up * 1.3).toFixed(0)} ${x.toFixed(0)},${(y - up * 0.6).toFixed(0)}`
      }
      return `<path d="${d} L620,800 Z" fill="${colour}"/>`
    },
    // A row of towers with some windows lit.
    skyline: (seed, y, colour, lit, tall = 260, wide = 70) => {
      const next = dice(seed)
      let out = ''
      for (let x = -10; x < 610; ) {
        const w = 26 + next() * wide
        const h = 60 + next() * tall
        out += `<rect x="${x.toFixed(0)}" y="${(y - h).toFixed(0)}" width="${w.toFixed(0)}" height="${(h + 800 - y).toFixed(0)}" fill="${colour}"/>`
        for (let wy = y - h + 10; wy < y - 8; wy += 14) for (let wx = x + 6; wx < x + w - 8; wx += 11) if (next() < 0.32) out += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="5" height="7" fill="${lit}" opacity="${(0.5 + next() * 0.5).toFixed(2)}"/>`
        x += w + next() * 6
      }
      return out
    },
    mist: (y, height, colour, opacity = 0.5) => `<rect x="-40" y="${y}" width="680" height="${height}" fill="${colour}" opacity="${opacity}" filter="url(#glow)"/>`,
    at: (x, y, scale, body, turn = 0) => `<g transform="translate(${x} ${y}) rotate(${turn}) scale(${scale})">${body}</g>`,
  }
}

const draw = (make) => {
  const k = kit()
  const body = make(k)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800"><defs>${defs}${k.extra.join('')}</defs>${body}<rect width="600" height="800" fill="url(#edges)"/><rect width="600" height="800" filter="url(#grain)"/></svg>`
}

// Figures and machines, each drawn around its own middle so it can be placed, sized and turned.
const ship = (hull, glowColour) => `<ellipse cx="-118" cy="0" rx="60" ry="9" fill="${glowColour}" filter="url(#soft)"/><path d="M-95,0 C-40,-24 40,-24 120,0 C40,15 -40,15 -95,0 Z" fill="${hull}"/><path d="M-25,6 L-85,50 L-45,50 L30,9 Z M-55,-8 L-95,-46 L-68,-46 L-20,-13 Z" fill="${hull}"/><path d="M40,-11 C62,-12 84,-7 100,-2 C80,-4 60,-5 42,-4 Z" fill="${glowColour}" opacity="0.9"/>`
const dragon = (colour) => `<path d="M0,0 C-40,-62 -112,-84 -165,-52 C-134,-46 -124,-30 -128,-10 C-104,-26 -88,-16 -82,6 C-62,-13 -42,-5 -30,12 Z" fill="${colour}"/><path d="M8,0 C48,-62 120,-84 173,-52 C142,-46 132,-30 136,-10 C112,-26 96,-16 90,6 C70,-13 50,-5 38,12 Z" fill="${colour}"/><path d="M-12,-4 C-2,-30 20,-46 46,-52 L62,-62 L57,-48 L74,-46 L54,-36 C36,-30 26,-14 24,6 C34,42 12,74 -26,100 C-4,62 -8,36 -14,16 Z" fill="${colour}"/>`
const sideCar = (body, glass, lamp) => `<path d="M-160,12 C-160,-10 -128,-18 -96,-20 L-54,-23 C-32,-50 10,-58 52,-56 C84,-54 104,-42 120,-25 L156,-17 C172,-12 176,0 172,12 Z" fill="${body}"/><path d="M-40,-25 C-24,-45 10,-51 46,-49 C70,-47 88,-37 100,-25 Z" fill="${glass}"/><circle cx="-100" cy="14" r="26" fill="#07070c"/><circle cx="-100" cy="14" r="12" fill="${glass}"/><circle cx="108" cy="14" r="26" fill="#07070c"/><circle cx="108" cy="14" r="12" fill="${glass}"/><ellipse cx="170" cy="-6" rx="10" ry="5" fill="${lamp}"/><ellipse cx="200" cy="-4" rx="46" ry="10" fill="${lamp}" opacity="0.5" filter="url(#soft)"/>`
const rearCar = (body, glass, lamp) => `<path d="M-120,36 L-120,0 L-100,-40 L-64,-66 L64,-66 L100,-40 L120,0 L120,36 Z" fill="${body}"/><path d="M-60,-58 L60,-58 L84,-36 L-84,-36 Z" fill="${glass}"/><rect x="-112" y="-18" width="224" height="9" fill="${lamp}"/><rect x="-126" y="-26" width="252" height="26" fill="${lamp}" opacity="0.55" filter="url(#soft)"/><rect x="-122" y="26" width="42" height="30" rx="6" fill="#050509"/><rect x="80" y="26" width="42" height="30" rx="6" fill="#050509"/>`
const soldier = (colour) => `<circle cx="0" cy="-152" r="15" fill="${colour}"/><path d="M-19,-156 C-19,-178 19,-178 19,-156 Z" fill="${colour}"/><path d="M-30,-134 L30,-134 L40,-108 L36,-56 L-36,-56 L-40,-108 Z" fill="${colour}"/><path d="M-40,-128 L-58,-70 L-46,-62 L-30,-110 Z M40,-128 L60,-84 L20,-64 L14,-76 L44,-92 L30,-116 Z" fill="${colour}"/><path d="M-34,-58 L-4,-58 L-8,44 L-38,44 Z M4,-58 L34,-58 L38,44 L8,44 Z" fill="${colour}"/><path d="M-10,-92 L96,-124 L99,-114 L-6,-80 Z" fill="${colour}"/><rect x="-24" y="-130" width="16" height="50" fill="${colour}"/>`
const hooded = (colour, eyes) => `<path d="M0,-180 C-34,-180 -48,-146 -44,-112 L-78,-92 C-100,-80 -106,-36 -112,70 L112,70 C106,-36 100,-80 78,-92 L44,-112 C48,-146 34,-180 0,-180 Z" fill="${colour}"/><path d="M0,-164 C-22,-164 -30,-140 -26,-116 C-10,-106 10,-106 26,-116 C30,-140 22,-164 0,-164 Z" fill="#000" opacity="0.55"/><rect x="-18" y="-140" width="36" height="5" rx="2" fill="${eyes}"/><rect x="-22" y="-144" width="44" height="13" fill="${eyes}" opacity="0.5" filter="url(#soft)"/>`
const mech = (colour, eye) => `<rect x="-26" y="-250" width="52" height="40" rx="6" fill="${colour}"/><rect x="-18" y="-238" width="36" height="8" fill="${eye}"/><rect x="-24" y="-244" width="48" height="20" fill="${eye}" opacity="0.5" filter="url(#soft)"/><path d="M-100,-206 L100,-206 L112,-150 L62,-140 L52,-40 L-52,-40 L-62,-140 L-112,-150 Z" fill="${colour}"/><rect x="-132" y="-196" width="38" height="150" rx="10" fill="${colour}"/><rect x="94" y="-196" width="38" height="150" rx="10" fill="${colour}"/><rect x="-140" y="-56" width="54" height="46" rx="8" fill="${colour}"/><rect x="86" y="-56" width="54" height="46" rx="8" fill="${colour}"/><path d="M-56,-44 L-8,-44 L-12,110 L-70,110 Z M8,-44 L56,-44 L70,110 L12,110 Z" fill="${colour}"/><circle cx="0" cy="-150" r="14" fill="${eye}"/><circle cx="0" cy="-150" r="30" fill="${eye}" opacity="0.4" filter="url(#soft)"/>`
const knight = (colour, cape) => `<path d="M-14,-96 C-60,-70 -84,-10 -70,64 L-8,56 Z" fill="${cape}"/><circle cx="0" cy="-118" r="14" fill="${colour}"/><path d="M-4,-134 L4,-134 L2,-150 L-2,-150 Z" fill="${colour}"/><path d="M-24,-102 L24,-102 L28,-40 L-28,-40 Z" fill="${colour}"/><path d="M-26,-42 L-4,-42 L-8,60 L-30,60 Z M4,-42 L26,-42 L32,60 L10,60 Z" fill="${colour}"/><path d="M22,-98 L52,-150 L60,-144 L34,-88 Z" fill="${colour}"/><path d="M52,-146 L78,-246 L84,-244 L62,-142 Z" fill="${colour}"/><rect x="44" y="-156" width="26" height="6" transform="rotate(14 57 -153)" fill="${colour}"/>`
const jet = (colour) => `<path d="M0,-84 L13,-30 L74,22 L74,36 L15,24 L11,52 L32,68 L32,77 L0,70 L-32,77 L-32,68 L-11,52 L-15,24 L-74,36 L-74,22 L-13,-30 Z" fill="${colour}"/>`
const rider = (colour, lamp) => `<circle cx="-76" cy="0" r="36" fill="none" stroke="${colour}" stroke-width="12"/><circle cx="86" cy="0" r="36" fill="none" stroke="${colour}" stroke-width="12"/><path d="M-76,0 L-40,-46 L40,-52 L86,0 L60,-4 L20,-30 L-30,-26 Z" fill="${colour}"/><path d="M-44,-48 C-40,-92 -6,-112 30,-104 L62,-62 L48,-52 L20,-78 L-4,-46 Z" fill="${colour}"/><circle cx="34" cy="-118" r="17" fill="${colour}"/><path d="M52,-62 L78,-58 L80,-50 L50,-52 Z" fill="${colour}"/><ellipse cx="124" cy="-24" rx="30" ry="8" fill="${lamp}" opacity="0.8" filter="url(#soft)"/>`
const helmet = (shell, visor, shine) => `<path d="M-160,44 C-182,-150 -96,-246 0,-246 C96,-246 182,-150 160,44 C150,128 86,182 0,188 C-86,182 -150,128 -160,44 Z" fill="${shell}"/><path d="M-150,-44 C-96,-76 96,-76 150,-44 L142,34 C86,6 -86,6 -142,34 Z" fill="${visor}"/><path d="M-120,-40 C-70,-58 -10,-62 40,-58 L20,-20 C-30,-22 -80,-16 -124,-2 Z" fill="${shine}" opacity="0.55"/><path d="M-60,96 L60,96 M-48,116 L48,116 M-34,136 L34,136" stroke="#000" stroke-opacity="0.5" stroke-width="7" stroke-linecap="round"/><circle cx="-146" cy="60" r="9" fill="${shine}"/><circle cx="146" cy="60" r="9" fill="${shine}"/>`
const wanderer = (colour) => `<ellipse cx="0" cy="-92" rx="24" ry="5" fill="${colour}"/><rect x="-11" y="-104" width="22" height="13" rx="3" fill="${colour}"/><circle cx="0" cy="-82" r="9" fill="${colour}"/><path d="M-13,-72 L13,-72 L15,-28 L-15,-28 Z" fill="${colour}"/><rect x="-27" y="-70" width="16" height="34" rx="4" fill="${colour}"/><path d="M-14,-30 L-2,-30 L-6,30 L-18,30 Z M2,-30 L14,-30 L20,30 L8,30 Z" fill="${colour}"/><path d="M26,-64 L30,30" stroke="${colour}" stroke-width="4"/><path d="M13,-66 L28,-50 L24,-46 L11,-58 Z" fill="${colour}"/>`
const swordsman = (colour) => `<path d="M-34,-108 L0,-134 L34,-108 Z" fill="${colour}"/><circle cx="0" cy="-102" r="10" fill="${colour}"/><path d="M-18,-92 L18,-92 L40,40 L-40,40 Z" fill="${colour}"/><path d="M16,-80 L112,-150 L115,-145 L22,-70 Z" fill="${colour}"/><path d="M-40,40 L-50,60 L-22,60 L-16,40 Z M16,40 L22,60 L50,60 L40,40 Z" fill="${colour}"/>`

export const covers = [
  { name: 'neon-district', theme: 'cyberpunk', svg: draw((k) => [
    k.sky([0, '#12052e'], [0.55, '#5a1489'], [1, '#ff2e97']),
    k.orb(300, 300, 150, '#ffd166', '#ff2e97', '#ff5ea8'),
    ...[0, 1, 2, 3, 4].map((i) => `<rect x="130" y="${332 + i * 24}" width="340" height="${4 + i * 2}" fill="#5a1489"/>`),
    k.skyline(11, 560, '#1c0b3d', '#28e0ff', 300, 60), k.skyline(23, 650, '#0d0522', '#ff5ea8', 190, 90),
    k.mist(600, 120, '#ff2e97', 0.35), k.at(300, 720, 1.25, hooded('#05020f', '#28e0ff')),
  ].join('')) },
  { name: 'dragon-peak', theme: 'fantasy', svg: draw((k) => [
    k.sky([0, '#2a0f3f'], [0.45, '#c2410c'], [0.8, '#fbbf24']),
    k.orb(330, 330, 170, '#fff3c4', '#f59e0b', '#fb923c'),
    k.ridge(5, 600, 190, '#7c2d12', 1), k.mist(520, 90, '#fdba74', 0.4), k.ridge(9, 690, 210, '#431407', 1),
    '<path d="M70,560 L70,470 L84,440 L98,470 L98,520 L130,520 L130,450 L150,410 L170,450 L170,520 L200,520 L200,480 L212,456 L224,480 L224,560 Z" fill="#1c0a05"/>',
    k.ridge(14, 790, 150, '#1c0a05', 1), k.at(320, 300, 1.25, dragon('#160804'), -8),
  ].join('')) },
  { name: 'star-drifter', theme: 'sci-fi', svg: draw((k) => [
    k.sky([0, '#020617'], [0.6, '#172554'], [1, '#4c1d95']), k.stars(3, 150, 800),
    k.light(420, 250, 190, '#38bdf8', 0.35), k.orb(420, 250, 150, '#7dd3fc', '#1e3a8a', '#38bdf8'),
    '<ellipse cx="420" cy="250" rx="250" ry="42" fill="none" stroke="#e0f2fe" stroke-width="12" opacity="0.8" transform="rotate(-18 420 250)"/>',
    k.orb(110, 150, 34, '#fca5a5', '#7f1d1d', '#f87171'),
    '<path d="M-40,760 L330,560" stroke="#7dd3fc" stroke-width="26" opacity="0.35" filter="url(#soft)"/>',
    k.at(330, 560, 1.5, ship('#e2e8f0', '#67e8f9'), -28), k.ridge(31, 800, 70, '#020617', 1, 9),
  ].join('')) },
  { name: 'midnight-drift', theme: 'racing', svg: draw((k) => [
    k.sky([0, '#0b0223'], [0.5, '#4a0d7a'], [0.62, '#ff3d81']),
    k.orb(300, 330, 170, '#ffe66d', '#ff3d81', '#ff7ab6'),
    ...[0, 1, 2, 3, 4, 5].map((i) => `<rect x="110" y="${350 + i * 26}" width="380" height="${5 + i * 3}" fill="#4a0d7a"/>`),
    k.skyline(8, 500, '#1a0638', '#ffd166', 150, 50),
    '<rect y="496" width="600" height="304" fill="#0b0223"/>',
    ...Array.from({ length: 13 }, (_, i) => `<path d="M300,496 L${-900 + i * 200},800" stroke="#28e0ff" stroke-width="2" opacity="0.7"/>`),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M0,${500 + i * i * 6.2} L600,${500 + i * i * 6.2}" stroke="#28e0ff" stroke-width="2" opacity="0.7"/>`),
    k.light(300, 690, 150, '#ff2e63', 0.35), k.at(300, 668, 1.5, rearCar('#14062e', '#3b1a6e', '#ff2e63')),
  ].join('')) },
  { name: 'hollow-manor', theme: 'horror', svg: draw((k) => [
    k.sky([0, '#020d12'], [0.6, '#0f3d3e'], [1, '#134e4a']), k.stars(17, 40, 300),
    k.orb(400, 210, 120, '#f8fafc', '#a7f3d0', '#99f6e4'),
    k.ridge(21, 640, 90, '#06201f', 0), k.mist(560, 90, '#5eead4', 0.25),
    '<path d="M150,640 L150,430 L190,380 L230,430 L230,400 L300,320 L370,400 L370,360 L395,300 L420,360 L420,640 Z" fill="#020a0c"/><path d="M386,300 L395,240 L404,300 Z" fill="#020a0c"/><rect x="330" y="330" width="16" height="50" fill="#020a0c"/>',
    '<rect x="180" y="470" width="24" height="36" fill="#fde047"/><rect x="286" y="420" width="28" height="44" fill="#fde047"/><rect x="386" y="400" width="18" height="30" fill="#fde047" opacity="0.8"/><rect x="270" y="560" width="46" height="80" fill="#050f12"/>',
    k.light(300, 442, 40, '#fde047', 0.5),
    '<path d="M520,700 C516,600 500,560 470,520 M506,610 C530,580 548,560 576,548 M500,570 C490,540 486,520 492,492 M486,548 C462,540 446,524 436,504" stroke="#020a0c" stroke-width="12" fill="none" stroke-linecap="round"/>',
    ...[[120, 180, 1], [210, 130, 0.7], [520, 330, 0.8], [80, 300, 0.6]].map(([x, y, s]) => k.at(x, y, s, '<path d="M0,0 C-10,-16 -26,-14 -34,-2 C-26,-6 -20,-2 -16,6 C-10,0 -4,0 0,6 C4,0 10,0 16,6 C20,-2 26,-6 34,-2 C26,-14 10,-16 0,0 Z" fill="#020a0c"/>')),
    k.ridge(27, 800, 120, '#020a0c', 0), k.mist(690, 110, '#5eead4', 0.18),
  ].join('')) },
  { name: 'iron-colossus', theme: 'sci-fi', svg: draw((k) => [
    k.sky([0, '#0c1220'], [0.6, '#7c2d12'], [1, '#fb923c']),
    k.light(300, 420, 240, '#fb923c', 0.45),
    '<path d="M300,330 L40,0 L170,0 Z M300,330 L560,0 L430,0 Z" fill="#fde68a" opacity="0.12"/>',
    k.skyline(41, 640, '#3b1408', '#fde68a', 130, 46), k.at(300, 600, 1.45, mech('#120805', '#22d3ee')),
    k.skyline(47, 760, '#0a0403', '#fb923c', 90, 70), k.mist(640, 120, '#fb923c', 0.25),
  ].join('')) },
  { name: 'samurai-dusk', theme: 'action', svg: draw((k) => [
    k.sky([0, '#450a0a'], [0.5, '#dc2626'], [1, '#fca5a5']),
    k.orb(300, 300, 190, '#fff1f2', '#fb7185', '#fda4af'),
    k.ridge(51, 600, 150, '#7f1d1d', 1), k.mist(540, 90, '#fecaca', 0.35),
    '<path d="M70,720 L70,330 L96,330 L96,720 Z M504,720 L504,330 L530,330 L530,720 Z M40,300 C200,330 400,330 560,300 L566,330 C400,356 200,356 34,330 Z M60,384 L540,384 L540,408 L60,408 Z" fill="#1a0505"/>',
    k.ridge(57, 790, 110, '#1a0505', 0), k.at(300, 668, 1.5, swordsman('#0d0202')),
    ...Array.from({ length: 22 }, (_, i) => `<path d="M${(i * 83) % 600},${(i * 137) % 700} l10,5 l-9,3 Z" fill="#fecdd3" opacity="0.8"/>`),
  ].join('')) },
  { name: 'circuit-breaker', theme: 'cyberpunk', svg: draw((k) => [
    k.sky([0, '#1e0536'], [0.5, '#a21caf'], [1, '#22d3ee']),
    ...Array.from({ length: 16 }, (_, i) => `<path d="M${-40 + i * 44},0 L${-40 + i * 44},${120 + ((i * 97) % 260)} l22,22 l0,${200 + ((i * 53) % 200)}" stroke="#f0abfc" stroke-width="3" fill="none" opacity="0.35"/><circle cx="${-18 + i * 44}" cy="${342 + ((i * 97) % 260) + ((i * 53) % 200)}" r="5" fill="#f0abfc" opacity="0.5"/>`),
    k.light(300, 400, 230, '#22d3ee', 0.3), k.at(300, 420, 1.2, helmet(k.fill([[0, '#2a1245'], [1, '#07020f']]), k.fill([[0, '#67e8f9'], [0.5, '#22d3ee'], [1, '#a21caf']]), '#ecfeff')),
    '<path d="M150,640 C200,700 400,700 450,640 L520,800 L80,800 Z" fill="#07020f"/>',
  ].join('')) },
  { name: 'apex-circuit', theme: 'racing', svg: draw((k) => [
    k.sky([0, '#0c4a6e'], [0.5, '#f97316'], [0.7, '#fde047']),
    k.orb(430, 400, 110, '#fffbeb', '#fbbf24', '#fde68a'), k.ridge(61, 520, 110, '#7c2d12', 0), k.ridge(63, 560, 60, '#431407', 0),
    '<path d="M0,560 L600,560 L600,800 L0,800 Z" fill="#1c1917"/><path d="M0,584 L600,584" stroke="#fef3c7" stroke-width="5" opacity="0.8"/>',
    ...Array.from({ length: 9 }, (_, i) => `<rect x="${-40 + i * 80}" y="690" width="46" height="9" fill="#fef3c7" opacity="0.85"/>`),
    ...Array.from({ length: 9 }, (_, i) => `<rect x="${-200 + ((i * 131) % 300)}" y="${600 + i * 11}" width="${160 + ((i * 71) % 200)}" height="4" fill="#fed7aa" opacity="0.5"/>`),
    k.light(330, 650, 120, '#f97316', 0.3), k.at(330, 630, 1.45, sideCar(k.fill([[0, '#ef4444'], [1, '#7f1d1d']]), '#1e293b', '#fef9c3')),
  ].join('')) },
  { name: 'frost-kingdom', theme: 'fantasy', svg: draw((k) => [
    k.sky([0, '#020617'], [0.5, '#0e7490'], [1, '#a5f3fc']), k.stars(71, 90, 380),
    '<path d="M-40,250 C120,120 260,330 420,170 S640,220 660,120" stroke="#5eead4" stroke-width="60" fill="none" opacity="0.4" filter="url(#glow)"/><path d="M-40,330 C140,220 300,400 460,260 S640,300 660,230" stroke="#a78bfa" stroke-width="44" fill="none" opacity="0.35" filter="url(#glow)"/>',
    k.ridge(73, 560, 230, '#155e75', 1), k.ridge(75, 600, 170, '#e0f2fe', 1, 10),
    '<path d="M430,470 L430,380 L442,350 L454,380 L454,420 L478,420 L478,350 L494,310 L510,350 L510,470 Z" fill="#083344"/>',
    k.ridge(77, 700, 110, '#0c4a6e', 1), k.ridge(79, 800, 130, '#f0f9ff', 0), k.at(220, 610, 1.35, knight('#04121c', '#b91c1c')),
  ].join('')) },
  { name: 'the-deep', theme: 'horror', svg: draw((k) => [
    k.sky([0, '#0e7490'], [0.4, '#164e63'], [1, '#020617']),
    '<path d="M180,0 L60,420 L200,420 Z M300,0 L260,520 L400,520 Z M430,0 L470,380 L590,380 Z" fill="#a5f3fc" opacity="0.1"/>',
    ...[[-30, 800, 150, 420, 40], [640, 800, 430, 380, 46], [80, 820, 260, 560, 30], [540, 820, 330, 600, 28]].map(([x0, y0, x1, y1, w]) => `<path d="M${x0},${y0} C${x0 + (x1 - x0) * 0.2},${y1 + 160} ${x1 + (x0 < 300 ? 90 : -90)},${y1 + 110} ${x1},${y1} C${x1 + (x0 < 300 ? -30 : 30)},${y1 - 40} ${x1 + (x0 < 300 ? 20 : -20)},${y1 - 60} ${x1 + (x0 < 300 ? 44 : -44)},${y1 - 34}" stroke="#010409" stroke-width="${w}" fill="none" stroke-linecap="round"/>`),
    k.light(300, 780, 200, '#dc2626', 0.35), '<ellipse cx="300" cy="760" rx="70" ry="34" fill="#fca5a5"/><ellipse cx="300" cy="760" rx="16" ry="32" fill="#010409"/>',
    '<path d="M344,300 L560,220 L590,330 Z" fill="#fef9c3" opacity="0.28"/>',
    k.at(290, 300, 1, '<ellipse cx="0" cy="0" rx="70" ry="24" fill="#f8fafc"/><rect x="-22" y="-44" width="34" height="26" rx="6" fill="#f8fafc"/><circle cx="40" cy="-2" r="9" fill="#0e7490"/><path d="M-70,0 L-92,-18 L-92,18 Z" fill="#f8fafc"/><circle cx="62" cy="0" r="8" fill="#fef08a"/>'),
    ...Array.from({ length: 14 }, (_, i) => `<circle cx="${250 + ((i * 37) % 90)}" cy="${250 - i * 17}" r="${2 + (i % 3)}" fill="#e0f2fe" opacity="0.6"/>`),
  ].join('')) },
  { name: 'lost-canyon', theme: 'adventure', svg: draw((k) => [
    k.sky([0, '#0f766e'], [0.5, '#fbbf24'], [1, '#fde68a']),
    k.orb(210, 290, 90, '#fffbeb', '#fde047', '#fef08a'),
    k.ridge(81, 520, 150, '#b45309', 1, 8), k.mist(470, 80, '#fef3c7', 0.4), k.ridge(83, 610, 180, '#92400e', 1, 7),
    '<path d="M330,520 L352,470 L372,470 L372,440 L392,440 L392,416 L428,416 L428,440 L448,440 L448,470 L468,470 L490,520 Z" fill="#451a03"/><rect x="402" y="486" width="16" height="34" fill="#fde047"/>',
    k.mist(560, 70, '#fde68a', 0.3), k.ridge(85, 700, 120, '#78350f', 1, 6),
    '<path d="M-20,800 L-20,560 L170,560 L230,600 L250,800 Z" fill="#1c0f05"/>', k.at(130, 530, 1.15, wanderer('#1c0f05')),
    '<path d="M600,0 C520,60 480,150 500,250 C530,170 570,120 600,100 Z M600,120 C540,190 530,260 548,330 C566,270 584,230 600,210 Z" fill="#14532d"/>',
  ].join('')) },
  { name: 'last-squad', theme: 'action', svg: draw((k) => [
    k.sky([0, '#1c1917'], [0.5, '#9a3412'], [1, '#fdba74']),
    k.light(300, 430, 260, '#f97316', 0.6), k.orb(300, 430, 170, '#fef9c3', '#ea580c', '#fb923c'),
    '<path d="M150,330 C90,250 190,200 180,130 C250,170 260,90 330,110 C340,170 430,150 420,240 C480,270 450,330 460,360 Z" fill="#292524" opacity="0.85"/>',
    k.skyline(91, 640, '#1c1210', '#fdba74', 120, 80),
    ...[[110, 190, 0.8], [470, 150, 0.6]].map(([x, y, s]) => k.at(x, y, s, '<ellipse cx="0" cy="0" rx="46" ry="15" fill="#0c0a09"/><path d="M40,0 L96,-10 L96,-4 Z" fill="#0c0a09"/><path d="M-70,-22 L70,-22" stroke="#0c0a09" stroke-width="5"/><path d="M0,-22 L0,-10" stroke="#0c0a09" stroke-width="6"/>')),
    k.ridge(93, 800, 90, '#0c0a09', 0), k.at(300, 700, 1.6, soldier('#0c0a09')),
  ].join('')) },
  { name: 'sky-corsairs', theme: 'adventure', svg: draw((k) => [
    k.sky([0, '#1d4ed8'], [0.55, '#f472b6'], [1, '#fde68a']),
    k.orb(450, 520, 100, '#fffbeb', '#fbbf24', '#fde68a'),
    ...[[90, 560, 150], [300, 640, 210], [520, 600, 160], [180, 720, 240], [470, 760, 260]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.36}" fill="#fff7ed" opacity="0.85" filter="url(#soft)"/>`),
    k.at(290, 330, 1.35, '<ellipse cx="0" cy="-70" rx="140" ry="58" fill="#7c2d12"/><path d="M-140,-70 C-60,-50 60,-50 140,-70 C60,-30 -60,-30 -140,-70 Z" fill="#431407"/><path d="M-110,-30 L-90,26 M110,-30 L90,26 M-40,-16 L-36,26 M40,-16 L36,26" stroke="#1c0a05" stroke-width="3"/><path d="M-120,26 L120,26 L86,70 L-76,70 Z" fill="#1c0a05"/><path d="M120,30 L176,6 L150,48 Z M-120,34 L-160,60 L-110,56 Z" fill="#1c0a05"/><path d="M0,-128 L0,-160 L40,-150 L0,-140" fill="#dc2626"/>'),
    ...[[110, 230, 0.4], [480, 250, 0.3]].map(([x, y, s]) => k.at(x, y, s, '<ellipse cx="0" cy="-70" rx="140" ry="58" fill="#431407"/><path d="M-120,26 L120,26 L86,70 L-76,70 Z" fill="#1c0a05"/><path d="M-110,-30 L-90,26 M110,-30 L90,26" stroke="#1c0a05" stroke-width="5"/>')),
  ].join('')) },
  { name: 'arcane-tower', theme: 'fantasy', svg: draw((k) => [
    k.sky([0, '#0f0728'], [0.6, '#5b21b6'], [1, '#c084fc']), k.stars(101, 120, 520),
    k.orb(130, 170, 60, '#f5f3ff', '#a78bfa', '#c4b5fd'), k.orb(210, 120, 22, '#fdf4ff', '#e879f9', '#f0abfc'),
    k.ridge(103, 640, 130, '#2e1065', 1),
    '<path d="M270,700 L286,330 L262,300 L290,290 L300,170 L310,290 L338,300 L314,330 L330,700 Z" fill="#0a0418"/><rect x="246" y="430" width="108" height="14" fill="#0a0418"/><rect x="254" y="560" width="92" height="14" fill="#0a0418"/><rect x="292" y="360" width="16" height="30" fill="#f0abfc"/><rect x="292" y="480" width="16" height="30" fill="#f0abfc"/>',
    k.light(300, 150, 90, '#f0abfc', 0.8), '<circle cx="300" cy="150" r="26" fill="#fdf4ff"/>',
    ...[70, 110, 150].map((r, i) => `<ellipse cx="300" cy="150" rx="${r}" ry="${r * 0.3}" fill="none" stroke="#f0abfc" stroke-width="4" opacity="${0.8 - i * 0.2}" transform="rotate(${-20 + i * 20} 300 150)"/>`),
    k.ridge(107, 800, 130, '#0a0418', 0),
    k.at(160, 690, 0.9, '<path d="M-22,60 L0,-70 L22,60 Z" fill="#0a0418"/><path d="M-16,-70 L0,-112 L16,-70 Z" fill="#0a0418"/><path d="M34,60 L34,-100" stroke="#0a0418" stroke-width="5"/><circle cx="34" cy="-106" r="9" fill="#f0abfc"/>'),
    k.light(190, 596, 30, '#f0abfc', 0.7),
  ].join('')) },
  { name: 'wasteland-run', theme: 'action', svg: draw((k) => [
    k.sky([0, '#7c2d12'], [0.5, '#f59e0b'], [1, '#fde68a']),
    k.orb(300, 360, 200, '#fffbeb', '#f59e0b', '#fcd34d'),
    k.skyline(111, 560, '#92400e', '#92400e', 200, 40), k.mist(500, 90, '#fde68a', 0.5), k.ridge(113, 610, 60, '#78350f', 0),
    '<path d="M0,640 L600,640 L600,800 L0,800 Z" fill="#451a03"/><path d="M240,640 L360,640 L640,800 L-40,800 Z" fill="#292524"/>',
    '<ellipse cx="150" cy="660" rx="200" ry="34" fill="#fde68a" opacity="0.5" filter="url(#glow)"/>',
    k.at(330, 650, 1.25, rider('#120a04', '#fef08a')),
  ].join('')) },
  { name: 'ghost-signal', theme: 'horror', svg: draw((k) => [
    k.sky([0, '#020617'], [0.6, '#450a0a'], [1, '#991b1b']), k.stars(121, 110, 800),
    k.light(300, 380, 260, '#dc2626', 0.35),
    '<path d="M60,800 C60,640 150,600 300,600 C450,600 540,640 540,800 Z" fill="#e2e8f0"/><path d="M210,600 L390,600 L380,640 L220,640 Z" fill="#64748b"/><rect x="250" y="690" width="100" height="60" rx="8" fill="#334155"/><circle cx="274" cy="720" r="8" fill="#ef4444"/><circle cx="300" cy="720" r="8" fill="#22d3ee"/>',
    '<circle cx="300" cy="400" r="190" fill="#f1f5f9"/>', `<circle cx="300" cy="400" r="150" fill="${k.fill([[0, '#7f1d1d'], [1, '#020617']])}"/>`,
    '<circle cx="350" cy="450" r="70" fill="#ef4444"/><circle cx="330" cy="430" r="70" fill="#020617" opacity="0.45"/><path d="M196,330 C230,280 280,262 330,266 C280,280 240,310 216,360 Z" fill="#fff" opacity="0.5"/>',
    '<path d="M300,250 L286,330 L312,352 L292,420 L318,470" stroke="#fff" stroke-width="4" fill="none" opacity="0.8"/>',
  ].join('')) },
  { name: 'jungle-relic', theme: 'adventure', svg: draw((k) => [
    k.sky([0, '#022c22'], [0.5, '#059669'], [1, '#a7f3d0']),
    k.orb(300, 250, 130, '#f0fdf4', '#86efac', '#bbf7d0'), k.ridge(131, 560, 120, '#065f46', 0), k.mist(480, 90, '#d1fae5', 0.35),
    ...[0, 1, 2, 3, 4].map((i) => `<path d="M${130 + i * 34},${640 - i * 62} L${470 - i * 34},${640 - i * 62} L${452 - i * 34},${578 - i * 62} L${148 + i * 34},${578 - i * 62} Z" fill="${i % 2 ? '#134e4a' : '#0f3d3a'}"/>`),
    '<path d="M276,640 L324,640 L312,330 L288,330 Z" fill="#042f2e"/><rect x="278" y="296" width="44" height="42" fill="#042f2e"/>', k.light(300, 320, 40, '#fde047', 0.9), '<rect x="290" y="306" width="20" height="30" fill="#fef08a"/>',
    k.ridge(133, 720, 80, '#022c22', 0),
    ...[[-10, 800, 1], [610, 800, -1]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s} 1)"><path d="M0,0 C40,-200 130,-330 250,-380 C170,-300 120,-190 100,-60 Z M0,-40 C10,-240 60,-400 150,-500 C110,-390 96,-260 100,-120 Z M0,-20 C80,-130 180,-190 300,-200 C210,-160 140,-100 90,-10 Z" fill="#011a14"/></g>`),
  ].join('')) },
  { name: 'storm-fleet', theme: 'sci-fi', svg: draw((k) => [
    k.sky([0, '#020617'], [0.6, '#1e1b4b'], [1, '#312e81']), k.stars(141, 140, 620),
    k.light(300, 700, 300, '#38bdf8', 0.5), `<circle cx="300" cy="1260" r="640" fill="${k.fill([[0, '#0c4a6e'], [1, '#020617']])}"/>`,
    '<path d="M-40,690 C140,600 460,600 640,690" stroke="#7dd3fc" stroke-width="7" fill="none"/><path d="M-40,690 C140,600 460,600 640,690" stroke="#bae6fd" stroke-width="30" fill="none" opacity="0.5" filter="url(#glow)"/>',
    k.light(470, 628, 60, '#fef9c3', 0.9),
    ...[[300, 300, 1.5], [150, 430, 0.95], [450, 430, 0.95], [60, 540, 0.6], [540, 540, 0.6], [300, 520, 0.7]].map(([x, y, s]) => `<path d="M${x},${y + 70 * s} L${x},${y + 330 * s}" stroke="#7dd3fc" stroke-width="${10 * s}" opacity="0.3" filter="url(#soft)"/>` + k.at(x, y, s, jet('#e2e8f0') + '<circle cx="0" cy="72" r="9" fill="#67e8f9"/>')),
  ].join('')) },
  { name: 'rogue-protocol', theme: 'action', svg: draw((k) => [
    k.sky([0, '#082f49'], [0.5, '#0ea5e9'], [1, '#e0f2fe']),
    ...[[100, 620, 220], [420, 700, 300], [540, 520, 180], [220, 780, 280]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.4}" fill="#f8fafc" opacity="0.9" filter="url(#soft)"/>`),
    k.orb(470, 170, 70, '#fffbeb', '#fde047', '#fef9c3'),
    '<path d="M250,360 L80,820 M330,340 L260,820" stroke="#f8fafc" stroke-width="22" opacity="0.75" filter="url(#soft)"/>',
    k.at(300, 320, 1.9, jet(k.fill([[0, '#475569'], [1, '#0f172a']])) + '<path d="M0,-60 L7,-34 L-7,-34 Z" fill="#38bdf8"/>', 24),
    ...[[120, 250, 0.5, 30], [470, 430, 0.45, 18]].map(([x, y, s, r]) => k.at(x, y, s, jet('#1e293b'), r)),
  ].join('')) },
]
