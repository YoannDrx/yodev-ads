# Notifications interrompues : reprise et réconciliation

Ce protocole accompagne la migration `0044_notification_delivery_leases`. Les colonnes `lease_expires_at` et `dispatch_started_at` sont nullables pour permettre le déploiement progressif. L'index ajouté porte sur l'état et les échéances. La migration étend une table existante ; les clés tenant, RLS, cascades de suppression et exports restent ceux de `notification_deliveries`.

## Déploiement et retour arrière

Appliquer la migration avant le code qui lit les nouvelles colonnes, sur un candidat dont les migrations, rôles et invariants ont été vérifiés dans une base isolée. Conserver les colonnes lors d'un retour arrière du code. Un retour à l'ancien worker perd les protections ajoutées : suspendre le scheduler et les notifications pendant cette opération, puis drainer les anciens workers avant une reprise encadrée. Ne pas remettre automatiquement les ambiguïtés en file.

Les nouvelles tentatives ont une réservation de deux minutes. Un marqueur est enregistré avant l'appel au transport, sous contrôle de l'état, du numéro de tentative et de l'échéance. Une tentative ayant perdu sa réservation ne peut pas démarrer le transport. Les écritures de résultat sont également conditionnées au numéro de tentative. Une acceptation tardive du worker original peut lever une ambiguïté de la même tentative ; elle ne peut pas écraser une nouvelle tentative.

Le scheduler réconcilie au plus 50 réservations expirées et 50 livraisons sans job par passage. Cette maintenance ne contacte pas de fournisseur. Elle reste autorisée si les notifications sont désactivées ; les workers d'envoi restent exclus par le switch.

## Décisions de récupération

| Situation | Décision |
| --- | --- |
| Réservation récente expirée, aucun marqueur de transport | Reprise en file, ou échec terminal si les tentatives sont épuisées |
| Email avec clé propre au canal et acceptation persistée dans le registre YoDevMail | Acceptation réconciliée ; horloge de l'incident mise à jour depuis la preuve |
| Transport commencé, sans preuve d'acceptation attribuable | `ambiguous`, alerte d'exploitation persistée, aucun renvoi automatique |
| Ancien `sending` sans réservation après cinq minutes | Traitement conservateur comme ambiguïté, sauf preuve attribuable |
| Livraison `queued`/`retrying` sans job actif | Job de secours dédupliqué |
| Incident résolu/acquitté, snooze actif ou préférences devenues incompatibles au retry | `cancelled`, sans transport |

Les nouveaux enregistrements stockent un job de secours dans la même transaction que la livraison. L'arrêt du processus entre création et première tentative ne perd donc plus l'envoi. Les erreurs de transport Webhook/Teams après le marqueur sont traitées comme ambiguës : un code HTTP ou une coupure ne constitue pas une preuve suffisante pour renvoyer un message non idempotent.

## Identité de l'email

Les nouvelles livraisons ont une clé d'idempotence propre à l'occurrence **et au canal**, conservée dans le payload. La génération de retry manuel d'un job ne change pas cette identité de transport. Deux canaux email ne peuvent plus entrer en conflit parce qu'ils partageaient la clé d'incident.

Les anciens payloads conservent leur clé d'origine lors d'un retry ; ils ne sont pas réémis sous une nouvelle identité. Une acceptation basée sur une ancienne clé commune à plusieurs canaux ne permet pas d'attribuer automatiquement le reçu à l'un d'eux. Ces ambiguïtés demandent une revue. Il faut vérifier le destinataire et le contenu historiques avant de décider d'une nouvelle émission ; un simple changement de clé n'est pas une réconciliation.

## Preuves et traitement opérationnel

`accepted` décrit une acceptation de transport, pas la réception de l'email. Le registre `transactional_email_deliveries` et les webhooks YoDevMail portent les états de livraison, bounce et plainte. Une preuve tardive attribuable peut faire passer une notification `ambiguous` à `accepted` au passage suivant du scheduler, sans nouvel appel réseau.

Les erreurs terminales et ambiguïtés produisent une alerte d'exploitation dans la même transaction que leur classement, avec une clé dédupliquée. La gate de release refuse les transports interrompus, ambigus ou en échec non résolus. Les ambiguïtés ne font pas partie de la rétention automatique des états terminaux.

La preuve de notification fournisseur doit être examinée avant tout renvoi. Les exercices réels et le parcours de revue opérateur restent à certifier avec T18/T19. Les tests locaux, y compris le serveur HTTP de fixture, ne valent pas réception réelle d'un email ou d'un message Teams/Slack.
