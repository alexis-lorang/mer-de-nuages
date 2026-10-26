import {
  SITES, VALLEYS, WEBCAMS, MODELS,
  webcamImage, webcamPlayer, meteobluePage, scoreValleys,
} from './config.js?v=51';
import {
  fetchForecast, computeAll, morningWindow, eveningWindow, bestInWindow, scoreClass, nowIndex,
  siteWeather, cloudSection, staleCache, MORNING, EVENING,
} from './forecast.js?v=51';
import { icon } from './icons.js?v=51';
import { scene } from './scene.js?v=51';

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
  cloudView: store.get('mdn-cloud-view', 'day') === 'days' ? 'day' : store.get('mdn-cloud-view', 'day'),
  themePref: store.get('mdn-theme', 'auto'),
  chartValley: (() => { try { return JSON.parse(store.get('mdn-chart-valley', '{}')) || {}; } catch { return {}; } })(),
  site: null,
  day: null,
};
if (!MODELS[state.model]) state.model = 'consensus';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const THEMES = {
  auto: ['Automatique', 'Comme le réglage de l’iPhone'],
  light: ['Clair', 'Fond clair'],
  dark: ['Sombre', 'Fond sombre'],
};
if (!THEMES[state.themePref]) state.themePref = 'auto';
const currentTheme = () => (state.themePref === 'auto' ? (prefersLight.matches ? 'light' : 'dark') : state.themePref);

// Applique le thème (attribut sur <html>, couleur de la barre du navigateur) et redessine le graphique des nuages.
function applyTheme() {
  const t = currentTheme();
  if (document.documentElement.dataset.theme === t) return;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#fdeee2' : '#1c1a31');
  if (onDetail && state.result && $('#detail .card.clouds')) refreshCloudCard();
}
prefersLight.addEventListener('change', () => { if (state.themePref === 'auto') applyTheme(); });
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

// Les n prochains jours qui ont encore un lever ou un coucher à venir.
const upcomingDays = (n = 4) => [...new Set(upcoming().map((e) => e.d))].slice(0, n);
// Jours affichés, sur l'accueil comme sur la page d'un lieu.
const DAYS = 5;
const detailDays = () => upcomingDays(DAYS);

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

// Jauge en demi-cercle : quatre segments aux seuils de l'indice (20, 40, 65), curseur sur la valeur.
const GAUGE_SEGS = [['low', 0, 20], ['maybe', 20, 40], ['good', 40, 65], ['top', 65, 100]];
function gauge(score, size = '') {
  const pt = (v) => {
    const a = ((180 - v * 1.8) * Math.PI) / 180;
    return [70 + 56 * Math.cos(a), 70 - 56 * Math.sin(a)].map((x) => x.toFixed(2));
  };
  const arcs = GAUGE_SEGS.map(([k, a0, a1], i) => {
    const [x0, y0] = pt(a0 + (i ? 1 : 0)), [x1, y1] = pt(a1 - (i < 3 ? 1 : 0));
    return `<path d="M${x0} ${y0} A56 56 0 0 1 ${x1} ${y1}" class="g-seg g-${k}"${i === 0 || i === 3 ? ' stroke-linecap="round"' : ''}/>`;
  }).join('');
  return `<div class="gauge ${size}${score == null ? ' na' : ''}" role="img" aria-label="Indice ${score ?? 'indisponible'} sur 100">
    <svg viewBox="0 0 140 84" aria-hidden="true">${arcs}<g class="g-knob-g" style="--r:${((score ?? 0) * 1.8).toFixed(1)}deg"><circle class="g-knob" cx="14" cy="70" r="9"/></g></svg>
    <b data-count="${score ?? ''}" aria-hidden="true">${score ?? '–'}</b>${size ? '' : '<small aria-hidden="true">sur 100</small>'}
  </div>`;
}

// Fond blanc d'une pilule, sous le bouton choisi (indice k).
const gpillThumb = (k) => `<span class="gpill-thumb" style="--k:${k}" aria-hidden="true"></span>`;

// Fait glisser le fond d'une pilule fraîchement redessinée depuis son ancienne position.
function slideThumb(root, from) {
  const th = $('.gpill-thumb', root);
  if (!th || from < 0) return;
  th.style.setProperty('--k0', from);
  th.classList.add('slide');
}

// Légende en échelle : un segment par niveau (classe de couleur ou teinte donnée), libellés dessous.
const scaleLegend = (items, label) => `<div class="scale" role="img" aria-label="${label}" style="--n:${items.length}">
    <div class="scale-bar" aria-hidden="true">${items.map(([cls, , col]) => `<i class="${cls ?? ''}"${col ? ` style="background:${col}"` : ''}></i>`).join('')}</div>
    <div class="scale-lbl" aria-hidden="true">${items.map(([, l]) => `<span>${l}</span>`).join('')}</div>
  </div>`;

// Indicateur d'activité façon iOS : 8 rayons d'opacité décroissante.
function spinner(cls = '') {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45 * Math.PI) / 180;
    const [x1, y1, x2, y2] = [12 + Math.sin(a) * 5, 12 - Math.cos(a) * 5, 12 + Math.sin(a) * 9.5, 12 - Math.cos(a) * 9.5];
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" style="--o:${(1 - i * 0.11).toFixed(2)}"/>`;
  }).join('');
  return `<svg class="spinner ${cls}" viewBox="0 0 24 24" aria-hidden="true">${rays}</svg>`;
}

const cardHead = (ic, title, extra = '') => `<div class="card-head">${icon(ic)}<span>${title}</span>${extra}</div>`;

