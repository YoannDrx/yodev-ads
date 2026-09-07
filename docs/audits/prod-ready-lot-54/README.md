# Lot 54 — Réponses Vercel et preuve de retrait externe

Base : `e90e0e0`. Suite T04/T17/T18. Aucune migration ni extension de privilège SQL.

Les messages libres des fournisseurs ne pilotent plus les décisions d’existence ou d’absence d’un domaine. L’adaptateur transporte un statut HTTP et un code structuré, sans recopier le message privé. Les erreurs réseau, JSON illisibles et enveloppes d’erreur sous HTTP 2xx restent non confirmées.

Après un refus d’ajout HTTP 400 ou 409, une lecture du domaine dans le projet configuré doit confirmer exactement son hostname, son identifiant de projet et un booléen de vérification. Les autres statuts ne déclenchent pas ce rattrapage. Le schéma de configuration impose un booléen `misconfigured` et accepte les recommandations IPv4 sous forme de groupes d’adresses, conformément au contrat officiel. `VERCEL_PROJECT_ID` doit être l’identifiant canonique du projet, pas son nom d’affichage ; cette exigence est explicitée dans `.env.example`.

Après un DELETE HTTP 404 avec le code `not_found`, le retrait n’est confirmé que si le projet est accessible avec le bon identifiant et qu’une seconde lecture du domaine retourne également cette absence structurée. Projet inaccessible, domaine encore présent, statut différent ou corps ambigu empêchent la révocation locale et la réussite du nettoyage. Une suppression HTTP réussie reste une confirmation du fournisseur ; une absence constatée ne garantit pas qu’un autre acteur ne puisse rattacher le domaine plus tard.

Le nettoyage d’espace réutilise cette décision de l’adaptateur. Pour Blob, seule `BlobNotFoundError` est tolérée : une erreur d’accès, de magasin ou un texte contenant « 404 » fait échouer la tentative. Le message enregistré dans le tombstone est fixe et ne contient aucun détail de transport. Ce changement ne couvre pas encore les autres messages Stripe/Google du cycle de suppression.

## Contrat consulté

L’[ajout d’un domaine à un projet](https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project) peut retourner 400 pour un domaine déjà associé et plusieurs conflits distincts sous 409. La [lecture du domaine](https://vercel.com/docs/rest-api/projects/get-a-project-domain) fournit son rattachement ; les [erreurs REST](https://vercel.com/docs/rest-api/errors) distinguent statut, code et message. Le [contrat de retrait](https://vercel.com/docs/rest-api/projects/remove-a-domain-from-a-project) documente une réussite HTTP 200. Les champs de configuration ont été vérifiés dans l’[OpenAPI officiel](https://openapi.vercel.sh/). Un extrait ciblé et son empreinte source sont conservés dans `provider-contract.json`.

## Preuves

- `check.log` : **1 624 tests / 201 fichiers**, huit tests de scripts, lint, TypeScript, frontières des données/transactions, build et audit runtime sans vulnérabilité détectée. Couverture instructions/branches/fonctions/lignes : **91,41 / 86,26 / 92,95 / 94,30 %**. Les tests incluent les réponses structurées, rattachements étrangers, recommandations IPv4/CNAME documentées et configurations mal typées.

- `domain-actors.log` : le protocole réel PostgreSQL conserve les matrices d’acteur et les attentes du lot 53, puis injecte cinq réponses HTTP trompeuses (401, 403, 404, 429, 500). Aucune ne révoque le domaine ni ne termine le nettoyage ; le tombstone porte un échec sans détail privé. Le chemin projet accessible + absence confirmée termine ensuite les deux opérations. DNS et HTTP sont interceptés, **aucun appel fournisseur réel**.
- `database.log` : toute la suite PostgreSQL passe avec le nouveau protocole. Après la correction finale du type des recommandations IPv4, le protocole domaines a été rejoué avec succès ; la suite PostgreSQL complète précède cette correction de schéma uniquement. La preuve des 60 migrations depuis une base vide reste celle du lot 33.

## Limites et suite obligatoire

La persistance durable des opérations, la réconciliation après arrêt du processus et les courses entre vérification/révocation/nettoyage restent à implémenter. Ce lot ne fournit pas un protocole atomique entre Vercel et PostgreSQL. Restent aussi le réenregistrement d’un hostname révoqué, la sonde de domaine et la liaison/langue des formulaires, puis les autres critères du plan T00–T23.

Aucune UI modifiée, aucune recette navigateur rejouée : dernière générale au lot 43 (76 parcours), dernière ciblée au lot 52 (six parcours de rapports), 84 scénarios disponibles. Aucune certification DNS/Vercel/Blob réelle, migration distante ou mise en production. L’objectif intégral reste actif.
