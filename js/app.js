import {
  SITES, VALLEYS, WEBCAMS, MODELS,
  webcamImage, webcamPlayer, meteobluePage,
} from './config.js';
import {
  fetchForecast, computeAll, morningWindow, eveningWindow, bestInWindow, scoreClass, nowIndex,
  siteWeather, cloudSection, MORNING, EVENING,
} from './forecast.js?v=11';
import { icon } from './icons.js?v=11';
import { scene } from './scene.js?v=11';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const fmtWeekdayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const fmtHour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const num = (x, unit = '') => (x == null ? '–' : `${x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${unit}`);
const int = (x, unit = '') => (x == null ? '–' : `${Math.round(x)}${unit}`);
const hour = (t) => fmtHour.format(new Date(t));

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const state = {
  data: null,
  result: null,
  weather: {},
  sections: {},
  loading: false,
  error: null,
  model: store.get('mdn-model', 'consensus'),
  daylight: store.get('mdn-daylight', '0') === '1',
  site: null,
  day: null,
};
if (!MODELS[state.model]) state.model = 'consensus';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const MODEL_INFO = {
  consensus: ['Consensus', 'Moyenne ICON + Météo-France'],
  icon_seamless: ['ICON', 'Service météo allemand (DWD)'],
  meteofrance_seamless: ['AROME / ARPEGE', 'Météo-France'],
};

// ---------- Moments : lever et coucher du soleil ----------

const KINDS = {
  rise: { label: 'Lever', icon: 'sunrise', win: morningWindow, at: (r, d) => r.sunrise[d], after: MORNING.after },
  set: { label: 'Coucher', icon: 'sunset', win: eveningWindow, at: (r, d) => r.sunset[d], after: EVENING.after },
};

const siteById = (id) => SITES.find((s) => s.id === id);
const moment = (siteId, d, kind) => bestInWindow(state.result.sites[siteId], KINDS[kind].win(state.result, d));

function dayBest(siteId, d) {
  const a = moment(siteId, d, 'rise'), b = moment(siteId, d, 'set');
  if (!a) return b;
  if (!b) return a;
  return b.score > a.score ? b : a;
}

const isPast = (d, kind) => new Date(KINDS[kind].at(state.result, d)).getTime() + KINDS[kind].after * 3600e3 < Date.now();

// Meilleure chance de la journée, parmi les levers/couchers pas encore passés.
function dayScore(siteId, d) {
  let best = null;
  for (const kind of ['rise', 'set']) {
    if (isPast(d, kind)) continue;
    const m = moment(siteId, d, kind);
    if (m && (!best || m.score > best.score)) best = { ...m, kind };
  }
  return best;
}

// Les 4 prochains jours qui ont encore un lever ou un coucher à venir.
const upcomingDays = () => [...new Set(upcoming().map((e) => e.d))].slice(0, 4);

// Levers et couchers à venir (fenêtre pas encore terminée), dans l'ordre.
function upcoming() {
  const r = state.result;
  const now = Date.now();
  const out = [];
  r.sunrise.forEach((_, d) => {
    for (const kind of ['rise', 'set']) {
      const t = new Date(KINDS[kind].at(r, d)).getTime();
      if (t + KINDS[kind].after * 3600e3 > now) out.push({ d, kind, t });
    }
  });
  return out.sort((a, b) => a.t - b.t);
}

const dayShort = (d) => (d === 0 ? 'Auj.' : d === 1 ? 'Dem.' : cap(fmtWeekday.format(new Date(state.result.sunrise[d]))));
const dayLabel = (d) => (d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : cap(fmtWeekdayLong.format(new Date(state.result.sunrise[d]))));
const valleyName = (k) => VALLEYS[k].name.replace(/\s*\(.*\)/, '');
const valleyTown = (k) => VALLEYS[k].name.match(/\((.*)\)/)?.[1] ?? VALLEYS[k].name;

const hasSea = (d) => d?.top != null && d.seaCC >= 25;
const inCloud = (s, d) => hasSea(d) && (d.top > s.alt + 20 || d.summitCC >= 50);

function layerNote(s, d) {
  if (!hasSea(d)) return 'pas de nuages bas';
  if (inCloud(s, d)) return 'sommet dans le nuage';
  return `nuages ≈ ${d.top} m`;
}

// ---------- Météo ----------

// Codes météo WMO : libellé, libellé court (tableau), icône.
const WMO = [
  [[0], 'Ciel clair', 'Clair', 'w-sun'], [[1], 'Plutôt dégagé', 'Dégagé', 'w-partly'],
  [[2], 'Partiellement nuageux', 'Nuageux', 'w-partly'], [[3], 'Couvert', 'Couvert', 'w-cloud'],
  [[45, 48], 'Brouillard', 'Brouillard', 'w-fog'], [[51, 53, 55, 56, 57], 'Bruine', 'Bruine', 'w-drizzle'],
  [[61, 63, 66], 'Pluie', 'Pluie', 'w-rain'], [[65, 67], 'Forte pluie', 'Pluie', 'w-rain'],
  [[71, 73, 75, 77], 'Neige', 'Neige', 'w-snow'], [[80, 81], 'Averses', 'Averses', 'w-rain'],
  [[82], 'Fortes averses', 'Averses', 'w-rain'], [[85, 86], 'Averses de neige', 'Neige', 'w-snow'],
  [[95, 96, 99], 'Orage', 'Orage', 'w-storm'],
];
const wmo = (code) => {
  const m = WMO.find(([codes]) => codes.includes(code));
  return m ? { label: m[1], short: m[2], icon: m[3] } : { label: '–', short: '–', icon: 'w-cloud' };
};

