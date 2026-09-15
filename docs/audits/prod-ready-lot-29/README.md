# Lot 29 — Score et première analyse qualifiés

Base : `8d25717`. Migration `0056_qualified_analysis_activation` ; 57 migrations cumulées. Aucun déploiement, migration distante ou appel fournisseur.

L’analyse exige cinq collections récentes, versionnées et de couverture de transport vérifiée, avec même période, monnaie, fuseau et contrat compatibles. Les campagnes doivent être non vides et un score fini doit être calculé. Sinon le score reste neutre, sans effacer les constats stockés. Le nouveau jalon `first_qualified_analysis` conserve période et versions des cinq sources. Les anciens `first_analysis` sont préservés mais exclus du compteur qualifié ; aucune reprise historique sans preuve n’est inventée. Une analyse qualifiée reste un événement historique lorsque les sources vieillissent ensuite.

## Preuves

- `check.log` : **1 331 tests / 183 fichiers**, sept tests de scripts, lint, types, frontières de données/transactions, build et audit runtime sans vulnérabilité. Couverture **92,55 / 87,15 / 93,30 / 95,21 %**.
- `database-upgrade.log` et `database-fresh57.log` : toutes les recettes PostgreSQL, sur la base existante puis depuis une base vide avec les 57 migrations.
- `browser.log` : **cinq scénarios réussis en 12,7 s**, analyse FR/mobile et EN/desktop, compteurs opérations et lecture analytique conservée. Absence de jalon sur données vides, inconnues, limitées ou anciennes ; score réel et versions enregistrées sur données qualifiées ; idempotence et préservation après vieillissement. Captures jointes inspectées.
- `browser-initial-fixture-error.log` conserve la première erreur du jeu de test (version non UUID), corrigée avant la recette finale. Aucun défaut produit n’a été masqué par cette correction.

La qualification concerne les requêtes reçues, pas l’exhaustivité de toutes les données métier Google. Le jalon prouve qu’une analyse qualifiée a été produite lors de la consultation serveur ; il ne prouve pas une lecture humaine. La certification des sources réelles, les coûts, la qualité des alertes et l’aide aux abandons restent à livrer pour T21.
