// Cartes sur une grille régulière :
// - inversion : T max dans les 1500 m au-dessus du sol − T au sol (2 m) ;
// - saturation : écart T − point de rosée au sol (2 m).
import { SITES } from './config.js';

const BBOX = { latMin: 48.30, latMax: 48.86, lonMin: 6.95, lonMax: 7.70 };
const STEP = { lat: 0.04, lon: 0.06 };
const LEVELS = [1000, 975, 950, 925, 900, 850, 800];
const CHUNK = 50;
const CACHE_TTL = 60 * 60 * 1000;
const DEPTH = 1500;

export const CLASSES = [
  { min: 6, label: 'Très forte (> 6 °C)', color: '#8e2c8a' },
  { min: 4, label: 'Forte (4 à 6 °C)', color: '#d7402b' },
  { min: 2, label: 'Modérée (2 à 4 °C)', color: '#f08a24' },
  { min: 0.5, label: 'Faible (0,5 à 2 °C)', color: '#f6d55c' },
];
export const colorFor = (dT) => CLASSES.find((c) => dT != null && dT >= c.min)?.color ?? null;

export const SAT_CLASSES = [
  { max: 0.5, label: 'Saturé (≤ 0,5 °C) : brouillard probable', color: '#1747b5' },
  { max: 1.5, label: 'Quasi saturé (0,5 à 1,5 °C)', color: '#2f8cf0' },
  { max: 3, label: 'Humide (1,5 à 3 °C)', color: '#8fd3f7' },
];
export const satColorFor = (sp) => SAT_CLASSES.find((c) => sp != null && sp <= c.max)?.color ?? null;

function gridPoints() {
  const pts = [];
  for (let lat = BBOX.latMin; lat <= BBOX.latMax + 1e-9; lat += STEP.lat) {
    for (let lon = BBOX.lonMin; lon <= BBOX.lonMax + 1e-9; lon += STEP.lon) {
      pts.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3) });
    }
  }
  return pts;
}

async function fetchChunk(pts, model, attempt = 1) {
  const hourly = ['temperature_2m', 'dew_point_2m', 'relative_humidity_2m', ...LEVELS.flatMap((p) => [`temperature_${p}hPa`, `geopotential_height_${p}hPa`])];
  const params = new URLSearchParams({
    latitude: pts.map((p) => p.lat).join(','),
    longitude: pts.map((p) => p.lon).join(','),
    hourly: hourly.join(','),
    daily: 'sunrise',
    models: model,
    forecast_days: '5',
    timezone: 'Europe/Paris',
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    const json = JSON.parse(await res.text());
    if (!res.ok || json.error) throw new Error(json.reason || `HTTP ${res.status}`);
    return Array.isArray(json) ? json : [json];
  } catch (e) {
    if (attempt < 3) return fetchChunk(pts, model, attempt + 1);
    throw e;
  }
}

export async function fetchInversionGrid(model, force = false) {
  const key = `mdn-grid-v2-${model}`;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      if (c && Date.now() - c.at < CACHE_TTL) return c;
    } catch { /* cache indisponible */ }
  }
  const pts = gridPoints();
  const chunks = [];
  for (let i = 0; i < pts.length; i += CHUNK) chunks.push(pts.slice(i, i + CHUNK));
  const results = (await Promise.all(chunks.map((c) => fetchChunk(c, model)))).flat();

  // Format compact pour le cache : par point, sol + séries.
  const points = results.map((r, i) => ({
    lat: pts[i].lat, lon: pts[i].lon, ground: r.elevation,
    t2: r.hourly.temperature_2m,
    td2: r.hourly.dew_point_2m,
    rh2: r.hourly.relative_humidity_2m,
    lv: LEVELS.map((p) => ({ t: r.hourly[`temperature_${p}hPa`], z: r.hourly[`geopotential_height_${p}hPa`] })),
  }));
  const data = { at: Date.now(), times: results[0].hourly.time, sunrise: results[0].daily.sunrise, points };
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota */ }
  return data;
}

// Écart T − Td au sol en un point à l'heure i.
export function saturationAt(pt, i) {
  const t = pt.t2[i], td = pt.td2?.[i];
  if (t == null || td == null) return null;
  return { spread: Math.max(0, Math.round((t - td) * 10) / 10), t, td, rh: pt.rh2?.[i], ground: Math.round(pt.ground) };
}

// Force de l'inversion en un point à l'heure i.
export function inversionAt(pt, i) {
  const t0 = pt.t2[i];
  if (t0 == null) return null;
  const prof = [{ z: pt.ground + 2, t: t0 }];
  for (const l of pt.lv) {
    const z = l.z[i], t = l.t[i];
    if (z != null && t != null && z > pt.ground + 2) prof.push({ z, t });
  }
  prof.sort((a, b) => a.z - b.z);
  let best = { dT: -Infinity, z: null };
  for (let z = pt.ground + 50; z <= pt.ground + DEPTH; z += 50) {
    let t = null;
    for (let k = 1; k < prof.length; k++) {
      if (z <= prof[k].z) {
        const a = prof[k - 1], b = prof[k];
        t = a.t + ((z - a.z) / (b.z - a.z)) * (b.t - a.t);
        break;
      }
    }
    if (t == null) break;
    if (t - t0 > best.dT) best = { dT: t - t0, z };
  }
  if (!Number.isFinite(best.dT)) return null;
  return { dT: Math.round(best.dT * 10) / 10, top: Math.round(best.z), ground: Math.round(pt.ground), t0 };
}