function weatherFor(siteId) {
  state.weather[siteId] ??= siteWeather(state.data, siteId, state.model);
  return state.weather[siteId];
}

// ---------- Petits composants ----------

function ring(score, cls, size = 64) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const off = c * (1 - (score ?? 0) / 100);
  return `<div class="ring ${cls}" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-val" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-off="${off.toFixed(1)}"/>
    </svg>
    <b data-count="${score ?? ''}">${score ?? '–'}</b>
  </div>`;
}

const cardHead = (ic, title, extra = '') => `<div class="card-head">${icon(ic)}<span>${title}</span>${extra}</div>`;

function camTile(c, extra = '') {
  return `<button class="cam tap" data-cam="${c.id}" aria-label="Webcam ${c.name}, timelapse">
    <span class="cam-img"><img loading="lazy" decoding="async" src="${webcamImage(c.id, state.daylight ? 'daylight' : 'current')}" alt=""
      onerror="this.parentNode.classList.add('broken')">${icon('camera', 'cam-ph')}</span>
    <span class="cam-cap"><b>${c.name}</b>${extra ? `<small>${extra}</small>` : ''}</span>
  </button>`;
}

// ---------- Accueil ----------

function renderHome(enter = false) {
  const body = $('#home-body');
  if (!state.result) {
    body.innerHTML = state.error ? errorCard() : homeSkeleton();
    return;
  }
  const r = state.result;
  const days = upcomingDays();

  // Meilleure occasion des prochains jours, tous lieux confondus.
  let top = null;
  for (const s of SITES) {
    for (const d of days) {
      const b = dayScore(s.id, d);
      if (b && (!top || b.score > top.b.score)) top = { s, d, b };
    }
  }

  const hero = top && top.b.score >= 20 ? (() => {
    const c = scoreClass(top.b.score);
    const k = KINDS[top.b.kind];
    return `<button class="card hero tap" data-site="${top.s.id}" data-day="${top.d}">
      <div class="hero-scene">${scene(top.s, top.b.ref, c.key, { W: 360, H: 140, labels: false })}</div>
      <div class="hero-info">
        <p class="eyebrow">Meilleure chance</p>
        <div class="hero-row">
          <div class="hero-text">
            <h2 class="hero-site">${top.s.name}</h2>
            <p class="hero-meta">${icon(k.icon)}${dayLabel(top.d)} · ${k.label.toLowerCase()} ${hour(k.at(r, top.d))}</p>
            <p class="hero-verdict ${c.key}">${c.label}</p>
          </div>
          ${ring(top.b.score, c.key, 64)}
        </div>
      </div>
    </button>`;
  })() : `<div class="card hero">
      <div class="hero-scene">${scene(SITES[0], null, 'low', { W: 360, H: 140, labels: false })}</div>
      <div class="hero-info">
        <p class="eyebrow">${days.length} prochains jours</p>
        <h2 class="hero-site">Pas de mer de nuages en vue</h2>
        <p class="hero-meta">Aucune couche basse prévue sous les sommets.</p>
      </div>
    </div>`;

  const rows = SITES.map((s) => `<div class="row-site">
      <button class="rs-name" data-site="${s.id}" data-day="${days[0]}"><b>${s.name}</b><small>${s.alt} m</small></button>
      ${days.map((d) => {
        const b = dayScore(s.id, d);
        const c = scoreClass(b?.score);
        return `<button class="rs-day ${c.key}" data-site="${s.id}" data-day="${d}" aria-label="${s.name}, ${dayLabel(d)} : ${b?.score ?? 'pas de données'}, ${c.label}">
          <b data-count="${b?.score ?? ''}">${b?.score ?? '–'}</b></button>`;
      }).join('')}
    </div>`).join('');

  body.innerHTML = `
    ${hero}
    <section class="section">
      <div class="section-head list-head">
        <h2>Lieux</h2>
        ${days.map((d) => `<span class="col-lbl">${dayShort(d)}</span>`).join('')}
      </div>
      <div class="card list">${rows}</div>
      <div class="legend">
        ${['top', 'good', 'maybe', 'low'].map((k) => `<span class="${k}"><i></i>${scoreClass({ top: 65, good: 40, maybe: 20, low: 0 }[k]).label}</span>`).join('')}
      </div>
      <p class="footnote">Meilleure chance de la journée, au lever ou au coucher du soleil, de 0 à 100.</p>
    </section>
    <section class="section">
      <div class="section-head"><h2>Webcams</h2></div>
      <div class="cam-strip">${WEBCAMS.map((c) => camTile(c)).join('')}</div>
    </section>
    <footer class="foot">
      Modèles ICON et AROME/ARPEGE via <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> ·
      webcams <a href="https://www.windy.com/webcams" target="_blank" rel="noopener">Windy</a>
    </footer>`;
  animateIn(body, enter);
}

function homeSkeleton() {
  return `<div class="card hero skel"><div class="hero-scene shimmer"></div><div class="hero-info"><i class="sk w40"></i><i class="sk w60"></i></div></div>
    <section class="section"><div class="section-head"><h2>Lieux</h2></div>
    <div class="card list">${SITES.map(() => '<div class="row-site skel"><span class="rs-name"><i class="sk w60"></i><i class="sk w30"></i></span></div>').join('')}</div></section>`;
}

