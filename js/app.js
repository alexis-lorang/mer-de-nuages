import {
  SITES, VALLEYS, WEBCAMS, MODELS,
  webcamImage, webcamPlayer, meteobluePage,
} from './config.js';
import {
  fetchForecast, computeAll, morningWindow, eveningWindow, bestInWindow, scoreClass, nowIndex,
  siteWeather, MORNING, EVENING,
} from './forecast.js?v=3';
import { icon } from './icons.js?v=3';
import { scene } from './scene.js?v=3';

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
function eventLabel(d, kind) {
  const part = kind === 'rise' ? 'matin' : 'soir';
  if (d === 0) return `Ce ${part}`;
  if (d === 1) return `Demain ${part}`;
  return `${cap(fmtWeekdayLong.format(new Date(state.result.sunrise[d])))} ${part}`;
}
const valleyName = (k) => VALLEYS[k].name.replace(/\s*\(.*\)/, '');

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
  const next = upcoming().slice(0, 2);

  // Meilleure occasion à venir, tous lieux confondus.
  let top = null;
  for (const s of SITES) {
    for (const ev of upcoming()) {
      const b = moment(s.id, ev.d, ev.kind);
      if (b && (!top || b.score > top.b.score)) top = { s, ev, b };
    }
  }

  const hero = top && top.b.score >= 20 ? (() => {
    const c = scoreClass(top.b.score);
    const k = KINDS[top.ev.kind];
    return `<button class="card hero tap" data-site="${top.s.id}" data-day="${top.ev.d}">
      <div class="hero-scene">${scene(top.s, top.b.ref, c.key, { W: 360, H: 140, labels: false })}</div>
      <div class="hero-info">
        <p class="eyebrow">Meilleure chance</p>
        <div class="hero-row">
          <div class="hero-text">
            <h2 class="hero-site">${top.s.name}</h2>
            <p class="hero-meta">${icon(k.icon)}${eventLabel(top.ev.d, top.ev.kind)} · ${k.label.toLowerCase()} ${hour(k.at(r, top.ev.d))}</p>
            <p class="hero-verdict ${c.key}">${c.label}</p>
          </div>
          ${ring(top.b.score, c.key, 64)}
        </div>
      </div>
    </button>`;
  })() : `<div class="card hero">
      <div class="hero-scene">${scene(SITES[0], null, 'low', { W: 360, H: 140, labels: false })}</div>
      <div class="hero-info">
        <p class="eyebrow">5 prochains jours</p>
        <h2 class="hero-site">Pas de mer de nuages en vue</h2>
        <p class="hero-meta">Aucune couche basse prévue sous les sommets.</p>
      </div>
    </div>`;

  const rows = SITES.map((s) => {
    const vals = next.map((ev) => {
      const b = moment(s.id, ev.d, ev.kind);
      const c = scoreClass(b?.score);
      return `<span class="rs-val ${c.key}"><b data-count="${b?.score ?? ''}">${b?.score ?? '–'}</b><small>${c.label}</small></span>`;
    }).join('');
    const summary = next.map((ev) => `${eventLabel(ev.d, ev.kind)} ${moment(s.id, ev.d, ev.kind)?.score ?? '–'}`).join(', ');
    return `<button class="row-site tap" data-site="${s.id}" data-day="${next[0]?.d ?? 0}" aria-label="${s.name}, ${summary}">
      <span class="rs-name"><b>${s.name}</b><small>${s.alt} m</small></span>
      ${vals}
      ${icon('chevron', 'chev')}
    </button>`;
  }).join('');

  body.innerHTML = `
    ${hero}
    <section class="section">
      <div class="section-head list-head">
        <h2>Lieux</h2>
        ${next.map((ev) => `<span class="col-lbl">${icon(KINDS[ev.kind].icon)}${eventLabel(ev.d, ev.kind)}</span>`).join('')}
        <span></span>
      </div>
      <div class="card list">${rows}</div>
      <p class="footnote">Chance de mer de nuages, de 0 à 100, au meilleur moment autour du lever et du coucher du soleil.</p>
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
  $('#detail-nav-title').textContent = s.name;
  const body = $('#detail-body');
  const head = `<div class="large-title"><h1 tabindex="-1">${s.name}</h1><p class="subtitle">${s.alt} m d’altitude</p></div>`;

  if (!state.result) {
    setGlow('low', true);
    body.innerHTML = `${head}${state.error ? errorCard() : '<div class="card skel tall shimmer"></div><div class="card skel tall shimmer"></div>'}`;
    return;
  }
  const r = state.result;
  if (state.day == null || state.day >= r.sunrise.length) state.day = upcoming()[0]?.d ?? 0;

  const picker = r.sunrise.map((_, d) => {
    const b = dayBest(s.id, d);
    const c = scoreClass(b?.score);
    return `<button class="seg tap ${c.key}" role="tab" data-day="${d}" aria-selected="${d === state.day}"
        aria-label="${eventLabel(d, 'rise').replace(/ matin$/, '')} : jusqu’à ${b?.score ?? 'pas de données'}">
      <span>${dayShort(d)}</span><b>${b?.score ?? '–'}</b></button>`;
  }).join('');

  body.innerHTML = `
    ${head}
    <div class="segmented" role="tablist" aria-label="Jour" style="--n:${r.sunrise.length}">
      <span class="seg-thumb" style="--k:${state.day}"></span>${picker}
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
    return `<div class="card moment ${mc.key}">
      ${cardHead(k.icon, `${k.label} ${hour(k.at(r, d))}`)}
      <b class="m-score" data-count="${m?.score ?? ''}">${m?.score ?? '–'}</b>
      <p class="m-verdict">${mc.label}</p>
      <p class="m-foot">${m ? `Idéal vers ${hour(m.time)}` : 'Pas de données'}</p>
    </div>`;
  };

  $('#d-day').innerHTML = `
    <div class="moments">${momentCard('rise', rise)}${momentCard('set', set)}</div>
    ${best ? `<div class="card scene-card">
      ${scene(s, best.ref, c.key)}
      <span class="scene-cap">${icon(KINDS[bestKind].icon)}${bestKind === 'rise' ? 'Au lever' : 'Au coucher'}</span>
    </div>` : ''}
    ${compareCard(s, rise, set)}
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
    ${meteogram(hours, state.result.sunrise[d], state.result.sunset[d], d === 0)}
  </div>`;
}

