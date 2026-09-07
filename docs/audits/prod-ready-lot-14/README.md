# Lot 14 — précision et périmètre des curseurs API

Preuves locales du 7 septembre 2026. T14 reste en cours pour les autres collections.

- `check.log` : lint, types, frontières de données, sérialisation transactionnelle, cinq tests de vérification de release, 1 187 tests applicatifs / 162 fichiers, build et audit runtime sans vulnérabilité. Couverture : 92,31 % instructions, 86,69 % branches, 93,33 % fonctions, 95,04 % lignes.
- `database.log` : suite sur PostgreSQL 17 jetable, 52 migrations cumulées déjà appliquées, invariants/RLS/concurrence/rapports/collections ; ajout de trois parcours API de 521 lignes avec microsecondes, égalités UUID, insertions et refus de curseurs étrangers.
- `load-first.log` : première recette de charge échouée, car ses approbations étaient artificiellement créées en 2037, au-delà de la nouvelle borne de départ. La fixture les crée maintenant la veille, avec des horodatages égaux pour vérifier le départage UUID.
- `load-final.log` : recette corrigée réussie ; 100 espaces, 149 comptes, 200 vigies, 10 000 notifications, 100 approbations concurrentes, quatre pages API, 1 000 ouvertures de rapport, rate limits, pool limité à dix connexions et scheduler concurrent.

Les handlers HTTP sont exercés dans les tests, avec authentification simulée. Aucun nouveau parcours UI, donc pas de nouveau passage navigateur pour cette correction. Aucun appel fournisseur, déploiement, migration distante ni changement de l’ouverture de l’API privée. Le protocole est décrit dans [API_PAGINATION.md](../../API_PAGINATION.md).
