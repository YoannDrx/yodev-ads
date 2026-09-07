# Lot 40 — Destinataires de tâches et préférences personnelles

Base : `33df670`. Suite T04/T15/T17. Aucune migration supplémentaire ; 60 migrations cumulées.

Les notifications de tâches contrôlent l’adhésion, le rôle, le forfait, le lifecycle, l’essai et l’adresse vérifiée du destinataire. Elles répètent ce contrôle après la revendication durable, avant le fournisseur. Les jobs vérifient également leur payload, workspace, tentative et bail actuels. La revendication du registre verrouille son état précédent pour préserver les tentatives ambiguës si l’admission est ensuite refusée. Les nouveaux audits distinguent acceptation et réception.

Les membres accèdent à `/account/notifications` depuis leur compte. Le formulaire partagé avec les paramètres lie la sauvegarde à l’espace affiché ; le rôle client reçoit une explication sur l’absence d’emails de tâches. Les refus conservent une destination locale autorisée et la sécurité personnelle reste disponible en grâce. Voir le [contrat](../../TASK_NOTIFICATIONS.md).

## Vérifications

- `task-recipients.log` : deux matrices de refus (mention/digest) pour membre retiré, client, adresse non vérifiée, grâce et essai expiré ; switch désactivé ; adresse actuelle utilisée même avec un ancien ciphertext invalide ; clés acceptées non soumises de nouveau. Quatorze révocations pendant une attente PostgreSQL réelle du registre (incluant adresse et consentement), deux ambiguïtés conservées après révocation, refus de contexte de job incorrect et bail expiré pendant l’attente. Quatre soumissions simulées en mémoire, zéro appel fournisseur réel. Le rôle système reste sans droit UPDATE sur `auth_users`.
- `database.log` : suite PostgreSQL complète et nouveau protocole intégré au runner commun avec la CI, sur la base jetable existante. Dernière base vide vérifiée au lot 33 ; aucune modification du schéma dans ce lot.
- `check.log` : **1 440 tests / 191 fichiers**, huit tests de scripts, lint, TypeScript, frontières de données et sérialisation, build et audit runtime sans vulnérabilité détectée. Couverture **92,30 / 87,01 / 93,13 / 95,03 %**. Les tests ajoutés ciblent les refus de destinataire et la conservation d’incertitude après contrôle final.
- `browser.log` : **quatre parcours en 13,6 s**, paramètres existants et nouvelle page personnelle FR/390 px et EN/1440 px. Persistance et rechargement vérifiés en base, formulaire d’un autre workspace refusé, rôle client explicite, grâce refusée pour la page métier et compte personnel encore accessible. Pas d’erreur de page ni de débordement horizontal. Les quatre captures sont conservées et inspectées à leur résolution originale. Contrôle agent-browser du serveur : connexion rendue, contenu et contrôles présents, aucun écran d’erreur Next ; session fermée.
- `types-final.log` et `lint-final.log` couvrent le nouveau fichier navigateur ajouté après le contrôle complet.

## Suites ouvertes

La dernière recette générale reste celle du lot 37 (66 parcours). Les deux contrôles locaux rendent désormais 72 scénarios disponibles ; leur passage général n’est pas revendiqué ici. Aucun déploiement, migration distante, CI distante ou email réel.

Le plafond de 50 tâches dans les récapitulatifs et les autres plafonds T14 doivent encore être traités. Les mutations de sélection de comptes, OAuth, rapports, domaines et lifecycle doivent poursuivre leur revue d’autorisation courante. Les certifications fournisseurs et critères de lancement T18–T23 restent ouverts ; l’objectif global demeure actif.
