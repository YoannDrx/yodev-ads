# Lot 15 — transport Google et couverture des collectes

Preuves locales du 7 septembre 2026. T14 reste en cours pour la consultation exhaustive des données analytiques et les autres listes.

- `check.log` : contrôle complet final réussi, 1 208 tests applicatifs / 164 fichiers, cinq tests de vérification de release, types/lint/frontières/sérialisation, build et audit runtime sans vulnérabilité. Couverture : 92,33 % instructions, 86,80 % branches, 93,10 % fonctions, 95,10 % lignes.
- `database-upgrade.log` : migration 0052 sur la base locale existante, puis suite complète (RLS, invariants, concurrence, historiques, collecte, sélection, rapports et collections).
- `database-clean.log` : même suite après les 53 migrations depuis une base vide `yodev_test_coverage_clean`.
- `browser.log` : deux parcours FR/EN réussis en 8,2 secondes, sans skip ; données reçues, limites atteintes et anciennes collectes sans métadonnée, lecture en grâce et sans fournisseur Google. Les qualifications sont des fixtures PostgreSQL, pas des preuves Google réelles.
- `stored-insights-*.png` : captures FR/EN à 1 440 px inspectées, détail des collectes ouvert et labels visibles.
- `signin-initial.png` : vérification initiale du serveur avec agent-browser ; formulaire accessible et aucun échec JavaScript remonté.

Le gateway est testé sur des réponses simulées de 10 521 comptes sur deux pages, plafonds GAQL conservés, répétition/cycle/incohérence des jetons, erreurs en milieu de lecture, borne de lignes/pages/octets cumulés, lecture bloquée sous échéance et absence de renvoi d’une mutation dont la réponse est illisible. Aucun appel Google réel, envoi, migration distante ou déploiement. Le serveur et le navigateur de recette ont été fermés, les fixtures navigateur nettoyées.

Voir [le contrat et ses limites](../../GOOGLE_COLLECTION_LIMITS.md). Le cache analytique reste borné à 1 900 000 octets normalisés ; son partitionnement et les aperçus UI encore limités restent suivis dans T14.
