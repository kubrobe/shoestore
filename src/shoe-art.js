// Generates a clean side-view sneaker as SVG, in any colour. The shop uses it as the product picture
// until the shop owner uploads real photos (products.image_url). Everything is drawn with plain
// shapes, so it needs no image files and the colour of the selected variant changes the picture.
//
//   GET /img/shoe/:productId.svg?c=%23cdbfaa   -> that product in that colour
//   GET /img/shoe.svg?style=runner&c=%231b1b1d -> any style / colour

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');

// amount > 0 mixes with white, < 0 mixes with black
export function shade(hex, amount) {
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  return toHex(rgb(hex).map((v) => v + (target - v) * a));
}
export const isDark = (hex) => {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
};

export const STYLES = ['court', 'runner', 'high', 'chunky', 'slip', 'boot'];
const ACCENTS = ['#f26a3d', '#3d6fb4', '#e0b44c', '#4f7a5a', '#d6456b'];
export const accentFor = (productId = 0) => ACCENTS[Math.abs(Number(productId) || 0) % ACCENTS.length];

// ---- upper (the cloth/leather part), one path per style. The shoe points LEFT; ground is at y = 412.
const UPPERS = {
  court: `M84 380 C78 352 96 326 132 316 C170 306 214 300 250 286 L262 278 C286 266 306 246 322 226 L346 222
          C352 244 376 262 404 262 C436 262 470 248 502 240 C522 238 534 268 531 316 L528 380 Z`,
  runner: `M82 380 C76 356 92 334 128 324 C168 316 214 308 252 290 L264 280 C288 268 308 248 324 232 L348 228
           C354 248 378 264 406 264 C438 264 472 250 504 242 C524 240 536 270 533 318 L530 380 Z`,
  high: `M84 380 C78 352 96 326 132 316 C170 306 214 300 250 286 L262 278 C282 262 294 222 300 170 L332 160
         C338 178 354 198 382 206 C412 212 442 198 474 180 C502 170 522 192 524 234 C528 272 530 310 528 380 Z`,
  chunky: `M80 380 C72 346 94 318 134 310 C174 302 216 298 252 282 L264 274 C288 262 308 244 324 224 L350 220
           C356 242 380 260 408 260 C440 260 474 246 506 238 C528 236 538 268 535 316 L532 380 Z`,
  slip: `M84 380 C78 356 98 334 134 326 C176 320 220 322 262 318 C290 316 316 300 340 290 C366 282 400 286 430 292
         C466 296 500 292 520 286 C534 300 533 340 530 380 Z`,
  boot: `M86 380 C80 352 98 326 134 316 C172 306 214 300 248 288 L260 280 C292 262 318 200 330 118 L500 108
         C524 112 534 170 532 250 C534 296 534 336 530 380 Z`,
};

// ---- sole (drawn on top of the upper so the join is always clean)
const SOLES = {
  court: { top: `M72 382 C72 400 86 414 108 414 L506 414 C528 414 542 402 542 382 L542 366 L72 366 Z`, out: 400 },
  runner: { top: `M70 386 C70 402 84 414 106 414 L508 414 C532 414 544 398 544 374 L544 336 C470 350 300 360 72 372 Z`, out: 400 },
  high: { top: `M72 382 C72 400 86 414 108 414 L506 414 C528 414 542 402 542 382 L542 366 L72 366 Z`, out: 400 },
  chunky: { top: `M66 388 C66 404 82 416 106 416 L512 416 C536 416 548 402 548 380 L548 350 C470 354 300 352 70 352 Z`, out: 400 },
  slip: { top: `M72 390 C72 404 86 414 108 414 L506 414 C528 414 540 404 540 388 L540 376 L72 376 Z`, out: 404 },
  boot: { top: `M68 384 C68 404 84 416 108 416 L508 416 C532 416 546 404 546 384 L546 360 L68 360 Z`, out: 398 },
};