function errorCard() {
  return `<div class="card error-card">
    ${icon('alert')}
    <b>Prévisions indisponibles</b>
    <p>${state.error}</p>
    <button class="pill-btn tap" data-action="refresh">${icon('refresh')}Réessayer</button>
  </div>`;
}

// ---------- Détail ----------

function setGlow(cls, instant = false) {
  const k = cls === 'na' ? 'low' : cls;
  const layers = $$('#detail .glow');
  layers.forEach((l) => {
    if (instant) l.style.transition = 'none';
    l.classList.toggle('on', l.dataset.glow === k);
  });
  if (instant) requestAnimationFrame(() => layers.forEach((l) => { l.style.transition = ''; }));
}

function renderDetail(enter = false) {
  const s = siteById(state.site);
  const body = $('#detail-body');
  const head = `<div class="large-title"><h1 tabindex="-1">${s.name}</h1><p class="subtitle">${s.alt} m d’altitude</p></div>`;

  if (!state.result) {
    setGlow('low', true);
    body.innerHTML = `${head}${state.error ? errorCard() : '<div class="card skel tall shimmer"></div><div class="card skel tall shimmer"></div>'}`;
    return;
  }
  const days = upcomingDays();
  if (!days.includes(state.day)) state.day = days[0] ?? 0;

  const picker = days.map((d) => {
    const b = dayScore(s.id, d);
    const c = scoreClass(b?.score);
    return `<button class="seg tap ${c.key}" role="tab" data-day="${d}" aria-selected="${d === state.day}"
        aria-label="${dayLabel(d)} : ${b?.score ?? 'pas de données'}">
      <span>${dayShort(d)}</span><b>${b?.score ?? '–'}</b></button>`;
  }).join('');

  body.innerHTML = `
    ${head}
    <div class="segmented" role="tablist" aria-label="Jour" style="--n:${days.length}">
      <span class="seg-thumb" style="--k:${days.indexOf(state.day)}"></span>${picker}
    </div>
    <div id="d-day" class="stack"></div>`;
  renderDay(enter);
  if (enter) animateIn(body, true, [$('.large-title', body), $('.segmented', body), ...$('#d-day').children]);
}

// Partie qui dépend du jour choisi.
function renderDay(enter = false) {
  const s = siteById(state.site);
  const r = state.result;
  const d = state.day;
  const rise = moment(s.id, d, 'rise');
  const set = moment(s.id, d, 'set');
  const best = dayBest(s.id, d);
  const bestKind = best && best === set ? 'set' : 'rise';
  const c = scoreClass(best?.score);
  setGlow(c.key, enter);

  const momentCard = (kind, m) => {
    const k = KINDS[kind];
    const mc = scoreClass(m?.score);
    const past = isPast(d, kind);
    return `<div class="card moment ${mc.key}${past ? ' past' : ''}">
      ${cardHead(k.icon, `${k.label} ${hour(k.at(r, d))}`)}
      <b class="m-score" data-count="${m?.score ?? ''}">${m?.score ?? '–'}</b>
      <p class="m-verdict">${mc.label}</p>
      <p class="m-foot">${past ? 'Passé' : m ? `Idéal vers ${hour(m.time)}` : 'Pas de données'}</p>
    </div>`;
  };

  $('#d-day').innerHTML = `
    <div class="moments">${momentCard('rise', rise)}${momentCard('set', set)}</div>
    ${best ? `<div class="card scene-card">
      ${scene(s, best.ref, c.key)}
      <span class="scene-cap">${icon(KINDS[bestKind].icon)}${bestKind === 'rise' ? 'Au lever' : 'Au coucher'}</span>
    </div>` : ''}
    ${compareCard(s, rise, set)}
    ${cloudCard(s, d, best?.ref?.valley ?? s.valleys[0])}
    ${weatherCard(s, d)}
    <section class="section">
      <div class="section-head"><h2>Webcams proches</h2></div>
      <div class="cam-strip">${nearCams(s).map(({ c: cam, dist }) => camTile(cam, `${dist.toFixed(0)} km`)).join('')}</div>
    </section>
    <div class="card about">
      ${cardHead('pin', 'Le lieu')}
      <p>${s.note}</p>
      <p class="muted">Vallées de référence : ${s.valleys.map(valleyName).join(', ')}.</p>
      <a class="pill-btn tap" href="${meteobluePage(s)}" target="_blank" rel="noopener">Prévisions meteoblue ${icon('external')}</a>
    </div>`;

  if (!enter) {
    replay([...$('#d-day').children], 'swap');
    countUp($('#d-day'));
  }
}

