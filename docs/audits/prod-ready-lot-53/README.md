# Lot 53 — Admission courante des opérations de domaines

Base : `6be562d`. Suite T04/T05/T17/T18. Aucune migration ni extension de privilège SQL.

La création d'un domaine exige maintenant le rôle courant d'administrateur et la capacité `custom_domain` dans la transaction. L'expiration d'essai après les attentes annule domaine, révélation DNS et audit. Vérification et révocation commencent également par le garde d'acteur ; les lectures de domaine sont verrouillées et limitées au workspace et à l'identifiant demandés.

La vérification mémorise la révision PostgreSQL `xmin` de la ligne, puis réautorise l'acteur et compare cette révision avant chaque requête Vercel. Une perte de droit pendant la résolution DNS bloque le premier appel ; une perte pendant la réponse d'ajout empêche les appels Vercel suivants, y compris la vérification de propriété. Après le contrôle de disponibilité HTTP, l'activation exige à nouveau acteur, capacité, révision et essai courants. Les verrous de base ne sont pas gardés pendant le réseau.

La révision complète de ligne évite de limiter la détection de changement à un timestamp JavaScript arrondi à la milliseconde. Une réponse obsolète ne peut ni écraser la nouvelle configuration, ni y inscrire son erreur. Les erreurs persistées sont remplacées par un message applicatif fixe ; les détails fournisseur ne sont plus stockés dans `lastError`.

La suppression ne requiert pas de conserver le forfait Agency : un administrateur autorisé peut nettoyer son ancien domaine après downgrade. Une suppression fournisseur admise et confirmée est ensuite enregistrée comme telle, même si l'acteur perd ses droits pendant la requête. Ce traitement est un constat de retrait déjà effectué, pas une nouvelle activation ; il verrouille le domaine et refuse d'écraser une révision différente.

## Preuves

- `check.log` : **1 596 tests / 201 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,39 / 86,23 / 92,87 / 94,29 %**. Les 22 tests ciblés de gestion/adaptateur Vercel passent, dont les refus avant premier appel, avant lecture de configuration et avant vérification d'un domaine déjà enregistré.
- `domain-actors.log` : trois matrices de rôle/adhésion/lifecycle, trois attentes d'adhésion avant fournisseur, capacité courante, deux expirations pendant l'audit, pertes de droits pendant DNS/Vercel/sonde HTTP, refus d'une révision modifiée, activation autorisée, retrait après downgrade, constat de suppression après révocation de l'acteur et erreur persistée sans détail privé. **DNS et HTTP interceptés ; zéro appel fournisseur réel.**
- `database.log` : toute la recette PostgreSQL passe avec ce nouveau protocole, enregistré dans le runner commun à la CI. La preuve des 60 migrations depuis une base vide demeure celle du lot 33.

## Limites et suite obligatoire

Ce lot sécurise l'admission et les écritures locales ; il ne certifie pas encore le protocole fournisseur complet. Un ajout accepté par Vercel peut précéder un refus d'activation locale. Une interruption du processus après ajout ou retrait peut encore nécessiter une reprise. Il faut poursuivre la persistance des opérations, leur réconciliation et leur nettoyage, y compris vérification/révocation concurrentes et résultat fournisseur ambigu, sans compensation aveugle susceptible d'effacer une opération plus récente.

À traiter également : réenregistrement d'un hostname déjà révoqué (index global unique), classification structurée des erreurs fournisseur plutôt que recherche de « 404/not found » dans leur texte, contrôle de la sonde de domaine, formulaire lié à son espace et affichage FR/EN des nouveaux refus. Ces points restent dans le périmètre de stabilisation, avec leur recette fournisseur réelle.

Aucune UI modifiée ou recette navigateur rejouée ici. La dernière recette ciblée reste celle du lot 52 (six parcours de rapports), la générale celle du lot 43 (76 parcours), avec 84 scénarios disponibles. Aucun déploiement, validation DNS/Vercel réelle ou gate de lancement n'est certifié ; l'objectif intégral demeure actif.
