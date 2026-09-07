# Lot 39 — Gestion des membres face aux retraits concurrents

Base : `b78739d`. Suite T04/T05/T17, aucune migration supplémentaire (60 cumulées).

La gestion des membres conserve une transaction système, nécessaire aux tables d’identité Better Auth. Elle verrouille maintenant la ligne du workspace et l’adhésion de l’acteur, en plus du verrou d’accès applicatif. Un retrait ou changement de rôle concurrent effectué sans ce verrou d’accès est donc relu avant l’autorisation. Le transfert verrouille aussi la cible avant de la désigner propriétaire.

Invitation, changement de rôle, retrait, annulation d’invitation et transfert vérifient l’essai après acquisition des verrous et après les écritures. L’expiration annule ensemble membres, sessions, invitations, jobs et audits. Le contrôle final porte sur le temps écoulé : un transfert, une rétrogradation volontaire ou un retrait de soi déjà autorisé ne sont pas rejetés au seul motif que l’acteur a volontairement cédé ses droits.

Les préférences personnelles utilisent le garde tenant d’acteur courant avec `workspace:read` et `monitoring`. Une adhésion retirée ne peut plus enregistrer de préférences ; les membres courants conservent la permission existante, y compris le rôle client. L’essai expirant pendant l’écriture annule aussi l’audit.

## Preuves

- `actor-reproduction.log` : sur le service du commit de base, une invitation est enregistrée pendant qu’une suppression de l’adhésion de l’acteur est encore non commitée dans une autre connexion. La lecture simple utilisait l’ancienne adhésion sans attendre.
- `target-reproduction.log` : une suppression concurrente de la cible bloquait son UPDATE de rôle, mais après le commit du retrait l’ancien code terminait le transfert vers cette cible sans adhésion. Ces deux reproductions ont temporairement utilisé le service du commit de base et une variante locale de la fixture ; les fichiers corrigés ont ensuite été restaurés.
- `member-mutations.log` : refus des six opérations pour adhésion retirée, lifecycle inactif ou essai expiré ; cinq attentes observées sur la ligne d’adhésion de l’acteur, sans verrou d’accès du côté du retrait ; cible supprimée refusée lors du transfert ; six expirations après autorisation pendant l’attente d’audit, sans état partiel. Transfert, rétrogradation et retrait de soi autorisés pendant un essai valide ; préférence personnelle du membre client conservée.
- `database.log` : tous les protocoles PostgreSQL passent, notamment ceux des frontières d’adhésion, admissions/quota, sessions et le nouveau protocole intégré au runner partagé avec la CI. La dernière recette depuis une base vide reste celle du lot 33 ; ce lot ne modifie pas le schéma.
- `check.log` : **1 427 tests / 190 fichiers**, huit tests de scripts, lint, TypeScript, frontières et sérialisation, build et audit runtime sans vulnérabilité détectée. Couverture **92,56 / 87,44 / 93,36 / 95,23 %**. Les trois nouveaux tests unitaires ciblent l’expiration initiale/finale et la rétrogradation volontaire.
- `browser.log` : **quatre parcours réussis en 8,9 s**, les deux transferts existants et deux préférences personnelles FR/390 px et EN/1440 px. Enregistrement/rechargement des préférences, heure/fuseau et option de mention comparés à PostgreSQL ; ancien formulaire refusé après passage en grâce, avec un seul audit de sauvegarde. Captures inspectées à leur résolution originale ; pas d’erreur de page ni de débordement horizontal. `types-final.log` et `lint-final.log` couvrent le nouveau fichier E2E ajouté après le contrôle complet.

## Limites et suite identifiée

La dernière recette générale reste celle du lot 37 (66 parcours). Avec les quatre scénarios ajoutés aux lots 38–39 et les deux contrôles locaux activés, 70 scénarios sont disponibles ; leur passage général n’est pas revendiqué ici. Aucun fournisseur, déploiement, migration distante ou CI distante.

La préférence enregistrée ne certifie pas un email reçu ni l’autorisation de son contenu. La revue de `task-notifications.ts` révèle que les mentions et digests personnels relisent le workspace mais pas l’adhésion ni les droits actuels du destinataire avant préparation/envoi. Ce contrôle doit être corrigé, y compris pour les jobs déjà en attente et les changements d’adresse vérifiée. Les préférences restent exposées dans les paramètres réservés aux administrateurs, alors que leur service permet les membres courants : un accès personnel cohérent reste à livrer après protection des destinataires. Les autres mutations et validations externes du plan restent ouvertes.