// Conditions au lever et au coucher, côte à côte.
function conditions(s, m) {
  const d = m?.ref;
  if (!d) return null;
  const cell = (st, text) => ({ st, text });
  const out = {};
  const w = weatherFor(s.id).hourly.find((h) => h.time === m.time);
  if (w) {
    const x = wmo(w.code);
    out.wx = { st: '', text: x.short, ic: x.icon };
    out.temp = cell('', num(w.t, '°'));
  }
  out.valley = d.seaCC >= 60 ? cell('ok', 'Denses') : d.seaCC >= 25 ? cell('mid', 'Éparses') : cell('bad', 'Aucun');
  out.top = hasSea(d) ? cell('', `${d.top} m`) : cell('', '–');
  if (!hasSea(d)) out.summit = cell('', '–');
  else if (inCloud(s, d)) out.summit = cell('bad', 'Dans le nuage');
  else out.summit = s.alt - d.top < 60 ? cell('mid', 'Juste') : cell('ok', 'Dégagé');
  out.sky = d.aboveCC < 30 ? cell('ok', d.high > 50 ? 'Voilé' : 'Dégagé') : d.aboveCC < 60 ? cell('mid', 'Mitigé') : cell('bad', 'Couvert');
  out.inv = d.dT == null ? cell('', '–') : d.dT >= 0 ? cell('ok', `+${num(d.dT, '°')}`) : d.dT < -2.5 ? cell('bad', 'Aucune') : cell('mid', 'Faible');
  out.wind = cell(d.wind > 40 ? 'bad' : d.wind > 25 ? 'mid' : 'ok', `${d.wind} km/h`);
  const per = Object.values(m.perModel).map((v) => v.score);
  out.models = per.length < 2 ? cell('', MODEL_INFO[state.model][0])
    : cell(Math.abs(per[0] - per[1]) >= 30 ? 'mid' : 'ok', per.join(' · '));
  return out;
}

function compareCard(s, rise, set) {
  const a = conditions(s, rise), b = conditions(s, set);
  if (!a && !b) return '';
  const ic = { ok: 'check', mid: 'tilde', bad: 'x' };
  const word = { ok: 'favorable', mid: 'moyen', bad: 'défavorable' };
  const v = (x) => (!x ? '<span class="cmp-v">–</span>'
    : `<span class="cmp-v ${x.st}">${x.st ? `<i aria-label="${word[x.st]}">${icon(ic[x.st])}</i>` : ''}${x.ic ? icon(x.ic, 'cmp-wx') : ''}${x.text}</span>`);
  const rows = [
    ['wx', 'Météo'], ['temp', 'Température'],
    ['valley', 'Nuages en vallée'], ['top', 'Dessus des nuages'], ['summit', 'Sommet'],
    ['sky', 'Ciel au-dessus'], ['inv', 'Inversion'], ['wind', 'Vent au sommet'],
    ['models', state.model === 'consensus' ? 'ICON · Météo-France' : 'Modèle'],
  ];
  return `<div class="card">
    <div class="cmp">
      <div class="cmp-row cmp-head"><span>Au sommet</span>
        <span>${icon('sunrise')}Lever</span><span>${icon('sunset')}Coucher</span></div>
      ${rows.map(([k, label]) => `<div class="cmp-row"><span class="cmp-lbl">${label}</span>${v(a?.[k])}${v(b?.[k])}</div>`).join('')}
    </div>
  </div>`;
}

function weatherCard(s, d) {
  const w = weatherFor(s.id);
  const date = state.result.sunrise[d].slice(0, 10);
  const day = w.daily.find((x) => x.date === date);
  const hours = w.hourly.filter((h) => h.time.startsWith(date));
  if (!day || !hours.length) return '';
  const wx = wmo(day.code);
  const daytime = hours.filter((h) => { const hh = Number(h.time.slice(11, 13)); return hh >= 7 && hh <= 19; });
  const avg = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  const cloud = avg(daytime.map((h) => h.cc).filter((x) => x != null));
  const nowH = d === 0 ? w.hourly[nowIndex(state.result)] : null;

  return `<div class="card weather">
    ${cardHead('thermo', 'Météo au sommet')}
    <div class="wx-main">
      ${icon(wx.icon, 'wx-ic')}
      <div class="wx-text"><b>${wx.label}</b>${nowH ? `<small>Maintenant ${num(nowH.t, '°')} · ${wmo(nowH.code).label.toLowerCase()}</small>` : ''}</div>
      <div class="wx-temps"><b>${int(day.tmax, '°')}</b><small>${int(day.tmin, '°')}</small></div>
    </div>
    <div class="wx-stats">
      <div><small>Pluie</small><b>${num(day.precip)}<i> mm</i></b></div>
      <div><small>Vent</small><b>${int(day.wind)}<i> km/h</i></b></div>
      <div><small>Rafales</small><b>${int(day.gust)}<i> km/h</i></b></div>
      <div><small>Nuages</small><b>${int(cloud)}<i> %</i></b></div>
    </div>
  </div>`;
}

// Couverture nuageuse au fil de la journée, par altitude, au-dessus de la vallée de référence.
function ccAt(levels, z) {
  if (!levels.length) return null;
  if (z <= levels[0].z) return levels[0].cc;
  for (let k = 1; k < levels.length; k++) {
    if (z <= levels[k].z) {
      const a = levels[k - 1], b = levels[k];
      return a.cc + ((z - a.z) / (b.z - a.z)) * (b.cc - a.cc);
    }
  }
  return levels.at(-1).cc;
}

// Classes de couverture reprises de meteoblue : 10–25, 25–50, 50–75, 75–90, 90–100 %.
const CLOUD_BINS = [[90, 'rgb(244,246,253)'], [75, 'rgb(203,210,231)'], [50, 'rgb(160,169,198)'], [25, 'rgb(118,128,162)'], [10, 'rgb(82,92,128)']];
const cloudColor = (cc) => CLOUD_BINS.find(([min]) => cc >= min)?.[1] ?? null;

