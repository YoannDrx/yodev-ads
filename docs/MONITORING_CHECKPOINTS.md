# Reprise des observations de monitoring

Un job `monitoring.scan_chunk` conserve dans son payload `monitoringProgress`, indexé par UUID de vigie. Chaque entrée contient les incidents détectés, résolus, les notifications mises en file et, si nécessaire, l'indication d'une observation ignorée. Les jobs existants sans cette propriété commencent avec une progression vide.

Le worker relit sa réservation avant toute lecture Google. Il filtre les vigies déjà terminées et restitue leurs résultats sans nouveau calcul, même si la connexion Google a disparu depuis. Les vigies restantes partagent les lectures de leur famille de données. Après chaque observation, une seule transaction :

1. verrouille le job et vérifie workspace, compte, vigie, worker, numéro de tentative et validité de réservation ;
2. sérialise l'observation du couple vigie/compte, relit l'état de l'agence, les droits opérationnels du compte et la configuration ;
3. applique les incidents et leurs résolutions pour ce couple uniquement ;
4. insère les livraisons par canal et leurs jobs de transport ;
5. écrit la trace d'observation et la progression, en vérifiant à nouveau la réservation.

Aucun transport fournisseur ne se produit dans cette transaction. Si le processus tombe après son commit, le retry retrouve la progression et ne modifie pas une deuxième fois les compteurs. Une erreur sur un incident ultérieur ou l'outbox annule l'ensemble de l'observation et son checkpoint. Le coupe-circuit notifications suspend les transports ; les observations conservent les notifications en file. Les transports relisent l'état des incidents et annulent un message devenu obsolète après résolution, acquittement, snooze, désactivation ou changement de sévérité.

Les empreintes nouvelles incluent la vigie, le compte et l'identité du résultat, avec une empreinte SHA-256 bornée. Deux vigies de même type ne partagent donc plus leurs incidents. Une ancienne empreinte attribuable à la même vigie et au même compte est conservée, ainsi que l'UUID de l'incident et ses commentaires. Chaque réouverture possède une clé d'événement propre au job qui l'a observée ; plusieurs épisodes ne sont plus supprimés par une déduplication permanente.

Une observation terminant après une lecture plus récente est ignorée : la dernière trace validée conserve l'heure de début de lecture. Cela empêche une réponse ancienne de rouvrir un incident déjà résolu par une observation plus récente. Cette trace ne prouve pas que toutes les données Google sont complètes : couverture, fraîcheur et pagination restent régies par les chantiers T09/T10/T14.

La migration `0046_monitoring_observation_lookup` ajoute un index partiel sur les traces d’observation par workspace, vigie et compte, puis date/UUID. Les autres événements d’audit n’y figurent pas. La recette vérifie par `EXPLAIN ANALYZE` son utilisation après actualisation des statistiques de fixture, avec 1 000 observations sans rapport avec le compte recherché. Comme l’index précédent du worker, sa création ORM ordinaire doit être mesurée sur une copie de la cible et planifiée si elle bloque ses écritures ; aucune migration distante n’a été appliquée. L’index reste compatible avec un rollback applicatif.

## Compatibilité et validation

Les jobs en file gardent leurs types et identifiants. Aucun backfill de progression n'est inventé pour les observations antérieures au déploiement. Si un ancien worker avait déjà effectué certaines écritures sans checkpoint, leur première relecture après déploiement peut augmenter leur compteur une fois ; le nouveau protocole s'applique ensuite. Un rollback vers l'ancien worker ignorerait les checkpoints et les garanties atomiques : suspendre le scheduler et examiner les jobs actifs avant de revenir en arrière.

La recette `verify-monitoring-checkpoints.ts`, intégrée à `npm run db:verify-local`, utilise uniquement une base PostgreSQL de fixture sur loopback. Elle vérifie deux commits concurrents, la reprise après commit avec une nouvelle tentative, le refus d'un worker expiré, l'annulation d'un lot après contrainte SQL, deux vigies de même type, plusieurs réouvertures, l'arrivée tardive d'une ancienne lecture, la séparation des comptes et la conservation d'une ancienne identité. La destination email est volontairement indéchiffrable et aucun envoi n'est exécuté.

Le résultat d'un scan compte les notifications **mises en file**. L'acceptation et la livraison relèvent du [registre des transports](./NOTIFICATION_RECOVERY.md) ; elles ne sont pas déduites du succès du scan. Les exercices déployés avec Google et les canaux réels restent nécessaires avant certification de la fonctionnalité.

## Actions humaines

La création et l’activation des vigies, le lancement manuel, l’acquittement et le workflow des alertes passent par `withWorkspaceActorTransaction`. Le service relit l’adhésion et le rôle courants sous verrou, vérifie le lifecycle et la capacité requise, puis applique l’opération et son audit dans la même transaction. Le quota de vigies utilise l’offre relue. Un essai est contrôlé de nouveau après les attentes et écritures métier ; son expiration annule aussi les jobs, commentaires et jalons produits par cette opération.

Le [lot 34](./audits/prod-ready-lot-34/README.md) vérifie ces cinq opérations avec des attentes PostgreSQL observées, y compris après le contrôle initial, et des formulaires FR/EN sur Better Auth local. Cette garantie concerne ces opérations identifiées ; elle ne remplace ni le protocole des workers ci-dessus, ni la revue des autres mutations.
