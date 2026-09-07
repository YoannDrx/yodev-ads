# Lot 56 — Réservation des domaines au-delà de la purge

Base : `0458e52`. Suite T04/T17/T18/T19. Migration `0060_domain_cleanup_reservations` ; 61 migrations cumulées.

La purge supprimait la ligne `workspace_domains`, donc son unicité, avant le retrait Vercel asynchrone. Une nouvelle attribution pouvait précéder un ancien nettoyage. La table dédiée `workspace_domain_cleanup_reservations` conserve désormais hostname et empreinte de l’espace, indépendamment de la rétention des espaces et des jobs. Les comptes applicatifs/auth n’y ont aucun droit de lecture ou de mutation ; seuls les rôles système/purge disposent des opérations nécessaires.

La purge réserve les hostnames en ordre stable dans sa transaction, avant de supprimer l’espace. Une réservation précédemment levée est réactivée, notamment lors d’une nouvelle purge après restauration. Le déclencheur de création/changement de hostname prend le même verrou et refuse une réservation non levée. Une purge annulée ne laisse ni réservation ni job partiel. La création bloquée remonte un message applicatif fixe, sans texte SQL ni paramètres. Les nouveaux hostnames non canoniques sont refusés au niveau SQL.

Le nettoyage exige sa réservation courante sous verrou, puis l’absence de tout rattachement local du hostname. Cela protège notamment un domaine qui aurait déjà été réattribué avant la migration : le nettoyage est refusé pour réconciliation avant tout appel. L’horloge du bail est relue après l’attente des réservations, en complément du protocole du lot 55.

## Portée de la réservation

Le nettoyage confirmé ne libère **pas encore automatiquement** la réservation. Une requête d’une ancienne tentative peut avoir été acceptée sans réponse locale ; une réussite plus récente ne suffit pas à démontrer que toutes ces opérations sont réconciliées. La libération contrôlée, le réenregistrement et le suivi durable des opérations Vercel restent à livrer ensemble. Ce lot ferme la fenêtre de réattribution dangereuse ; il ne clôture pas le parcours complet de réutilisation d’un domaine.

## Migration et déploiement

La migration reprend les hostnames des jobs de nettoyage encore conservés, y compris les dead letters et jobs terminés. Un contenu durable invalide fait échouer la migration et doit être réconcilié, plutôt que silencieusement ignoré. Les domaines d’anciens jobs déjà supprimés ne sont pas reconstructibles depuis cette seule source : l’inventaire fournisseur reste nécessaire pour le candidat réel.

Avant déploiement, interrompre les workers et drainer les opérations de domaines/purge de l’ancienne version ; appliquer la migration, puis démarrer la version compatible. Une ancienne instance de purge ne crée pas ces réservations. En cas de retour applicatif à une version antérieure, garder les opérations concernées fermées jusqu’à réconciliation ; ne pas supprimer la table ou ses réservations comme procédure de rollback. La durée de conservation et l’outillage de levée après réconciliation restent dans le travail T18/T19.

## Preuves

- `check.log` : **1 639 tests / 202 fichiers**, huit tests de scripts, lint, TypeScript, frontières, build et audit runtime sans vulnérabilité détectée. Couverture instructions/branches/fonctions/lignes : **91,43 / 86,26 / 92,97 / 94,36 %**.

- `fresh-migration.log` : base PostgreSQL jetable neuve, application de `0000` à `0059`, insertion d’un ancien job en dead letter, application de `0060`, contrôle de la reprise de son hostname et de sa conservation après suppression du job. Une seconde exécution des migrations est idempotente. Base de recette détruite à la fin ; aucune migration distante.
- `reservations.log` : purge annulée atomiquement, réactivation d’une réservation levée, création réellement bloquée pendant la purge puis refusée, aucune révélation/audit partiel, réservation conservée après nettoyage et rétention du job, attribution antérieure protégée, privilèges SQL restreints et refus de contournement par casse non canonique. Le premier essai de fixture a nécessité des casts UUID/texte explicites lors de sa préparation ; le protocole produit passe ensuite.
- `database.log` : suite PostgreSQL complète, avec les protocoles du lot 55 adaptés aux réservations. Le nouveau protocole de réservation est enregistré dans le runner commun local/CI. Le protocole d’admission vérifie aussi réservation absente/levée et expiration pendant son verrou. Après ajout de la réactivation d’une réservation levée, le contrôle général et le protocole ciblé de réservation sont rejoués ; la suite PostgreSQL complète précède ce dernier ajustement.

Les transports HTTP sont interceptés, aucun fournisseur réel. Aucune UI modifiée ni recette navigateur rejouée : générale au lot 43, ciblée au lot 52, 84 scénarios disponibles. Les autres mutations, plafonds, certificats fournisseurs et critères T00–T23 demeurent ouverts ; l’objectif reste intégralement actif.
