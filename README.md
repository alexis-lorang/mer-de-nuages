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

Application web pensée pour iPhone, au style d’iOS (ciel animé, cartes en verre dépoli, transitions de navigation).
Sur iPhone : Safari → Partager → « Sur l’écran d’accueil » pour l’ouvrir en plein écran comme une app.

- **Accueil** : la meilleure chance des 5 prochains matins, puis une carte par lieu avec l’indice du prochain matin
  et une barre par jour. Toucher un lieu (ou un jour) ouvre sa page. Tirer vers le bas pour actualiser.
- **Page d’un lieu** : indice, verdict, meilleur moment et lever du soleil ; sélecteur de matin ; coupe illustrée
  (montagne, mer de nuages, ciel) ; les 4 conditions ; tableau heure par heure autour du lever
  (indice, sommet des nuages, température / point de rosée / humidité au sommet et en vallée) ; tuiles
  (dessus des nuages, inversion, vent, ciel au-dessus, sommet, vallée, conditions actuelles) ; accord des modèles ;
  webcams proches ; lien meteoblue. Retour par le bouton « Lieux » ou en glissant depuis le bord gauche (app installée).
- **Réglages** (icône en haut à droite) : modèle météo, dernière image de jour pour les webcams, actualisation.
- Chaque page a sa propre adresse (`#/lieu/donon/1` = Donon, demain matin), partageable.

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

L’indice du jour retient le meilleur créneau entre 1 h avant et 2 h après le lever du soleil.
Les seuils et pondérations sont dans `js/forecast.js` (`scoreHour`). C’est une heuristique, à ajuster avec l’expérience du terrain.

## Fichiers

- `js/config.js` : sites, vallées de référence, webcams, URLs meteoblue/Windy
- `js/forecast.js` : récupération Open-Meteo (cache 30 min) et calcul de l’indice
- `js/app.js` : interface (accueil, page lieu, navigation, réglages)
- `js/scene.js` : illustration animée (montagne, mer de nuages, ciel)
- `js/icons.js` : icônes SVG
- `manifest.webmanifest`, `icon.svg`, `apple-touch-icon.png` : installation sur l’écran d’accueil