// Laces: [x, y] points along the vamp, each a short bar across the lace panel
const LACES = {
  court: [[236, 290], [216, 296], [196, 301], [176, 306]],
  runner: [[240, 296], [220, 301], [200, 306], [180, 311]],
  high: [[262, 262], [268, 240], [274, 218], [280, 196], [236, 292], [212, 298], [188, 304]],
  chunky: [[240, 288], [220, 293], [200, 298], [180, 303]],
  slip: [],
  boot: [[270, 268], [278, 244], [286, 220], [294, 196], [302, 172], [310, 148], [244, 292], [214, 300], [184, 308]],
};

export function shoeSvg({ style = 'court', color = '#cdbfaa', accent = '#f26a3d', bg = null } = {}) {
  const s = STYLES.includes(style) ? style : 'court';
  const base = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#cdbfaa';
  const acc = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent.toLowerCase() : '#f26a3d';
  const dark = shade(base, -0.28);
  const darker = shade(base, -0.5);
  const light = shade(base, 0.2);
  const accentFinal = Math.abs(rgb(acc).reduce((a, b) => a + b, 0) - rgb(base).reduce((a, b) => a + b, 0)) < 90 ? shade(acc, isDark(base) ? 0.5 : -0.4) : acc;
  const soleFill = isDark(base) && s !== 'boot' ? '#f1eee6' : '#f6f3ec';
  const lace = isDark(base) ? '#f4f1ea' : '#ffffff';
  const sole = SOLES[s];
  const lift = s === 'chunky' ? -10 : 0;           // chunky sole is taller, the upper sits higher
  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img">`);
  parts.push(`<defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".30"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
    <pattern id="mesh" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.3" fill="#fff" fill-opacity=".30"/><circle cx="7" cy="7" r="1.3" fill="#fff" fill-opacity=".30"/></pattern>
  </defs>`);
  if (bg) parts.push(`<rect width="600" height="600" fill="${bg}"/>`);

  // Everything is scaled up and centred; tall shoes (high-top, boot) sit lower than low shoes.
  const dy = s === 'boot' ? 32 : s === 'high' ? 14 : -22;
  parts.push(`<g transform="translate(0 ${dy}) translate(300 300) scale(1.14) translate(-300 -300)">`);
  // ground shadow
  parts.push(`<ellipse cx="305" cy="428" rx="236" ry="20" fill="url(#g)"/>`);

  // shoe group (slightly rotated, like a product photo)
  parts.push(`<g transform="translate(0 -6) rotate(-3 300 330)">`);

  // upper + gentle light/shade
  parts.push(`<g transform="translate(0 ${lift})">`);
  parts.push(`<path d="${UPPERS[s]}" fill="${base}"/>`);
  parts.push(`<path d="${UPPERS[s]}" fill="url(#sh)"/>`);

  if (s === 'runner') parts.push(`<path d="${UPPERS[s]}" fill="url(#mesh)"/>`);

  // inner collar / opening
  if (s === 'slip') {
    parts.push(`<path d="M340 290 C366 282 400 286 430 292 C466 296 500 292 520 286 C500 304 466 310 430 308 C400 306 366 300 340 290 Z" fill="${darker}"/>`);
    parts.push(`<path d="M236 321 C252 319 272 319 288 314 L288 336 C270 342 252 342 236 340 Z" fill="${accentFinal}"/>`);
    parts.push(`<path d="M246 328 h30" stroke="${shade(accentFinal, 0.5)}" stroke-width="3" stroke-linecap="round"/>`);
  } else if (s === 'boot') {
    parts.push(`<path d="M330 118 L500 108 C510 110 518 122 522 142 C440 130 380 134 330 150 Z" fill="${darker}"/>`);
    parts.push(`<path d="M500 108 C524 112 534 170 532 250 C512 220 506 160 500 108 Z" fill="${dark}"/>`);
  } else {
    const hi = s === 'high';
    const inner = hi
      ? 'M332 160 C338 178 354 198 382 206 C412 212 442 198 474 180 C446 190 414 198 384 194 C356 188 340 176 332 160 Z'
      : 'M346 222 C352 244 376 262 404 262 C436 262 470 248 502 240 C470 246 436 254 404 252 C376 252 352 238 346 222 Z';
    parts.push(`<path d="${inner}" fill="${darker}"/>`);
  }

  // toe cap and heel counter
  if (s !== 'slip') {
    parts.push(`<path d="M84 380 C78 352 96 326 132 316 C150 311 166 322 168 342 L170 380 Z" fill="${light}" fill-opacity=".85"/>`);
  } else {
    parts.push(`<path d="M84 380 C78 356 98 334 134 326 C150 323 164 332 166 348 L168 380 Z" fill="${light}" fill-opacity=".8"/>`);
  }
  const heelTop = { court: 240, runner: 242, high: 172, chunky: 238, slip: 286, boot: 150 }[s];
  parts.push(`<path d="M531 ${heelTop + 76} C534 ${heelTop + 30} 522 ${heelTop} 502 ${heelTop} L472 ${heelTop + 12} C480 ${heelTop + 60} 482 ${heelTop + 100} 478 380 L529 380 Z" fill="${dark}" fill-opacity=".9"/>`);

  // side panel in the accent colour
  if (s === 'court' || s === 'chunky' || s === 'high') {
    parts.push(`<path d="M262 288 L308 284 C322 314 326 346 322 380 L278 380 C282 346 276 316 262 288 Z" fill="${accentFinal}"/>`);
  } else if (s === 'runner') {
    parts.push(`<path d="M250 360 C310 356 392 330 468 282 C436 338 362 374 262 378 Z" fill="${accentFinal}"/>`);
  } else if (s === 'boot') {
    parts.push(`<path d="M236 330 C300 322 372 318 524 314 L526 350 C420 352 320 360 238 366 Z" fill="${dark}"/>`);
  }

  // lace panel + laces
  if (LACES[s].length) {
    const pts = LACES[s];
    parts.push(`<path d="${s === 'high' || s === 'boot' ? 'M262 282 L' + (s === 'boot' ? '330 118' : '300 168') : 'M254 290 L160 312'}" stroke="${dark}" stroke-width="${s === 'boot' ? 26 : s === 'high' ? 22 : 16}" stroke-linecap="round" opacity=".55" fill="none"/>`);
    for (const [x, y] of pts) {
      parts.push(`<path d="M${x - 9} ${y - 9} L${x + 9} ${y + 9}" stroke="${lace}" stroke-width="5" stroke-linecap="round"/>`);
      parts.push(`<path d="M${x + 9} ${y - 9} L${x - 9} ${y + 9}" stroke="${lace}" stroke-width="5" stroke-linecap="round" opacity=".85"/>`);
    }
  }

  // stitching along the bottom edge of the upper
  parts.push(`<path d="M96 364 C150 360 260 358 330 356 C400 354 470 358 520 362" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-dasharray="6 6" fill="none"/>`);
  parts.push(`</g>`);

  // sole on top
  parts.push(`<path d="${sole.top}" fill="${soleFill}"/>`);
  parts.push(`<path d="${sole.top}" fill="url(#sh)"/>`);
  // outsole band (clipped to the sole shape)
  parts.push(`<clipPath id="sc"><path d="${sole.top}"/></clipPath>`);
  parts.push(`<rect x="60" y="${sole.out}" width="500" height="24" fill="${shade(soleFill, -0.2)}" clip-path="url(#sc)"/>`);
  if (s === 'chunky' || s === 'boot') {
    // lugs
    for (let x = 90; x < 520; x += 26) parts.push(`<rect x="${x}" y="${sole.out + 4}" width="14" height="14" rx="3" fill="${shade(soleFill, -0.4)}" clip-path="url(#sc)"/>`);
  }
  // sole highlight line
  parts.push(`<path d="M86 ${s === 'slip' ? 380 : 372} L530 ${s === 'runner' ? 344 : s === 'slip' ? 380 : 372}" stroke="#fff" stroke-opacity=".7" stroke-width="2" fill="none" transform="translate(0 ${s === 'chunky' ? -14 : 0})"/>`);
  parts.push(`</g></g></svg>`);
  return parts.join('');
}
