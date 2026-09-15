# Collections de travail — première partie de T14

Les pages Alertes, Approbations, Audit, Tâches et Support interrogent maintenant PostgreSQL par pages de 25 résultats. Recherche et statut sont appliqués avant la limite. Un identifiant d’entité peut ouvrir directement un ancien élément. Les filtres de compte, d’assignation et de sévérité sont supportés côté repository pour les ressources correspondantes ; leur exposition dans le cockpit portefeuille est suivie sous T16.

## Ordre et curseurs

L’ordre est `created_at DESC, id DESC`, y compris pour les tâches et le support : les échéances et états restent visibles mais ne déplacent pas une ligne pendant la consultation. Le premier appel fige une borne de création à l’horodatage PostgreSQL de la transaction. Le curseur conserve cet horodatage et la dernière paire date/UUID avec les six décimales PostgreSQL. Aucune conversion en `Date` JavaScript avant la comparaison SQL ; elle perdrait les microsecondes et pourrait sauter des lignes.

Le curseur est un petit payload chiffré/authentifié avec le trousseau existant, versionné et expirant après 24 heures. Il est lié au workspace, à la collection, aux filtres et, pour les lectures de support restreintes, au demandeur. Le contenu des lignes n’y est pas copié. Un curseur falsifié, expiré ou d’un autre contexte affiche une erreur explicite avec retour aux résultats récents. Un changement de filtre repart de la première page.

La borne exclut les nouvelles insertions ordinaires d’une traversée existante. Les suppressions et changements d’état restent reflétés lors des requêtes suivantes : il ne s’agit pas d’un snapshot historique MVCC conservé pendant 24 heures. Les compteurs portent sur l’ensemble des résultats correspondant aux filtres et à la borne, et non sur les 25 lignes affichées. Les approbations disponibles pour un batch sont explicitement celles de la page.

## Discussions et continuité

Les listes ne chargent plus tous les messages du workspace. Une jointure latérale récupère au maximum six messages par entité affichée : cinq sont présentés, le sixième signale la suite. L’historique dédié `/discussions/{kind}/{id}` permet de parcourir tous les messages et de rechercher leur contenu. Les horodatages et UUID suivent les mêmes règles de pagination. Les anciens services non paginés d’approbations, audit, tâches et support ont été supprimés ; leurs tests sont remplacés par ceux des nouveaux repositories et la recette PostgreSQL.

L’historique applique la permission courante et la frontière de workspace. Pour un client au rôle restreint, le support exige aussi que le ticket lui appartienne. Les notes internes du support sont exclues de la liste, des prévisualisations, de la recherche et de l’historique. Les actions de commentaire et de mise à jour reviennent sur l’entité concernée et invalident son historique, afin qu’une action sur un ancien élément reste visible. Une tâche terminée ouverte par identifiant ne disparaît pas derrière le filtre « ouvertes ».

## Migration et vérification

`0051_workspace_collection_pages.sql` ajoute dix index pour les parcours workspace/date/UUID et parent/date/UUID, dont un index de support par demandeur. Aucun changement de données ou de privilèges. Elle s’applique via le migrateur habituel ; les créations d’index classiques doivent être intégrées à la fenêtre de migration du candidat. Le code précédent reste compatible avec ces index supplémentaires.

Depuis `web/`, avec une base PostgreSQL **locale jetable** :

```sh
npm run check
YODEV_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:56187/yodev_test npm run db:verify-local
YODEV_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:56187/yodev_test npm run test:e2e:local -- --grep 'workspace collection navigation'
```

La fixture `verify-workspace-collections.ts` est incluse dans la suite de base locale. Elle parcourt cinq collections de 521 éléments et quatre discussions de 701 messages, avec des dates à microsecondes et des égalités départagées par UUID. Elle vérifie les curseurs étrangers/falsifiés, un changement de filtre/demandeur, l’insertion pendant une traversée, les caractères `%`/`_` traités littéralement et les notes internes inaccessibles. La recette navigateur FR/EN vérifie recherche, page suivante, ancien message, commentaire d’une ancienne tâche et refus d’un ticket étranger au lecteur.

Les [preuves du lot 13](./audits/prod-ready-lot-13/README.md) concernent ces cinq collections. T14 reste ouvert pour les vues analytiques/insights, les listes de rapports et chronologies restantes, les plafonds GAQL et les exports de résultats volumineux. Le résumé d’alertes utilisé par l’ancien cockpit sera remplacé dans le travail de portefeuille ; il ne constitue pas encore un comptage exhaustif de toutes les alertes du workspace.

La pagination de l’API privée est désormais vérifiée séparément : [contrat et preuves](./API_PAGINATION.md).

## Écritures de tâches

La création, la modification et les commentaires relisent l’acteur dans leur transaction, avec des permissions distinctes de gestion et de discussion. Les lignes d’identité/espace restent verrouillées et les essais sont contrôlés de nouveau après les attentes métier. Le commentaire, son audit et ses jobs de mention sont atomiques. Une modification verrouille la tâche avant de valider sa transition afin de ne pas écraser une complétion concurrente. Le [lot 36](./audits/prod-ready-lot-36/README.md) documente les reproductions PostgreSQL et les parcours FR/EN ; la livraison effective des notifications reste une preuve fournisseur distincte.
