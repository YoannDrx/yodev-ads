# Lot 42 — Sélection des comptes avec droits courants

Base : `869b4e9`. Suite T04/T05/T11/T17. Aucune migration supplémentaire ; 60 migrations cumulées.

Le service de sélection relisait déjà le forfait sous verrou, mais pas l’adhésion ni le rôle de l’acteur. Les modes sélection et priorités utilisent maintenant le garde transactionnel commun : `google:connect`, capacité `google.read`, adhésion/rôle/propriétaire/lifecycle actuels et expiration de l’essai. Le contrôle final annule les écritures si l’essai expire pendant les attentes métier.

Le formulaire porte l’espace affiché et le serveur le compare à l’espace authentifié. L’éditeur est identifié par espace et version. Les refus de permission sont traités par l’action, puis les gardes de page, avec explication FR/EN. La liste des comptes et le cockpit sont revalidés après le retour. Voir le [contrat de sélection](../../ACCOUNT_SELECTION.md).

## Preuves

- `actor-reproduction.log` : le protocole de refus appliqué temporairement au service du commit de base échoue avec `Missing expected rejection: analyst: selection must refuse`. La sauvegarde était acceptée au niveau du service. Le fichier corrigé a ensuite été restauré avant les vérifications suivantes.
- `account-selection-actors.log` : les deux modes refusent analyste, stratège, client, adhésion retirée, grâce/suspension/suppression et essai expiré. Deux attentes réellement observées sur l’adhésion modifiée hors verrou applicatif conduisent au refus. Deux expirations pendant l’attente d’insertion d’audit annulent sélection, activation, jalon et audit. Une ancienne version de forfait est refusée ; un administrateur courant peut sauvegarder sélection et priorités.
- `account-selection.log` : le protocole métier conserve 57 comptes, deux MCC hors quota, limites 3/15/50, priorités et historique après downgrade/upgrade, conflit concurrent, réconciliation d’inventaire et admission finale du compte actif. La fixture possède désormais une vraie identité et adhésion Better Auth locale, nécessaire au contrôle d’acteur.
- `database.log` : toute la suite PostgreSQL passe, incluant le nouveau protocole partagé avec la CI. Aucune migration ajoutée ; dernière recette sur base vide au lot 33. Les inventaires sont simulés, sans lecture ni écriture Google.
- `check.log` : **1 451 tests / 191 fichiers**, huit tests de scripts, lint, types, frontières de données/sérialisation, compilation et audit runtime sans vulnérabilité détectée. Couverture **92,28 / 87,06 / 93,13 / 95,00 %**. Le test ajouté à l’action vérifie le refus d’un formulaire provenant d’un autre espace ; le refus de permission vérifie désormais la redirection maîtrisée.
- `browser.log` : **quatre parcours en 9,4 s**, les deux scénarios existants de sélection/quota/priorités/conflit et deux nouveaux parcours de formulaire obsolète. L’admin enregistre, puis les changements d’espace, de rôle et de lifecycle refusent toute sauvegarde supplémentaire. L’ordre demeure en base, avec un seul audit. Les captures FR/390 px et EN/1440 px montrent le refus et la sélection enregistrée en lecture seule ; pas d’erreur de page ni débordement horizontal. Agent-browser confirme le rendu de connexion et l’absence d’écran d’erreur Next ; sa session est fermée.

## Suites ouvertes

La dernière recette générale reste celle du lot 37 (66 parcours). Les deux contrôles locaux donnent maintenant accès à 76 scénarios ; leur passage général n’est pas revendiqué. Aucun envoi fournisseur, migration distante, déploiement ou CI distante.

Cette correction protège la sélection manuelle et ses priorités. `persistTenantGoogleAccountInventory` conserve encore une transaction tenant sans réautorisation de l’acteur dans son service ; les chemins de synchronisation système ont des contraintes distinctes, notamment la validité temporelle de l’accès. Ces suites, les autres mutations et les certifications T18–T23 restent ouvertes. Le plan global n’est pas déclaré terminé.
