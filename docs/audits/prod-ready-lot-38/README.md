# Lot 38 — Acteurs des ressources de sécurité et règles budgétaires

Base : `9ac90ee`. Suite T04/T05/T15/T17, aucune migration supplémentaire (60 cumulées).

Les six opérations de `workspace-security-resources.ts` utilisent désormais `withWorkspaceActorTransaction` : création/révocation de clé API, création/désactivation de canal, reprise manuelle de job et règle de sécurité. Le garde relit l’adhésion, le propriétaire, le rôle, le lifecycle et les capacités nécessaires. Un essai expirant pendant une attente métier annule aussi les écritures, la révélation de clé et l’audit.

La clé reste réservée au propriétaire. Les scopes inconnus sont refusés ; les scopes d’écriture exigent `api.propose` depuis l’offre courante, même si l’appelant a chargé Agency avant un downgrade. L’accès à la bêta privée est vérifié avec le contexte courant lors de l’émission. La fenêtre de révélation commence après l’attente de quota. La révocation ne demande pas de capacité payante supplémentaire.

Les règles de sécurité relisent le forfait autorisant leur portée, valident la cohérence workspace/client/campagne, verrouillent le compte ciblé et refusent compte manager, compte hors espace ou devise différente. Les valeurs restent stockées en micros selon le contrat existant. La reprise de job conserve la génération et les tentatives précédentes ; ce lot ne lance pas le worker.

L’écran des paramètres ne montre plus à un administrateur les contrôles de clés réservés au propriétaire. La création exige aussi `api.read`. Les boutons de révocation et de désactivation ont maintenant un nom accessible FR/EN identifiant la ressource.

## Preuves

- `actor-reproduction.log` : les **six opérations** du code précédent réussissaient malgré le rôle devenu client. La reproduction utilise le même protocole, avec le fichier de service du commit de base, puis restaure le nouveau fichier.
- `security-actors.log` : acteur révoqué/retiré, quatre états inactifs et essai expiré refusés ; six attentes d’accès observées suivies d’une révocation/transfert ; trois downgrades observés ; six expirations après autorisation pendant l’attente d’audit. Aucun état métier, révélation ni audit partiel. Contrôle des scopes, de la portée et de la devise ; chiffrement/hachage, destruction des credentials, génération de reprise et droits owner/admin contrôlés.
- `database.log` : toute la recette PostgreSQL passe. Le protocole de quota concurrent de canaux utilise désormais de vraies identités et adhésions ; exactement une création réussit au dernier emplacement disponible. Le nouveau protocole de sécurité est intégré au runner partagé avec la CI. La dernière reconstruction depuis une base vide reste celle du lot 33, sans modification du schéma dans ce lot.
- `check.log` : **1 424 tests / 190 fichiers**, huit tests de scripts, lint, TypeScript, frontières de données et sérialisation, build et audit runtime sans vulnérabilité détectée. Couverture **92,56 / 87,43 / 93,35 / 95,23 %**. `unit.log` : 21 tests ciblés, dont six refus par rôle et scopes d’écriture après downgrade.
- `browser.log` : **quatre parcours réussis en 15,0 s**, dont deux nouveaux FR/390 px et EN/1440 px et les deux paramètres existants. Création de clé, révélation via l’interface puis second accès HTTP refusé, révocation ; création/désactivation de canal ; règle de campagne enregistrée en micros ; reprise de job ; contrôles API absents pour admin ; formulaire ancien refusé après retrait du rôle. Les valeurs sont comparées à PostgreSQL. Captures inspectées à leur résolution originale, aucun secret affiché dans les captures, aucune erreur de page ni débordement horizontal.

## Périmètre et limites

`YODEV_TEST_SECURITY_CONTROLS=1` active uniquement les contrôles API/notifications locaux du runner, avec allowlist de la fixture. Les credentials fournisseurs restent vides et aucun worker n’est lancé. La clé révélée est jetable et les journaux la masquent. Ce protocole prouve la persistance et l’autorisation des ressources, pas une réception email/Slack/Teams ni une mutation Google.

La recette générale reste celle du lot 37 : **66 parcours sans skip**. Les deux nouveaux scénarios portent le total disponible à 68 quand les contrôles analytiques et de sécurité sont tous deux activés ; leur exécution générale n’est pas revendiquée ici. Aucun déploiement, migration distante, CI distante ou certification de prestataire. Les sessions/rappels OAuth de canaux, membres, sélection des comptes, autres mutations et critères de lancement restent ouverts. Contrat : [mutations de l’espace](../../WORKSPACE_MUTATIONS.md).
