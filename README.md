# Mers de nuages · Vosges du Nord

Dashboard statique (HTML/JS, sans build) qui prévoit les mers de nuages sur 5 jours pour :
Donon, Rocher de Mutzig, Rocher de Dabo, Col du Valsberg et Château du Haut-Barr.

## Lancer

Le plus simple : double-cliquer sur **`Lancer le dashboard.command`**. Il démarre le serveur local et ouvre le navigateur.
La première fois, macOS peut demander une confirmation : clic droit → Ouvrir. Garder la fenêtre du Terminal ouverte tant qu’on utilise le dashboard.

Ou à la main :

```bash
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765. Un serveur est nécessaire, car les modules ES ne se chargent pas en `file://`.

## Contenu

- **Prochains matins** (en haut) : grille sites × 5 matins. Chaque case montre une coupe illustrée (montagne, nuages, ciel) et l’indice. À côté de chaque site : température, humidité et point de rosée actuels au sommet.
- **Carte** (à droite) : sites colorés selon le matin choisi, webcams 📷 en popup.
- **Détail** (clic sur une case) : verdict et accord entre modèles, checklist des 4 conditions, tableau heure par heure autour du lever (indice, sommet des nuages, température / point de rosée / humidité au sommet et en vallée), lien vers le météogramme meteoblue, webcams proches.
- **Toutes les webcams** (repliable) : 12 webcams Windy, image actuelle ou dernière image de jour. Un clic ouvre le timelapse 24 h.

## Cartes (inversion et saturation)

Onglet « Cartes », deux modes :

- **Saturation (T − Td)** : écart entre température et point de rosée à 2 m. Bleu foncé ≤ 0,5 °C (saturé, brouillard probable),
  bleu 0,5–1,5 °C (quasi saturé), bleu clair 1,5–3 °C (humide), rien au-delà. Badge du jour : part du secteur saturée au lever.
- **Inversion** : grille d’environ 200 points (un tous les ~4 km) de Sarrebourg à la plaine d’Alsace.
En chaque point, force de l’inversion = température la plus chaude dans les 1 500 m au-dessus du sol − température au sol (2 m).
Couleurs : jaune 0,5–2 °C, orange 2–4 °C, rouge 4–6 °C, violet > 6 °C. Choix du jour, de l’heure (par défaut le prochain lever)
et du modèle (AROME 1,3 km par défaut, ou ICON). Badge du jour : inversion maximale au lever.

Grille chargée seulement à l’ouverture de l’onglet, avec un cache d’une heure (`js/inversion.js`).

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
- `js/app.js` : interface
