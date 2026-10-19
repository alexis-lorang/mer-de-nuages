// Points d'intérêt, vallées de référence et webcams.
// Coordonnées : OpenStreetMap (Nominatim). Altitudes : OSM / IGN.

export const SITES = [
  {
    id: 'donon',
    name: 'Donon',
    lat: 48.5126, lon: 7.1645, alt: 1009,
    valleys: ['sarrebourg', 'bruche', 'molsheim'],
    chart: ['grandfontaine', 'bruche'],
    note: 'Vue à 360° : plateau lorrain, vallée de la Bruche, plaine d’Alsace au loin.',
  },
  {
    id: 'mutzig',
    name: 'Rocher de Mutzig',
    lat: 48.5494, lon: 7.2398, alt: 1009,
    valleys: ['molsheim', 'bruche', 'wasselonne'],
    chart: ['lutzelhouse', 'bruche'],
    note: 'Point culminant des Vosges du Nord, belle vue sur la plaine et la Bruche.',
  },
  {
    id: 'dabo',
    name: 'Rocher de Dabo',
    lat: 48.6490, lon: 7.2456, alt: 664, labelLeft: true,
    valleys: ['sarrebourg', 'wasselonne'],
    chart: ['sarrebourg'],
    note: 'Belvédère sur le plateau lorrain et le massif du Dabo.',
  },
  {
    id: 'valsberg',
    name: 'Col du Valsberg',
    lat: 48.6511, lon: 7.2943, alt: 650, labelRight: true,
    valleys: ['wasselonne', 'sarrebourg'],
    chart: ['wasselonne'],
    note: 'Col entre Dabo et Obersteigen, vue sur la Mossig et la plaine.',
  },
  {
    id: 'hautbarr',
    name: 'Château du Haut-Barr',
    lat: 48.7247, lon: 7.3383, alt: 460,
    valleys: ['saverne', 'kochersberg'],
    note: '« Œil de l’Alsace » : la mer de nuages doit rester sous ~430 m.',
  },
  {
    id: 'chateau-lutzelbourg',
    name: 'Château de Lutzelbourg',
    lat: 48.7327, lon: 7.2538, alt: 322,
    valleys: ['lutzelbourg', 'saverne'],
    chart: ['lutzelbourg'],
    note: 'Ruines sur un promontoire au-dessus de la vallée de la Zorn : la mer de nuages doit rester sous ~300 m.',
  },
];

// Fonds de vallée / plaines où se forment les stratus et brouillards.
export const VALLEYS = {
  sarrebourg:  { name: 'Plateau lorrain (Sarrebourg)', lat: 48.735, lon: 7.055 },
  bruche:      { name: 'Vallée de la Bruche (Schirmeck)', lat: 48.483, lon: 7.220 },
  molsheim:    { name: 'Plaine d’Alsace (Molsheim)', lat: 48.540, lon: 7.495 },
  wasselonne:  { name: 'Mossig (Wasselonne)', lat: 48.637, lon: 7.448 },
  saverne:     { name: 'Saverne / Zorn', lat: 48.742, lon: 7.365 },
  kochersberg: { name: 'Plaine (Kochersberg)', lat: 48.690, lon: 7.560 },
  grandfontaine: { name: 'Haute Bruche (Grandfontaine)', lat: 48.4933, lon: 7.1617 },
  lutzelhouse: { name: 'Vallée de la Bruche (Lutzelhouse)', lat: 48.5196, lon: 7.2880 },
  lutzelbourg: { name: 'Vallée de la Zorn (Lutzelbourg)', lat: 48.7352, lon: 7.2504 },
};

// Webcams Windy (images publiques, timelapse intégrable).
export const WEBCAMS = [
  { id: 1516695655, name: 'Donon (depuis Grandfontaine)', lat: 48.5065, lon: 7.1476 },
  { id: 1668335952, name: 'Dabo › Sud-est', lat: 48.6519, lon: 7.2902 },
  { id: 1516695520, name: 'Tour du Champ du Feu (1099 m)', lat: 48.3930, lon: 7.2698 },
  { id: 1759304403, name: 'Steinbourg › Sud-est', lat: 48.7557, lon: 7.4228 },
  { id: 1615707346, name: 'Aérodrome de Sarrebourg-Buhl', lat: 48.7175, lon: 7.0739 },
  { id: 1688133480, name: 'Ottrott › Sud', lat: 48.4336, lon: 7.4010 },
  { id: 1611407513, name: 'Col de la Charbonnière', lat: 48.3834, lon: 7.2574 },
  { id: 1607109002, name: 'Col de Steige', lat: 48.3638, lon: 7.1998 },
  { id: 1607108427, name: 'Col de Saales', lat: 48.3492, lon: 7.1117 },
  { id: 1607107793, name: 'Col du Hantz', lat: 48.4024, lon: 7.0900 },
  { id: 1607110298, name: 'Col d’Urbeis', lat: 48.3328, lon: 7.1948 },
  { id: 1793893763, name: 'Stutzheim-Offenheim › Ouest', lat: 48.6286, lon: 7.6250 },
];

export const webcamImage = (id, kind = 'current') =>
  `https://imgproxy.windy.com/_/preview/plain/${kind}/${id}/original.jpg?v=2&t=${Math.floor(Date.now() / 300000)}`;
export const webcamPlayer = (id) =>
  `https://webcams.windy.com/webcams/public/embed/player/${id}/day`;

export const meteoblueMeteogram = (s) => {
  const loc = `${s.lat.toFixed(4)}N${s.lon.toFixed(4)}E${s.alt}_Europe%2FParis`;
  return `https://www.meteoblue.com/fr/meteo/widget/meteogram/${loc}?geoloc=fixed&temperature_units=CELSIUS&windspeed_units=KILOMETER_PER_HOUR&precipitation_units=MILLIMETER&forecast_days=5&layout=bright&autowidth=auto`;
};
export const meteobluePage = (s) =>
  `https://www.meteoblue.com/fr/meteo/semaine/${s.lat.toFixed(4)}N${s.lon.toFixed(4)}E${s.alt}_Europe%2FParis`;

export const MODELS = {
  consensus: { label: 'Consensus ICON + Météo-France', ids: ['icon_seamless', 'meteofrance_seamless'] },
  icon_seamless: { label: 'ICON (DWD)', ids: ['icon_seamless'] },
  meteofrance_seamless: { label: 'AROME / ARPEGE (Météo-France)', ids: ['meteofrance_seamless'] },
};
