# Lot 16 — consultation et export des collections analytiques

Preuves locales du 7 septembre 2026.

- `check.log` : contrôle complet réussi, 1 217 tests applicatifs / 166 fichiers, cinq tests de vérification de release, types/lint/frontières/sérialisation, build et audit runtime sans vulnérabilité. Couverture : 92,35 % instructions, 86,77 % branches, 93,14 % fonctions, 95,10 % lignes.
- `database.log` : suite PostgreSQL complète sur les 53 migrations déjà présentes ; nouvelle recette des 701 lignes, aperçu SQL borné, recherche littérale, export complet, changement de source et frontières tenant/lifecycle.
- `browser.log` : quatre parcours ciblés réussis en 19,1 secondes, sans skip. Nouveaux parcours FR à 390 px et EN à 1 440 px, plus relecture des deux parcours de synchronisation en grâce sans Google.
- `analytical-search-fr.png` et `analytical-search-en.png` : captures inspectées de la 651e ligne, avec détails ouverts, nom long Unicode, montant négatif et montant dépassant la précision entière JavaScript. Aucun débordement horizontal détecté.
- `signin-initial.png` : contrôle initial agent-browser réussi, formulaire visible, aucun échec JavaScript remonté.

L’export téléchargé est comparé aux 701 lignes originales, indépendamment de la recherche réduite à une seule ligne. Les tests vérifient les HTTP 409 après actualisation, 404 pour un client absent et 403 sans session. Les payloads sont des fixtures, sans appel Google. Les fixtures navigateur ont été nettoyées et le serveur/navigateur fermés.

Les premières vérifications ont relevé une date de référence manquante dans la fixture PostgreSQL et un nom de variable `window` masquant celui du navigateur dans le test TypeScript ; les fixtures ont été corrigées avant les passages réussis ci-dessus. Aucun déploiement, migration distante ou nouvelle migration dans ce lot. Le partitionnement des grandes sources et les autres collections restent nécessaires pour fermer T14.
