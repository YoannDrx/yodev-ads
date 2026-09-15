# Lot 51 — Gestion des planifications sous bail courant

Base : `9ff353e`. Suite T04/T05/T12/T17. Aucune migration ; 60 migrations cumulées.

La suspension/réactivation et le renouvellement du lien verrouillent désormais la planification avant de lire son bail et avant toute écriture du lien. L'ordre planification puis lien correspond à celui du worker. Une réservation apparue pendant l'attente est relue et bloque l'opération, au lieu d'être ignorée par une lecture préalable. Les deux opérations partagent le même contrôle.

L'échéance est comparée à `clock_timestamp()` dans une requête après l'attente. Un bail expirant pendant l'autorisation ne bloque donc plus l'opération à cause d'un `now` ancien. Le timestamp des nouvelles écritures est également initialisé après cette vérification, sauf date explicitement fournie par l'appelant pour ses données métier. Les contrôles d'acteur et le contrôle final d'expiration d'essai existants sont conservés.

## Preuves

- `check.log` : **1 532 tests / 199 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,31 / 86,09 / 92,85 / 94,23 %**. Les 18 tests de gestion de rapports passent, dont les deux expirations évaluées avec l'horloge après verrou malgré un timestamp appelant ancien.
- `report-management-actors.log` : les six matrices de droits/lifecycles, six attentes d'adhésion et six expirations d'essai pendant l'audit restent vertes. Deux attentes sur une planification observent le bail acquis par un worker concurrent et refusent toute modification du lien, du token ou de l'audit. Deux expirations pendant l'attente d'autorisation permettent ensuite l'opération. Les droits analyste, quotas courants et versions concurrentes restent vérifiés.
- `database.log` : toute la recette PostgreSQL passe, y compris le protocole du worker livré au lot 50. La dernière preuve des 60 migrations depuis une base vide demeure celle du lot 33.
- `browser.log` : **deux parcours FR/390 px et EN/1440 px passent sans skip en 6,1 s**. Les actions de renouvellement et suspension sont tentées avec un bail actif : message traduit visible, token et état inchangés. Après expiration, le parcours renouvelle, suspend et réactive, puis vérifie les modèles et le refus après rétrogradation. Aucun worker ou fournisseur réel. Agent-browser inspecte le rendu de connexion ; sa session et le serveur sont fermés.

## Limites et suite

Le refus protège une réservation encore active ; il ne peut annuler un email déjà accepté. Aucun changement de schéma ni privilège ajouté. Pas de déploiement ou de certification fournisseur.

La recette navigateur générale demeure celle du lot 43 (76 parcours), avec 82 scénarios disponibles. Poursuivre la cohérence des ressources référencées et le rattachement des formulaires de rapports à leur espace, les domaines/lifecycle, les plafonds de collections et les critères externes du plan. L'objectif intégral reste actif.