// Échelle d'altitude de meteoblue (0 · 1,5 · 3,5 · 6 · 9 · 14 km), détaillée sous 1,5 km pour les mers de nuages.
const Z_TICKS = [0, 500, 1000, 1500, 3500, 6000, 9000, 14000];

// Image de la coupe : chaque pixel interpole la couverture entre deux heures et deux niveaux,
// puis prend la couleur de sa classe. Contours lisses, comme sur meteoblue.
function cloudRaster(hours, ground, zAtRow, w, h) {
  const k = Math.min(3, Math.max(2, devicePixelRatio || 2));
  const W = Math.round(w * k), H = Math.round(h * k);
  const n = hours.length;
  const rows = Array.from({ length: H }, (_, py) => zAtRow((py + 0.5) / k));
  const grid = hours.map((hr) => rows.map((z) => (z < ground ? -1 : ccAt(hr.levels, z) ?? 0)));
  const rgb = CLOUD_BINS.map(([min, c]) => [min, c.match(/\d+/g).map(Number)]);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let px = 0; px < W; px++) {
    const t = Math.max(0, Math.min(n - 1, ((px + 0.5) / W) * n - 0.5));
    const i0 = Math.floor(t), i1 = Math.min(n - 1, i0 + 1), f = t - i0;
    for (let py = 0; py < H; py++) {
      const a = grid[i0][py], b = grid[i1][py];
      if (a < 0 || b < 0) continue;
      const cc = a + (b - a) * f;
      const bin = rgb.find(([min]) => cc >= min);
      if (!bin) continue;
      const o = (py * W + px) * 4;
      img.data[o] = bin[1][0]; img.data[o + 1] = bin[1][1]; img.data[o + 2] = bin[1][2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}

const dayHead = (d) => (d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain'
  : `${cap(fmtWeekday.format(new Date(state.result.sunrise[d])))} ${new Date(state.result.sunrise[d]).getDate()}`);

function cloudCard(s, d, valleyKey) {
  const r = state.result;
  state.sections[valleyKey] ??= cloudSection(state.data, valleyKey, state.model);
  // Trois jours à partir du jour choisi, comme meteoblue.
  const dates = r.sunrise.slice(d, d + 3).map((t) => t.slice(0, 10));
  const hours = state.sections[valleyKey].filter((h) => dates.includes(h.time.slice(0, 10)));
  const rain = weatherFor(s.id).hourly.filter((h) => dates.includes(h.time.slice(0, 10)));
  if (hours.length < 24) return '';

  // Mise en page : noms des jours, bande jour/nuit, coupe des nuages, pluie, heures.
  const n = hours.length;
  const W = 320, x0 = 30, x1 = W - 2;
  const nameY = 11, barY = 19, barH = 8;
  const top = 36, bottom = 216;
  const rainTop = 224, rainB = 242;
  const H = 260;
  const cw = (x1 - x0) / n;
  const seg = (bottom - top) / (Z_TICKS.length - 1);
  const y = (z) => {
    const zc = Math.max(0, Math.min(z, Z_TICKS.at(-1)));
    let k = 1;
    while (k < Z_TICKS.length - 1 && zc > Z_TICKS[k]) k++;
    return bottom - (k - 1 + (zc - Z_TICKS[k - 1]) / (Z_TICKS[k] - Z_TICKS[k - 1])) * seg;
  };
  const zAt = (py) => {
    const u = (bottom - py) / seg;
    const k = Math.min(Z_TICKS.length - 2, Math.floor(u));
    return Z_TICKS[k] + (u - k) * (Z_TICKS[k + 1] - Z_TICKS[k]);
  };
  const t0 = new Date(hours[0].time).getTime();
  const xt = (t) => x0 + ((new Date(t).getTime() - t0) / 3600e3) * cw;
  const dayX = (k) => x0 + k * 24 * cw;
  const ground = hours[0].ground;
  const gy = y(ground);
  const days = dates.map((date) => r.sunrise.findIndex((t) => t.startsWith(date)));
  const f = (v) => v.toFixed(1);

  let g = `<svg class="cs" viewBox="0 0 ${W} ${H}" role="img" aria-label="Couverture nuageuse par altitude au-dessus de ${valleyTown(valleyKey)}, sur trois jours">
    <defs>
      <linearGradient id="cs-dawn" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ff9f6a"/><stop offset=".25" stop-color="#ffd36b"/>
        <stop offset=".75" stop-color="#ffd36b"/><stop offset="1" stop-color="#ff9f6a"/>
      </linearGradient>
      <clipPath id="cs-plot"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bottom - top}" rx="6"/></clipPath>
    </defs>`;

  // Fond de la coupe : nuit sombre, jour plus clair (visible là où il n'y a pas de nuages).
  g += `<g clip-path="url(#cs-plot)"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bottom - top}" class="cs-night"/>`;
  days.forEach((i) => {
    g += `<rect x="${f(xt(r.sunrise[i]))}" y="${top}" width="${f(xt(r.sunset[i]) - xt(r.sunrise[i]))}" height="${bottom - top}" class="cs-day"/>`;
  });
  g += `<image x="${x0}" y="${top}" width="${x1 - x0}" height="${f(gy - top)}" preserveAspectRatio="none"
    href="${cloudRaster(hours, ground, (py) => zAt(top + py), x1 - x0, gy - top)}"/>`;
  g += `<rect x="${x0}" y="${f(gy)}" width="${x1 - x0}" height="${f(bottom - gy)}" class="cs-ground"/>`;
  // Graduations d'altitude.
  for (const z of Z_TICKS.slice(1)) g += `<line x1="${x0}" x2="${x1}" y1="${f(y(z))}" y2="${f(y(z))}" class="cs-grid"/>`;
  // Lever et coucher : traits fins au-dessus des nuages.
  days.forEach((i) => {
    for (const t of [r.sunrise[i], r.sunset[i]]) g += `<line x1="${f(xt(t))}" x2="${f(xt(t))}" y1="${top}" y2="${bottom}" class="cs-sunline"/>`;
  });
  g += '</g>';

  // Altitudes.
  for (const z of Z_TICKS.slice(1)) {
    g += `<text x="${x0 - 5}" y="${f(y(z) + 3.5)}" class="cs-lbl end">${num(z / 1000)}</text>`;
  }
  g += `<text x="${x0 - 5}" y="${top - 4}" class="cs-lbl end unit">km</text>`;

  // Noms des jours et bande jour/nuit.
  days.forEach((i, k) => {
    const a = dayX(k) + (k ? 1 : 0), b = dayX(k + 1) - (k < days.length - 1 ? 1 : 0);
    g += `<text x="${f((dayX(k) + dayX(k + 1)) / 2)}" y="${nameY}" class="cs-dayname${k === 0 ? ' on' : ''}">${dayHead(i)}</text>`;
    g += `<rect x="${f(a)}" y="${barY}" width="${f(b - a)}" height="${barH}" rx="${barH / 2}" class="cs-bar-night"/>`;
    const sx = xt(r.sunrise[i]), ex = xt(r.sunset[i]);
    g += `<rect x="${f(sx)}" y="${barY}" width="${f(ex - sx)}" height="${barH}" rx="${barH / 2}" fill="url(#cs-dawn)"/>`;
  });

  // Séparateurs de jours (minuit), du nom du jour jusqu'aux heures.
  for (let k = 1; k < days.length; k++) {
    g += `<line x1="${f(dayX(k))}" x2="${f(dayX(k))}" y1="${barY - 2}" y2="${rainB}" class="cs-midnight"/>`;
  }

  // Maintenant.
  if (d === 0) {
    const nx = xt(Date.now());
    if (nx > x0 && nx < x1) {
      g += `<line x1="${f(nx)}" x2="${f(nx)}" y1="${top}" y2="${rainB}" class="cs-now"/>
        <circle cx="${f(nx)}" cy="${top}" r="3" class="cs-now-dot"/>`;
    }
  }

  // Altitude du sommet.
  const sy = y(s.alt);
  g += `<line x1="${x0}" x2="${x1}" y1="${f(sy)}" y2="${f(sy)}" class="cs-summit"/>`;

  // Pluie au lieu.
  const pMax = Math.max(2, ...rain.map((h) => h.precip ?? 0));
  g += `<text x="${x0 - 5}" y="${rainB - 2}" class="cs-lbl end unit">mm</text>`;
  rain.forEach((h, i) => {
    if (!h.precip) return;
    const bh = Math.max(1.5, (h.precip / pMax) * (rainB - rainTop));
    g += `<rect x="${(x0 + i * cw + 0.3).toFixed(2)}" y="${f(rainB - bh)}" width="${Math.max(1, cw - 0.6).toFixed(2)}" height="${f(bh)}" rx="0.8" class="cs-rain"/>`;
  });
  g += `<line x1="${x0}" x2="${x1}" y1="${rainB}" y2="${rainB}" class="cs-axis"/>`;

  // Heures.
  days.forEach((_, k) => {
    for (const hh of [6, 12, 18]) {
      const hx = x0 + (k * 24 + hh) * cw;
      g += `<line x1="${f(hx)}" x2="${f(hx)}" y1="${rainB}" y2="${rainB + 3}" class="cs-axis"/>
        <text x="${f(hx)}" y="${H - 4}" class="cs-lbl">${hh}h</text>`;
    }
  });
  g += '</svg>';

  const bins = CLOUD_BINS.slice().reverse();
  return `<div class="card clouds">
    ${cardHead('layers', 'Nuages par altitude')}
    <p class="cs-sub">Au-dessus de ${valleyTown(valleyKey)}, vallée à ${Math.round(ground)} m</p>
    ${g}
    <div class="cs-scale">
      <span class="cs-scale-title">Couverture</span>
      <div class="cs-scale-body">
        <div class="cs-scale-bar">${bins.map(([min]) => `<i style="background:${cloudColor(min)}"></i>`).join('')}</div>
        <div class="cs-scale-ticks">${bins.map(([min]) => `<span>${min}</span>`).join('')}<span>100 %</span></div>
      </div>
    </div>
    <div class="cs-legend">
      <span><i class="k-day"></i>Jour</span>
      <span><i class="k-night"></i>Nuit</span>
      <span><i class="k-summit"></i>Sommet (${s.alt} m)</span>
      <span><i class="k-rain"></i>Pluie, max ${num(pMax)} mm/h</span>
    </div>
  </div>`;
}

function nearCams(s) {
  return WEBCAMS
    .map((c) => ({ c, dist: Math.hypot((c.lat - s.lat) * 111, (c.lon - s.lon) * 74) }))
    .sort((a, b) => a.dist - b.dist).slice(0, 3);
}

// ---------- Animations ----------

// Entrée en cascade (arrivée sur la page) ou fondu enchaîné (mise à jour du contenu).
function animateIn(root, enter, els = [...root.children]) {
  replay(els, enter ? 'rise' : 'swap');
  countUp(root);
  fillRings(root);
}

function replay(els, cls) {
  els.forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 8));
    el.classList.remove('rise', 'swap');
    void el.offsetWidth;
    el.classList.add(cls);
  });
}

