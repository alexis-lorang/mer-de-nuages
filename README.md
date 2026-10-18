# Mers de nuages · Vosges du Nord

Application web statique (HTML/JS, sans build) qui prévoit les mers de nuages sur 5 jours pour :
Donon, Rocher de Mutzig, Rocher de Dabo, Col du Valsberg et Château du Haut-Barr.

## Lancer

Le plus simple : double-cliquer sur **`Lancer le dashboard.command`**. Il démarre le serveur local et ouvre le navigateur.
La première fois, macOS peut demander une confirmation : clic droit → Ouvrir. Garder la fenêtre du Terminal ouverte tant qu’on utilise le dashboard.

Ou à la main :

```bash
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765. Un serveur est nécessaire, car les modules ES ne se chargent pas en `file://`.

## Interface

Application web pensée pour iPhone, au style d’iOS. Sur iPhone : Safari → Partager → « Sur l’écran d’accueil »
pour l’ouvrir en plein écran comme une app.

- **Accueil** : la meilleure chance à venir, puis la liste des lieux avec l’indice des deux prochains rendez-vous
  (lever et coucher du soleil, dans l’ordre). Toucher un lieu ouvre sa page. Tirer vers le bas pour actualiser.
- **Page d’un lieu** : choix du jour ; indice au lever et au coucher ; coupe illustrée (montagne, mer de nuages) ;
  tableau lever / coucher (météo, température, nuages en vallée, dessus des nuages, sommet, ciel au-dessus,
  inversion, vent, accord des modèles) ; météo du jour au sommet et météogramme (nuages, température, pluie,
  lever et coucher) ; webcams proches ; lien vers meteoblue.
  Retour par le bouton « Lieux » flottant en bas, ou en glissant depuis le bord gauche (app installée).
  Rien d’interactif dans le haut de l’écran : en mode application, iOS floute la zone sous la barre d’état.
- **Réglages** (bouton à droite du grand titre) : modèle météo, dernière image de jour pour les webcams, actualisation.
- Chaque page a sa propre adresse (`#/lieu/donon/1` = Donon, demain), partageable.

Le météogramme meteoblue ne peut pas être intégré : leur site interdit l’affichage dans une autre page
(`X-Frame-Options: SAMEORIGIN`). Le météogramme est donc dessiné à partir des données Open-Meteo du lieu
(AROME, complété par ICON au-delà de sa portée).

## Indice (0–100)

Calculé heure par heure à partir des profils verticaux (niveaux 1000 → 700 hPa) d’Open-Meteo,
modèles ICON (DWD) et AROME/ARPEGE (Météo-France), ou leur moyenne (« consensus »).

Pour chaque site, on teste plusieurs vallées de référence (plateau lorrain, Bruche, plaine d’Alsace, Mossig, Zorn…)
et on garde la meilleure :

| Facteur | Source |
|---|---|
| Nuages bas en vallée sous le sommet | couverture nuageuse aux niveaux de pression sous l’altitude du site + visibilité (brouillard) |
| Sommet hors du nuage | couverture interpolée à l’altitude du site |
| Ciel dégagé au-dessus | couverture des niveaux au-dessus + nuages moyens (nuages hauts légèrement pénalisants) |
| Inversion | T au-dessus du sommet − T dans la couche nuageuse |
| Vent faible | vent interpolé à l’altitude du site |

L’indice retient le meilleur créneau entre 1 h avant et 2 h après le lever du soleil, et entre 2 h avant et 1 h après le coucher.
Les seuils et pondérations sont dans `js/forecast.js` (`scoreHour`). C’est une heuristique, à ajuster avec l’expérience du terrain.

## Fichiers

- `js/config.js` : sites, vallées de référence, webcams, URLs meteoblue/Windy
- `js/forecast.js` : récupération Open-Meteo (cache 30 min) et calcul de l’indice
- `js/app.js` : interface (accueil, page lieu, navigation, réglages)
- `js/scene.js` : illustration animée (montagne, mer de nuages, ciel)
- `js/icons.js` : icônes SVG
- `manifest.webmanifest`, `icon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` : icône et installation sur l’écran d’accueil (PNG rendus depuis `icon.svg` avec QuickLook, `qlmanage -t -s 1024`)
