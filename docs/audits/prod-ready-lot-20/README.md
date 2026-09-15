# Lot 20 — activation fondée sur une publication effective

7 septembre 2026. Correction de T21 ; ce lot ne clôt pas la mesure des coûts et de la qualité des alertes.

Une planification de rapport ne marque plus un premier rapport. La création effective d’une édition immuable écrit `first_report_published` dans la même transaction, pour les publications manuelles, API, dynamiques et planifiées. L’événement référence l’édition et sa date de publication, avec `evidence: report_edition_v1`. Une publication impossible ou annulée par rollback ne produit aucun événement ; réouverture/révision/publications suivantes conservent le premier événement.

Les anciens `first_report` restent dans l’historique et les exports. Le tableau d’exploitation et les cohortes utilisent uniquement le nouveau marqueur de publication. Cela prouve une édition produite, pas une réception email. `accounts_selected` suit désormais une sélection explicite contenant au moins un annonceur actif ; l’inventaire synchronisé reste une étape séparée.

La migration `0054_published_report_activation` élargit la contrainte SQL des milestones sans retirer les anciennes valeurs. Elle reprend le premier rapport à partir des éditions immuables conservées, et la première sélection positive à partir des audits conservés. Elle ne reconstruit pas une date à partir de préférences courantes et ne remplace pas les événements déjà établis. Les périodes historiques sans pièce conservée restent sans preuve de publication/sélection.

Les cohortes ignorent les dates invalides, les événements futurs, les événements antérieurs à l’espace et les espaces futurs. Un ancien événement invalide ne masque plus un événement ultérieur valide. Les agrégats du tableau d’exploitation appliquent les mêmes bornes temporelles. Les barres d’avancement utilisent un élément HTML `progress` avec un libellé accessible.

- `check-final.log` : **1 281 tests / 174 fichiers**, cinq tests de release, lint, types, frontières, sérialisation, build et audit runtime réussis. Couverture 92,51 % instructions, 87,04 % branches, 93,28 % fonctions, 95,19 % lignes ; zéro vulnérabilité runtime signalée.
- `database-fresh.log` : **55 migrations depuis une base PostgreSQL 17 vide** et suite complète réussie. La nouvelle recette vérifie les publications, l’absence d’événement lors d’un échec, la conservation du marqueur historique, la reprise idempotente et son périmètre tenant.
- `database-activation-final.log` : ajoute un rollback volontaire après insertion de l’édition et du marqueur ; les deux écritures sont annulées ensemble. Relecture/publication réelle puis reprise de données réussies, sans appel fournisseur.
- `browser.log` : **trois scénarios réussis en 19,2 secondes, aucun skip**. Le compteur d’exploitation exclut un ancien marqueur et une publication future. Les parcours de rapports FR/EN couvrent périodes, révisions et restitution HTML/PDF/CSV. Connexion initiale inspectée avec agent-browser, capture du tableau d’exploitation archivée.

Le premier contrôle a découvert la contrainte historique de `0023_activation_milestones`, absente du schéma TypeScript ; elle est maintenant élargie par la migration. Un `await` dans une callback de fixture non asynchrone a également été corrigé. Les diagnostics initiaux restent archivés. La base jetable déjà migrée a reçu le SQL corrigé explicitement ; le passage canonique depuis zéro est `database-fresh.log`. Aucun ancien fichier de migration publié n’a été modifié.

Déploiement : appliquer `0054` avant d’activer le nouveau code, sinon la contrainte historique refuse les nouveaux événements et annule la transaction métier. L’ancien code reste compatible avec la contrainte élargie. Un retour applicatif peut conserver les nouvelles lignes et les exporter ; ne pas effacer l’historique pour revenir à la version précédente.

Aucune migration distante ni émission/réception fournisseur réelle. Les 429 de fin de scénario PDF correspondent au contrôle négatif du parcours ; cette recette ne certifie pas une capacité de charge distante. Le suivi complet des coûts, les aides d’activation, la qualification des alertes et les preuves commerciales restent à réaliser dans T21/T22/T23.
