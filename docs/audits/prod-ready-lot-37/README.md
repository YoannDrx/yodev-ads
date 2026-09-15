# Lot 37 — Paramètres, vues personnelles et redirections après révocation

Base : `d0124f0`. Suite T04/T05/T15/T17, aucune migration supplémentaire (60 cumulées).

Les cinq mutations de paramètres et les trois écritures de vues personnelles relisent désormais l’acteur dans leur transaction. Rôle, adhésion, lifecycle, forfait et expiration de l’essai sont vérifiés sous les verrous communs ; un refus après une attente métier annule également les audits. Les politiques d’approbation sont recalculées depuis l’offre courante. L’objectif refuse les comptes managers et utilise la devise du compte verrouillé ; les audits de paramètres utilisent les valeurs précédentes réellement enregistrées. Le remplacement/retrait de logo retourne l’ancienne URL autoritative pour le nettoyage Blob de l’action.

Les 19 pages ordinaires authentifiées utilisent un garde de permission fondé sur leur chemin déclaré. Le layout n’autorise plus une redirection à partir d’un en-tête de chemin pouvant être repris depuis la Server Action d’origine. Un accès retiré mène au support ou à la facturation selon les droits actuels. Les deux pages d’opérations conservent leurs contrôles spécifiques et leurs refus terminaux. Les Server Actions gardent leur contrôle par exception, indépendant du rendu.

## Reproductions et PostgreSQL

- `actor-reproduction.log` : sept écritures sur huit réussissaient pour un acteur devenu client. La huitième rencontrait un conflit de version entre opérations de vue concurrentes, sans constituer un refus d’autorisation.
- `settings-actors.log` : huit opérations refusées pour acteur révoqué/retiré, lifecycle inactif et essai expiré ; huit attentes d’accès observées suivies d’une révocation ; trois downgrades pendant une attente ; huit expirations après autorisation pendant les verrous métier, sans écriture ni audit partiel. Audits de devise/valeurs précédentes, politique dérivée, ancienne URL et vues d’analyste contrôlés. Aucun appel fournisseur.
- `portfolio-views.log` : quota de 20, versions concurrentes, isolation utilisateur/espace, grâce et suppression en cascade restent vérifiés avec de vraies identités et adhésions locales.
- `database.log` : tous les protocoles du runner partagé avec la CI passent sur PostgreSQL 17 et les 60 migrations existantes. La dernière recette depuis une base vide reste celle du lot 33 ; ce lot ne modifie pas le schéma.
- `check.log` : **1 417 tests / 190 fichiers**, huit tests de scripts, lint, types, frontières des données et sérialisation, build et audit runtime sans vulnérabilité détectée. Couverture **92,60 / 87,38 / 93,34 / 95,24 %**.

## Recette navigateur et corrections du protocole

`browser-initial.log` conserve deux parcours portefeuille réussis et deux échecs de paramètres : l’hypothèse d’un statut 404 dans un rendu de Server Action était incorrecte. `browser-redirect-reproduction.log` révèle ensuite un défaut réel : 273 requêtes GET vers le support et une fermeture prématurée du flux, après révocation depuis un formulaire. Le nouveau garde de page supprime cette dépendance au chemin transmis par l’action. Les contextes associés sont expurgés.

`browser-general-initial.log` conserve **65 réussites sur 66**, avec un échec du parcours de vigie anglais. Le test enchaînait la sélection suivante après le commit PostgreSQL sans attendre le nouveau rendu, lequel pouvait remplacer la sélection. Il attend désormais aussi le badge de statut et le contrôle attendu. `browser-monitoring-selector.log` conserve un essai intermédiaire échoué à cause du libellé de bouton choisi dans le test (« Deactivate » au lieu de « Pause »), ensuite corrigé d’après le composant.

`browser-targeted-final.log` : **quatre parcours FR/EN réussis en 14,2 s**. Les nouvelles recettes vérifient langue, double approbation, marque, refus après downgrade/révocation, arrivée sur un support effectivement visible et refus des accès directs aux pages. Les valeurs et audits sont comparés à PostgreSQL. Les contrôles des vigies et alertes restent utilisables et rejettent le formulaire révoqué.

`browser-general-final.log` : **66 parcours réussis sans skip en 3,5 minutes**, dont les cinq rôles, identité/sessions, navigation FR/EN et mobile, contrôles analytiques, portefeuille, rapports et collections. Le contrôle complet précède uniquement les derniers ajustements des tests navigateur ; `types-final.log` et `lint-final.log` vérifient ceux-ci.

`browser-captures-final.log` : les **deux parcours de paramètres passent encore en 8,1 s** après le seul recentrage des formulaires pour les captures. L’en-tête fixe masquait initialement le sélecteur de politique dans l’image ; les quatre captures finales FR/390 px et EN/1440 px ont été inspectées à leur résolution originale, avec les contrôles visibles. Le code applicatif est identique à celui de la recette générale.

## Limites

Ces preuves utilisent Better Auth et PostgreSQL locaux, des fournisseurs désactivés ou dépourvus de credentials et aucun worker fournisseur. Aucun envoi, mutation Google, nettoyage Blob réel, déploiement, migration distante ou CI distante n’est certifié. Un nettoyage Blob échoué n’a pas encore de reprise durable. Les autres mutations (sécurité, membres, sélection, rapports, domaines et lifecycle), les messages de capacité encore techniques, les dates/sources de tâches et les critères externes du plan restent ouverts. Contrat : [paramètres et accès](../../WORKSPACE_MUTATIONS.md).
