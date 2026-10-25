// Illustration pastel : ciel, soleil, pic générique, mer de nuages en rangées de nuages ronds.
let uid = 0;

// Ciel selon la chance de mer de nuages : pêche quand c'est prometteur, lavande grisée sinon.
const SKIES = {
  top: ['#fff0e2', '#fbd2c6', '#ecc9e0'],
  good: ['#fff3e6', '#fde0cc', '#f1d3e3'],
  maybe: ['#f6eef6', '#e8dff2', '#dcd6ee'],
  low: ['#f1eef3', '#e4e0ea', '#d8d4e2'],
  na: ['#f1eef3', '#e4e0ea', '#d8d4e2'],
};

// Rangée de nuages ronds (motif de 4 rayons, répété pour pouvoir dériver en boucle) posée sur un aplat.
function puffs(cy, radii, step, fill, W, H, cls) {
  const period = step * radii.length;
  let c = '';
  for (let i = 0, x = -period; x < W + period * 2; i++, x += step) {
    c += `<circle cx="${x.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radii[i % radii.length].toFixed(1)}"/>`;
  }
  return `<g class="${cls}" style="--p:${period.toFixed(1)}" fill="${fill}">${c}
    <rect x="${-period}" y="${cy.toFixed(1)}" width="${W + period * 3}" height="${Math.max(0, H - cy).toFixed(1)}"/></g>`;
}

/**
 * @param s   site (alt, name)
 * @param d   conditions du meilleur créneau (top, seaCC, summitCC, aboveCC, high) ou null
 * @param cls classe de score (top, good, maybe, low, na)
 * @param opt { W, H, labels }
 */
