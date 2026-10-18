import {
  SITES, VALLEYS, WEBCAMS, MODELS,
  webcamImage, webcamPlayer, meteobluePage,
} from './config.js';
import { fetchForecast, computeAll, morningWindow, bestInWindow, scoreClass, nowIndex } from './forecast.js';
import { createInversionView } from './inversion.js';

const $ = (sel) => document.querySelector(sel);
const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLongDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
const fmtHour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const num = (x, unit = '') => (x == null ? '–' : `${x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${unit}`);

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const state = {
  data: null,
  result: null,
  model: store.get('mdn-model', 'consensus'),
  day: 0,
  site: store.get('mdn-site', 'donon'),
  daylight: store.get('mdn-daylight', '0') === '1',
};
if (!MODELS[state.model]) state.model = 'consensus';
if (!SITES.find((s) => s.id === state.site)) state.site = SITES[0].id;

const siteById = (id) => SITES.find((s) => s.id === id);
const dayLabel = (d) => (d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : fmtDay.format(new Date(state.result.sunrise[d])));
const shortValley = (k) => VALLEYS[k].name.replace(/\s*\(.*\)/, '')
  .replace(/^Plaine/, 'plaine').replace(/^Plateau/, 'plateau').replace(/^Vallée/, 'vallée');
const valleyTown = (k) => (VALLEYS[k].name.match(/\((.*)\)/)?.[1] ?? VALLEYS[k].name);

function siteDayBest(siteId, day) {
  const r = state.result;
  return bestInWindow(r.sites[siteId], morningWindow(r, day));
}

// ---------- Carte ----------

const map = L.map('map', { scrollWheelZoom: false });
L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 16,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
}).addTo(map);
map.fitBounds(L.latLngBounds(SITES.map((s) => [s.lat, s.lon])).pad(0.2));

const siteMarkers = {};
for (const s of SITES) {
  const m = L.marker([s.lat, s.lon], { icon: siteIcon(s, null), riseOnHover: true }).addTo(map);
  m.on('click', () => select(s.id, state.day, true));
  siteMarkers[s.id] = m;
}
for (const c of WEBCAMS) {
  L.marker([c.lat, c.lon], {
    icon: L.divIcon({ className: 'cam-marker', html: '📷', iconSize: [22, 22], iconAnchor: [11, 11] }),
  }).addTo(map).bindPopup(() => camPopup(c), { maxWidth: 320, minWidth: 280 });
}