function camTile(c, extra = '') {
  return `<button class="cam tap" data-cam="${c.id}" aria-label="Webcam ${c.name}, timelapse">
    <span class="cam-img"><img loading="lazy" decoding="async" src="${webcamImage(c.id, state.daylight ? 'daylight' : 'current')}" alt=""
      onerror="this.parentNode.classList.add('broken')">${icon('camera', 'cam-ph')}
      <span class="cam-cap"><b>${c.name}</b>${extra ? `<small>${extra}</small>` : ''}</span>
      <span class="cam-play">${icon('play')}</span></span>
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
  const days = upcomingDays(DAYS);

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
    return `<button class="card hero tap ${c.key}" data-site="${top.s.id}" data-day="${top.d}">
      <div class="hero-scene">${scene(top.s, top.b.ref, c.key, { W: 360, H: 160, labels: false })}
        <span class="hero-badge glass">${icon('star')}Meilleure chance</span></div>
      <div class="hero-info">
        <div class="hero-row">
          <div class="hero-text">
            <h2 class="hero-site">${top.s.name}</h2>
            <p class="hero-meta">${icon(k.icon)}${dayLabel(top.d)} · ${k.label.toLowerCase()} ${hour(k.at(r, top.d))}</p>
            <span class="chip ${c.key}">${c.label}</span>
          </div>
          ${gauge(top.b.score)}
        </div>
      </div>
      <div class="hero-foot">
        ${icon('cloud')}
        <span class="hero-note">${cap(layerNote(top.s, top.b.ref))}</span>
        ${icon('chevron', 'hero-chev')}
      </div>
    </button>`;
  })() : `<div class="card hero">
      <div class="hero-scene">${scene(SITES[0], null, 'low', { W: 360, H: 160, labels: false })}
        <span class="hero-badge glass">${days.length} prochains jours</span></div>
      <div class="hero-info">
        <h2 class="hero-site">Pas de mer de nuages en vue</h2>
        <p class="hero-meta">Aucune couche basse prévue sous les sommets.</p>
      </div>
    </div>`;

  // Une carte par lieu : nom, puis une case par jour. Chaque case se remplit depuis le bas selon la chance
  // de mer de nuages (comme une mer qui monte) ; le meilleur jour du lieu est entouré.
  const cell = (s, d, j, best) => {
    const b = dayScore(s.id, d);
    const c = scoreClass(b?.score);
    const when = b?.kind ? ` au ${KINDS[b.kind].label.toLowerCase()}` : '';
    return `<button class="pl-day ${c.key}${best ? ' best' : ''}" data-site="${s.id}" data-day="${d}"
        style="--v:${Math.max(0.05, (b?.score ?? 0) / 100).toFixed(2)};--j:${j}"
        aria-label="${s.name}, ${dayLabel(d)}${when} : ${b?.score ?? 'pas de données'}, ${c.label}${best ? ', meilleur jour' : ''}">
      <span class="pl-d">${dayShort(d)}</span>
      <b data-count="${b?.score ?? ''}">${b?.score ?? '–'}</b>
      ${b?.kind ? icon(KINDS[b.kind].icon, 'pl-k') : '<i class="pl-k"></i>'}
      ${best ? `<span class="pl-best" aria-hidden="true">${icon('star')}</span>` : ''}
    </button>`;
  };
  // Meilleurs lieux d'abord : plus haute chance sur les jours affichés, puis la deuxième, etc.
  const ranked = SITES.map((s) => ({ s, desc: days.map((d) => dayScore(s.id, d)?.score ?? -1).sort((x, y) => y - x) }))
    .sort((a, b) => {
      for (let k = 0; k < a.desc.length; k++) if (a.desc[k] !== b.desc[k]) return b.desc[k] - a.desc[k];
      return 0;
    })
    .map(({ s }) => s);
  const places = ranked.map((s) => {
    const scores = days.map((d) => dayScore(s.id, d)?.score ?? -1);
    const max = Math.max(...scores);
    const bestJ = max >= 20 ? scores.indexOf(max) : -1;
    return `<article class="card place">
      <button class="pl-head" data-site="${s.id}" data-day="${days[0]}">
        <b>${s.name}</b><small>${s.alt} m</small>${icon('chevron', 'pl-chev')}
      </button>
      <div class="pl-days" style="--n:${days.length}">${days.map((d, j) => cell(s, d, j, j === bestJ)).join('')}</div>
    </article>`;
  }).join('');

  body.innerHTML = `
    ${hero}
    <section class="section">
      <div class="section-head"><h2>Lieux</h2><span class="section-sub">${days.length} prochains jours
        <button class="help-btn" data-action="help-days" aria-label="Comment lire les cases"><span aria-hidden="true">?</span></button></span></div>
      <div class="stack tight">${places}</div>
      ${scaleLegend(['low', 'maybe', 'good', 'top'].map((k) => [k, scoreClass({ top: 65, good: 40, maybe: 20, low: 0 }[k]).label]),
        'Légende de l’indice, du plus faible au plus fort : peu probable, possible, probable, très probable')}
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

const DAYS_NOTE = 'Meilleure chance de la journée, de 0 à 100 : la case se remplit d’autant, l’icône indique le lever '
  + 'ou le coucher, le meilleur jour est entouré et marqué d’une étoile. Au-delà de 4 jours, seul le modèle ICON est disponible.';

function homeSkeleton() {
  return `<div class="card hero skel"><div class="hero-scene shimmer"></div><div class="hero-info"><i class="sk w40"></i><i class="sk w60"></i></div></div>
    <section class="section"><div class="section-head"><h2>Lieux</h2></div>
    <div class="stack">${SITES.map(() => '<div class="card place skel"><i class="sk w40"></i><div class="pl-days shimmer"></div></div>').join('')}</div></section>`;
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
  const days = detailDays();
  if (!days.includes(state.day)) state.day = days[0] ?? 0;

  const picker = days.map((d) => {
    const b = dayScore(s.id, d);
    const c = scoreClass(b?.score);
    return `<button class="seg tap ${c.key}" role="tab" data-day="${d}" aria-selected="${d === state.day}"
        style="--v:${Math.max(0.05, (b?.score ?? 0) / 100).toFixed(2)};--j:${days.indexOf(d)}"
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
      ${gauge(m?.score ?? null, 'sm')}
      <span class="chip ${mc.key}">${mc.label}</span>
      <p class="m-foot">${past ? 'Passé' : m ? `Idéal vers ${hour(m.time)}` : 'Pas de données'}</p>
    </div>`;
  };

  $('#d-day').innerHTML = `
    <div class="moments">${momentCard('rise', rise)}${momentCard('set', set)}</div>
    ${best ? sceneCard(s, d, state.sceneKind ?? bestKind) : ''}
    ${cloudCard(s, d)}
    <section class="section">
      <div class="section-head"><h2>Webcams proches</h2></div>
      <div class="cam-strip">${nearCams(s).map(({ c: cam, dist }) => camTile(cam, `${dist.toFixed(0)} km`)).join('')}</div>
    </section>
    ${weatherCard(s, d)}
    ${compareCard(s, rise, set)}
    <div class="card about">
      ${cardHead('pin', 'Le lieu')}
      <p>${s.note}</p>
      <p class="muted">Vallées de référence : ${scoreValleys(s).map(valleyName).join(', ')}.</p>
      <a class="pill-btn tap" href="${meteobluePage(s)}" target="_blank" rel="noopener">Prévisions meteoblue ${icon('external')}</a>
    </div>`;

  if (!enter) {
    replay([...$('#d-day').children], 'swap');
    countUp($('#d-day'));
  }
}

// Illustration de la mer de nuages par rapport au sommet, au lever ou au coucher.
function sceneCard(s, d, kind) {
  const m = moment(s.id, d, kind);
  const c = scoreClass(m?.score);
  return `<div class="card scene-card">
    ${scene(s, m?.ref ?? null, m ? c.key : 'low')}
    <div class="scene-switch gpill" role="tablist" aria-label="Moment illustré">${gpillThumb(kind === 'set' ? 1 : 0)}
      ${['rise', 'set'].map((k) => `<button role="tab" data-scene="${k}" aria-selected="${k === kind}"
        aria-label="${k === 'rise' ? 'Au lever' : 'Au coucher'}" title="${k === 'rise' ? 'Au lever' : 'Au coucher'}">${icon(KINDS[k].icon)}</button>`).join('')}
    </div>
  </div>`;
}

function setSceneKind(kind) {
  const card = $('#detail .scene-card');
  if (!card || card.querySelector(`[data-scene="${kind}"][aria-selected="true"]`)) return;
  const from = kind === 'set' ? 0 : 1;
  state.sceneKind = kind;
  const tmp = document.createElement('div');
  tmp.innerHTML = sceneCard(siteById(state.site), state.day, kind);
  const next = tmp.firstElementChild;
  card.replaceWith(next);
  slideThumb(next, from);
  replay([$('svg.scene', next)], 'swap');
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
  const v = (x, lane) => (!x ? `<span class="cmp-v lane ${lane}">–</span>`
    : `<span class="cmp-v lane ${lane} ${x.st}">${x.st ? `<i aria-label="${word[x.st]}">${icon(ic[x.st])}</i>` : ''}${x.ic ? icon(x.ic, 'cmp-wx') : ''}${x.text}</span>`);
  const rows = [
    ['wx', 'Météo', 'w-cloud'], ['temp', 'Température', 'thermo'],
    ['valley', 'Nuages en vallée', 'valley'], ['top', 'Dessus des nuages', 'cloud'], ['summit', 'Sommet', 'mountain'],
    ['sky', 'Ciel au-dessus', 'sky'], ['inv', 'Inversion', 'layers'], ['wind', 'Vent au sommet', 'wind'],
    ['models', state.model === 'consensus' ? 'ICON · M-France' : 'Modèle', 'scale'],
  ];
  return `<div class="card cmp-card">
    <div class="cmp">
      <div class="cmp-row cmp-head"><span>Conditions</span>
        <span class="lane rise">${icon('sunrise')}Lever</span><span class="lane set">${icon('sunset')}Coucher</span></div>
      ${rows.map(([k, label, ic]) => `<div class="cmp-row"><span class="cmp-lbl">${icon(ic)}<span>${label}</span></span>${v(a?.[k], 'rise')}${v(b?.[k], 'set')}</div>`).join('')}
    </div>
  </div>`;
}

// Famille de temps (teinte de la carte) et couleur d'une température (froid → chaud).
const WX_TYPE = {
  'w-sun': 'clear', 'w-partly': 'partly', 'w-cloud': 'cloud', 'w-fog': 'fog',
  'w-drizzle': 'rain', 'w-rain': 'rain', 'w-snow': 'snow', 'w-storm': 'storm',
};
const TEMP_STOPS = [[-5, [122, 160, 255]], [0, [90, 200, 250]], [5, [100, 210, 200]], [10, [139, 217, 106]],
  [15, [255, 210, 63]], [20, [255, 159, 67]], [25, [255, 107, 74]]];
function tempColor(t) {
  const st = TEMP_STOPS;
  if (t <= st[0][0]) return `rgb(${st[0][1]})`;
  for (let i = 1; i < st.length; i++) {
    if (t <= st[i][0]) {
      const [a, ca] = st[i - 1], [b, cb] = st[i];
      const k = (t - a) / (b - a);
      return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(',')})`;
    }
  }
  return `rgb(${st.at(-1)[1]})`;
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

  // Barre des températures sur l'échelle des jours affichés, comme la vue 10 jours de l'app Météo.
  const span = detailDays().map((i) => w.daily.find((x) => x.date === state.result.sunrise[i].slice(0, 10))).filter(Boolean);
  const lo = Math.min(...span.map((x) => x.tmin ?? Infinity)), hi = Math.max(...span.map((x) => x.tmax ?? -Infinity));
  const pos = (t) => (hi > lo ? (t - lo) / (hi - lo) : 0.5) * 100;
  const range = day.tmin != null && day.tmax != null && Number.isFinite(lo) ? `<div class="wx-range">
      <span class="wx-min">${int(day.tmin, '°')}</span>
      <span class="range" aria-hidden="true">
        <i style="left:${pos(day.tmin).toFixed(1)}%;width:${Math.max(4, pos(day.tmax) - pos(day.tmin)).toFixed(1)}%;
          background:linear-gradient(90deg, ${tempColor(day.tmin)}, ${tempColor(day.tmax)})"></i>
        ${nowH?.t != null ? `<b class="range-now" style="left:${Math.min(100, Math.max(0, pos(nowH.t))).toFixed(1)}%"></b>` : ''}
      </span>
      <span class="wx-max">${int(day.tmax, '°')}</span>
    </div>` : '';
  const stat = (ic, cls, label, val, unit) => `<div class="wx-stat ${cls}">
      <small>${icon(ic)}${label}</small><b>${val}<i> ${unit}</i></b></div>`;

  return `<div class="card weather wx-${WX_TYPE[wx.icon] ?? 'cloud'}">
    ${cardHead('thermo', 'Météo au sommet')}
    <div class="wx-main">
      ${icon(wx.icon, 'wx-ic')}
      <div class="wx-text"><b>${wx.label}</b>${nowH ? `<small>Maintenant ${num(nowH.t, '°')} · ${wmo(nowH.code).label.toLowerCase()}</small>` : ''}</div>
    </div>
    ${range}
    <div class="wx-stats">
      ${stat('drop', 's-rain', 'Pluie', num(day.precip), 'mm')}
      ${stat('wind', 's-wind', 'Vent', int(day.wind), 'km/h')}
      ${stat('wind', 's-gust', 'Rafales', int(day.gust), 'km/h')}
      ${stat('w-cloud', 's-cloud', 'Nuages', int(cloud), '%')}
    </div>
    ${hourlyStrip(w, d)}
  </div>`;
}

// Heure par heure : 24 h à partir de minuit (ou de maintenant aujourd'hui), lever et coucher intercalés.
function hourlyStrip(w, d) {
  const r = state.result;
  const date = r.sunrise[d].slice(0, 10);
  const sr = new Date(r.sunrise[d]).getTime(), ss = new Date(r.sunset[d]).getTime();
  const nowT = Date.now();
  let hours = w.hourly.filter((h) => h.time.startsWith(date));
  if (d === 0) hours = hours.filter((h) => new Date(h.time).getTime() + 3600e3 > nowT);
  if (!hours.length) return '';
  const night = (t) => t < sr || t > ss;
  const items = [];
  for (const h of hours) {
    const t = new Date(h.time).getTime();
    for (const [st, kind] of [[sr, 'rise'], [ss, 'set']]) {
      if (st >= t && st < t + 3600e3) items.push({ sun: kind, t: st });
    }
    items.push({ h, t });
  }
  items.sort((a, b) => a.t - b.t || (a.sun ? -1 : 1));
  const first = items.find((x) => x.h);
  const cells = items.map((x) => {
    if (x.sun) {
      return `<div class="hr sun" role="listitem">
        <span class="hr-t">${hour(x.t)}</span>${icon(KINDS[x.sun].icon, 'hr-ic')}<b>${x.sun === 'rise' ? 'Lever' : 'Coucher'}</b><small class="hr-p"></small></div>`;
    }
    const { h } = x;
    const isNow = d === 0 && x === first;
    const wx = wmo(h.code);
    const ic = night(x.t + 1800e3) ? (wx.icon === 'w-sun' ? 'w-moon' : wx.icon === 'w-partly' ? 'w-moon-cloud' : wx.icon) : wx.icon;
    return `<div class="hr${isNow ? ' now' : ''}" role="listitem" aria-label="${isNow ? 'Maintenant' : hour(h.time)} : ${wx.label}, ${num(h.t, '°')}${h.precip ? `, ${num(h.precip)} mm` : ''}">
      <span class="hr-t">${isNow ? 'Maint.' : `${new Date(h.time).getHours()} h`}</span>${icon(ic, 'hr-ic')}<b>${int(h.t, '°')}</b>
      <small class="hr-p">${h.precip >= 0.1 ? num(h.precip) : ''}</small></div>`;
  }).join('');
  return `<div class="hourly" role="list" aria-label="Heure par heure">${cells}</div>
    <p class="hr-note">${icon('drop')}Pluie en mm par heure</p>`;
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

// Trois niveaux de couverture, nommés : plus lisibles que des tranches de pourcentage.
// Une même teinte lavande, du plus clair (quelques nuages) au plus foncé (couvert) ; éclaircie sur le fond de nuit.
const CLOUD_LEVELS = [[80, 'Couvert'], [50, 'Nuageux'], [20, 'Quelques nuages']];
const CLOUD_PALETTES = {
  dark: [[80, 'rgb(236,232,248)'], [50, 'rgb(176,168,214)'], [20, 'rgb(120,112,170)']],
  light: [[80, 'rgb(85,80,144)'], [50, 'rgb(138,130,191)'], [20, 'rgb(185,176,219)']],
};
const cloudBins = () => CLOUD_PALETTES[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
const cloudColor = (cc) => cloudBins().find(([min]) => cc >= min)?.[1] ?? null;
const cloudWord = (cc) => CLOUD_LEVELS.find(([min]) => cc >= min)?.[1] ?? null; // libellés de la légende

// Altitudes : les basses couches (là où se forment les mers de nuages) occupent l'essentiel de la hauteur.
const Z_TICKS = [0, 500, 1000, 1500, 2000, 3000, 6000, 12000];

// Flou par boîtes répétées (proche d'un flou gaussien) sur un champ W × H.
function blurField(f, W, H, r, passes = 3) {
  const tmp = new Float32Array(f.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) acc += f[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += f[row + Math.min(W - 1, x + r + 1)] - f[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        f[y * W + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
  }
}

// Image de la coupe : couverture interpolée en temps et en altitude, floutée pour arrondir les angles.
// Contour net (anticrénelé selon la pente du champ, ~1 px), intérieur en fondu entre les niveaux,
// calculé sur une copie plus floutée. Les colonnes couvrent [tStart, tEnd] (ms).
function cloudRaster(hours, ground, zAtRow, w, h, tStart, tEnd) {
  const k = Math.min(3, Math.max(2, devicePixelRatio || 2));
  const W = Math.round(w * k), H = Math.round(h * k);
  const n = hours.length;
  const h0 = new Date(hours[0].time).getTime();
  const rows = Array.from({ length: H }, (_, py) => zAtRow((py + 0.5) / k));
  const grid = hours.map((hr) => rows.map((z) => (z < ground ? 0 : ccAt(hr.levels, z) ?? 0)));
  const field = new Float32Array(W * H);
  for (let px = 0; px < W; px++) {
    const time = tStart + ((px + 0.5) / W) * (tEnd - tStart);
    const t = Math.max(0, Math.min(n - 1, (time - h0) / 3600e3 - 0.5));
    const i0 = Math.floor(t), i1 = Math.min(n - 1, i0 + 1), f = t - i0;
    for (let py = 0; py < H; py++) field[py * W + px] = grid[i0][py] + (grid[i1][py] - grid[i0][py]) * f;
  }
  blurField(field, W, H, Math.round(3 * k));
  const tone = field.slice();
  blurField(tone, W, H, Math.round(4 * k));

  const pal = cloudBins().map(([, c]) => c.match(/\d+/g).map(Number)); // couvert, nuageux, quelques
  const [over, cloudy, few] = pal;
  const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const mix = (c1, c2, u) => [0, 1, 2].map((i) => c1[i] + (c2[i] - c1[i]) * u);
  const EDGE = 20, AA = 0.9 * k; // seuil du contour, largeur de l'anticrénelage (px image)

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const gy = rows.findIndex((z) => z < ground);
  for (let py = 0; py < H; py++) {
    if (gy >= 0 && py >= gy) break;
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const v = field[i];
      if (v < EDGE - 12) continue;
      // Distance au contour ≈ écart au seuil / pente locale : bord de largeur constante.
      const gx = (field[i + (px < W - 1 ? 1 : 0)] - field[i - (px > 0 ? 1 : 0)]) / 2;
      const gyv = (field[i + (py < H - 1 ? W : 0)] - field[i - (py > 0 ? W : 0)]) / 2;
      const alpha = Math.min(1, Math.max(0, 0.5 + (v - EDGE) / (Math.hypot(gx, gyv) * AA + 1e-3)));
      if (alpha <= 0) continue;
      const t = Math.max(tone[i], v * 0.85);
      let c = mix(few, cloudy, smooth(34, 64, t));
      c = mix(c, over, smooth(64, 94, t));
      const o = i * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}

const dayHead = (d) => (d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain'
  : `${cap(fmtWeekday.format(new Date(state.result.sunrise[d])))} ${new Date(state.result.sunrise[d]).getDate()}`);

// Vues du graphique : la journée choisie, ou zoom sur le lever / le coucher.
const CLOUD_VIEWS = { day: ['Toute la journée', 'sky'], rise: ['Autour du lever', 'sunrise'], set: ['Autour du coucher', 'sunset'] };
// Vallée du graphique : celle choisie pour ce lieu (liste `chart` de la config), sinon la vallée du meilleur moment.
function cloudValley(s, d) {
  const want = s.chart?.length
    ? (s.chart.includes(state.chartValley[s.id]) ? state.chartValley[s.id] : s.chart[0])
    : dayBest(s.id, d)?.ref?.valley ?? s.valleys[0];
  // Vallée pas encore dans les prévisions en cache (ajoutée récemment) : une autre vallée du lieu en attendant.
  if (state.data?.raw?.[want]) return want;
  return [...(s.chart ?? []), ...s.valleys].find((k) => state.data?.raw?.[k]) ?? want;
}

function cloudCard(s, d, valleyKey = cloudValley(s, d)) {
  const r = state.result;
  const view = CLOUD_VIEWS[state.cloudView] ? state.cloudView : 'day';
  state.sections[valleyKey] ??= cloudSection(state.data, valleyKey, state.model);
  const all = state.sections[valleyKey];
  if (!all.length) return ''; // vallée absente des prévisions en cache
  const H1 = 3600e3;
  const sr = new Date(r.sunrise[d]).getTime(), ss = new Date(r.sunset[d]).getTime();

  let tStart, tEnd;
  if (view === 'day') {
    tStart = new Date(`${r.sunrise[d].slice(0, 10)}T00:00`).getTime();
    tEnd = tStart + 24 * H1;
  } else {
    [tStart, tEnd] = view === 'rise' ? [sr - 5 * H1, sr + 4 * H1] : [ss - 4 * H1, ss + 5 * H1];
  }
  const within = (h) => { const t = new Date(h.time).getTime(); return t >= tStart - H1 && t < tEnd + H1; };
  const hours = all.filter(within);
  const rain = weatherFor(s.id).hourly.filter(within);
  if (hours.length < 4) return '';

  // Mise en page : heures du soleil, bande jour/nuit, coupe, pluie, heures.
  const W = 320, x0 = 34, x1 = W - 4;
  const sunY = 11, barY = 17, barH = 6;
  const top = 32, bottom = 228;
  const rainTop = 236, rainB = 252;
  const H = 268;
  const xt = (t) => x0 + ((new Date(t).getTime() - tStart) / (tEnd - tStart)) * (x1 - x0);
  const ticks = Z_TICKS;
  const seg = (bottom - top) / (ticks.length - 1);
  const y = (z) => {
    const zc = Math.max(0, Math.min(z, ticks.at(-1)));
    let k = 1;
    while (k < ticks.length - 1 && zc > ticks[k]) k++;
    return bottom - (k - 1 + (zc - ticks[k - 1]) / (ticks[k] - ticks[k - 1])) * seg;
  };
  const zAt = (py) => {
    const u = (bottom - py) / seg;
    const k = Math.min(ticks.length - 2, Math.max(0, Math.floor(u)));
    return ticks[k] + (u - k) * (ticks[k + 1] - ticks[k]);
  };
  const ground = hours[0].ground;
  const gy = y(ground);
  const f = (v) => v.toFixed(1);
  const clampX = (x) => Math.max(x0, Math.min(x1, x));
  const days = r.sunrise.map((_, i) => i).filter((i) => {
    const m = new Date(`${r.sunrise[i].slice(0, 10)}T00:00`).getTime();
    return m < tEnd && m + 24 * H1 > tStart;
  });

  let g = `<svg class="cs" viewBox="0 0 ${W} ${H}" role="img" aria-label="Nuages par altitude au-dessus de ${valleyTown(valleyKey)}">
    <defs>
      <linearGradient id="cs-dawn" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ff9f6a"/><stop offset=".25" stop-color="#ffd36b"/>
        <stop offset=".75" stop-color="#ffd36b"/><stop offset="1" stop-color="#ff9f6a"/>
      </linearGradient>
      <clipPath id="cs-plot"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bottom - top}" rx="8"/></clipPath>
      <clipPath id="cs-bar"><rect x="${x0}" y="${barY}" width="${x1 - x0}" height="${barH}" rx="${barH / 2}"/></clipPath>
    </defs>`;

  // Coupe : fond nuit / jour, nuages, sol, graduations, lever et coucher.
  g += `<g clip-path="url(#cs-plot)"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bottom - top}" class="cs-night"/>`;
  for (const i of days) {
    const [a, b] = [clampX(xt(r.sunrise[i])), clampX(xt(r.sunset[i]))];
    if (b > a) g += `<rect x="${f(a)}" y="${top}" width="${f(b - a)}" height="${bottom - top}" class="cs-day"/>`;
  }
  g += `<image x="${x0}" y="${top}" width="${x1 - x0}" height="${f(gy - top)}" preserveAspectRatio="none"
    href="${cloudRaster(hours, ground, (py) => zAt(top + py), x1 - x0, gy - top, tStart, tEnd)}"/>`;
  g += `<rect x="${x0}" y="${f(gy)}" width="${x1 - x0}" height="${f(bottom - gy)}" class="cs-ground"/>`;
  for (const z of ticks.slice(1)) g += `<line x1="${x0}" x2="${x1}" y1="${f(y(z))}" y2="${f(y(z))}" class="cs-grid${z === 3000 ? ' strong' : ''}"/>`;
  for (const t of [sr, ss]) {
    const x = xt(t);
    if (x > x0 && x < x1) g += `<line x1="${f(x)}" x2="${f(x)}" y1="${top}" y2="${bottom}" class="cs-sunline"/>`;
  }
  g += '</g>';

  // Altitudes (km) et repère du sommet sur l'axe.
  for (const z of ticks.slice(1)) g += `<text x="${x0 - 6}" y="${f(y(z) + 3.5)}" class="cs-lbl end">${num(z / 1000)}</text>`;
  g += `<text x="${x0 - 6}" y="${top - 6}" class="cs-lbl end unit">km</text>`;
  const sy = y(s.alt);
  g += `<path d="M${x0 - 1} ${f(sy)} l-6 -4 v8 Z" class="cs-summit-mark"/>
    <line x1="${x0}" x2="${x1}" y1="${f(sy)}" y2="${f(sy)}" class="cs-summit"/>`;

  // Bande jour/nuit et heures du soleil.
  g += `<g clip-path="url(#cs-bar)"><rect x="${x0}" y="${barY}" width="${x1 - x0}" height="${barH}" class="cs-bar-night"/>`;
  for (const i of days) {
    const sx = xt(r.sunrise[i]), ex = xt(r.sunset[i]);
    if (ex > x0 && sx < x1) g += `<rect x="${f(sx)}" y="${barY}" width="${f(ex - sx)}" height="${barH}" rx="${barH / 2}" fill="url(#cs-dawn)"/>`;
  }
  g += '</g>';
  for (const [t, label] of [[sr, 'lever'], [ss, 'coucher']]) {
    const x = xt(t);
    if (x < x0 || x > x1) continue;
    const anchor = x < x0 + 30 ? 'start' : x > x1 - 30 ? 'end' : 'middle';
    g += `<text x="${f(x)}" y="${sunY}" class="cs-sun-lbl" text-anchor="${anchor}">${hour(t)}</text>`;
    g += `<circle cx="${f(x)}" cy="${barY + barH / 2}" r="4" class="cs-sun-dot"><title>${label}</title></circle>`;
  }

  // Maintenant.
  const nx = xt(Date.now());
  if (nx > x0 && nx < x1) g += `<line x1="${f(nx)}" x2="${f(nx)}" y1="${top}" y2="${rainB}" class="cs-now"/>`;

  // Pluie au lieu, une barre par heure.
  const inRange = rain.filter((h) => { const t = new Date(h.time).getTime(); return t + H1 > tStart && t < tEnd; });
  const pMax = Math.max(2, ...inRange.map((h) => h.precip ?? 0));
  g += `<text x="${x0 - 6}" y="${rainB - 2}" class="cs-lbl end unit">mm</text>`;
  inRange.forEach((h) => {
    if (!h.precip) return;
    const t = new Date(h.time).getTime();
    const [a, b] = [clampX(xt(t + 0.1 * H1)), clampX(xt(t + 0.9 * H1))];
    const bh = Math.max(1.5, (h.precip / pMax) * (rainB - rainTop));
    if (b > a) g += `<rect x="${f(a)}" y="${f(rainB - bh)}" width="${f(b - a)}" height="${f(bh)}" rx="1.5" class="cs-rain"/>`;
  });
  g += `<line x1="${x0}" x2="${x1}" y1="${rainB}" y2="${rainB}" class="cs-axis"/>`;

  // Heures : toutes les 3 h sur la journée, toutes les 2 h en zoom.
  const every = view === 'day' ? 3 : 2;
  for (let t = Math.ceil(tStart / H1) * H1; t <= tEnd; t += H1) {
    const hh = new Date(t).getHours();
    if (hh % every) continue;
    const x = xt(t);
    if (x < x0 + 6 || x > x1 - 6) continue;
    g += `<line x1="${f(x)}" x2="${f(x)}" y1="${rainB}" y2="${rainB + 3}" class="cs-axis"/>
      <text x="${f(x)}" y="${H - 3}" class="cs-lbl">${hh} h</text>`;
  }

  g += '</svg>';

  const when = view === 'day' ? `${dayLabel(d)}, toute la journée` : `${dayLabel(d)}, autour du ${view === 'rise' ? 'lever' : 'coucher'}`;
  const valleyCtl = s.chart?.length > 1
    ? `<label class="vsel glass">
        <select data-chartvalley-select aria-label="Vallée du graphique">${s.chart.map((k) => `<option value="${k}"${k === valleyKey ? ' selected' : ''}>${valleyTown(k)}</option>`).join('')}</select>
        ${icon('updown')}
      </label>`
    : `<span class="vsel solo glass">${valleyTown(valleyKey)}</span>`;
  return `<div class="card clouds">
    ${cardHead('layers', 'Nuages par altitude')}
    <p class="cs-sub">${when} · vallée à ${Math.round(ground)} m</p>
    <div class="cs-controls">
      <div class="gpill" role="tablist" aria-label="Période du graphique">${gpillThumb(Object.keys(CLOUD_VIEWS).indexOf(view))}
        ${Object.entries(CLOUD_VIEWS).map(([k, [label, ic]]) => `<button role="tab" data-cloudview="${k}" aria-selected="${k === view}" aria-label="${label}" title="${label}">${icon(ic)}</button>`).join('')}
      </div>
      ${valleyCtl}
    </div>
    ${g}
    <div class="cs-legend">
      ${scaleLegend(cloudBins().slice().reverse().map(([min, col]) => [null, cloudWord(min), col]),
        'Couverture nuageuse, du plus clair au plus foncé : quelques nuages, nuageux, couvert')}
      <div class="cs-keys"><span><i class="k-summit"></i>Sommet ${s.alt} m</span><span><i class="k-rain"></i>Pluie</span></div>
    </div>
  </div>`;
}

