# Lot 46 — Sessions OAuth Teams sous autorisation courante

Base : `94d6e33`. Suite T04/T05/T17. Aucune migration ajoutée ; 60 migrations cumulées.

Créer une session, obtenir un accès renouvelé et terminer la création d’un canal exigent désormais `workspace:admin` et `notifications.webhook` via le garde transactionnel. Le quota de canaux provient du forfait relu sous verrou ; le contexte fourni par l’appelant ne peut plus augmenter cette limite.

La session stockée est liée à son espace, son utilisateur et son fournisseur, puis verrouillée avant le contrôle de son échéance par l’horloge PostgreSQL. Le renouvellement libère les verrous avant l’appel Microsoft, puis relit les droits et la session et compare le credential courant avant de retourner l’accès. Cela vaut aussi lorsque Microsoft conserve le refresh token. Une rotation concurrente, une suppression, une expiration ou une révocation des droits empêche le retour du jeton d’accès. La fin de la transaction contrôle encore l’échéance et, pour un essai, ses droits temporels.

Le callback transmet l’échéance OAuth signée à la création de session ; elle est vérifiée avant et après les écritures. La session de sélection est créée pour 15 minutes depuis l’horloge de la base. Terminer la connexion crée canal et audit, puis consomme la session dans la même transaction ; une expiration pendant l’audit annule tout et conserve la session non consommée. Deux validations concurrentes produisent un seul canal.

## Preuves

- `reproduction.log` : la création acceptait un acteur devenu analyste avant correction (`Missing expected rejection: create`).
- `database.log` : recette PostgreSQL complète avec le nouveau protocole Teams. Trois attentes d’adhésion, trois expirations d’essai après autorisation et quatre expirations de session pendant les attentes sont contrôlées. Le protocole couvre aussi utilisateur étranger, suppression/rotation/expiration/downgrade pendant le renouvellement pour un token modifié ou inchangé, quota Studio épuisé malgré un ancien contexte Agency, expiration du callback avant et après attente de l’audit, encryption et consommation concurrente unique. **14 réponses Microsoft simulées, zéro appel fournisseur réel.** Les premières extensions de fixture ont rencontré les contraintes SQL interdisant un fournisseur autre que Teams et une expiration antérieure à la création : les données de test ont été corrigées sans modifier ces contraintes.
- `check.log` : **1 508 tests / 196 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,42 / 86,29 / 92,85 / 94,24 %**. Les 16 tests de service et cinq tests du callback complètent les preuves PostgreSQL ; un cas paramétré de test a été corrigé après sa première exécution.
- `types-final.log` : TypeScript repassé après correction des seules dates de fixture ; aucun code applicatif modifié après le contrôle complet.

## Limites et suite

Ce lot sécurise les services de persistance et de renouvellement. Il ne certifie pas Microsoft Graph, ses scopes réels ni l’envoi d’un message. Un renouvellement fournisseur déjà réalisé peut être suivi d’un refus local ; aucune compensation ni révocation fournisseur n’est prétendue. Aucun navigateur n’a été lancé : la recette générale reste celle du lot 43 et les six parcours ciblés du lot 44 gardent leur portée.

Le parcours Teams doit encore lier le formulaire affiché à son espace et à sa session, traiter les erreurs de chargement en FR/EN et protéger l’ordre des autorisations/cookies concurrents. Poursuivre également les mutations de rapports, domaines et lifecycle, puis les certifications Google/Microsoft et autres fournisseurs, le candidat déployé et la bêta du plan. L’objectif global reste actif.
