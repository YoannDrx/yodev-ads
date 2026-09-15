# Lot 34 — Droits courants des vigies et workflows d’alerte

Base : `9c7199d`. Aucune migration supplémentaire : 60 migrations cumulées. Suite T04 ; le plan global reste en cours.

Les cinq opérations création de vigie, activation/désactivation, demande de scan, acquittement et workflow d’alerte relisent maintenant le rôle, l’adhésion, le lifecycle et l’offre dans leur transaction. Les verrous protègent ces références pendant les écritures. Un second contrôle des essais après les attentes métier annule toute l’opération si l’essai a expiré, y compris ses jobs, commentaires, audits et jalons. Les quotas utilisent l’offre relue, indépendamment du contexte transmis par l’appelant.

## Preuves

- `reproduction.log` : avant correction, les cinq mutations acceptaient un acteur devenu analyste après le précontrôle d’action.
- `check.log` : **1 398 tests applicatifs / 190 fichiers**, huit tests de scripts, lint, types, frontières des données et transactions, build et audit runtime sans vulnérabilité détectée. Couverture **92,66 / 87,40 / 93,32 / 95,25 %**.
- `database.log` : suite PostgreSQL complète réussie sur la base locale existante. Le protocole des quotas/workers possède désormais une identité et une adhésion réelles. Le nouveau protocole `verify-monitoring-actors.ts` appartient au runner également utilisé par la CI.
- `trial-expiry.log` et le dernier protocole de `database.log` : refus des cinq opérations pour adhésion supprimée, rôle retiré, états inactifs et essai expiré ; cinq véritables attentes sur le verrou d’accès suivies d’une révocation ; cinq attentes métier après autorisation suivies d’une expiration. Les compteurs métier, jobs, commentaires, audits et jalons restent inchangés après refus. Les cinq opérations restent utilisables par le stratège autorisé. Les appels fournisseur sont interdits dans ce protocole.
- `browser.log` : **quatre parcours ciblés réussis en 14,2 s**, deux nouveaux parcours de vigies/workflow et les deux parcours de qualification d’alertes. Better Auth/PostgreSQL réels locaux, FR à 390 px et EN à 1440 px, soumissions des formulaires, révocation entre affichage et envoi, aucune erreur de page ni débordement horizontal. Captures inspectées. Elles exposent encore un message de permission technique à améliorer dans une suite T15.

La dernière recette générale reste celle du lot 33 (60 scénarios). Deux nouveaux scénarios sont disponibles ; une recette générale de 62 n’est pas revendiquée. Aucune base vide n’a été recréée pour ce changement sans migration. Aucun appel Google, envoi réel, worker fournisseur, migration distante, CI distante ni déploiement.

La protection ne s’étend pas implicitement aux autres services : les avis de qualité utilisent encore leur contrôle initial, et les autres mutations métier restent à examiner. Le contrôle final de l’essai est effectué avant le commit applicatif ; aucune garantie d’horloge distribuée ni validation fournisseur n’est déduite de cette recette locale.
