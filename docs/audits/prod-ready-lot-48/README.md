# Lot 48 — Droits courants des modèles et planifications de rapports

Base : `5ecde26`. Suite T04/T05/T17. Aucune migration ajoutée ; 60 migrations cumulées.

Les six mutations de `report-management.ts` utilisent désormais le garde d’acteur transactionnel avec `reports:manage` et `monitoring` : créer/modifier/désactiver un modèle, créer/activer-désactiver une planification et renouveler son lien. Les droits, le lifecycle et le forfait courants sont relus sous verrou, puis l’essai est contrôlé après les attentes métier. Un refus annule modèles, versions, planifications, liens et audits de la transaction. Le quota relu conserve sa priorité sur un ancien contexte Agency fourni par l’appelant. Le rôle analyste conserve ces six fonctions ; client et strategist ne les acquièrent pas.

Le protocole d’activation utilise maintenant une vraie identité, organisation et adhésion Better Auth locales pour créer sa planification. Sa garantie reste inchangée : une planification n’est pas une édition publiée ni un jalon de première publication. Aucun privilège applicatif n’est élargi.

## Preuves

- `reproduction.log` : avant correction, le service accepte la création d’un modèle pour le rôle client (`Missing expected rejection: template_create:client`).
- `report-actors.log` et `database.log` : six matrices de rôles/lifecycles, six attentes réellement observées sur adhésion et six expirations d’essai pendant l’audit. Les écritures de versions/liens/audits sont annulées. Chaque opération réussit pour l’analyste. Le quota Solo bloque création/réactivation malgré un contexte Agency ancien ; deux modifications concurrentes d’un modèle produisent une seule nouvelle version et un audit. Toute la recette PostgreSQL, incluant l’activation avec vraie identité, passe sans fournisseur.
- `check.log` : **1 524 tests / 199 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,40 / 86,22 / 92,88 / 94,26 %**. Les 21 tests ciblés de gestion/périodes passent également. Le nouveau protocole SQL apporte les preuves de concurrence ; le nombre de tests unitaires reste inchangé.
- `browser-initial.log` : les deux parcours existants de rapports HTML/PDF/CSV et révisions passent. Les deux nouveaux parcours créent bien leur planification puis rencontrent un sélecteur ambigu : la planification et son lien ont le même titre. Le test est limité à la section des envois planifiés, sans changement applicatif pour ce point.
- `browser-final.log` : **les deux nouveaux parcours FR/mobile et EN/desktop passent en 5,4 s**. Un analyste crée/modifie/désactive un modèle, crée une planification, renouvelle son lien, suspend/réactive l’envoi, puis se voit refuser une création après rétrogradation au rôle client. Les versions et le changement de token sont vérifiés dans PostgreSQL ; aucun worker ni envoi fournisseur. Agent-browser vérifie le rendu de connexion et l’absence d’écran d’erreur ; ses sessions et le serveur sont fermés.
- `types-final.log` et `browser-lint.log` : vérifications du nouveau scénario navigateur. Seul son sélecteur est ajusté après la première recette ; aucun code applicatif ne change après le contrôle complet.

## Limites et suite

Cette livraison couvre l’autorisation transactionnelle des six services de modèles et planifications. Elle ne termine pas la revue des trois mutations de publication/révision/révocation dans `public-report-workflows.ts`. Les vérifications de bail d’envoi utilisant une heure chargée avant attente, les verrous des ressources référencées et les formulaires de rapports liés à leur espace restent à traiter. La dernière recette navigateur générale demeure celle du lot 43 (76 parcours) ; 82 scénarios sont maintenant disponibles avec les contrôles locaux.

Poursuivre ces garanties de rapports, les domaines et le lifecycle, puis les autres critères du plan : finitions linguistiques, certifications fournisseurs, candidat déployé, exigences commerciales et bêta réelle. Les preuves locales ne certifient aucune émission d’email ni mise en production. L’objectif global reste actif.
