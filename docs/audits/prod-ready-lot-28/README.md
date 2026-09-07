# Lot 28 — Synthèse stockée indépendante des lectures Google

Base : `077fcb7`. Aucun changement de schéma, d’interface ou de configuration distante.

Le scheduler peut désormais créer la synthèse du lundi pour les espaces surveillés lorsque les notifications sont actives, même si les lectures Google sont coupées. Le worker ne classe plus `monitoring.weekly_digest` parmi les jobs Google ; il conserve son classement parmi les notifications. Les scans et les collectes Google restent exclus. L’appel direct au digest refuse immédiatement de lire ou d’envoyer lorsque les notifications sont désactivées, et conserve un éventuel état « skipped » du transport au lieu de le remplacer par un faux état non ignoré.

La synthèse utilise toujours le portefeuille stocké et ses qualifications, le fuseau de planification, la date d’occurrence stable et la déduplication par canal. Aucun accès OAuth ou Google n’est nécessaire à son contenu.

## Vérifications

- Tests du scheduler/worker : création du digest du lundi sans jobs Google, date de déduplication stable, exécution du digest avec Google désactivé, exclusion lorsque les notifications sont arrêtées. L’appel direct désactivé ne lit aucune donnée et ne contacte aucun transport.
- `database.log` : portefeuille PostgreSQL de 50 comptes, 45 qualifiés, puis génération réelle de la synthèse avec `GOOGLE_READS_ENABLED=0`. Tous les appels `fetch` sont interdits et aucun canal de livraison n’est configuré dans cette fixture : **zéro appel fournisseur**, aucune réception revendiquée.
- `check.log` : **1 328 tests / 182 fichiers**, sept tests de scripts, lint, TypeScript, vérifications de frontières/transactions, build et audit runtime sans vulnérabilité. Couverture **92,53 % / 87,11 % / 93,27 % / 95,20 %**.
- Aucun navigateur répété pour ce changement de scheduler/worker. Les recettes générales/ciblées de l’interface restent datées des lots 25/27. Les 56 migrations sont inchangées.

La réception email/Slack/Teams et la mesure de charge déployée restent nécessaires pour clôturer T16. Cette livraison ne réactive aucun interrupteur distant.