function countUp(root) {
  $$('[data-count]', root).forEach((el) => {
    const to = Number(el.dataset.count);
    if (el.dataset.count === '' || Number.isNaN(to)) return;
    if (reduceMotion.matches || document.hidden) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 800;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  });
}

function fillRings(root) {
  for (const c of $$('.ring-val', root)) {
    getComputedStyle(c).strokeDashoffset; // fixe l'état de départ pour que la transition parte de 0
    c.style.strokeDashoffset = c.dataset.off;
  }
}

// ---------- Navigation ----------

function parseHash() {
  const m = location.hash.match(/^#\/lieu\/([\w-]+)(?:\/(\d+))?/);
  if (m && siteById(m[1])) return { site: m[1], day: m[2] != null ? Number(m[2]) : null };
  return null;
}

function openSite(site, day) {
  history.pushState({ pushed: true }, '', `#/lieu/${site}/${day}`);
  route();
}

function goBack() {
  if (history.state?.pushed) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); route(); }
}

let onDetail = false;
function route() {
  const r = parseHash();
  const home = $('#home'), detail = $('#detail');
  if (r) {
    const changed = !onDetail || r.site !== state.site;
    state.site = r.site;
    state.day = r.day;
    if (changed) {
      $('.scroller', detail).scrollTop = 0;
      renderDetail(true);
    }
    onDetail = true;
    document.body.classList.add('show-detail');
    detail.inert = false;
    home.inert = true;
    $('h1', detail)?.focus({ preventScroll: true });
  } else {
    onDetail = false;
    document.body.classList.remove('show-detail');
    detail.inert = true;
    home.inert = false;
  }
}
window.addEventListener('popstate', route);

