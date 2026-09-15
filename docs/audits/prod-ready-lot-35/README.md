# Lot 35 — Expiration pendant la qualification et refus FR/EN

Base : `8928ffc`. Suite T04/T15, sans migration.

Le contrôle initial d’un avis pouvait réussir, puis attendre sur la ligne de l’alerte jusqu’après l’expiration de l’essai. La reproduction PostgreSQL conserve ce succès incorrect dans `quality-reproduction.log`. Le service utilise désormais la transaction d’acteur commune, avec recontrôle final de l’essai. Le protocole observe réellement l’attente après autorisation pour une nouvelle catégorie, un retrait et un avis identique ; chaque appel est refusé sans changement d’avis, de version, de statut ou de nombre d’audits. Les anciens tests de concurrence, observation obsolète, droits inter-agence, contraintes et retrait audité passent aussi.

Les refus de permission affichent une explication FR/EN avec actualisation ou contact administrateur. Le nom technique de permission reste dans l’erreur serveur existante ; le texte visible est traduit par la couche de présentation commune. Les autres messages métier et erreurs fournisseur suivent leur comportement existant.

## Vérifications

- `quality.log` : protocole PostgreSQL complet de qualité, incluant les trois nouvelles attentes ; aucun fournisseur autorisé.
- `unit.log` : **30 tests ciblés / trois fichiers** (qualité, garde d’acteur, messages).
- `types.log`, `lint.log`, `boundary.log`, `serialization.log` : TypeScript, ESLint des cinq fichiers modifiés, frontière des données et sérialisation des transactions réussis.
- `browser-final.log` : **quatre parcours FR/EN réussis en 14,5 s**, vrai Better Auth/PostgreSQL local, qualité d’alerte et formulaires de vigies/workflow. Le message traduit est exigé après retrait du rôle. Captures finales FR/mobile et EN/desktop inspectées, sans débordement horizontal ni erreur de page.

Le contrôle général de 1 398 tests/build/audit et la suite PostgreSQL générale restent datés du lot 34 ; la dernière recette navigateur générale est celle du lot 33 (60 parcours). Ces vérifications générales n’ont pas été répétées pour cette extension ciblée d’un garde déjà éprouvé. Aucun fournisseur, migration distante, déploiement ni certification de production. La revue des autres mutations et les critères externes T18–T23 restent ouverts.