function setChartValley(k) {
  const s = siteById(state.site);
  if (!s?.chart?.includes(k) || cloudValley(s, state.day) === k) return;
  state.chartValley[s.id] = k;
  store.set('mdn-chart-valley', JSON.stringify(state.chartValley));
  refreshCloudCard();
}

function setCloudView(view) {
  if (view === state.cloudView) return;
  const from = Object.keys(CLOUD_VIEWS).indexOf(state.cloudView);
  state.cloudView = view;
  store.set('mdn-cloud-view', view);
  refreshCloudCard(from);
}

function refreshCloudCard(from = -1) {
  const card = $('#detail .card.clouds');
  if (!card) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = cloudCard(siteById(state.site), state.day);
  const next = tmp.firstElementChild;
  card.replaceWith(next);
  slideThumb(next, from);
  replay([$('svg.cs', next)], 'swap');
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
      state.sceneKind = null;
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
  const box = $('#d-day');
  box?.style.setProperty('--dx', `${d > state.day ? 28 : -28}px`);
  clearTimeout(selectDay.t);
  selectDay.t = setTimeout(() => box?.style.removeProperty('--dx'), 700);
  state.day = d;
  state.sceneKind = null;
  history.replaceState(history.state, '', `#/lieu/${state.site}/${d}`);
  $$('.segmented .seg').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.day) === d)));
  $('.seg-thumb')?.style.setProperty('--k', detailDays().indexOf(d));
  renderDay();
}

