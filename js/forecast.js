// Récupération Open-Meteo + calcul de l'indice "mer de nuages".
import { SITES, VALLEYS, MODELS } from './config.js?v=39';

const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700];
const WIND_LEVELS = [950, 925, 900, 850];
// Niveaux d'altitude supplémentaires pour le graphique des nuages (jusqu'à ~12 km).
const HIGH_LEVELS = [600, 500, 400, 300, 250, 200];
const SURFACE = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m'];
// Météo au lieu (affichage seulement).
const WEATHER = ['weather_code', 'precipitation', 'cloud_cover', 'wind_gusts_10m', 'wind_direction_10m'];
const DAILY = ['sunrise', 'sunset', 'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max', 'wind_gusts_10m_max'];
const ALL_MODELS = MODELS.consensus.ids;
const CACHE_KEY = 'mdn-forecast-v7';
const CACHE_TTL = 30 * 60 * 1000;

function hourlyVars() {
  const v = [...SURFACE, ...WEATHER];
  for (const p of LEVELS) v.push(`cloud_cover_${p}hPa`, `temperature_${p}hPa`, `relative_humidity_${p}hPa`, `geopotential_height_${p}hPa`);
  for (const p of WIND_LEVELS) v.push(`wind_speed_${p}hPa`);
  for (const p of HIGH_LEVELS) v.push(`cloud_cover_${p}hPa`, `geopotential_height_${p}hPa`);
  return v;
}

function locations() {
  return [
    ...SITES.map((s) => ({ key: s.id, lat: s.lat, lon: s.lon })),
    ...Object.entries(VALLEYS).map(([k, v]) => ({ key: k, lat: v.lat, lon: v.lon })),
  ];
}

export async function fetchForecast({ force = false } = {}) {
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (c && Date.now() - c.at < CACHE_TTL) return c;
    } catch { /* cache indisponible */ }
  }
  const locs = locations();
  // Une requête par modèle (une requête unique dépasse le délai du serveur),
  // puis fusion avec des clés suffixées par le modèle.
  let perModel;
  try {
    perModel = await Promise.all(ALL_MODELS.map((m) => fetchModel(locs, m)));
  } catch (e) {
    // Service indisponible : on garde les dernières prévisions connues, même anciennes.
    const old = staleCache();
    if (old) return { ...old, stale: true };
    throw e;
  }
  const raw = {};
  locs.forEach((l, i) => {
    const loc = { elevation: perModel[0][i].elevation, hourly: { time: perModel[0][i].hourly.time }, daily: { time: perModel[0][i].daily.time } };
    ALL_MODELS.forEach((m, k) => {
      for (const part of ['hourly', 'daily']) {
        for (const [key, v] of Object.entries(perModel[k][i][part])) if (key !== 'time') loc[part][`${key}_${m}`] = v;
      }
    });
    raw[l.key] = loc;
  });
  const data = { at: Date.now(), raw };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    // Anciennes versions du cache : inutiles une fois la nouvelle enregistrée (place limitée).
    for (const k of ['mdn-forecast-v2', 'mdn-forecast-v3', 'mdn-forecast-v4', 'mdn-forecast-v5', 'mdn-forecast-v6']) localStorage.removeItem(k);
  } catch { /* quota */ }
  return data;
}

