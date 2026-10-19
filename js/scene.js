// Illustration animée : ciel de l'aube, montagne, mer de nuages.
let uid = 0;

const SKIES = {
  top: ['#1c2c5e', '#5d4f93', '#c97a86', '#f3a965'],
  good: ['#1a2f62', '#46609f', '#9b8fc0', '#e9aaa0'],
  maybe: ['#1f2f4c', '#3f5a82', '#7189aa', '#a9bad0'],
  low: ['#262d3a', '#3d4757', '#5e6878', '#848e9d'],
  na: ['#262d3a', '#3d4757', '#5e6878', '#848e9d'],
};

// Courbe lissée (Catmull-Rom → Bézier) passant par les points.
function smooth(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// Vague périodique (période p), assez large pour boucler par translation.
function wave(y, amp, p, W, H) {
  let d = `M${-p} ${y.toFixed(1)} Q${-p + p / 4} ${(y - amp).toFixed(1)} ${-p + p / 2} ${y.toFixed(1)}`;
  for (let x = -p + p / 2; x < W + p; x += p / 2) d += ` T${x + p / 2} ${y.toFixed(1)}`;
  return `${d} L${W + p} ${H} L${-p} ${H} Z`;
}

/**
 * @param s   site (alt, name)
 * @param d   conditions du meilleur créneau (top, seaCC, summitCC, aboveCC, high) ou null
 * @param cls classe de score (top, good, maybe, low, na)
 * @param opt { W, H, labels }
 */
export function scene(s, d, cls = 'na', { W = 340, H = 190, labels = true } = {}) {
  const id = `sc${++uid}`;
  const sky = SKIES[cls] ?? SKIES.na;
  const base = 120;
  const zMax = Math.round(s.alt * 1.32 + 220);
  const y = (z) => H - ((Math.min(z, zMax) - base) / (zMax - base)) * (H - 18);
  const above = d?.aboveCC ?? 40;
  const hasSea = d?.top != null && d.seaCC >= 25;
  const inCloud = hasSea && (d.top > s.alt + 20 || d.summitCC >= 50);
  const peakX = Math.round(W * 0.44);
  const py = y(s.alt);
  const f = (k) => y(base + (s.alt - base) * k);

  const ridge = [[0, f(0.3)], [W * 0.09, f(0.36)], [W * 0.16, f(0.5)], [W * 0.25, f(0.57)], [W * 0.31, f(0.74)],
    [W * 0.38, f(0.87)], [peakX, py], [W * 0.5, f(0.9)], [W * 0.56, f(0.8)], [W * 0.63, f(0.66)],
    [W * 0.71, f(0.6)], [W * 0.8, f(0.46)], [W * 0.89, f(0.38)], [W, f(0.3)]];
  const back = [[0, f(0.55)], [W * 0.12, f(0.62)], [W * 0.22, f(0.5)], [W * 0.55, f(0.58)], [W * 0.68, f(0.72)],
    [W * 0.78, f(0.64)], [W * 0.9, f(0.7)], [W, f(0.6)]];
  const ridgePath = smooth(ridge);

  let g = `<svg viewBox="0 0 ${W} ${H}" class="scene" role="img" aria-label="${
    hasSea ? (inCloud ? `${s.name} dans le nuage, couche jusqu’à ${d.top} m` : `Mer de nuages jusqu’à ${d.top} m sous ${s.name} (${s.alt} m)`)
      : `Pas de mer de nuages sous ${s.name}`}">
  <defs>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky[0]}"/><stop offset=".45" stop-color="${sky[1]}"/>
      <stop offset=".78" stop-color="${sky[2]}"/><stop offset="1" stop-color="${sky[3]}"/>
    </linearGradient>
    <radialGradient id="${id}g"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".95"/><stop offset=".35" stop-color="#ffc27a" stop-opacity=".45"/><stop offset="1" stop-color="#ff9f6a" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2f52"/><stop offset="1" stop-color="#121628"/></linearGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b5f8f" stop-opacity=".75"/><stop offset="1" stop-color="#3a3f68" stop-opacity=".6"/></linearGradient>
    <linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#eef0fb"/><stop offset="1" stop-color="#c8cde6"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${id}s)"/>`;

  // Étoiles quand le ciel est dégagé.
  if (above < 50) {
    let seed = s.alt;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    g += '<g class="sc-stars">';
    for (let i = 0; i < 18; i++) {
      g += `<circle class="sc-star" cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H * 0.42).toFixed(0)}" r="${(0.5 + rnd() * 0.8).toFixed(1)}" style="--d:${(rnd() * 3).toFixed(1)}s"/>`;
    }
    g += '</g>';
  }

  // Soleil levant derrière la crête.
  if (above < 65) {
    const op = (1 - above / 80).toFixed(2);
    const sx = W * 0.8, sy = f(0.62);
    g += `<g style="opacity:${op}"><circle class="sc-glow" cx="${sx}" cy="${sy}" r="${H * 0.42}" fill="url(#${id}g)"/>
      <circle cx="${sx}" cy="${sy}" r="${H * 0.075}" fill="#ffe7b0"/></g>`;
  }

  // Nuages d'altitude.
  if (above >= 20) {
    g += `<g class="sc-high" style="opacity:${Math.min(0.85, above / 100 + 0.1).toFixed(2)}" fill="#e7e9f5">
      <ellipse cx="${W * 0.14}" cy="${H * 0.12}" rx="${W * 0.12}" ry="5"/><ellipse cx="${W * 0.24}" cy="${H * 0.09}" rx="${W * 0.08}" ry="5"/>
      <ellipse cx="${W * 0.66}" cy="${H * 0.16}" rx="${W * 0.14}" ry="5"/><ellipse cx="${W * 0.78}" cy="${H * 0.12}" rx="${W * 0.07}" ry="4"/></g>`;
  }

  g += `<path d="${smooth(back)} L${W} ${H} L0 ${H} Z" fill="url(#${id}b)"/>`;
  g += `<path d="${ridgePath} L${W} ${H} L0 ${H} Z" fill="url(#${id}m)"/>`;
  g += `<path d="${smooth(ridge.slice(5, 10))}" fill="none" stroke="#ffc9a3" stroke-opacity=".35" stroke-width="1.2"/>`;

  // Mer de nuages : deux vagues décalées qui dérivent.
  if (hasSea) {
    const ty = inCloud ? Math.min(py - 14, y(d.top)) : y(d.top);
    const op = (0.55 + 0.42 * d.seaCC / 100).toFixed(2);
    g += `<g style="opacity:${op}">
      <g class="sc-wave sc-w2" style="--p:56"><path d="${wave(ty + 4, 3, 56, W, H)}" fill="#dfe3f5" opacity=".7"/></g>
      <g class="sc-wave sc-w1" style="--p:44"><path d="${wave(ty, 2.6, 44, W, H)}" fill="url(#${id}c)"/></g>
    </g>`;
    if (labels) {
      const lbl = inCloud ? 'Sommet dans le nuage' : `Nuages ≈ ${d.top} m`;
      const ly = Math.max(12, ty - 1);
      // Étiquette à droite : le coin haut gauche accueille les boutons lever / coucher.
      const lw = lbl.length * 5.6 + 14;
      g += `<line x1="0" x2="${W}" y1="${ty}" y2="${ty}" class="sc-line"/>
        <g transform="translate(${W - lw - 10} ${Math.max(52, Math.min(H - 22, ly + 6))})"><rect width="${lw}" height="17" rx="8.5" class="sc-pill"/>
        <text x="7" y="12" class="sc-txt dark">${lbl}</text></g>`;
    }
  }

  // Le site.
  g += `<circle class="sc-pulse" cx="${peakX}" cy="${py}" r="6"/>
    <circle cx="${peakX}" cy="${py}" r="3.6" class="sc-site"/>`;
  if (labels) g += `<text x="${peakX + 9}" y="${py - 6}" class="sc-txt">${s.alt} m</text>`;
  return `${g}</svg>`;
}