function siteIcon(s, score) {
  const cls = scoreClass(score).key;
  const selected = s.id === state.site ? ' selected' : '';
  const lbl = s.labelRight ? ' lbl-right' : '';
  return L.divIcon({
    className: '',
    html: `<div class="site-marker ${cls}${selected}${lbl}"><b>${score ?? '–'}</b><span>${s.name}</span></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function camPopup(c) {
  const el = document.createElement('div');
  el.className = 'cam-popup';
  el.innerHTML = `
    <img src="${webcamImage(c.id, state.daylight ? 'daylight' : 'current')}" alt="${c.name}">
    <div class="row"><strong>${c.name}</strong><button class="btn small">Timelapse 24 h</button></div>`;
  el.querySelector('button').onclick = () => openCam(c);
  return el;
}

// ---------- Grille d'ensemble ----------

function renderGrid() {
  const r = state.result;
  const iNow = nowIndex(r);
  const head = `<tr><th></th>${r.sunrise.map((sr, d) =>
    `<th class="${d === state.day ? 'cur' : ''}"><span class="lg">${dayLabel(d)}</span><span class="sm">${d === 0 ? 'Auj.' : fmtShort.format(new Date(sr))}</span><small>lever ${fmtHour.format(new Date(sr))}</small></th>`).join('')}</tr>`;

  const rows = SITES.map((s) => {
    const now = r.sites[s.id][iNow]?.met?.site;
    const cells = r.sunrise.map((_, d) => {
      const b = siteDayBest(s.id, d);
      const c = scoreClass(b?.score);
      const sel = s.id === state.site && d === state.day ? ' selected' : '';
      return `<td><button class="cell ${c.key}${sel}" data-site="${s.id}" data-day="${d}" title="${s.name} · ${dayLabel(d)} : ${c.label}">
        <b>${b?.score ?? '–'}</b><small>${cellNote(s, b?.ref)}</small></button></td>`;
    }).join('');
    return `<tr class="${s.id === state.site ? 'cur' : ''}">
      <th><button class="site-name" data-site="${s.id}">${s.name}</button>
        <small>${s.alt} m</small>
        ${now ? `<small class="now" title="Maintenant au sommet : température · humidité · point de rosée"><span>🌡 ${num(now.t, '°')} · 💧 ${num(now.rh, ' %')}</span> <span>Td ${num(now.td, '°')}</span></small>` : ''}
      </th>${cells}</tr>`;
  }).join('');

  const t = $('#grid');
  t.innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
  renderBest();
  t.querySelectorAll('.cell').forEach((b) => {
    b.onclick = () => select(b.dataset.site, Number(b.dataset.day), true);
  });
  t.querySelectorAll('.site-name').forEach((b) => {
    b.onclick = () => select(b.dataset.site, state.day, true);
  });
}

// Petite note sous le chiffre : où se situe la couche par rapport au site.
function cellNote(s, d) {
  if (!d || d.top == null || d.seaCC < 25) return '';
  if (d.top > s.alt + 20 || d.summitCC >= 50) return 'dans le nuage';
  return `☁ ${d.top} m`;
}

// Les 3 meilleurs couples site / matin, en tête de grille.
function renderBest() {
  const r = state.result;
  const all = [];
  for (const s of SITES) {
    r.sunrise.forEach((_, d) => {
      const b = siteDayBest(s.id, d);
      if (b?.score >= 20) all.push({ s, d, score: b.score });
    });
  }
  all.sort((a, b) => b.score - a.score);
  const el = $('#best');
  if (!all.length) {
    el.innerHTML = '<span class="muted">Aucune mer de nuages en vue sur les 5 prochains matins.</span>';
    return;
  }
  el.innerHTML = `<span class="best-label">Meilleures chances</span>${all.slice(0, 3).map((x) =>
    `<button class="best ${scoreClass(x.score).key}" data-site="${x.s.id}" data-day="${x.d}">
      <b>${x.score}</b> ${x.s.name} · ${dayLabel(x.d)}</button>`).join('')}`;
  el.querySelectorAll('.best').forEach((b) => {
    b.onclick = () => select(b.dataset.site, Number(b.dataset.day), true);
  });
}

function select(site, day, scroll = false) {
  state.site = site;
  state.day = day;
  store.set('mdn-site', site);
  renderAll();
  if (scroll) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMarkers() {
  for (const s of SITES) {
    const best = state.result ? siteDayBest(s.id, state.day) : null;
    siteMarkers[s.id].setIcon(siteIcon(s, best?.score ?? null));
  }
}

// ---------- Détail ----------

function renderDetail() {
  const s = siteById(state.site);
  const r = state.result;
  const best = siteDayBest(s.id, state.day);
  const sc = scoreClass(best?.score);
  const d = best?.ref;

  const mScores = best ? Object.entries(best.perModel)
    .map(([m, v]) => ({ name: m === 'icon_seamless' ? 'ICON' : 'Météo-France', score: v.score })) : [];
  const models = mScores.map((m) => `${m.name} ${m.score}`).join(' · ');
  const spread = mScores.length > 1 ? Math.max(...mScores.map((m) => m.score)) - Math.min(...mScores.map((m) => m.score)) : 0;
  const agreement = mScores.length < 2 ? ''
    : spread >= 30 ? `<div class="warn">⚠ Modèles en désaccord (${models}) : prévision incertaine.</div>`
    : `<div class="muted">Modèles d’accord (${models}).</div>`;

  const nearCams = WEBCAMS
    .map((c) => ({ c, dist: Math.hypot((c.lat - s.lat) * 111, (c.lon - s.lon) * 74) }))
    .sort((a, b) => a.dist - b.dist).slice(0, 3);

  const dayTabs = r.sunrise.map((_, i) => {
    const b = siteDayBest(s.id, i);
    return `<button class="tab ${i === state.day ? 'active' : ''}" data-day="${i}">${dayLabel(i)} <span class="pill ${scoreClass(b?.score).key}">${b?.score ?? '–'}</span></button>`;
  }).join('');

  $('#detail').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${s.name} <span class="muted">${s.alt} m</span></h2>
        <div class="muted">${s.note}</div>
      </div>
      <div class="links">
        <a class="btn" href="${meteobluePage(s)}" target="_blank" rel="noopener">Météogramme meteoblue ↗</a>
      </div>
    </div>
    <div class="tabs">${dayTabs}</div>

    ${best ? `
    <div class="detail-main">
      <div class="big-cs">${crossSection(s, d, true)}</div>
      <div>
        <div class="verdict ${sc.key}">
          <div class="v-score"><b>${best.score}</b><small>/100</small></div>
          <div>
            <strong>${fmtLongDay.format(new Date(r.sunrise[state.day]))} : mer de nuages ${sc.label.toLowerCase()}</strong>
            <div class="muted">Meilleur moment vers ${fmtHour.format(new Date(best.time))}, lever du soleil à ${fmtHour.format(new Date(r.sunrise[state.day]))}.</div>
            ${agreement}
          </div>
        </div>
        <ul class="checks">${diagnose(s, d).map((c) => `
          <li class="${c.state}"><i>${c.state === 'ok' ? '✓' : c.state === 'mid' ? '~' : '✗'}</i>
            <div><b>${c.title}</b> <span>${c.text}</span></div></li>`).join('')}
        </ul>
      </div>
    </div>

    <h3>Heure par heure</h3>
    ${hourTable(s, r, d.valley)}
    ` : '<p class="muted">Pas de données pour ce jour.</p>'}

    <h3>Webcams proches</h3>
    <div class="cams mini">${nearCams.map(({ c, dist }) => camCard(c, `${dist.toFixed(0)} km`)).join('')}</div>
  `;
  $('#detail').querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => select(state.site, Number(b.dataset.day));
  });
  bindCamCards($('#detail'));
}