async function fetchModel(locs, model, attempt = 1) {
  const params = new URLSearchParams({
    latitude: locs.map((l) => l.lat).join(','),
    longitude: locs.map((l) => l.lon).join(','),
    hourly: hourlyVars().join(','),
    daily: DAILY.join(','),
    models: model,
    forecast_days: '7',
    timezone: 'Europe/Paris',
  });
  // Délai maximal : en cas de surcharge, Open-Meteo peut laisser une requête en suspens plusieurs minutes.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = JSON.parse(await res.text());
    if (json.error) throw new Error(json.reason);
    return Array.isArray(json) ? json : [json];
  } catch (e) {
    if (e.name === 'AbortError') e = new Error('délai dépassé');
    // Nouvel essai après une pause croissante (le service est parfois surchargé quelques secondes).
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
      return fetchModel(locs, model, attempt + 1);
    }
    throw new Error(`Open-Meteo (${model}) : ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Dernières prévisions connues, quel que soit leur âge (affichées en attendant les nouvelles).
export function staleCache() {
  // Un cache plus ancien peut ne pas contenir un lieu ajouté depuis : ce lieu s'affichera sans données.
  for (const key of [CACHE_KEY, 'mdn-forecast-v6']) {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      if (c?.raw) return c;
    } catch { /* cache illisible */ }
  }
  return null;
}

// ---------- Profils verticaux ----------

const pick = (obj, name, model) => obj[`${name}_${model}`] ?? obj[name];

function buildProfiles(loc, model) {
  const h = loc.hourly;
  const n = h.time.length;
  const ground = loc.elevation ?? 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const levels = [];
    for (const p of LEVELS) {
      const z = pick(h, `geopotential_height_${p}hPa`, model)?.[i];
      const cc = pick(h, `cloud_cover_${p}hPa`, model)?.[i];
      const t = pick(h, `temperature_${p}hPa`, model)?.[i];
      if (z == null || cc == null || t == null) continue;
      levels.push({
        p, z, cc, t,
        rh: pick(h, `relative_humidity_${p}hPa`, model)?.[i],
        ws: WIND_LEVELS.includes(p) ? pick(h, `wind_speed_${p}hPa`, model)?.[i] : null,
      });
    }
    levels.sort((a, b) => a.z - b.z);
    const sfc = {};
    for (const k of SURFACE) sfc[k] = pick(h, k, model)?.[i];
    out.push(levels.length ? { levels, sfc, ground } : null);
  }
  return out;
}

function interp(levels, z, key) {
  const pts = levels.filter((l) => l[key] != null);
  if (!pts.length) return null;
  if (z <= pts[0].z) return pts[0][key];
  for (let i = 1; i < pts.length; i++) {
    if (z <= pts[i].z) {
      const a = pts[i - 1], b = pts[i];
      return a[key] + ((z - a.z) / (b.z - a.z)) * (b[key] - a[key]);
    }
  }
  return pts[pts.length - 1][key];
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);

// Point de rosée (formule de Magnus).
function dewPoint(t, rh) {
  if (t == null || rh == null || rh <= 0) return null;
  const g = Math.log(rh / 100) + (17.62 * t) / (243.12 + t);
  return (243.12 * g) / (17.62 - g);
}
const lerp01 = (x, x0, x1) => clamp((x - x0) / (x1 - x0), 0, 1);

// Couche nuageuse basse dans la vallée : couverture, sommet estimé.
function valleyLayer(vp, alt) {
  const lv = vp.levels.filter((l) => l.z > vp.ground - 20);
  let seaCC = 0;
  for (const l of lv) if (l.z < alt - 30) seaCC = Math.max(seaCC, l.cc);

  const vis = vp.sfc.visibility;
  let fog = false;
  if (vis != null) {
    const fogCC = vis < 1000 ? 95 : vis < 2500 ? 60 : 0;
    if (fogCC > seaCC) { seaCC = fogCC; fog = true; }
  }

  // Sommet : première couche >= 40 % puis premier niveau sec au-dessus.
  const TH = 40;
  let top = null;
  const iStart = lv.findIndex((l) => l.cc >= TH && l.z < alt + 600);
  if (iStart >= 0) {
    let j = iStart;
    while (j + 1 < lv.length && lv[j + 1].cc >= TH) j++;
    if (j + 1 < lv.length) {
      const a = lv[j], b = lv[j + 1];
      top = a.z + ((a.cc - TH) / (a.cc - b.cc)) * (b.z - a.z);
    } else top = lv[j].z;
  } else if (fog) top = vp.ground + 150;
  return { seaCC, top };
}

function scoreHour(sp, vp, alt) {
  if (!sp || !vp) return null;
  const { seaCC, top } = valleyLayer(vp, alt);

  const summitCC = clamp(interp(sp.levels, alt + 20, 'cc') ?? 0, 0, 100);
  let aboveCC = 0;
  for (const l of sp.levels) if (l.z > alt + 200 && l.z < 3300) aboveCC = Math.max(aboveCC, l.cc);
  aboveCC = Math.max(aboveCC, sp.sfc.cloud_cover_mid ?? 0);
  const high = sp.sfc.cloud_cover_high ?? 0;

  // Inversion : T au-dessus du sommet vs T dans la couche nuageuse.
  const zb = Math.max(vp.ground + 50, (top ?? alt - 200) - 80);
  const tLow = interp(vp.levels, zb, 't');
  let dT = -Infinity;
  for (const dz of [0, 150, 300, 500]) {
    const tUp = interp(sp.levels, alt + dz, 't');
    if (tUp != null && tLow != null) dT = Math.max(dT, tUp - tLow);
  }
  if (!Number.isFinite(dT)) dT = null;
  const invF = dT == null ? 0.8 : 0.5 + 0.5 * lerp01(dT, -3, 0);

  const wind = interp(sp.levels, alt, 'ws') ?? sp.sfc.wind_speed_10m ?? 0;
  const windF = 1 - 0.6 * lerp01(wind, 15, 45);

  const score = 100 * (seaCC / 100) * (1 - summitCC / 100) * (1 - 0.85 * aboveCC / 100)
    * (1 - 0.25 * high / 100) * invF * windF;

  // Conditions au sommet (profil interpolé à l'altitude du site) et en vallée (2 m).
  const sT = interp(sp.levels, alt, 't');
  const sRH = clamp(interp(sp.levels, alt, 'rh') ?? NaN, 0, 100);
  const vT = vp.sfc.temperature_2m;
  const vRH = vp.sfc.relative_humidity_2m;
  const met = {
    site: { t: round1(sT), rh: Number.isNaN(sRH) ? null : Math.round(sRH), td: round1(dewPoint(sT, sRH)) },
    valley: { t: round1(vT), rh: vRH == null ? null : Math.round(vRH), td: round1(vp.sfc.dew_point_2m ?? dewPoint(vT, vRH)) },
  };

  return {
    met,
    score: Math.round(clamp(score, 0, 100)),
    seaCC: Math.round(seaCC), top: top == null ? null : Math.round(top),
    summitCC: Math.round(summitCC), aboveCC: Math.round(aboveCC), high: Math.round(high),
    dT: dT == null ? null : Math.round(dT * 10) / 10, wind: Math.round(wind),
  };
}

// ---------- API publique ----------

export function computeAll(data, modelKey) {
  const models = MODELS[modelKey].ids;
  const first = data.raw[SITES.find((s) => data.raw[s.id])?.id];
  const times = first.hourly.time;
  const sunrise = pick(first.daily, 'sunrise', ALL_MODELS[0]);
  const sunset = pick(first.daily, 'sunset', ALL_MODELS[0]);

  const profiles = {};
  for (const m of models) {
    profiles[m] = {};
    for (const [k, loc] of Object.entries(data.raw)) profiles[m][k] = buildProfiles(loc, m);
  }

  const sites = {};
  for (const s of SITES) {
    const hours = times.map((t, i) => {
      const perModel = {};
      for (const m of models) {
        let best = null;
        for (const vk of s.valleys) {
          const r = scoreHour(profiles[m][s.id]?.[i], profiles[m][vk]?.[i], s.alt);
          if (r && (!best || r.score > best.score)) best = { ...r, valley: vk };
        }
        if (best) perModel[m] = best;
      }
      const vals = Object.values(perModel);
      if (!vals.length) return { time: t, score: null, perModel };
      const avg = Math.round(vals.reduce((a, r) => a + r.score, 0) / vals.length);
      const ref = vals.reduce((a, r) => (r.score > a.score ? r : a));
      // Conditions au sommet : moyenne des modèles ; vallée : celle du modèle de référence.
      const mean = (k) => {
        const xs = vals.map((v) => v.met.site[k]).filter((x) => x != null);
        return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
      };
      const met = { site: { t: mean('t'), rh: mean('rh') == null ? null : Math.round(mean('rh')), td: mean('td') }, valley: ref.met.valley };
      return { time: t, score: avg, perModel, ref, met };
    });
    sites[s.id] = hours;
  }
  return { times, sunrise, sunset, sites, models };
}

function windowIdx(result, from, to) {
  return result.times
    .map((t, i) => ({ t: new Date(t), i }))
    .filter(({ t }) => t >= from && t <= to)
    .map(({ i }) => i);
}

// Fenêtre du matin : lever du soleil -1 h à +2 h.
export const MORNING = { before: 1, after: 2 };
export function morningWindow(result, dayIdx) {
  const sr = new Date(result.sunrise[dayIdx]).getTime();
  return windowIdx(result, new Date(sr - MORNING.before * 3600e3), new Date(sr + MORNING.after * 3600e3));
}

// Fenêtre du soir : coucher du soleil -2 h à +1 h.
export const EVENING = { before: 2, after: 1 };
export function eveningWindow(result, dayIdx) {
  const ss = new Date(result.sunset[dayIdx]).getTime();
  return windowIdx(result, new Date(ss - EVENING.before * 3600e3), new Date(ss + EVENING.after * 3600e3));
}

// Météo au lieu, pour un modèle (en consensus : AROME, plus fin sur la France, complété par ICON).
export function siteWeather(data, siteId, modelKey) {
  const models = modelKey === 'consensus' ? ['meteofrance_seamless', 'icon_seamless'] : MODELS[modelKey].ids;
  const loc = data.raw[siteId];
  if (!loc) return { hourly: [], daily: [] };
  const get = (part, name, i) => {
    for (const m of models) {
      const v = pick(loc[part], name, m)?.[i];
      if (v != null) return v;
    }
    return null;
  };
  const hourly = loc.hourly.time.map((time, i) => ({
    time,
    code: get('hourly', 'weather_code', i),
    t: get('hourly', 'temperature_2m', i),
    rh: get('hourly', 'relative_humidity_2m', i),
    precip: get('hourly', 'precipitation', i),
    cc: get('hourly', 'cloud_cover', i),
    wind: get('hourly', 'wind_speed_10m', i),
    gust: get('hourly', 'wind_gusts_10m', i),
    dir: get('hourly', 'wind_direction_10m', i),
  }));
  const daily = loc.daily.time.map((date, i) => ({
    date,
    code: get('daily', 'weather_code', i),
    tmax: get('daily', 'temperature_2m_max', i),
    tmin: get('daily', 'temperature_2m_min', i),
    precip: get('daily', 'precipitation_sum', i),
    wind: get('daily', 'wind_speed_10m_max', i),
    gust: get('daily', 'wind_gusts_10m_max', i),
  }));
  return { hourly, daily };
}

export function bestInWindow(hours, idxs) {
  let best = null;
  for (const i of idxs) {
    const h = hours[i];
    if (h && h.score != null && (!best || h.score > best.score)) best = { ...h, i };
  }
  return best;
}

export function scoreClass(s) {
  if (s == null) return { key: 'na', label: 'Pas de données' };
  if (s >= 65) return { key: 'top', label: 'Très probable' };
  if (s >= 40) return { key: 'good', label: 'Probable' };
  if (s >= 20) return { key: 'maybe', label: 'Possible' };
  return { key: 'low', label: 'Peu probable' };
}

// Index de l'heure la plus proche de maintenant.
export function nowIndex(result) {
  const now = Date.now();
  let best = 0;
  result.times.forEach((t, i) => {
    if (Math.abs(new Date(t).getTime() - now) < Math.abs(new Date(result.times[best]).getTime() - now)) best = i;
  });
  return best;
}

// Couverture nuageuse par altitude, heure par heure, au-dessus d'un point (lieu ou vallée).
// En consensus : moyenne des modèles niveau par niveau.
export function cloudSection(data, key, modelKey) {
  const loc = data.raw[key];
  if (!loc) return [];
  const h = loc.hourly;
  const models = MODELS[modelKey].ids;
  return h.time.map((time, i) => {
    const levels = [];
    for (const p of [...LEVELS, ...HIGH_LEVELS]) {
      let z = 0, cc = 0, n = 0;
      for (const m of models) {
        const zz = pick(h, `geopotential_height_${p}hPa`, m)?.[i];
        const c = pick(h, `cloud_cover_${p}hPa`, m)?.[i];
        if (zz == null || c == null) continue;
        z += zz; cc += c; n++;
      }
      if (n) levels.push({ z: z / n, cc: cc / n });
    }
    levels.sort((a, b) => a.z - b.z);
    return { time, ground: loc.elevation ?? 0, levels };
  });
}