function selectDay(d) {
  if (d === state.day) return;
  state.day = d;
  history.replaceState(history.state, '', `#/lieu/${state.site}/${d}`);
  $$('.segmented .seg').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.day) === d)));
  $('.seg-thumb')?.style.setProperty('--k', upcomingDays().indexOf(d));
  renderDay();
}

// Délégation des clics.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action], [data-site], [data-day], [data-cam], [data-model]');
  if (!t) return;
  if (t.dataset.cam) return openCam(WEBCAMS.find((c) => c.id === Number(t.dataset.cam)));
  if (t.dataset.model) return setModel(t.dataset.model);
  if (t.dataset.site) return openSite(t.dataset.site, Number(t.dataset.day));
  if (t.dataset.day && t.closest('.segmented')) return selectDay(Number(t.dataset.day));
  switch (t.dataset.action) {
    case 'back': return goBack();
    case 'settings': return openSettings();
    case 'close-sheet': return closeSheet();
    case 'refresh': closeSheet(); return load(true);
    default:
  }
});

// Grand titre élastique quand on tire vers le bas.
for (const page of $$('.page')) {
  const sc = $('.scroller', page);
  sc.addEventListener('scroll', () => {
    const y = sc.scrollTop;
    const lt = $('.large-title', page);
    if (lt) lt.style.transform = y < 0 ? `scale(${1 + Math.min(0.08, -y / 900)})` : '';
    if (page.id === 'home') pullToRefresh(y);
  }, { passive: true });
}

// Tirer pour actualiser (rebond natif d'iOS).
let ptrArmed = false;
function pullToRefresh(y) {
  const ptr = $('#home .ptr');
  if (state.loading) return;
  const k = Math.min(1, Math.max(0, -y / 80));
  ptr.style.opacity = k;
  ptr.style.transform = `translateY(${Math.min(40, -y / 2)}px) rotate(${k * 270}deg)`;
  ptrArmed = k >= 1;
}
$('#home .scroller').addEventListener('touchend', () => {
  if (ptrArmed && !state.loading) { ptrArmed = false; load(true); }
}, { passive: true });

// Retour par glissement depuis le bord gauche (application installée sur l'écran d'accueil).
if (standalone) {
  const detail = $('#detail'), home = $('#home');
  let x0 = null, t0 = 0, dx = 0;
  detail.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.clientX > 24 || !onDetail) return;
    x0 = t.clientX; t0 = performance.now(); dx = 0;
    document.body.classList.add('dragging');
  }, { passive: true });
  detail.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    dx = Math.max(0, e.touches[0].clientX - x0);
    const w = innerWidth;
    detail.style.transform = `translateX(${dx}px)`;
    home.style.transform = `translateX(${-30 + (30 * dx) / w}%)`;
    home.style.setProperty('--shade', (1 - dx / w).toFixed(3));
  }, { passive: true });
  detail.addEventListener('touchend', () => {
    if (x0 == null) return;
    const v = dx / (performance.now() - t0);
    document.body.classList.remove('dragging');
    detail.style.transform = '';
    home.style.transform = '';
    home.style.removeProperty('--shade');
    x0 = null;
    if (dx > innerWidth * 0.35 || v > 0.6) {
      document.body.classList.remove('show-detail');
      goBack();
    }
  });
}

// ---------- Feuille modale ----------

const sheet = $('#sheet');

function openSheet(title, html, cls = '') {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  sheet.className = `sheet ${cls}`;
  sheet.showModal();
  $('.sheet-panel', sheet).scrollTop = 0;
}

