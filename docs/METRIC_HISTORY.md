# Historique journalier et couverture des métriques

Le collecteur conserve des dates calendaires dans le fuseau du compte Google Ads. Il distingue les jours complets, le jour courant partiel et les lignes anciennes dont la couverture n'est pas prouvée. Cette qualification décrit la réussite de la collecte ; elle ne rend pas définitives les conversions, qui peuvent évoluer après leur première observation.

## Collecte et reprise

Le job existant `metrics.daily_sync` devient un répartiteur. Il fige son plan dans son payload avant de créer des jobs `metrics.sync_chunk` de sept jours au maximum. Les clés parent/date rendent une reprise de répartition idempotente, même après minuit. Les derniers jours passent avant le rattrapage. Chaque lot reprend sous réservation, vérifie le workspace, le compte actif, le fuseau et la devise, puis relit les deux familles compte/campagne hors transaction.

La première collecte couvre au moins les 90 jours précédents et le jour courant. Les collectes suivantes relisent au moins 32 jours précédents, ou la plus grande fenêtre de conversion connue augmentée de deux jours. Des réglages absents ou incomplets imposent 90 jours. Une tranche supplémentaire de sept jours revisite à tour de rôle l'historique plus ancien déjà conservé, dans la limite de 730 dates. Cette rotation peut prendre plusieurs mois pour un historique long ; elle n'est pas une garantie de correction immédiate de tout l'historique. Une plage explicite de réparation est comprise par le répartiteur, sans formulaire public dans ce lot.

Les fenêtres de conversion sont lues sur les actions activées sans sélectionner de métrique, afin d'inclure celles qui n'ont encore aucune conversion. Les propriétés utilisées sont documentées dans [ConversionAction](https://developers.google.com/google-ads/api/reference/rpc/v25/ConversionAction).

Une réponse absente, invalide, tronquée au niveau JSON ou contenant une erreur interrompt le lot avant l'écriture. Les lignes sans date ou identité requise sont rejetées. Les lignes journalières des campagnes supprimées sont conservées. Google peut omettre les lignes segmentées dont toutes les métriques sélectionnées valent zéro : un jour absent devient donc zéro seulement après réussite des deux réponses non filtrées. Les anciennes lignes campagne omises sont remises à zéro en conservant leur identité historique. Voir [le contrat Google des métriques nulles](https://developers.google.com/google-ads/api/docs/reporting/zero-metrics).

Les métriques, leur couverture, l'audit et le checkpoint sont écrits dans une seule transaction. Un verrou par agence/compte sérialise les écritures qui se recouvrent ; l'instant de début de lecture empêche une réponse plus ancienne d'écraser une observation plus récente. Un ancien worker ou une réservation expirée ne peut pas valider le résultat. Une reprise d'un lot déjà enregistré retourne son résultat sans seconde lecture Google.

## Données et consommateurs

La migration `0047_metric_date_coverage` ajoute six colonnes à `daily_account_metrics` : `timezone`, `coverage_status`, `source_observed_at`, `source_version`, `account_rows` et `campaign_rows`. Les lignes existantes prennent `legacy` ; aucun backfill ne les déclare complètes sans relecture. `source_version` est un identifiant opaque du lot, sans clé étrangère vers les jobs dont la rétention est plus courte. Aucun nouveau stockage tenant ni nouvelle règle RLS n'est introduit.

Le pacing utilise uniquement les jours terminés depuis le début du mois, avec couverture complète, version présente et fuseau actuel. Une lacune masque dépense à date et projection, et affiche le nombre de jours couverts. Le premier jour du mois n'a pas encore de projection. Le suivi budgétaire enregistré reste consultable lorsque Google est déconnecté ou indisponible.

Les nouvelles observations de mutations utilisent la même qualification. Une journée complète sans ligne pour une campagne constitue une observation à zéro ; une journée partielle ou un ancien jeu sans version ne constitue pas une preuve complète. Une couverture insuffisante produit des variations nulles. Les anciens résultats d'observation déjà stockés devront aussi être qualifiés à leur lecture dans T10 : ce lot ne réécrit pas leur preuve historique.

Le contrat de périodes 7/30/90 jours, mois précédent et dates personnalisées est préparé dans `calendar-window.ts`, avec des jours terminés et une rétention bornée. Les rapports publics ne sont pas basculés sur ces périodes avant T12. Les autres vues analytiques restent à migrer sur les lectures persistées dans T10.

## Déploiement et retour arrière

1. Suspendre la planification et laisser finir ou récupérer les réservations des anciens workers. Un ancien worker écrit les montants sans mettre à jour la qualification : il ne doit pas coexister avec le nouveau writer.
2. Appliquer la migration d'extension, puis déployer le worker et les consommateurs ensemble. Vérifier comptages, RLS et invariants sur une copie avant la cible réelle.
3. Réactiver progressivement la collecte ; vérifier les lots, dates, devises et fuseaux, puis rapprocher un compte contrôlé avec Google. Les lignes `legacy` restent indisponibles pour les calculs qualifiés jusqu'à leur recollecte.
4. En cas de retour au code précédent, suspendre et drainer les nouveaux jobs d'abord. L'ancien worker ne comprend pas `metrics.sync_chunk`. Conserver payloads, audits et colonnes ; privilégier un correctif progressif, sans supprimer les preuves ni relancer aveuglément des lots sous l'ancien code.

## Preuves et limites

Les preuves locales sont conservées dans [le lot 8](./audits/prod-ready-lot-8/). Les tests couvrent calendrier/fuseaux, partition, conversion tardive, réponse incomplète, zéros, campagnes supprimées, reprise, concurrence, réponse ancienne, changement de contexte et rollback SQL. La recette PostgreSQL exerce réellement les écritures et leur consommation ; les parcours FR/EN vérifient la projection puis sa disparition après création d'une lacune.

Aucune migration distante ni lecture Google réelle n'a été exécutée pour ce lot. La qualification repose sur le contrat de réponse du fournisseur et doit encore être rapprochée des données d'un compte contrôlé, y compris les différences possibles de disponibilité entre lectures compte et campagne. Les volumes et limites de mémoire des réponses très grandes restent à traiter dans T14. Les tests locaux ne constituent pas une certification financière ou de production.
