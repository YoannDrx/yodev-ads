# Lot 13 — collections métier et discussions

Première partie de T14, 7 septembre 2026. Contrat : [WORKSPACE_COLLECTIONS.md](../../WORKSPACE_COLLECTIONS.md).

- `check.log` : 1 165 tests / 161 fichiers ; couverture au-dessus des seuils inchangés, build, lint, types, frontières, sérialisation, tests de release et audit runtime sans vulnérabilité.
- `build-final.log`, `lint-final.log`, `types-last.log` : vérifications après les derniers ajustements. Le build final inclut le correctif de l’en-tête mobile.
- `database-suite.log` : migration 0051 appliquée à la base locale existante, soit 52 migrations cumulées ; toutes les suites locales de base réussissent. Les erreurs de connexion à la fin de certains exercices correspondent aux scénarios de délai/annulation du vérificateur de concurrence, qui réussit ensuite.
- `collections-database.log` : cinq collections de 521 éléments, quatre discussions de 701 messages, précision des dates, curseurs et frontières de lecture vérifiés. Aucun appel réseau fournisseur.
- `browser-focused.log` : deux scénarios FR/EN, 18,3 secondes, recherche et pagination, dernier/ancien message, commentaire d’une ancienne tâche, retour sur cette tâche et refus du support d’un autre lecteur.
- `browser-full-before-header-fix.log` : 33 réussites et un défaut de débordement mobile provoqué par la marque longue d’une fixture précédente ; le second scénario dépendant n’est pas exécuté.
- `browser-full-final.log` : 35 scénarios réussis, aucun skip, après correction et ajout du cas de marque longue directement à la fixture des collections.
- `collections-*.png`, `discussion-*.png` : captures finales FR à 390 px et EN à 1440 px, inspectées. Les données sont artificielles et nettoyées après la recette.

Les anciennes vérifications unitaires des services supprimés sont remplacées par celles des nouvelles collections et la recette PostgreSQL réelle. Ces preuves ne portent pas encore sur l’ensemble de T14 : les vues analytiques, limites GAQL, API et exportations volumineuses restent ouvertes. Aucun déploiement, migration distante ou fournisseur réel n’est revendiqué.