// Délégation des clics.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action], [data-site], [data-day], [data-cam], [data-model], [data-cloudview], [data-theme-pref], [data-scene], [data-chartvalley]');
  if (!t) return;
  if (t.dataset.cam) return openCam(WEBCAMS.find((c) => c.id === Number(t.dataset.cam)));
  if (t.dataset.model) return setModel(t.dataset.model);
  if (t.dataset.themePref) return setThemePref(t.dataset.themePref);
  if (t.dataset.scene) return setSceneKind(t.dataset.scene);
  if (t.dataset.chartvalley) return setChartValley(t.dataset.chartvalley);
  if (t.dataset.cloudview) return setCloudView(t.dataset.cloudview);
  if (t.dataset.site) return openSite(t.dataset.site, Number(t.dataset.day));
  if (t.dataset.day && t.closest('.segmented')) return selectDay(Number(t.dataset.day));
  switch (t.dataset.action) {
    case 'back': return goBack();
    case 'settings': return openSettings();
    case 'help-days': return openSheet('Lire les cases', `<p class="help-body">${DAYS_NOTE}</p>`);
    case 'close-sheet': return closeSheet();
    case 'refresh': closeSheet(); return load(true);
    case 'refresh-in-sheet': load(true); return updateRefreshRow();
    default:
  }
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-chartvalley-select]');
  if (sel) setChartValley(sel.value);
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

