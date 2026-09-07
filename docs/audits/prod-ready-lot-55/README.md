# Lot 55 — Admission et reçus du nettoyage externe

Base : `f2cbbbf`. Suite T04/T07/T17/T18. Aucune migration ni extension de privilège SQL.

Le nettoyage durable créé par la purge recevait uniquement son contenu métier. Il pouvait donc effectuer les retraits et écrire le tombstone sans vérifier que le worker possédait encore la tentative courante. Il relançait aussi les appels même lorsque le tombstone portait déjà une réussite.

Le runner transmet désormais son job réclamé au service. Chaque admission verrouille le job puis le tombstone et exige : job global de type `workspace.external_cleanup`, état `running`, propriétaire du bail, numéro de tentative, clé de déduplication du tombstone et contenu exact courant. Le bail est évalué avec l’horloge PostgreSQL après les deux attentes. Un tombstone absent ou une réussite sans date de confirmation sont refusés avant tout appel.

Avant Blob et chaque requête Vercel, y compris les lectures de confirmation après un DELETE 404, l’admission est répétée. Les transactions ne restent pas ouvertes pendant les appels fournisseurs. La finalisation et l’enregistrement d’une erreur vérifient encore la tentative et l’horloge après l’écriture. Une ancienne tentative ne peut donc écraser le statut de son successeur ; une expiration pendant l’écriture annule celle-ci. Le lancement et l’échec effacent toute ancienne date de complétion incohérente.

Un reçu `completed` daté, retrouvé par le job courant, permet la reprise sans appel fournisseur. Une tentative expirée après un effet fournisseur laisse l’opération à reprendre : elle ne marque pas elle-même la réussite. Les messages persistés restent fixes et les distinctions Vercel/Blob du lot 54 sont conservées.

## Preuves

- `check.log` : **1 636 tests / 202 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture instructions/branches/fonctions/lignes : **91,41 / 86,24 / 92,97 / 94,35 %**. Le premier contrôle TypeScript a demandé une discrimination explicite du résultat de reprise dans la fixture ; après correction de cette assertion, le contrôle général et le protocole ciblé passent.

- `cleanup-admission.log` : PostgreSQL réel, neuf refus de tentative/contenu, tombstone absent ou reçu incomplet, attente du verrou de job avec remplacement de worker, expiration pendant le verrou du tombstone, conservation d’un reçu de successeur, arrêt avant la lecture suivant un 404, deux expirations sous déclencheur après écriture (succès et échec) et reprise sans transport. Le protocole est ajouté au runner commun local/CI.
- `domain-actors.log` et `database.log` : le protocole domaines du lot 54 transmet maintenant un vrai job local persistant ; ses matrices et ses cinq erreurs HTTP trompeuses conservent leurs preuves. Toute la suite PostgreSQL passe sur les 60 migrations existantes ; après la correction de typage de l’assertion, le nouveau protocole ciblé est rejoué avec succès. La preuve d’installation depuis une base vide demeure celle du lot 33.
- Les tests de nettoyage simulés précédents sont déplacés dans `workspace-external-cleanup.test.ts` et étendus à l’admission et aux reçus. L’orchestration vérifie que le job est transmis ; l’adaptateur Vercel prouve les trois points d’admission possibles du retrait.

## Limites et suite obligatoire

Ce lot protège les effets suivants et les écritures locales après perte d’un bail. Il ne peut annuler une requête déjà admise et reçue par Vercel. La réservation durable d’un hostname au-delà de la purge reste nécessaire pour empêcher sa réattribution pendant le nettoyage, ainsi qu’un protocole de réconciliation des résultats ambigus et des vérifications/révocations concurrentes. Ces exigences demeurent ouvertes, de même que le plafond historique de 100 domaines du contenu de nettoyage.

Les nouveaux tests interceptent HTTP ; aucun appel Vercel/Blob réel. Aucune UI modifiée ni recette navigateur rejouée (générale au lot 43, ciblée au lot 52, 84 scénarios disponibles). Aucun déploiement ou validation fournisseur. L’objectif T00–T23 demeure intégral et actif.