// ---------- Vue carte ----------

export function createInversionView(root) {
  const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtHour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const num = (x) => x.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

  root.innerHTML = `
    <div class="inv-bar card">
      <div class="inv-row">
        <div class="seg" id="inv-mode">
          <button data-mode="inversion">Inversion</button>
          <button data-mode="saturation">Saturation (T − Td)</button>
        </div>
      </div>
      <div class="inv-row">
        <div id="inv-days" class="tabs"></div>
        <select id="inv-model" aria-label="Modèle">
          <option value="meteofrance_seamless">AROME (Météo-France, 1,3 km)</option>
          <option value="icon_seamless">ICON (DWD)</option>
        </select>
      </div>
      <div class="inv-row">
        <button class="btn small" id="inv-prev" aria-label="Heure précédente">◀</button>
        <input type="range" id="inv-hour" min="0" max="23" step="1">
        <button class="btn small" id="inv-next" aria-label="Heure suivante">▶</button>
        <strong id="inv-time"></strong>
        <span class="muted" id="inv-status"></span>
      </div>
    </div>
    <div class="card inv-map-card">
      <div id="inv-map"></div>
      <div class="inv-legend" id="inv-legend"></div>
    </div>
    <p class="muted hint inv-hint" id="inv-hint"></p>`;

  const map = L.map(root.querySelector('#inv-map'), { scrollWheelZoom: true });
  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 15,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) | Données Open-Meteo',
  }).addTo(map);
  map.fitBounds([[BBOX.latMin, BBOX.lonMin], [BBOX.latMax, BBOX.lonMax]]);
  const layer = L.layerGroup().addTo(map);
  for (const s of SITES) {
    L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: '', html: `<div class="inv-site${s.labelLeft ? ' left' : ''}"><i></i><span>${s.name}</span></div>`, iconSize: [10, 10], iconAnchor: [5, 5] }),
      zIndexOffset: 1000,
    }).addTo(map);
  }

  let savedMode = 'inversion';
  try { savedMode = localStorage.getItem('mdn-map-mode') || 'inversion'; } catch { /* ignore */ }
  const st = { data: null, model: 'meteofrance_seamless', day: 0, hour: 7, mode: savedMode };

  // Ce qui change d'un mode à l'autre : couleur, info-bulle, légende, badge du jour.
  const MODES = {
    inversion: {
      legend: `<b>Inversion</b>${CLASSES.slice().reverse().map((c) => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('')}
        <span><i class="none"></i>Pas d’inversion</span>`,
      hint: `Écart entre la température la plus chaude dans les 1 500 m au-dessus du sol et la température au sol.
        Une inversion forte en vallée au lever du soleil favorise brouillards et mers de nuages.
        Badge sur chaque jour : inversion la plus forte du secteur au lever du soleil.`,
      empty: 'aucune inversion à cette heure',
      cell(pt, i) {
        const v = inversionAt(pt, i);
        if (!v) return null;
        return {
          color: colorFor(v.dT),
          tip: v.dT >= 0.5
            ? `<b>Inversion ${num(v.dT)} °C</b><br>Sol ${v.ground} m : ${num(v.t0)} °C<br>Air le plus chaud vers ${v.top} m`
            : `<b>Pas d’inversion</b><br>Sol ${v.ground} m : ${num(v.t0)} °C`,
        };
      },
      badge(vals) {
        const xs = vals.map((v) => v?.dT).filter((x) => x != null);
        const max = xs.length ? Math.max(...xs) : null;
        const c = colorFor(max);
        return { color: c, text: c ? `${num(max)}°` : '–', title: 'Inversion maximale au lever du soleil' };
      },
      value: inversionAt,
    },
    saturation: {
      legend: `<b>Écart T − point de rosée</b>${SAT_CLASSES.map((c) => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('')}
        <span><i class="none"></i>Sec (> 3 °C)</span>`,
      hint: `Écart entre la température et le point de rosée à 2 m du sol. Quand il tombe à 0, l’air est saturé : la vapeur
        se condense en brouillard, nuage bas ou rosée. En vallée au lever du soleil, c’est le signe d’une mer de nuages possible.
        Badge sur chaque jour : part du secteur saturée au lever du soleil.`,
      empty: 'aucune zone saturée ou humide à cette heure',
      cell(pt, i) {
        const v = saturationAt(pt, i);
        if (!v) return null;
        return {
          color: satColorFor(v.spread),
          tip: `<b>Écart ${num(v.spread)} °C${v.spread <= 0.5 ? ' · saturé' : ''}</b><br>Température ${num(v.t)} °C · rosée ${num(v.td)} °C<br>
            Humidité ${v.rh ?? '–'} % · sol ${v.ground} m`,
        };
      },
      badge(vals) {
        const xs = vals.filter(Boolean);
        const share = xs.length ? Math.round((100 * xs.filter((v) => v.spread <= 0.5).length) / xs.length) : 0;
        const c = share > 0 ? SAT_CLASSES[0].color : null;
        return { color: c, text: share > 0 ? `${share} %` : '–', title: 'Part du secteur saturée au lever du soleil', light: true };
      },
      value: saturationAt,
    },
  };
  const $ = (s) => root.querySelector(s);

  function hourIndex() {
    const day = st.data.sunrise[st.day].slice(0, 10);
    return st.data.times.indexOf(`${day}T${String(st.hour).padStart(2, '0')}:00`);
  }

  function draw() {
    layer.clearLayers();
    const i = hourIndex();
    const date = new Date(st.data.times[i]);
    $('#inv-time').textContent = `${fmtDay.format(date)} ${fmtHour.format(date)}`;
    $('#inv-hour').value = st.hour;
    const sr = new Date(st.data.sunrise[st.day]);
    $('#inv-status').textContent = `lever du soleil ${fmtHour.format(sr)}`;
    root.querySelectorAll('#inv-days .tab').forEach((b, k) => b.classList.toggle('active', k === st.day));

    const mode = MODES[st.mode];
    let count = 0;
    for (const pt of st.data.points) {
      const cell = mode.cell(pt, i);
      const color = cell?.color ?? null;
      if (color) count++;
      const bounds = [[pt.lat - STEP.lat / 2, pt.lon - STEP.lon / 2], [pt.lat + STEP.lat / 2, pt.lon + STEP.lon / 2]];
      const rect = L.rectangle(bounds, {
        stroke: false,
        fillColor: color ?? '#000',
        fillOpacity: color ? (st.mode === 'saturation' ? 0.72 : 0.55) : 0,
      }).addTo(layer);
      if (cell) rect.bindTooltip(cell.tip, { sticky: true });
    }
    $('#inv-status').textContent = `lever du soleil ${fmtHour.format(sr)}${count ? '' : ` · ${mode.empty}`}`;
  }

  // Badge de chaque jour, calculé à l'heure du lever du soleil.
  function renderDays() {
    const mode = MODES[st.mode];
    $('#inv-days').innerHTML = st.data.sunrise.map((sr, d) => {
      const h = new Date(sr).getHours();
      const i = st.data.times.indexOf(`${sr.slice(0, 10)}T${String(h).padStart(2, '0')}:00`);
      const b = mode.badge(st.data.points.map((pt) => mode.value(pt, i)));
      return `<button class="tab ${d === st.day ? 'active' : ''}" data-day="${d}" title="${b.title}">${d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : fmtDay.format(new Date(sr))}
        <span class="inv-max${b.light ? ' light' : ''}" style="${b.color ? `background:${b.color}` : ''}">${b.text}</span></button>`;
    }).join('');
    root.querySelectorAll('#inv-days .tab').forEach((b) => {
      b.onclick = () => { st.day = Number(b.dataset.day); draw(); };
    });
  }

  function applyMode() {
    try { localStorage.setItem('mdn-map-mode', st.mode); } catch { /* ignore */ }
    root.querySelectorAll('#inv-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === st.mode));
    $('#inv-legend').innerHTML = MODES[st.mode].legend;
    $('#inv-hint').textContent = MODES[st.mode].hint.replace(/\s+/g, ' ');
    if (st.data) { renderDays(); draw(); }
  }
  root.querySelectorAll('#inv-mode button').forEach((b) => {
    b.onclick = () => { st.mode = b.dataset.mode; applyMode(); };
  });
  applyMode();

  async function load(force = false) {
    $('#inv-status').textContent = 'Chargement de la grille (≈ 15 s)…';
    try {
      st.data = await fetchInversionGrid(st.model, force);
      renderDays();
      draw();
    } catch (e) {
      console.error(e);
      $('#inv-status').textContent = `Erreur de chargement : ${e.message}`;
    }
  }

  // Par défaut : le prochain lever du soleil (demain si celui d'aujourd'hui est passé).
  function defaultTime() {
    const now = Date.now();
    const d = st.data.sunrise.findIndex((s) => new Date(s).getTime() > now - 3600e3);
    st.day = Math.max(0, d);
    st.hour = new Date(st.data.sunrise[st.day]).getHours();
  }

  $('#inv-hour').oninput = (e) => { st.hour = Number(e.target.value); draw(); };
  const shift = (dh) => {
    let h = st.hour + dh, d = st.day;
    if (h < 0) { h = 23; d--; } else if (h > 23) { h = 0; d++; }
    if (d < 0 || d >= st.data.sunrise.length) return;
    st.hour = h; st.day = d; draw();
  };
  $('#inv-prev').onclick = () => shift(-1);
  $('#inv-next').onclick = () => shift(1);
  $('#inv-model').onchange = (e) => { st.model = e.target.value; load(); };

  let started = false;
  return {
    async show() {
      map.invalidateSize();
      if (!started) {
        started = true;
        await load();
        if (st.data) { defaultTime(); draw(); }
      }
    },
    refresh: () => load(true),
  };
}