export function scene(s, d, cls = 'na', { W = 340, H = 220, labels = true } = {}) {
  const id = `sc${++uid}`;
  const sky = SKIES[cls] ?? SKIES.na;
  const k = H / 230; // échelle des formes, dessinées pour 230 px de haut
  const base = 120;
  const zMax = Math.round(s.alt * 1.32 + 220);
  const y = (z) => H - ((Math.min(z, zMax) - base) / (zMax - base)) * (H - 18);
  const f = (t) => y(base + (s.alt - base) * t);
  const above = d?.aboveCC ?? 40;
  const hasSea = d?.top != null && d.seaCC >= 25;
  const inCloud = hasSea && (d.top > s.alt + 20 || d.summitCC >= 50);

  // Pic placé à droite : la gauche accueille l'échelle d'altitude.
  const peakX = W * 0.72;
  const py = y(s.alt);
  const slope = 0.7;
  const half = (H - py) / slope;
  const ty = hasSea ? (inCloud ? Math.min(py - 14 * k, y(d.top)) : y(d.top)) : null;

  let g = `<svg viewBox="0 0 ${W} ${H}" class="scene" role="img" aria-label="${
    hasSea ? (inCloud ? `${s.name} dans le nuage, couche jusqu’à ${d.top} m` : `Mer de nuages jusqu’à ${d.top} m sous ${s.name} (${s.alt} m)`)
      : `Pas de mer de nuages sous ${s.name}`}">
  <defs>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky[0]}"/><stop offset=".55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${id}s)"/>`;

  // Soleil bas sur l'horizon (juste au-dessus des nuages s'il y en a), voilé quand le ciel se couvre.
  if (above < 65) {
    const op = Math.min(1, 1.15 - above / 70).toFixed(2);
    const sx = W * 0.19, sy = Math.max(py + 40 * k, hasSea ? ty - 16 * k : f(0.5));
    g += `<g style="opacity:${op}"><circle cx="${sx}" cy="${sy}" r="${46 * k}" fill="#ffe7cd" opacity=".8"/>
      <circle cx="${sx}" cy="${sy}" r="${26 * k}" fill="#ffcda4"/></g>`;
  }

  // Nuages d'altitude : quelques traînées blanches.
  if (above >= 20) {
    const op = Math.min(0.9, above / 100 + 0.2).toFixed(2);
    g += `<g class="sc-high" style="opacity:${op}" fill="#ffffff">
      <rect x="${W * 0.08}" y="${H * 0.1}" width="${W * 0.22}" height="${8 * k}" rx="${4 * k}"/>
      <rect x="${W * 0.18}" y="${H * 0.1 + 11 * k}" width="${W * 0.14}" height="${7 * k}" rx="${3.5 * k}"/>
      <rect x="${W * 0.55}" y="${H * 0.07}" width="${W * 0.26}" height="${8 * k}" rx="${4 * k}"/></g>`;
  }

  // Crêtes lointaines, puis le pic (deux versants et un sommet plus clair).
  g += `<path d="M0 ${f(0.42)} L${W * 0.09} ${f(0.56)} L${W * 0.18} ${f(0.48)} L${W * 0.28} ${f(0.62)} L${W * 0.39} ${f(0.46)} L${W * 0.5} ${f(0.3)} L0 ${f(0.3)} Z" fill="#cdb7dc"/>
    <path d="M${W * 0.8} ${f(0.4)} L${W * 0.88} ${f(0.52)} L${W * 0.95} ${f(0.46)} L${W} ${f(0.56)} L${W} ${f(0.3)} L${W * 0.8} ${f(0.3)} Z" fill="#d8c5e3"/>
    <path d="M${peakX - half} ${H} L${peakX} ${py} L${peakX + half} ${H} Z" fill="#7f78b0"/>
    <path d="M${peakX} ${py} L${peakX + half} ${H} L${peakX + half * 0.3} ${H} Z" fill="#6c65a2"/>`;
  const ch = Math.min(24 * k, (H - py) * 0.18);
  g += `<path d="M${peakX} ${py} L${peakX - ch * 0.67} ${py + ch} L${peakX - ch * 0.25} ${py + ch * 0.83} L${peakX + ch * 0.08} ${py + ch * 1.17}
    L${peakX + ch * 0.42} ${py + ch * 0.75} L${peakX + ch * 0.75} ${py + ch * 1.04} Z" fill="#a49bd0"/>`;

  // Mer de nuages : trois rangées qui dérivent lentement (ombre rosée, rose pâle, crème).
  if (hasSea) {
    const op = (0.75 + 0.25 * d.seaCC / 100).toFixed(2);
    const step = 40 * k;
    g += `<g style="opacity:${op}">
      ${puffs(ty + 22 * k, [22, 26, 20, 25].map((r) => r * k), step, '#efd6e4', W, H, 'sc-drift back')}
      ${puffs(ty + 42 * k, [20, 24, 19, 23].map((r) => r * k), step, '#f9e6ec', W, H, 'sc-drift')}
      ${puffs(ty + 64 * k, [22, 25, 21, 24].map((r) => r * k), step, '#fff8f5', W, H, 'sc-drift back')}
    </g>`;
  }

  // Échelle d'altitude à gauche : sommet et dessus des nuages.
  if (labels) {
    const rx = 22;
    const marks = [{ z: py, txt: `<tspan class="b">${s.alt} m</tspan><tspan dx="6">${inCloud ? 'Sommet dans le nuage' : 'Sommet'}</tspan>`, solid: true, to: peakX - 6 }];
    if (hasSea && (!inCloud || ty < py - 26)) {
      const slopeX = peakX - (ty - py) * slope;
      marks.push({ z: ty, txt: `<tspan class="b">${d.top} m</tspan><tspan dx="6">Dessus des nuages</tspan>`, solid: false, to: Math.max(rx + 40, Math.min(slopeX - 8, W * 0.45)) });
    }
    const ys = marks.map((m) => m.z);
    g += `<line x1="${rx}" x2="${rx}" y1="${Math.min(...ys) - 12}" y2="${Math.max(...ys) + 14}" stroke="rgba(95,90,146,.28)" stroke-width="1.5" stroke-linecap="round"/>`;
    for (const [i, m] of marks.entries()) {
      // Deux repères trop proches : le second texte passe sous sa ligne.
      const below = i === 1 && Math.abs(m.z - marks[0].z) < 26;
      g += `<line x1="${rx}" x2="${m.to}" y1="${m.z}" y2="${m.z}" stroke="rgba(95,90,146,.2)" stroke-width="1"/>`;
      if (m.solid) g += `<circle cx="${peakX}" cy="${py}" r="3.5" fill="#fff"/>`;
      g += `<circle cx="${rx}" cy="${m.z}" r="5" fill="${m.solid ? '#5f5a92' : '#fff'}" stroke="${m.solid ? '#fff' : '#5f5a92'}" stroke-width="2"/>
        <text x="${rx + 12}" y="${below ? m.z + 18 : m.z - 6}" class="sc-txt">${m.txt}</text>`;
    }
  }
  return `${g}</svg>`;
}
