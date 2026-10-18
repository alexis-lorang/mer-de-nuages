import {
  SITES, VALLEYS, WEBCAMS, MODELS,
  webcamImage, webcamPlayer, meteobluePage,
} from './config.js';
import { fetchForecast, computeAll, morningWindow, bestInWindow, scoreClass, nowIndex } from './forecast.js';
import { icon } from './icons.js';
import { scene } from './scene.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const fmtLongDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric' });
const fmtHour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const num = (x, unit = '') => (x == null ? '–' : `${x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${unit}`);
const signed = (x, unit = '') => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x), unit)}`);
const hour = (t) => fmtHour.format(new Date(t));

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const state = {
  data: null,
  result: null,
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

// ---------- Données ----------

const siteById = (id) => SITES.find((s) => s.id === id);

function siteDayBest(siteId, day) {
  const r = state.result;
  return bestInWindow(r.sites[siteId], morningWindow(r, day));
}

// Prochain matin utile : aujourd'hui tant que la fenêtre du lever n'est pas passée.
function nextMorning() {
  const now = Date.now();
  const d = state.result.sunrise.findIndex((sr) => new Date(sr).getTime() + 2 * 3600e3 > now);
  return d < 0 ? 0 : d;
}

const dayShort = (d) => (d === 0 ? 'Auj.' : d === 1 ? 'Dem.' : cap(fmtWeekday.format(new Date(state.result.sunrise[d]))));
const dayLabel = (d) => (d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : cap(fmtLongDay.format(new Date(state.result.sunrise[d]))));
const morningLabel = (d) => (d === 0 ? 'Ce matin' : d === 1 ? 'Demain matin' : `${dayLabel(d)} matin`);
const valleyTown = (k) => (VALLEYS[k].name.match(/\((.*)\)/)?.[1] ?? VALLEYS[k].name);
const valleyName = (k) => VALLEYS[k].name.replace(/\s*\(.*\)/, '');

function inCloud(s, d) {
  return d?.top != null && d.seaCC >= 25 && (d.top > s.alt + 20 || d.summitCC >= 50);
}

function layerNote(s, d) {
  if (!d || d.top == null || d.seaCC < 25) return 'pas de nuages bas';
  if (inCloud(s, d)) return 'sommet dans le nuage';
  return `nuages ≈ ${d.top} m`;
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

const sectionHead = (ic, title) => `<div class="card-head">${icon(ic)}<span>${title}</span></div>`;

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
    body.innerHTML = state.error ? errorCard() : skeleton();
    return;
  }
  const r = state.result;
  const nm = nextMorning();

  // Meilleur couple site / matin sur les 5 jours.
  let top = null;
  for (const s of SITES) {
    r.sunrise.forEach((_, d) => {
      const b = siteDayBest(s.id, d);
      if (b && (!top || b.score > top.b.score || (b.score === top.b.score && d < top.d))) top = { s, d, b };
    });
  }

  const hero = top && top.b.score >= 20 ? (() => {
    const c = scoreClass(top.b.score);
    return `<button class="card hero tap" data-site="${top.s.id}" data-day="${top.d}">
      <div class="hero-scene">${scene(top.s, top.b.ref, c.key, { W: 360, H: 150, labels: false })}</div>
      <div class="hero-info">
        <div class="eyebrow">${icon('star')}Meilleure chance · ${morningLabel(top.d)}</div>
        <div class="hero-row">
          <div class="hero-text">
            <div class="hero-site">${top.s.name}</div>
            <div class="hero-meta">Mer de nuages ${c.label.toLowerCase()}</div>
            <div class="hero-meta dim">${icon('sunrise')}Lever ${hour(r.sunrise[top.d])} · ${layerNote(top.s, top.b.ref)}</div>
          </div>
          ${ring(top.b.score, c.key, 68)}
        </div>
      </div>
    </button>`;
  })() : `<div class="card hero empty">
      <div class="hero-scene">${scene(SITES[0], null, 'low', { W: 360, H: 150, labels: false })}</div>
      <div class="hero-info">
        <div class="eyebrow">${icon('cloud')}5 prochains matins</div>
        <div class="hero-site">Pas de mer de nuages en vue</div>
        <div class="hero-meta dim">Les modèles ne prévoient pas de couche basse sous les sommets.</div>
      </div>
    </div>`;

  const sites = SITES.map((s) => {
    const b = siteDayBest(s.id, nm);
    const c = scoreClass(b?.score);
    const days = r.sunrise.map((_, d) => {
      const bd = siteDayBest(s.id, d);
      const cd = scoreClass(bd?.score);
      return `<button class="day tap ${cd.key}${d === nm ? ' next' : ''}" data-site="${s.id}" data-day="${d}"
          aria-label="${s.name}, ${dayLabel(d)} : ${bd?.score ?? 'pas de données'}, ${cd.label}">
        <span class="day-lbl">${dayShort(d)}</span>
        <span class="capsule"><i style="--v:${Math.max(0.07, (bd?.score ?? 0) / 100)};--j:${d}"></i></span>
        <span class="day-val">${bd?.score ?? '–'}</span>
      </button>`;
    }).join('');
    return `<article class="card site">
      <button class="site-head tap" data-site="${s.id}" data-day="${nm}" aria-label="${s.name} : ${c.label}, voir le détail">
        <span class="site-title">
          <b>${s.name}</b>
          <small>${s.alt} m · ${layerNote(s, b?.ref)}</small>
        </span>
        <span class="site-score ${c.key}">
          <b data-count="${b?.score ?? ''}">${b?.score ?? '–'}</b>
          <small>${c.label}</small>
        </span>
        ${icon('chevron', 'chev')}
      </button>
      <div class="days">${days}</div>
    </article>`;
  }).join('');

  body.innerHTML = `
    ${hero}
    <h2 class="section-title">Lieux <span>indice au lever, 0–100</span></h2>
    ${sites}
    <div class="legend" aria-label="Légende">
      ${['low', 'maybe', 'good', 'top'].map((k) => `<span class="${k}"><i></i>${scoreClass({ low: 0, maybe: 20, good: 40, top: 65 }[k]).label}</span>`).join('')}
    </div>
    <h2 class="section-title">Webcams <span>toucher pour le timelapse</span></h2>
    <div class="cam-strip">${WEBCAMS.map((c) => camTile(c)).join('')}</div>
    <footer class="foot">
      Indice calculé à partir des profils verticaux des modèles ICON et AROME/ARPEGE
      (<a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>) :
      nuages bas en vallée sous le sommet, sommet hors du nuage, ciel dégagé au-dessus, inversion, vent faible.
      Webcams <a href="https://www.windy.com/webcams" target="_blank" rel="noopener">Windy</a>.
    </footer>`;
  animateIn(body, enter);
}

function skeleton() {
  return `<div class="card hero skel"><div class="hero-scene shimmer"></div><div class="hero-info"><i class="sk w60"></i><i class="sk w40"></i></div></div>
    <h2 class="section-title">Lieux</h2>
    ${SITES.map(() => '<div class="card site skel"><div class="site-head"><span class="site-title"><i class="sk w50"></i><i class="sk w30"></i></span></div><div class="days shimmer-row"></div></div>').join('')}`;
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

function setSky(page, cls, instant = false) {
  const k = cls === 'na' ? 'low' : cls;
  $$('.sky-layer', page).forEach((l) => {
    if (instant) l.style.transition = 'none';
    l.classList.toggle('on', l.dataset.sky === k);
  });
  if (instant) requestAnimationFrame(() => $$('.sky-layer', page).forEach((l) => { l.style.transition = ''; }));
}

function renderDetail(enter = false) {
  const s = siteById(state.site);
  const page = $('#detail');
  $('#detail-nav-title').textContent = s.name;
  $('#detail-meteoblue').href = meteobluePage(s);
  const body = $('#detail-body');

  if (!state.result) {
    setSky(page, 'low');
    body.innerHTML = `<div class="d-hero"><h1>${s.name}</h1><p class="d-sub">${s.alt} m</p></div>${state.error ? errorCard() : '<div class="card skel tall shimmer"></div><div class="card skel tall shimmer"></div>'}`;
    return;
  }
  const r = state.result;
  if (state.day == null || state.day >= r.sunrise.length) state.day = nextMorning();

  const picker = r.sunrise.map((_, d) => {
    const b = siteDayBest(s.id, d);
    const c = scoreClass(b?.score);
    return `<button class="seg tap ${c.key}" role="tab" data-day="${d}" aria-selected="${d === state.day}">
      <span>${dayShort(d)}</span><b>${b?.score ?? '–'}</b><i class="dot"></i></button>`;
  }).join('');

  body.innerHTML = `
    <div id="d-hero"></div>
    <div class="segmented" role="tablist" aria-label="Matin" style="--n:${r.sunrise.length}">
      <span class="seg-thumb" style="--k:${state.day}"></span>${picker}
    </div>
    <div id="d-day"></div>`;
  renderDay(enter);
  if (enter) animateIn(body, true, [$('#d-hero'), $('.segmented', body), ...$('#d-day').children]);
}

// Partie qui dépend du matin choisi.
function renderDay(enter = false) {
  const s = siteById(state.site);
  const r = state.result;
  const day = state.day;
  const best = siteDayBest(s.id, day);
  const c = scoreClass(best?.score);
  const d = best?.ref;
  setSky($('#detail'), c.key, enter);

  $('#d-hero').innerHTML = `<div class="d-hero ${c.key}">
      <h1 tabindex="-1">${s.name}</h1>
      <p class="d-sub">${s.alt} m · ${morningLabel(day)}</p>
      <div class="d-score"><b data-count="${best?.score ?? ''}">${best?.score ?? '–'}</b></div>
      <p class="d-verdict">${best ? `Mer de nuages ${c.label.toLowerCase()}` : 'Pas de données'}</p>
      ${best ? `<p class="d-times">${icon('clock')}Meilleur moment ${hour(best.time)}<span>·</span>${icon('sunrise')}Lever ${hour(r.sunrise[day])}</p>` : ''}
    </div>`;

  if (!best) {
    $('#d-day').innerHTML = '<div class="card"><p class="muted">Pas de données pour ce matin.</p></div>';
    countUp($('#d-hero'));
    return;
  }

  $('#d-day').innerHTML = `
    <div class="card scene-card">${scene(s, d, c.key)}</div>
    ${conditionsCard(s, d)}
    ${hourlyCard(s, r, d.valley, best)}
    ${tiles(s, r, d)}
    ${modelsCard(best)}
    ${nearCamsCard(s)}
    <div class="card about">
      ${sectionHead('pin', 'Le lieu')}
      <p>${s.note}</p>
      <p class="muted">Vallées de référence : ${s.valleys.map(valleyName).join(', ')}.</p>
      <a class="pill-btn tap" href="${meteobluePage(s)}" target="_blank" rel="noopener">Météogramme meteoblue ${icon('external')}</a>
    </div>`;

  // Centre le tableau horaire sur le lever du soleil.
  const hs = $('.hours-scroll', $('#d-day'));
  const sr = $('.hcol.sunrise', hs);
  if (hs && sr) hs.scrollLeft = sr.offsetLeft - hs.clientWidth / 2 + sr.offsetWidth / 2;

  if (!enter) {
    replay([$('#d-hero'), ...$('#d-day').children], 'swap');
    countUp($('#d-hero'));
  }
}

// Les 4 conditions d'une mer de nuages, en langage clair.
function diagnose(s, d) {
  const out = [];
  const side = `côté ${valleyName(d.valley).replace(/^Plaine/, 'plaine').replace(/^Plateau/, 'plateau').replace(/^Vallée/, 'vallée')}`;

  if (d.seaCC >= 60) out.push(['ok', 'Nuages en vallée', `Couche dense ${side}.`]);
  else if (d.seaCC >= 25) out.push(['mid', 'Nuages en vallée', `Quelques nuages ${side}, mer trouée.`]);
  else out.push(['bad', 'Nuages en vallée', 'Vallées dégagées, rien en dessous.']);

  if (d.top == null) out.push(['bad', 'Sommet au-dessus', 'Pas de couche nuageuse basse.']);
  else if (inCloud(s, d)) out.push(['bad', 'Sommet au-dessus', `Non : nuages jusqu’à ~${d.top} m, vous seriez dans le brouillard.`]);
  else {
    const gap = s.alt - d.top;
    out.push(gap < 60
      ? ['mid', 'Sommet au-dessus', `Juste : nuages jusqu’à ~${d.top} m, ça peut accrocher.`]
      : ['ok', 'Sommet au-dessus', `Oui : nuages jusqu’à ~${d.top} m, ${gap} m sous vous.`]);
  }

  if (d.aboveCC < 30) out.push(['ok', 'Ciel au-dessus', d.high > 50 ? 'Dégagé, voile d’altitude.' : 'Ciel bleu.']);
  else if (d.aboveCC < 60) out.push(['mid', 'Ciel au-dessus', 'Partiellement nuageux.']);
  else out.push(['bad', 'Ciel au-dessus', 'Couvert, ambiance grise.']);

  if (d.wind > 40) out.push(['bad', 'Air stable', `Non : vent fort au sommet (${d.wind} km/h).`]);
  else if (d.dT != null && d.dT >= 0) out.push([d.wind > 25 ? 'mid' : 'ok', 'Air stable', `Oui : plus chaud en haut qu’en bas (inversion), vent ${d.wind} km/h.`]);
  else if (d.dT != null && d.dT < -2.5) out.push(['bad', 'Air stable', `Non : pas d’inversion, vent ${d.wind} km/h.`]);
  else out.push(['mid', 'Air stable', `Inversion faible, vent ${d.wind} km/h.`]);
  return out;
}

function conditionsCard(s, d) {
  const items = diagnose(s, d);
  const ok = items.filter((x) => x[0] === 'ok').length;
  const ic = { ok: 'check', mid: 'tilde', bad: 'x' };
  const word = { ok: 'Oui', mid: 'Moyen', bad: 'Non' };
  return `<div class="card">
    ${sectionHead('layers', `Conditions · ${ok}/4 réunies`)}
    <ul class="checks">${items.map(([st, title, text]) => `
      <li class="${st}"><span class="chk" aria-label="${word[st]}">${icon(ic[st])}</span>
        <div><b>${title}</b><p>${text}</p></div></li>`).join('')}
    </ul>
  </div>`;
}

function hourlyCard(s, r, valleyKey, best) {
  const sr = new Date(r.sunrise[state.day]).getTime();
  const hours = r.sites[s.id]
    .map((h) => ({ ...h, t: new Date(h.time).getTime() }))
    .filter((h) => h.t >= sr - 3.5 * 3600e3 && h.t <= sr + 4.5 * 3600e3);
  const sat = (m) => m && m.t != null && m.td != null && m.t - m.td <= 1.5;
  const dry = (m) => m && m.rh != null && m.rh < 70;

  const cols = hours.map((h) => {
    const isSr = Math.abs(h.t - sr) < 1800e3;
    const isBest = h.time === best.time;
    const c = scoreClass(h.score);
    const st = h.met?.site, va = h.met?.valley;
    const warm = st?.t != null && va?.t != null && st.t >= va.t;
    return `<div class="hcol${isSr ? ' sunrise' : ''}${isBest ? ' best' : ''}">
      <span class="h-time">${isSr ? icon('sunrise') : hour(h.time).replace(':00', ' h')}</span>
      <span class="h-score ${c.key}">${h.score ?? '–'}</span>
      <span class="h-cell">${h.ref?.top != null && h.ref.seaCC >= 25 ? h.ref.top : '–'}</span>
      <span class="h-sep"></span>
      <span class="h-cell${warm ? ' warm' : ''}">${num(st?.t, '°')}</span>
      <span class="h-cell">${num(st?.td, '°')}</span>
      <span class="h-cell${sat(st) ? ' sat' : dry(st) ? ' dry' : ''}">${num(st?.rh, '%')}</span>
      <span class="h-sep"></span>
      <span class="h-cell">${num(va?.t, '°')}</span>
      <span class="h-cell">${num(va?.td, '°')}</span>
      <span class="h-cell${sat(va) ? ' sat' : ''}">${num(va?.rh, '%')}</span>
    </div>`;
  }).join('');

  return `<div class="card hourly">
    ${sectionHead('clock', 'Heure par heure')}
    <div class="hours">
      <div class="h-labels" aria-hidden="true">
        <span class="h-time"></span>
        <span class="h-lbl">Indice</span>
        <span class="h-lbl">Nuages (m)</span>
        <span class="h-sep">Sommet</span>
        <span class="h-lbl">Temp.</span>
        <span class="h-lbl">Rosée</span>
        <span class="h-lbl">Humidité</span>
        <span class="h-sep">${valleyTown(valleyKey)}</span>
        <span class="h-lbl">Temp.</span>
        <span class="h-lbl">Rosée</span>
        <span class="h-lbl">Humidité</span>
      </div>
      <div class="hours-scroll">${cols}</div>
    </div>
    <div class="keys">
      <span><i class="k-sat"></i>Air saturé : brouillard</span>
      <span><i class="k-dry"></i>Air sec : au-dessus</span>
      <span><i class="k-warm"></i>Inversion</span>
    </div>
  </div>`;
}

function tiles(s, r, d) {
  const now = r.sites[s.id][nowIndex(r)]?.met?.site;
  const bestMet = siteDayBest(s.id, state.day)?.met;
  const gap = d.top != null ? s.alt - d.top : null;
  const hasSea = d.top != null && d.seaCC >= 25;
  const windWord = d.wind > 40 ? 'Fort' : d.wind > 25 ? 'Modéré' : d.wind > 10 ? 'Faible' : 'Calme';
  const tile = (ic, title, val, foot, wide = false) => `<div class="tile${wide ? ' wide' : ''}">
    ${sectionHead(ic, title)}<div class="tile-val">${val}</div><p class="tile-foot">${foot}</p></div>`;
  return `<div class="tiles">
    ${tile('cloud', 'Dessus des nuages', hasSea ? `${d.top} m` : '–',
      !hasSea ? 'Pas de couche basse.' : inCloud(s, d) ? 'Au niveau du sommet ou au-dessus.' : `${gap} m sous le sommet.`)}
    ${tile('layers', 'Inversion', d.dT != null ? signed(d.dT, ' °C') : '–',
      d.dT == null ? 'Non calculée.' : d.dT >= 0 ? 'Plus chaud en haut qu’en bas.' : d.dT < -2.5 ? 'Pas d’inversion.' : 'Inversion faible.')}
    ${tile('wind', 'Vent au sommet', `${d.wind}<small> km/h</small>`, `${windWord}.`)}
    ${tile('sky', 'Ciel au-dessus', `${d.aboveCC}<small> %</small>`,
      d.aboveCC < 30 ? (d.high > 50 ? 'Dégagé, voile d’altitude.' : 'Dégagé.') : d.aboveCC < 60 ? 'Partiellement nuageux.' : 'Couvert.')}
    ${tile('thermo', 'Au sommet', num(bestMet?.site.t, '°'), `Humidité ${num(bestMet?.site.rh, ' %')} · rosée ${num(bestMet?.site.td, '°')}`)}
    ${tile('valley', 'En vallée', num(bestMet?.valley.t, '°'), `${valleyTown(d.valley)} · humidité ${num(bestMet?.valley.rh, ' %')}`)}
    ${now ? `<div class="tile wide now">
      ${sectionHead('drop', 'Maintenant au sommet')}
      <div class="now-row">
        <div><b>${num(now.t, '°')}</b><small>Température</small></div>
        <div><b>${num(now.rh, ' %')}</b><small>Humidité</small></div>
        <div><b>${num(now.td, '°')}</b><small>Point de rosée</small></div>
      </div></div>` : ''}
  </div>`;
}

function modelsCard(best) {
  const entries = Object.entries(best.perModel)
    .map(([m, v]) => ({ name: m === 'icon_seamless' ? 'ICON' : 'Météo-France', score: v.score }));
  if (entries.length < 2) {
    return `<div class="card">
      ${sectionHead('scale', 'Modèle')}
      <p class="muted">Calcul avec ${MODEL_INFO[state.model][0]} seul. Le consensus compare deux modèles.</p>
      <button class="pill-btn tap" data-action="settings">Changer de modèle</button>
    </div>`;
  }
  const spread = Math.max(...entries.map((e) => e.score)) - Math.min(...entries.map((e) => e.score));
  return `<div class="card">
    ${sectionHead('scale', 'Accord des modèles')}
    <div class="bars">${entries.map((e) => `
      <div class="bar-row"><span>${e.name}</span>
        <span class="bar"><i class="${scoreClass(e.score).key}" style="--v:${Math.max(0.02, e.score / 100)}"></i></span>
        <b>${e.score}</b></div>`).join('')}
    </div>
    <p class="${spread >= 30 ? 'warn' : 'muted'}">${spread >= 30
      ? `${icon('alert')}Modèles en désaccord : prévision incertaine.`
      : 'Les deux modèles vont dans le même sens.'}</p>
  </div>`;
}

function nearCamsCard(s) {
  const near = WEBCAMS
    .map((c) => ({ c, dist: Math.hypot((c.lat - s.lat) * 111, (c.lon - s.lon) * 74) }))
    .sort((a, b) => a.dist - b.dist).slice(0, 3);
  return `<div class="card cams-card">
    ${sectionHead('camera', 'Webcams proches')}
    <div class="cam-list">${near.map(({ c, dist }) => camTile(c, `${dist.toFixed(0)} km`)).join('')}</div>
  </div>`;
}

// ---------- Animations ----------

// Entrée en cascade (arrivée sur la page) ou fondu enchaîné (mise à jour du contenu).
// L'animation porte sur chaque carte et jamais sur un conteneur : une opacité sur un
// parent couperait le flou d'arrière-plan des cartes pendant l'animation.
function animateIn(root, enter, els = [...root.children]) {
  replay(els, enter ? 'rise' : 'swap');
  countUp(root);
  fillRings(root);
}

function replay(els, cls) {
  els.forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 10));
    el.classList.remove('rise', 'swap');
    void el.offsetWidth;
    el.classList.add(cls);
  });
}

function countUp(root, animate = true) {
  $$('[data-count]', root).forEach((el) => {
    const to = Number(el.dataset.count);
    if (el.dataset.count === '' || Number.isNaN(to)) return;
    if (!animate || reduceMotion.matches || document.hidden) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  });
}

function fillRings(root, animate = true) {
  for (const c of $$('.ring-val', root)) {
    if (!animate) c.style.transition = 'none';
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
  const lt = $('.large-title', page);
  sc.addEventListener('scroll', () => {
    const y = sc.scrollTop;
    const limit = page.id === 'home' ? 40 : 150;
    page.classList.toggle('scrolled', y > limit);
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
  const start = (e) => {
    if (!e.target.closest('.sheet-grab, .sheet-head')) return;
    y0 = e.touches[0].clientY; dy = 0;
    panel.style.transition = 'none';
  };
  panel.addEventListener('touchstart', start, { passive: true });
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
      <p>Chance de voir une mer de nuages (0–100) au meilleur moment entre 1 h avant et 2 h après le lever du soleil.</p>
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
  state.result = computeAll(state.data, state.model);
  renderHome();
  if (onDetail) renderDetail();
}

function openCam(c) {
  openSheet(c.name, `
    <div class="player"><iframe src="${webcamPlayer(c.id)}" title="Timelapse ${c.name}" allowfullscreen></iframe></div>
    <a class="pill-btn tap" href="https://www.windy.com/webcams/${c.id}" target="_blank" rel="noopener">Voir sur Windy ${icon('external')}</a>`, 'cam-sheet');
}

// ---------- Chargement ----------

async function load(force = false) {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  document.body.classList.add('loading');
  if (!state.result) { renderHome(); if (onDetail) renderDetail(); }
  try {
    state.data = await fetchForecast({ force });
    const first = !state.result;
    state.result = computeAll(state.data, state.model);
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

// Icônes fixes et étoiles.
$$('[data-action="settings"].icon-btn').forEach((b) => { b.innerHTML = icon('settings'); });
$('.back-ic').innerHTML = icon('back');
$('#detail-meteoblue').innerHTML = icon('external');
for (const el of $$('.stars')) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  el.innerHTML = Array.from({ length: 46 }, () =>
    `<i style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 45).toFixed(1)}%;--s:${(0.6 + rnd() * 1.4).toFixed(1)}px;--d:${(rnd() * 4).toFixed(1)}s"></i>`).join('');
}

if (reduceMotion.matches) document.documentElement.classList.add('reduce');
document.documentElement.classList.add('no-anim');
route();
requestAnimationFrame(() => document.documentElement.classList.remove('no-anim'));
load();