// Les 4 conditions d'une mer de nuages, en langage clair.
function diagnose(s, d) {
  const out = [];
  const side = `côté ${shortValley(d.valley)}`;

  if (d.seaCC >= 60) out.push({ state: 'ok', title: 'Nuages bas en vallée :', text: `couche dense ${side}.` });
  else if (d.seaCC >= 25) out.push({ state: 'mid', title: 'Nuages bas en vallée :', text: `quelques nuages ${side}, mer trouée.` });
  else out.push({ state: 'bad', title: 'Nuages bas en vallée :', text: 'vallées dégagées, rien en dessous.' });

  if (d.top == null) {
    out.push({ state: 'bad', title: 'Site au-dessus :', text: 'pas de couche nuageuse basse.' });
  } else if (d.top > s.alt + 20 || d.summitCC >= 50) {
    out.push({ state: 'bad', title: 'Site au-dessus :', text: `non, nuages jusqu’à ~${d.top} m, vous seriez dans le brouillard.` });
  } else {
    const gap = s.alt - d.top;
    out.push(gap < 60
      ? { state: 'mid', title: 'Site au-dessus :', text: `juste, nuages jusqu’à ~${d.top} m, ça peut accrocher.` }
      : { state: 'ok', title: 'Site au-dessus :', text: `oui, nuages jusqu’à ~${d.top} m, ${gap} m sous vous.` });
  }

  if (d.aboveCC < 30) out.push({ state: 'ok', title: 'Ciel au-dessus :', text: d.high > 50 ? 'dégagé, voile d’altitude.' : 'bleu.' });
  else if (d.aboveCC < 60) out.push({ state: 'mid', title: 'Ciel au-dessus :', text: 'partiellement nuageux.' });
  else out.push({ state: 'bad', title: 'Ciel au-dessus :', text: 'couvert, ambiance grise.' });

  if (d.wind > 40) out.push({ state: 'bad', title: 'Air stable :', text: `non, vent fort au sommet (${d.wind} km/h).` });
  else if (d.dT != null && d.dT >= 0) out.push({ state: d.wind > 25 ? 'mid' : 'ok', title: 'Air stable :', text: `oui, plus chaud en haut qu’en bas (inversion), vent ${d.wind} km/h.` });
  else if (d.dT != null && d.dT < -2.5) out.push({ state: 'bad', title: 'Air stable :', text: `non, pas d’inversion, vent ${d.wind} km/h.` });
  else out.push({ state: 'mid', title: 'Air stable :', text: `inversion faible, vent ${d.wind} km/h.` });

  return out;
}