// Météogramme de la journée : nuages, température, pluie, lever et coucher.
function meteogram(hours, sunrise, sunset, today) {
  const W = 320, H = 176;
  const x = (hh) => 8 + (hh / 24) * (W - 16);
  const top = 30, bottom = 140;
  const ts = hours.map((h) => h.t).filter((t) => t != null);
  let tMin = Math.min(...ts), tMax = Math.max(...ts);
  const mid = (tMin + tMax) / 2;
  if (tMax - tMin < 6) { tMin = mid - 3; tMax = mid + 3; }
  const yT = (t) => bottom - 14 - ((t - tMin) / (tMax - tMin)) * (bottom - top - 26);
  const pMax = Math.max(2, ...hours.map((h) => h.precip ?? 0));
  const hh = (t) => { const dt = new Date(t); return dt.getHours() + dt.getMinutes() / 60; };

  const pts = hours.map((h, i) => (h.t == null ? null : [x(i + 0.5), yT(h.t)])).filter(Boolean);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts.at(-1)[0].toFixed(1)} ${bottom} L${pts[0][0].toFixed(1)} ${bottom} Z`;
  const iMax = hours.findIndex((h) => h.t === Math.max(...ts));
  const iMin = hours.findIndex((h) => h.t === Math.min(...ts));
  const cw = (W - 16) / 24;

  let g = `<svg class="mg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Météogramme : température de ${num(Math.min(...ts), '°')} à ${num(Math.max(...ts), '°')}, pluie ${num(hours.reduce((a, h) => a + (h.precip ?? 0), 0))} mm">
    <defs><linearGradient id="mg-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb340" stop-opacity=".35"/><stop offset="1" stop-color="#ffb340" stop-opacity="0"/></linearGradient></defs>`;
  // Nuages : une case par heure, plus opaque quand c'est couvert.
  hours.forEach((h, i) => {
    g += `<rect x="${(x(i) + 0.5).toFixed(1)}" y="4" width="${(cw - 1).toFixed(1)}" height="12" rx="2" class="mg-cloud" style="opacity:${(0.08 + 0.8 * (h.cc ?? 0) / 100).toFixed(2)}"/>`;
  });
  // Lignes de repère toutes les 6 h.
  for (const k of [6, 12, 18]) g += `<line x1="${x(k)}" x2="${x(k)}" y1="22" y2="${bottom}" class="mg-grid"/>`;
  // Pluie.
  hours.forEach((h, i) => {
    if (!h.precip) return;
    const ph = Math.max(2, (h.precip / pMax) * 44);
    g += `<rect x="${(x(i) + 1.5).toFixed(1)}" y="${(bottom - ph).toFixed(1)}" width="${(cw - 3).toFixed(1)}" height="${ph.toFixed(1)}" rx="1.5" class="mg-rain"/>`;
  });
  // Lever et coucher.
  for (const [t, ic] of [[sunrise, 'sunrise'], [sunset, 'sunset']]) {
    const sx = x(hh(t));
    g += `<line x1="${sx}" x2="${sx}" y1="22" y2="${bottom}" class="mg-sun"/>`;
    g += icon(ic, 'mg-ic').replace('<svg ', `<svg x="${(sx - 7).toFixed(1)}" y="20" width="14" height="14" `);
  }
  if (today) {
    const nx = x(hh(Date.now()));
    g += `<line x1="${nx}" x2="${nx}" y1="22" y2="${bottom}" class="mg-now"/>`;
  }
  g += `<path d="${area}" fill="url(#mg-t)"/><path d="${line}" class="mg-temp"/>`;
  for (const [i, below] of [[iMax, false], [iMin, true]]) {
    if (i < 0) continue;
    const [px, py] = [x(i + 0.5), yT(hours[i].t)];
    g += `<circle cx="${px}" cy="${py}" r="3" class="mg-dot"/>
      <text x="${Math.min(W - 14, Math.max(14, px))}" y="${below ? py + 15 : py - 8}" class="mg-val">${num(hours[i].t, '°')}</text>`;
  }
  g += `<line x1="8" x2="${W - 8}" y1="${bottom}" y2="${bottom}" class="mg-axis"/>`;
  for (const k of [0, 6, 12, 18]) g += `<text x="${x(k) + (k ? 0 : 8)}" y="${bottom + 16}" class="mg-lbl">${String(k).padStart(2, '0')} h</text>`;
  g += `<g class="mg-legend" transform="translate(8 ${H - 6})">
    <rect y="-8" width="10" height="8" rx="2" class="mg-cloud" style="opacity:.6"/><text x="14">Nuages</text>
    <line x1="72" x2="84" y1="-4" y2="-4" class="mg-temp"/><text x="88">Température</text>
    <rect x="170" y="-8" width="8" height="8" rx="1.5" class="mg-rain"/><text x="182">Pluie (max ${num(pMax)} mm/h)</text></g>`;
  return `${g}</svg>`;
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
      detail.classList.remove('scrolled');
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
  $('.seg-thumb')?.style.setProperty('--k', d);
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

// Barre de navigation compacte au défilement, grand titre élastique.
for (const page of $$('.page')) {
  const sc = $('.scroller', page);
  sc.addEventListener('scroll', () => {
    const y = sc.scrollTop;
    page.classList.toggle('scrolled', y > 44);
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

document.documentElement.classList.add('no-anim');
route();
requestAnimationFrame(() => document.documentElement.classList.remove('no-anim'));
load();
