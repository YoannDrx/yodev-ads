# Lot 57 — Reçus durables des retraits Vercel après purge

Base : `6277cf6`. Suite T04/T07/T17/T18/T19. Migration `0061_domain_cleanup_receipts` ; 62 migrations cumulées.

Le nettoyage ne conservait qu’un état global dans son tombstone. Après un retrait réussi puis un échec ultérieur, la reprise retirait à nouveau chaque domaine. Une réponse reçue après perte du bail ne pouvait pas devenir une preuve durable indépendante de la finalisation du job.

Le registre privé `domain_cleanup_attempts` mémorise maintenant l’intention avant le réseau, avec hostname, empreinte de l’espace, job, tentative, worker et empreinte du projet/équipe Vercel. Une contrainte unique limite à une chaîne de retrait par domaine et tentative. La réservation et le bail sont contrôlés avant et après l’insertion, puis avant chaque requête fournisseur. Une invocation concurrente du même essai ne peut pas soumettre un second DELETE.

Les résultats distinguent `not_submitted`, `confirmed` et `ambiguous`. Une intention sans reçu reste `submitting` et doit être considérée non résolue. Les détails privés du transport ne sont pas inscrits dans ce registre. Un changement de projet ou d’équipe Vercel interdit la réutilisation des reçus du job et les nouveaux appels avant réconciliation lorsqu’une requête a pu être soumise. Si toutes les tentatives précédentes sont `not_submitted`, une nouvelle tentative peut utiliser la configuration corrigée.

Une réponse de retrait confirmée est enregistrée même si le worker a perdu son bail pendant l’appel : cette écriture constate uniquement le résultat de l’intention déjà admise. Elle ne modifie pas le tombstone du successeur, ne termine pas le job et ne libère pas le hostname. Une reprise autorisée retrouve les reçus confirmés du même job et évite ces appels ; les anciennes ambiguïtés restent conservées même si une tentative suivante réussit.

Les identifiants d’intention et les résultats terminaux sont immuables en SQL. Le rôle système peut insérer et finaliser les preuves, mais pas les supprimer ; les rôles applicatif/auth/purge n’accèdent pas à cette table. Les preuves survivent à la suppression des jobs et des espaces.

## Preuves

- `check.log` : **1 646 tests / 203 fichiers**, huit tests de scripts, lint, TypeScript, frontières, build et audit runtime sans vulnérabilité détectée. Couverture instructions/branches/fonctions/lignes : **91,44 / 86,28 / 92,95 / 94,39 %**.

- `receipts.log` : succès partiel puis reprise sans nouveau retrait du premier domaine ; ambiguïté conservée après succès ultérieur ; refus après changement de projet/équipe ; réponse admise enregistrée après perte du bail ; deux invocations concurrentes sans double DELETE ; refus avant transport ; état d’interruption **injecté** et panne d’écriture de reçu restant non résolus ; immutabilité SQL, privilèges et conservation après rétention du job. Aucun arrêt réel de processus n’est revendiqué par ce protocole.
- `database.log` : suite PostgreSQL complète sur une nouvelle base locale et les 62 migrations finales. Les fixtures des lots 54–56 effacent uniquement leurs propres reçus entre leurs cas simulés indépendants. Le nouveau protocole est enregistré dans le runner partagé avec la CI. Après l’ajustement final autorisant une configuration corrigée uniquement pour les appels non soumis, le contrôle général et le protocole ciblé sont rejoués ; la suite PostgreSQL complète précède cet ajustement.
- `fresh-migration.log` : installation depuis une base vide, reprise d’un ancien nettoyage lors de `0060`, installation de `0061` et réexécution idempotente. La première version locale non livrée de `0061` a été régénérée pour inclure le périmètre fournisseur ; la base de recette a été recréée avant le contrôle final, sans modifier l’historique d’un environnement distant.

## Limites et suite obligatoire

Ce registre concerne les retraits Vercel du nettoyage après purge. Les ajouts/vérifications/révocations ordinaires de domaines et le retrait Blob ne disposent pas encore de ce protocole. L’historique antérieur à la migration ne peut pas être inventé. Une intention `submitting` ou `ambiguous` reste un obstacle à la libération automatique ; le parcours opérateur de réconciliation et la levée contrôlée des réservations restent à livrer avec le protocole des autres opérations de domaines. Une réussite de nettoyage n’affirme pas que ces autres opérations sont toutes réglées.

Comme au lot 56, drainer les anciennes opérations avant migration et démarrer uniquement le worker compatible. La rétention et la réconciliation des preuves restent à intégrer à l’exploitation ; ne pas supprimer ce registre pour débloquer une réattribution.

Tous les transports sont simulés. Aucune UI modifiée ni nouvelle recette navigateur (générale au lot 43, ciblée au lot 52, 84 scénarios disponibles). Aucun appel fournisseur réel, migration distante ou déploiement. L’objectif complet T00–T23 reste actif.