function closeSheet() {
  if (!sheet.open || sheet.classList.contains('closing')) return;
  if (reduceMotion.matches) { sheet.close(); return; }
  sheet.classList.add('closing');
  setTimeout(() => sheet.close(), 260);
}
sheet.addEventListener('close', () => { sheet.classList.remove('closing'); $('#sheet-body').innerHTML = ''; });
sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

// Glisser vers le bas pour fermer.
{
  const panel = $('.sheet-panel', sheet);
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.sheet-grab, .sheet-head')) return;
    y0 = e.touches[0].clientY; dy = 0;
    panel.style.transition = 'none';
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 110) closeSheet();
  });
}

function openSettings() {
  const at = state.data ? `Prévisions de ${hour(state.data.at)}` : 'Prévisions non chargées';
  openSheet('Réglages', `
    <p class="group-label">Modèle météo</p>
    <div class="group">${Object.keys(MODELS).map((k) => `
      <button class="row tap" data-model="${k}" aria-pressed="${k === state.model}">
        <span><b>${MODEL_INFO[k][0]}</b><small>${MODEL_INFO[k][1]}</small></span>
        ${k === state.model ? icon('check', 'row-check') : ''}
      </button>`).join('')}
    </div>
    <p class="group-label">Webcams</p>
    <div class="group">
      <label class="row"><span>Dernière image de jour</span>
        <input type="checkbox" class="switch" id="opt-daylight" ${state.daylight ? 'checked' : ''}></label>
    </div>
    <div class="group">
      <button class="row tap accent" data-action="refresh"><span>Actualiser les prévisions</span>${icon('refresh')}</button>
    </div>
    <p class="group-foot">${at} · Open-Meteo</p>
    <p class="group-label">À propos de l’indice</p>
    <div class="group text">
      <p>Chance de voir une mer de nuages (0–100) au meilleur moment autour du lever (de 1 h avant à 2 h après)
        et du coucher du soleil (de 2 h avant à 1 h après).</p>
      <p>Elle combine cinq facteurs tirés des profils verticaux des modèles : nuages bas en vallée sous le sommet,
        sommet hors du nuage, ciel dégagé au-dessus, inversion de température et vent faible.</p>
    </div>`, 'settings');
  $('#opt-daylight').onchange = (e) => {
    state.daylight = e.target.checked;
    store.set('mdn-daylight', state.daylight ? '1' : '0');
    $$('.cam img').forEach((img) => {
      const id = img.closest('.cam').dataset.cam;
      img.parentNode.classList.remove('broken');
      img.src = webcamImage(id, state.daylight ? 'daylight' : 'current');
    });
  };
}

function setModel(k) {
  if (k === state.model) return;
  state.model = k;
  store.set('mdn-model', k);
  $$('#sheet [data-model]').forEach((b) => {
    const on = b.dataset.model === k;
    b.setAttribute('aria-pressed', String(on));
    $('.row-check', b)?.remove();
    if (on) b.insertAdjacentHTML('beforeend', icon('check', 'row-check'));
  });
  if (!state.data) return;
  compute();
  renderHome();
  if (onDetail) renderDetail();
}

function openCam(c) {
  openSheet(c.name, `
    <div class="player"><iframe src="${webcamPlayer(c.id)}" title="Timelapse ${c.name}" allowfullscreen></iframe></div>
    <a class="pill-btn tap" href="https://www.windy.com/webcams/${c.id}" target="_blank" rel="noopener">Voir sur Windy ${icon('external')}</a>`, 'cam-sheet');
}

// ---------- Chargement ----------

function compute() {
  state.result = computeAll(state.data, state.model);
  state.weather = {};
  state.sections = {};
}

async function load(force = false) {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  document.body.classList.add('loading');
  if (!state.result) { renderHome(); if (onDetail) renderDetail(); }
  try {
    state.data = await fetchForecast({ force });
    const first = !state.result;
    compute();
    $('#updated').textContent = `Vosges du Nord · prévisions de ${hour(state.data.at)}`;
    renderHome(first || force);
    if (onDetail) renderDetail(first || force);
  } catch (e) {
    console.error(e);
    state.error = e.message;
    if (!state.result) { renderHome(); if (onDetail) renderDetail(); }
  } finally {
    state.loading = false;
    document.body.classList.remove('loading');
    const ptr = $('#home .ptr');
    ptr.style.opacity = '';
    ptr.style.transform = '';
  }
}

// Revenir dans l'application : recharge si les prévisions ont plus de 30 min.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.data && Date.now() - state.data.at > 30 * 60e3) load();
});

$$('[data-action="settings"].icon-btn').forEach((b) => { b.innerHTML = icon('settings'); });
$('.back-ic').innerHTML = icon('back');

// Hauteur réelle de l'écran : en application installée, iOS donne parfois une fenêtre plus courte
// que l'écran (bande vide en bas). On étend alors les pages à toute la hauteur.
function fitScreen() {
  const portrait = innerHeight >= innerWidth;
  const h = standalone && portrait ? Math.max(innerHeight, screen.height) : innerHeight;
  document.documentElement.style.setProperty('--app-h', `${h}px`);
}
fitScreen();
addEventListener('resize', fitScreen);

document.documentElement.classList.add('no-anim');
route();
requestAnimationFrame(() => document.documentElement.classList.remove('no-anim'));
load();
