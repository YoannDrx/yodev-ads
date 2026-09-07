# Lot 11 — éditions de rapports

Implémentation locale de T12, 7 septembre 2026. Contrat : [REPORT_EDITIONS.md](../../REPORT_EDITIONS.md).

- `check-final.log` : vérification applicative complète, 1 098 tests / 154 fichiers, seuils de couverture inchangés ; build, lint, types, frontières de données, sérialisation, tests des preuves de release et audit runtime réussis.
- `database-fresh.log` : 51 migrations depuis une base jetable vide, suites de concurrence et fixture des rapports. Le transport email est intercepté dans la fixture : acceptation puis perte de job, reprise sans seconde soumission, ancien destinataire conservé et aucune connexion réseau réelle.
- `schema-final.log` : catalogue de vérification complété avec les éditions ; 48 tables tenantées sous RLS forcée, 37 contraintes composites et invariants sans violation.
- `browser-full.log` : 33 scénarios réussis, aucun skip.
- `browser-controls-final.log` : deux parcours FR/EN rejoués après l’alignement des contrôles de planification. Les cinq périodes passent création → révélation → HTML/CSV/PDF ; révision, conservation des anciens chiffres/PDF, données manquantes, révocation, rôle stratège et limite PDF sont vérifiés.
- Captures finales : page des éditions et rapport public, FR à 390 px et EN à 1440 px. Les identités, domaines et tokens visibles sont artificiels et révoqués par le nettoyage des fixtures.
- Journaux intermédiaires : correction d’une attente de permissions erronée dans le test, isolation des compteurs PDF de la recette et ajout des régressions nécessaires pour atteindre les seuils de couverture. Aucune limite produit ni seuil CI n’a été relâché.

Les tokens de fixture sont masqués dans les journaux texte archivés. Aucun secret fournisseur, email réel, compte Google actif, migration distante ou déploiement ne fait partie de ces preuves. La qualité PDF Unicode, la localisation des montants, les logos et les grands volumes restent suivis dans T13–T14.