// Tirer pour actualiser (rebond natif d'iOS) : l'indicateur se place dans l'espace qui s'ouvre
// au-dessus du grand titre, ses rayons apparaissent un à un, puis il tourne quand on peut relâcher.
let ptrArmed = false;
const PTR_PULL = 90;
function pullToRefresh(y) {
  const ptr = $('#home .ptr');
  const pull = Math.max(0, -y);
  if (state.loading || pull === 0) {
    ptr.style.opacity = 0;
    ptr.classList.remove('armed');
    ptrArmed = false;
    return;
  }
  const k = Math.min(1, pull / PTR_PULL);
  ptr.style.opacity = Math.min(1, pull / 30);
  ptr.style.transform = `translateY(${(pull / 2).toFixed(1)}px)`;
  ptr.style.setProperty('--shown', Math.ceil(k * 8));
  $$('line', ptr).forEach((l, i) => l.classList.toggle('on', i < Math.ceil(k * 8)));
  ptrArmed = k >= 1;
  ptr.classList.toggle('armed', ptrArmed);
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

// Réglages : listes groupées façon iOS, icône colorée en tête de ligne, aperçus pour le thème.
const MODEL_ICONS = { consensus: ['scale', '#5f5a92'], icon_seamless: ['w-cloud', '#6f8fc9'], meteofrance_seamless: ['mountain', '#e98a7e'] };
const tile = (ic, color) => `<span class="tile-ic" style="--tile:${color}">${icon(ic)}</span>`;

function themePreview(k) {
  const part = (t) => `<span class="tp-screen ${t}"><i class="tp-title"></i><i class="tp-card"></i><i class="tp-card short"></i></span>`;
  return `<span class="tp-phone${k === 'auto' ? ' auto' : ''}">${k === 'auto' ? part('light') + part('dark') : part(k)}</span>`;
}

function refreshDetail() {
  if (state.loading) return `${spinner('inline')}En cours`;
  return state.data ? hour(state.data.at) : '–';
}
function updateRefreshRow() {
  const el = $('#sheet .refresh-detail');
  if (el) el.innerHTML = refreshDetail();
}

function openSettings() {
  openSheet('Réglages', `
    <p class="group-label">Apparence</p>
    <div class="group themes" role="radiogroup" aria-label="Apparence">
      ${Object.keys(THEMES).map((k) => `
        <button class="theme-opt" role="radio" data-theme-pref="${k}" aria-checked="${k === state.themePref}">
          ${themePreview(k)}
          <span class="theme-name">${THEMES[k][0]}</span>
          <span class="radio" aria-hidden="true">${icon('check')}</span>
        </button>`).join('')}
    </div>

    <p class="group-label">Modèle météo</p>
    <div class="group" role="radiogroup" aria-label="Modèle météo">${Object.keys(MODELS).map((k) => `
      <button class="row tap" role="radio" data-model="${k}" aria-checked="${k === state.model}">
        ${tile(...MODEL_ICONS[k])}
        <span class="row-text"><b>${MODEL_INFO[k][0]}</b><small>${MODEL_INFO[k][1]}</small></span>
        ${icon('check', 'row-check')}
      </button>`).join('')}
    </div>
    <p class="group-foot">Le consensus fait la moyenne des deux modèles. Au-delà de 4 jours, seul ICON est disponible.</p>

    <p class="group-label">Données</p>
    <div class="group">
      <label class="row">
        ${tile('camera', '#f4a26b')}
        <span class="row-text"><b>Webcams de jour</b><small>Dernière image prise en journée</small></span>
        <input type="checkbox" class="switch" id="opt-daylight" ${state.daylight ? 'checked' : ''}>
      </label>
      <button class="row tap" data-action="refresh-in-sheet">
        ${tile('refresh', '#6fb08c')}
        <span class="row-text"><b>Actualiser les prévisions</b></span>
        <span class="row-detail refresh-detail">${refreshDetail()}</span>
      </button>
    </div>

    <p class="group-label">À propos</p>
    <div class="group">
      <details class="row-details">
        <summary class="row">
          ${tile('info', '#8e88b8')}
          <span class="row-text"><b>Comment l’indice est calculé</b></span>
          ${icon('chevron', 'row-chev')}
        </summary>
        <div class="details-body">
          <p>Chance de voir une mer de nuages, de 0 à 100, au meilleur moment autour du lever (de 1 h avant à 2 h après)
            et du coucher du soleil (de 2 h avant à 1 h après).</p>
          <p>Elle combine cinq facteurs tirés des profils verticaux des modèles : nuages bas en vallée sous le sommet,
            sommet hors du nuage, ciel dégagé au-dessus, inversion de température et vent faible.</p>
        </div>
      </details>
    </div>
    <p class="credits">Prévisions <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> ·
      webcams <a href="https://www.windy.com/webcams" target="_blank" rel="noopener">Windy</a></p>`, 'settings');
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

function setThemePref(k) {
  if (k === state.themePref || !THEMES[k]) return;
  state.themePref = k;
  store.set('mdn-theme', k);
  $$('#sheet [data-theme-pref]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themePref === k)));
  applyTheme();
}

function setModel(k) {
  if (k === state.model) return;
  state.model = k;
  store.set('mdn-model', k);
  $$('#sheet [data-model]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.model === k)));
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
  // Pas encore de prévisions à l'écran : on affiche tout de suite les dernières connues, puis on actualise.
  if (!state.result) {
    const old = staleCache();
    if (old) {
      state.data = old;
      compute();
      renderHome(true);
      if (onDetail) renderDetail(true);
    }
  }
  setStatus(state.result ? 'Actualisation…' : 'Chargement des prévisions…', true);
  const ptr = $('#home .ptr');
  ptr.style.opacity = 0;
  ptr.classList.remove('armed');
  if (!state.result) { renderHome(); if (onDetail) renderDetail(); }
  try {
    const shownAt = state.result ? state.data?.at : null;
    state.data = await fetchForecast({ force });
    setStatus(`Vosges du Nord · prévisions de ${hour(state.data.at)}${state.data.stale ? ' (service indisponible, anciennes données)' : ''}`);
    if (state.data.at === shownAt) return; // ces prévisions sont déjà à l'écran
    const first = !state.result;
    compute();
    renderHome(first || force);
    if (onDetail) renderDetail(first || force);
  } catch (e) {
    console.error(e);
    state.error = e.message;
    setStatus(state.data ? `Vosges du Nord · prévisions de ${hour(state.data.at)}` : 'Prévisions indisponibles');
    if (!state.result) { renderHome(); if (onDetail) renderDetail(); }
  } finally {
    state.loading = false;
    document.body.classList.remove('loading');
    updateRefreshRow();
  }
}

// Sous-titre de l'accueil : date des prévisions, ou chargement en cours avec l'indicateur.
function setStatus(text, busy = false) {
  const el = $('#updated');
  el.classList.toggle('busy', busy);
  el.innerHTML = busy ? `${spinner('inline')}<span>${text}</span>` : `<span>${text}</span>`;
}

// Revenir dans l'application : recharge si les prévisions ont plus de 30 min.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.data && Date.now() - state.data.at > 30 * 60e3) load();
});

$$('[data-action="settings"].icon-btn').forEach((b) => { b.innerHTML = icon('settings'); });
$('.back-ic').innerHTML = icon('back');
$('.sheet-close').innerHTML = icon('x');
$('#home .ptr').innerHTML = spinner();

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
applyTheme();
route();
requestAnimationFrame(() => document.documentElement.classList.remove('no-anim'));
load();