// Tableau horaire autour du lever : indice, couche, T / HR / Td au sommet et en vallée.
function hourTable(s, r, valleyKey) {
  const sr = new Date(r.sunrise[state.day]).getTime();
  const hours = r.sites[s.id]
    .map((h, i) => ({ ...h, i, t: new Date(h.time).getTime() }))
    .filter((h) => h.t >= sr - 3.5 * 3600e3 && h.t <= sr + 3.5 * 3600e3);

  const cell = (h, fn, cls = () => '') => `<td class="${cls(h)}">${fn(h)}</td>`;
  const row = (label, fn, cls) => `<tr><th>${label}</th>${hours.map((h) => cell(h, fn, cls)).join('')}</tr>`;
  const sat = (m) => m && m.t != null && m.td != null && m.t - m.td <= 1.5;
  const dry = (m) => m && m.rh != null && m.rh < 70;
  const isSunrise = (h) => Math.abs(h.t - sr) < 1800e3;

  return `<div class="table-scroll"><table class="hours">
    <thead><tr><th></th>${hours.map((h) => `<th class="${isSunrise(h) ? 'sunrise' : ''}">${fmtHour.format(new Date(h.time)).replace(':00', ' h')}${isSunrise(h) ? '<small>☀ lever</small>' : ''}</th>`).join('')}</tr></thead>
    <tbody>
      ${row('Indice', (h) => `<span class="pill ${scoreClass(h.score).key}">${h.score ?? '–'}</span>`)}
      ${row('Nuages jusqu’à', (h) => (h.ref?.top != null && h.ref.seaCC >= 25 ? `${h.ref.top} m` : '–'))}
      <tr class="group"><th colspan="${hours.length + 1}">Au sommet (${s.alt} m)</th></tr>
      ${row('Température', (h) => num(h.met?.site.t, '°'), (h) => (h.met?.site.t != null && h.met.valley.t != null && h.met.site.t >= h.met.valley.t ? 'warm' : ''))}
      ${row('Point de rosée', (h) => num(h.met?.site.td, '°'))}
      ${row('Humidité', (h) => num(h.met?.site.rh, ' %'), (h) => (sat(h.met?.site) ? 'sat' : dry(h.met?.site) ? 'dry' : ''))}
      <tr class="group"><th colspan="${hours.length + 1}">En vallée (${valleyTown(valleyKey)})</th></tr>
      ${row('Température', (h) => num(h.met?.valley.t, '°'))}
      ${row('Point de rosée', (h) => num(h.met?.valley.td, '°'))}
      ${row('Humidité', (h) => num(h.met?.valley.rh, ' %'), (h) => (sat(h.met?.valley) ? 'sat' : ''))}
    </tbody></table></div>
    <p class="muted hint"><span class="key sat"></span> air saturé (température ≈ point de rosée) : brouillard ou nuage ·
      <span class="key dry"></span> air sec au sommet : au-dessus de la couche ·
      <span class="key warm"></span> plus chaud au sommet qu’en vallée : inversion.</p>`;
}

// Coupe schématique : montagne, mer de nuages, ciel.
function crossSection(s, d, big) {
  const W = 160, H = big ? 120 : 90, base = 150;
  const zMax = Math.round(s.alt * 1.4 + 150);
  const y = (z) => H - ((Math.min(z, zMax) - base) / (zMax - base)) * (H - 6);
  const above = d?.aboveCC ?? 0;
  const sea = d?.top != null && d.seaCC >= 25 ? d : null;
  const peakX = 70, py = y(s.alt);

  let g = `<svg viewBox="0 0 ${W} ${H}" class="cs" role="img" aria-label="Coupe schématique">`;
  g += `<rect width="${W}" height="${H}" class="cs-sky" style="--grey:${Math.round(above)}%"/>`;
  if (above < 50) g += `<circle cx="134" cy="18" r="8" class="cs-sun"/>`;
  if (above >= 20) {
    g += `<g class="cs-hicloud" style="opacity:${(above / 100).toFixed(2)}">
      <ellipse cx="38" cy="14" rx="26" ry="7"/><ellipse cx="58" cy="10" rx="18" ry="7"/>
      <ellipse cx="108" cy="18" rx="28" ry="7"/><ellipse cx="128" cy="12" rx="16" ry="6"/></g>`;
  }
  const z = (f) => y(base + (s.alt - base) * f);
  g += `<path class="cs-mount" d="M0 ${H} L0 ${z(0.35)} L${peakX - 32} ${z(0.7)} L${peakX} ${py} L${peakX + 26} ${z(0.78)} L${W} ${z(0.3)} L${W} ${H} Z"/>`;
  if (sea) {
    const ty = y(sea.top);
    let path = `M0 ${H} L0 ${ty}`;
    for (let x = 0; x <= W; x += 8) path += ` L${x} ${(ty + Math.sin(x / 7) * 1.6).toFixed(1)}`;
    path += ` L${W} ${H} Z`;
    g += `<path class="cs-sea" d="${path}" style="opacity:${(0.45 + 0.5 * sea.seaCC / 100).toFixed(2)}"/>`;
    if (big) g += `<text x="6" y="${Math.min(H - 4, ty + 12)}" class="cs-txt">nuages ≈ ${sea.top} m</text>`;
  }
  g += `<circle cx="${peakX}" cy="${py}" r="3.5" class="cs-site"/>`;
  if (big) g += `<text x="${peakX + 7}" y="${py - 4}" class="cs-txt">${s.alt} m</text>`;
  return `${g}</svg>`;
}

