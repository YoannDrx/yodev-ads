# Lot 19 — portefeuille agence, vues personnelles et revue de charge

7 septembre 2026. Implémentation T16 ; contrat détaillé dans [PORTFOLIO.md](../../PORTFOLIO.md).

Le portefeuille réunit les comptes gérés, leurs historiques qualifiés sur 30 jours terminés, le pacing mensuel, les alertes critiques, les tâches et les décisions en attente. Les agrégats couvrent tous les comptes filtrés, avec pagination des lignes à 25. Devises, fuseaux et périodes sont séparés ; données inconnues, anciennes, héritées et sources vides/futures ne deviennent pas de faux zéros.

Les vues personnelles conservent les filtres, avec un quota de 20 par utilisateur/espace, des versions empêchant les écrasements concurrents, des audits et une isolation RLS par utilisateur et espace. La grâce autorise la lecture seulement ; la suspension interdit l’accès. Les exports incluent les vues et la suppression de l’espace les supprime par cascade. La charge d’équipe inclut les tâches sans compte et les anciens responsables ; les liens ouvrent leurs tâches ou leurs comptes concernés.

La synthèse hebdomadaire réutilise ces groupes qualifiés au lieu de sommer des snapshots hérités et de supposer l’euro. Son occurrence reste liée à la date de création du job lors des reprises. Les transports existants conservent leurs contrôles et leur outbox ; aucun envoi réel n’a été effectué.

## Preuves locales

- `check.log` : **1 279 tests / 174 fichiers**, cinq tests de release, lint, types, frontière App Router, sérialisation transactionnelle, build et audit runtime réussis. Couverture : 92,53 % instructions, 87,03 % branches, 93,28 % fonctions, 95,21 % lignes ; aucune vulnérabilité runtime signalée. `check-final.log` consigne le passage après les derniers ajustements SQL/UI et de recette.
- `database-initial.log` : mise à niveau locale cumulative avec la migration additive `0053_portfolio_saved_views`.
- `database-fresh.log` : **54 migrations depuis une base PostgreSQL 17 vide**, puis toutes les recettes RLS/rôles/contraintes/invariants/concurrence, collectes, sélection, éditions, collections et statut public. Les deux nouvelles recettes portent sur le portefeuille et les vues.
- `database-portfolio-final.log` : 50 comptes, 45 qualifiés initialement, trois devises et deux fuseaux, montants de plus de 21 chiffres, zéro distinct d’absence, lectures périmées/héritées/futures/mauvaise devise, source blanche rejetée, recherche littérale, filtres complets, pagination, compteurs métiers, charge sans client, grâce/suspension. Appels fournisseurs interdits dans le processus.
- Les vues sont testées avec deux utilisateurs et deux espaces : lecture sans filtre sous RLS, tentative d’insertion au nom d’autrui, mises à jour concurrentes, suppression obsolète, deux créations disputant la dernière place, quota propre à chaque utilisateur et cascade de suppression.
- `browser-final.log` : **4 scénarios réussis en 22,2 secondes, aucun skip**, comprenant les deux longues recettes portefeuille et les deux recettes navigation FR/EN. Les parcours vérifient pagination de 50 comptes, filtres, vues création/renommage/suppression/conflit, liens vers tâches non attribuées, disparition après achèvement d’une tâche, accès client/anonyme refusé, grâce en lecture seule et absence de débordement global à 390 px. Captures FR/EN desktop/mobile archivées.

## Échecs intermédiaires et portée

Le premier test supposait qu’un panneau natif `details` serait refermé après chaque Server Action : React conserve son état lorsque l’URL reste identique. La recette attend désormais la nouvelle version et ouvre le panneau seulement si nécessaire. Un deuxième sélecteur d’alerte incluait l’annonceur de route Next ; il cible maintenant le message de conflit.

Une recette de navigation démarrait parfois avant l’hydratation, lorsque le lien HTML effectue normalement une navigation native. Le contrôle de conservation du document attend maintenant le sélecteur d’espace, qui apparaît après chargement de la session côté client. Les assertions clavier/retour arrière et de conservation du document restent présentes.

`browser-full-initial.log` conserve le passage de **45 scénarios : 43 réussites, un échec et un scénario non exécuté**. L’échec venait du contrôle de console plus strict ajouté au portefeuille. `browser-csp-diagnostic.log` attribue les violations de style au script `next-devtools` et au portail/panneau de développement. La recette finale distingue ces événements structurés des violations applicatives, sans modifier la CSP. Chaque locale du passage final enregistre 231 violations du panneau de développement et zéro erreur applicative. Les captures utilisent `caret: initial` pour éviter que Playwright injecte des styles de curseur pendant l’hydratation.

Le passage complet a aussi rencontré des réponses 429 sur les lectures de session après de nombreuses navigations rapides, ainsi que des avertissements de capture/hydratation dans les anciennes recettes. Les plafonds du produit n’ont pas été abaissés. Le passage final ciblé ne vaut pas un passage complet de 45 scénarios sans avertissement ; cette limite reste à traiter dans la recette T17/T22.

Aucune migration distante, aucun déploiement, appel Google ni réception fournisseur certifiée. Le serveur navigateur et les fixtures sont nettoyés. Les mesures de performance en environnement déployé et les preuves de lancement restent distinctes de ces validations locales.
