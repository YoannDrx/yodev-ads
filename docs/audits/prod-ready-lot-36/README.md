# Lot 36 — Mutations de tâches, commentaires et transitions concurrentes

Base : `cb582a9`. Suite T04/T15/T17, aucune migration supplémentaire (60 cumulées).

Création, modification et commentaire de tâche utilisent désormais le garde transactionnel de l’acteur. Gestion et discussion conservent leurs permissions distinctes : un analyste peut commenter mais ne peut pas créer ou modifier une tâche. L’expiration d’un essai pendant une attente métier annule la tâche, son commentaire, l’audit et le job de mention ensemble. Aucun fournisseur n’est appelé dans ces transactions.

La modification verrouille également la ligne de tâche avant de lire son état. Une complétion concurrente hors du verrou d’accès est donc relue avant validation : l’action « démarrer » issue de l’ancien état ne remplace plus une tâche terminée. Le refus de transition est expliqué en français et en anglais, avec une invitation à recharger les actions disponibles.

## Reproductions et preuves

- `actor-reproduction.log` : les trois opérations réussissaient malgré le rôle devenu client après le contrôle initial.
- `transition-reproduction.log` : après ajout du garde d’acteur mais avant verrouillage de la tâche, une complétion concurrente était encore écrasée par un démarrage calculé depuis l’ancien état.
- `task-actors.log` : droits révoqués/adhésion supprimée, quatre états inactifs et essai expiré refusés ; trois attentes d’accès observées suivies d’une révocation ; transition concurrente refusée ; trois attentes métier après autorisation suivies d’une expiration, sans écriture partielle. Discussion analyste et gestion stratège restent utilisables. Le job de mention est seulement mis en file ; aucune livraison réelle n’est revendiquée.
- `database.log` : toute la suite PostgreSQL locale passe, y compris ce nouveau protocole intégré au runner partagé avec la CI. Pas de recréation de base vide pour ce changement sans migration.
- `check.log` : **1 401 tests / 190 fichiers**, huit tests de scripts, lint, TypeScript, frontières des données et sérialisation, build et audit runtime sans vulnérabilité détectée. Couverture **92,64 / 87,40 / 93,32 / 95,22 %**.

## Recette navigateur

`browser-initial.log` : trois réussites (nouveau parcours FR et les deux anciens parcours de recherche/discussion), un échec dans le nouveau parcours EN. Le test sélectionnait une action après le commit PostgreSQL mais avant le nouveau rendu du formulaire : la sélection pouvait être remplacée par celui-ci. Le contexte est conservé et expurgé. Le test attend désormais aussi le badge de statut rendu avant l’opération suivante ; aucun délai produit ni transition autorisée n’est modifié pour ce test.

`browser-final.log` : **deux parcours de tâches FR/EN réussis en 19,4 s** sur Better Auth/PostgreSQL locaux. Création réelle avec SLA de 24 h et assignation, sept transitions, complétion concurrente face à un formulaire ancien, révocation du rôle de gestion, commentaire par analyste et refus de commentaire après passage en grâce. Le nombre d’audits est contrôlé ; les écritures refusées n’ajoutent aucun commentaire. Captures FR à 390 px et EN à 1440 px inspectées, sans erreur de page ni débordement horizontal. `types-final.log` et `lint-final.log` vérifient le dernier ajustement de synchronisation du test.

La dernière recette générale demeure celle du lot 33 (60 parcours). Les quatre scénarios ajoutés depuis rendent 64 scénarios disponibles avec les contrôles analytiques, sans revendiquer leur exécution générale dans ce lot. Aucun fournisseur, déploiement, migration distante ou CI distante. Les dates invalides, références de source de rapport, autres formulaires/mutations et validations de lancement restent à examiner selon le plan ; ce lot ne certifie pas tous les parcours de tâches.
