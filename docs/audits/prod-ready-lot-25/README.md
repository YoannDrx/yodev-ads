# Lot 25 — Refus d’invitation compréhensibles et recette générale

Base : `3a2d879`. Aucune migration supplémentaire ; **56 migrations cumulées**. Aucun fournisseur ni déploiement.

Après validation de la session, du destinataire et de l’invitation par Better Auth, un précontrôle explique l’indisponibilité du workspace ou le manque de place avant la tentative d’acceptation. Il ne remplace pas le trigger de la migration 0055, qui reste nécessaire lorsqu’un état ou un quota change après cette lecture.

L’interface traduit les codes de refus en FR/EN : rétablissement d’accès par le propriétaire, place à libérer, nouvelle invitation, bonne identité ou email à vérifier. Les messages techniques arbitraires du prestataire ne sont plus présentés tels quels. La reprise d’une acceptation réussie dont la réponse est perdue reste prioritaire et ne crée aucun droit.

## Preuves

- `check.log` : **1 320 tests / 181 fichiers**, sept tests de scripts, lint, types, frontières des données et transactions, build et audit runtime sans vulnérabilité. Couverture **92,53 % / 87,09 % / 93,27 % / 95,20 %**. Le premier passage (`initial-check.log`) a identifié une assertion UI qui attendait encore le texte brut du prestataire ; elle vérifie désormais le message utile et l’absence de détails techniques.
- `database.log` : quota concurrent, lifecycle, essai expiré et downgrade toujours vérifiés sur PostgreSQL réel ; le précontrôle SQL annonce disponible/plein/indisponible sur les mêmes fixtures.
- `targeted-browser.log` : **deux scénarios FR/EN en 24,1 s**, suspension refusée avec **403** et texte localisé, invitation toujours en attente, puis acceptation et reprise réussies. Aucun `SERVER_ERROR` ni 500 dans cette recette.
- `full-browser.log` et `full-browser/` : **53 scénarios réussis sans skip en 2,4 minutes**, avec les contrôles analytiques activés dans le runner. Cinq rôles, cycle d’authentification, invitations, transferts, accès/lifecycle, isolation, compte personnel, sélections, éditions et téléchargements, portfolio, navigation mobile, listes et statut public sont vérifiés. Aucun `SERVER_ERROR`, 500 ou `Hydration failed` dans le journal. Les 403/404/429 intentionnels font partie des assertions de refus.
- Page de connexion inspectée : contrôles présents, aucune erreur ni overlay détecté, capture `sign-in.png` inspectée à sa résolution originale. Toutes les ressources de test sont nettoyées par le runner.

La recette PostgreSQL complète depuis zéro reste celle du lot 24 ; seul son protocole d’admission, enrichi par le précontrôle, a été répété ici. Une course détectée seulement au dernier instant par le trigger peut encore produire une erreur générique ; aucun succès ni adhésion ne sont annoncés dans ce cas. Le candidat déployé, les prestataires réels et les critères de bêta restent à vérifier séparément.