// ---------- Webcams ----------

function camCard(c, extra = '') {
  return `<figure class="cam" data-cam="${c.id}">
    <img loading="lazy" src="${webcamImage(c.id, state.daylight ? 'daylight' : 'current')}" alt="${c.name}">
    <figcaption>${c.name}${extra ? ` <small>${extra}</small>` : ''}</figcaption>
  </figure>`;
}

function bindCamCards(root) {
  root.querySelectorAll('.cam').forEach((el) => {
    el.onclick = () => openCam(WEBCAMS.find((c) => c.id === Number(el.dataset.cam)));
  });
}

function renderCams() {
  $('#cams').innerHTML = WEBCAMS.map((c) => camCard(c)).join('');
  bindCamCards($('#cams'));
}

function openCam(c) {
  $('#modal-title').textContent = c.name;
  $('#modal-body').innerHTML = `<iframe src="${webcamPlayer(c.id)}" title="Timelapse ${c.name}" allowfullscreen></iframe>
    <p class="muted"><a href="https://www.windy.com/webcams/${c.id}" target="_blank" rel="noopener">Voir sur Windy ↗</a></p>`;
  $('#modal').showModal();
}
$('#modal-close').onclick = () => $('#modal').close();
$('#modal').addEventListener('close', () => { $('#modal-body').innerHTML = ''; });
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) $('#modal').close(); });

// ---------- Contrôles ----------

function renderAll() {
  renderGrid();
  renderMarkers();
  renderDetail();
  map.invalidateSize();
}

const sel = $('#model');
for (const [k, m] of Object.entries(MODELS)) sel.add(new Option(m.label, k, false, k === state.model));
sel.onchange = () => {
  state.model = sel.value;
  store.set('mdn-model', state.model);
  state.result = computeAll(state.data, state.model);
  renderAll();
};

const dl = $('#daylight');
dl.checked = state.daylight;
dl.onchange = () => {
  state.daylight = dl.checked;
  store.set('mdn-daylight', dl.checked ? '1' : '0');
  renderCams();
  renderDetail();
};

$('#refresh').onclick = () => load(true);

async function load(force = false) {
  $('#grid').innerHTML = '<tr><td class="muted loading">Chargement des prévisions…</td></tr>';
  try {
    state.data = await fetchForecast({ force });
    state.result = computeAll(state.data, state.model);
    $('#updated').textContent = `Vosges du Nord · prévisions de ${fmtHour.format(new Date(state.data.at))}`;
    renderAll();
  } catch (e) {
    console.error(e);
    $('#grid').innerHTML = `<tr><td class="error">Impossible de charger les prévisions : ${e.message}</td></tr>`;
  }
}

// ---------- Onglets de vue ----------

let invView = null;
function showView(name) {
  store.set('mdn-view', name);
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#view-forecast').hidden = name !== 'forecast';
  $('#view-inversion').hidden = name !== 'inversion';
  $('#forecast-controls').hidden = name !== 'forecast';
  if (name === 'inversion') {
    invView ??= createInversionView($('#view-inversion'));
    invView.show();
  } else {
    map.invalidateSize();
  }
}
document.querySelectorAll('.view-btn').forEach((b) => { b.onclick = () => showView(b.dataset.view); });

renderCams();
load();
if (store.get('mdn-view', 'forecast') === 'inversion') showView('inversion');
