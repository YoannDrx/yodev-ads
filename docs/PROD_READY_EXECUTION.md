# Exécution Prod Ready — YoDevAds

Objectif actif créé à la demande de l’utilisateur le 6 septembre 2026 : implémenter le plan complet, corriger A01–A16 et conserver les preuves des validations. Le plan est autorisé ; le compteur de bêta et les validations externes ne sont pas considérés accomplis par les changements de code.

## Base et règles de suivi

- Branche : `codex/prod-ready`, créée depuis `origin/main` (`377ed72f1db03921af46946e85578c271e01c9d1`). Le changement d’adresse distante est conservé.
- Audit original et reproductions : `docs/AUDIT_PROD_READY_2026-09-06.md`, `docs/audits/2026-09-06/`.
- Aucun déploiement, aucune migration de la base distante et aucun envoi à des tiers pendant ce lot.
- La CI hebdomadaire vérifie les dépendances et garde les SBOM et le scan de secrets ; responsable de traitement : mainteneur du dépôt (Yoann Andrieux).

## Avancement

| Ticket | État | Changements / travail restant |
| --- | --- | --- |
| T00 | Terminé | Référence distante reprise, branche isolée, instructions et guides Next 16 installés lus, preuves initiales conservées. |
| T01 | Code vérifié | Lockfile corrige browserslist/fast-uri et leurs dépendances compatibles ; audit npm à zéro vulnérabilité. pip 26.2.1 dans le venv local, minimum corrigé dans CI et venv SBOM. CI hebdomadaire ajoutée. Build, audits et suite complète du candidat réussis ; CI distante à rejouer sur PR. |
| T02 | Code et tests ciblés vérifiés | Schéma partagé limitant temporairement les nouvelles périodes à 30 jours ; anciens liens retournent un message HTML ou HTTP 409 en PDF/CSV ; modèles existants conservés, envois incompatibles bloqués. CSV neutralise les formules textuelles sans modifier les nombres typés. Recette auth création→téléchargement restante ; 7/90 restent ouverts sous T12. |
| T03 | Code et tests ciblés vérifiés | Panne de collecte sans métriques artificielles ; score absent si aucune campagne, limité au client et aux alertes ouvertes/rouvertes. Horodatage de collecte Google visible. Cache et qualité des données historiques restent sous T09–T10. |
| T04 | En cours | Décision commune rôle/lifecycle/capacité/switch, permissions de consultation en grâce, audit séparé des droits admin, support accessible aux membres suspendus. Formulaires cockpit/analyse/alertes/tâches/vigies/approbations alignés. Matrice cinq rôles et appels directs vérifiés localement ; grâce, suspension et changement de rôle entre espaces couverts. Recette staging et autres parcours métier restent à compléter. |
| T05 | En cours | Création et réactivation de vigie relisent les entitlements sous verrou de workspace puis verrou de quota ; transitions idempotentes et auditées. Tests du plafond et de réactivation. Concurrence réelle création/réactivation vérifiée sur PostgreSQL jetable, avec forfait obsolète fourni par le demandeur. Autres ressources et scénarios de downgrade restent à vérifier. |
| T06 | En cours | Budget worker décompté après planification, réserve de finalisation et refus de démarrer sans budget utile. Scans manuels en file ; anciens jobs workspace convertis en répartiteurs idempotents ; lots par client/type de données de cinq vigies maximum, insertion par groupes de 100. Résolution limitée au client du lot. Tests 50 comptes/200 vigies et concurrence PostgreSQL réussis. Contexte de deadline Google/OAuth conservé. Checkpoints internes aux lots, équité globale entre agences, budget DB et autres transports restent à finaliser. |
| T07 | En cours | Récupération bornée des leases expirés, y compris dernière tentative, historique et audit ; finalisation conditionnée au numéro de tentative. Test PostgreSQL avec arrêt SIGKILL de la dernière tentative et deux récupérateurs concurrents réussi. Rappels indépendants du scan Google, horloge 4/12/24 h en temps écoulé, snooze/acquittement/résolution, déduplication par incident/échéance et reprise depuis acceptation persistée implémentés. Les nouveaux états de notification distinguent acceptation du transport et livraison email effective ; un échec ne fait plus avancer lastNotifiedAt. Requêtes et reprise vérifiées sur PostgreSQL sans envoi externe. Réservations de notification, reprise sans transport démarré, ambiguïtés, registre email, clés par canal et file de secours atomique vérifiés localement. Échéances/réception fournisseur et parcours de revue opérateur restent à certifier/finaliser. |
| T08 | En cours | Identité exacte du candidat et origine de confiance raccordées aux scripts/CI ; sondes Google/Sentry commerciales en lecture seule, preuves Sentry et attestations de connecteurs liées à la cible/configuration. Tests locaux, couverture et build vérifiés ; exercices déployés et certificats fournisseurs réels restent à produire. |
| T09–T14 | À faire | Contrats et dépendances inchangés dans le plan. |
| T15 | Code et recette locale vérifiés | Menu complet, fermeture après navigation/Échap, dernier lien accessible par défilement, FR/EN à 390/768 px. Changement d’espace vers un rôle moins privilégié puis retour testé ; transition corrigée pour repartir d’un document neuf. Validation staging sur candidat restant sous T22. |
| T16 | À faire | Portefeuille et vues d’équipe selon le plan. |
| T17 | En cours | Identités vérifiées et vraies sessions Better Auth créées dans une base jetable ; matrice cinq rôles, accès directs et Server Actions, scénarios grâce/suspension/mobile. Runner local et intégration CI ajoutés. Parcours métier complets avec données/fournisseurs restent à couvrir. |
| T18–T23 | À faire | Conserver les critères du plan, y compris fournisseurs, bêta réelle et preuves de lancement. |

## Vérifications du premier lot

Preuves : [`docs/audits/prod-ready-lot-1/`](./audits/prod-ready-lot-1/).

- 853 tests / 129 fichiers réussis : `npm run test:coverage -- --maxWorkers=1 --testTimeout=60000`.
- Couverture : 92,37 % instructions, 85,82 % branches, 93,55 % fonctions, 94,68 % lignes. Seuils CI inchangés.
- `npm run lint`, `npm run typecheck`, `npm run build`, vérification frontière App Router et sérialisation transactionnelle réussis.
- Python : 15 tests réussis, Ruff réussi, pip-audit sans vulnérabilité connue (package local YoDevAds non publié exclu par pip-audit).
- PostgreSQL 17 jetable local : migrations 0000–0043, RLS/rôles, contraintes, invariants, concurrence des approbations/jobs/Stripe/suppression réussis. Nouveaux tests : dernier quota de vigie disputé entre création et réactivation ; forfait relu sous verrou ; worker tué par SIGKILL à sa dernière tentative ; deux récupérateurs concurrents ; ancien worker empêché de finaliser.
- La première recette globale a détecté des fixtures 7 jours devenues invalides et une erreur de type d’autorisation ; corrections vérifiées. L’import Better Auth a également dépassé les timeouts sous charge, contaminant le test suivant. La reprise avec un worker et un timeout de recette plus long est verte ; aucun délai produit n’a été augmenté pour masquer cet incident.
- Au terme du premier lot, les E2E authentifiés du candidat, les vérifications visuelles et les preuves fournisseurs restaient à exécuter ; les avancées suivantes sont consignées ci-dessous. Aucun résultat historique ne sert de preuve du nouveau candidat.

Les résultats locaux ne certifient pas la production. Les prochains lots restent autorisés et l’objectif demeure actif.

## Recette authentifiée reproductible

Le premier lot de corrections est enregistré dans `599fdfc`. Le lot de recette `9b03262` ajoute :

- `npm run db:verify-local` pour préparer et vérifier une base jetable sur loopback ;
- `npm run test:e2e:local` pour créer les cinq identités de recette, les authentifier via la vraie route Better Auth, lancer Next et jouer les E2E avec sessions obligatoires ;
- des scénarios de changement de lifecycle, de rôle entre deux workspaces, de navigation mobile complète et de clavier en FR/EN ;
- la même recette dans le job PostgreSQL de CI, avec captures et traces conservées 14 jours.

Les limites d’authentification ne sont pas désactivées. Le provisionnement réinitialise les compteurs uniquement dans la base locale jetable, évitant de dépasser le plafond de cinq connexions lors des reprises de la matrice cinq rôles. Les secrets et cookies de fixture sont temporaires ; aucun fournisseur externe n’est activé.

La recette a détecté une page vide lors du changement vers un espace où le rôle est moins privilégié. Après confirmation de Better Auth, le client ouvre maintenant un document neuf et ne réutilise pas l’arbre de navigation du précédent tenant. Le test ciblé prouve le passage owner → client et le retour, avec les droits de navigation correspondants.


## Traitements durables et preuves locales suivantes

Les scans manuels créent désormais un job et son audit dans une même transaction tenantée. Les demandes concurrentes réutilisent le traitement en cours. Les lots conservent leur parent et leur périmètre ; un retry du répartiteur ne recrée pas les lots déjà présents. Les états de job et les audits `monitoring.chunk_completed` permettent d'identifier les parties terminées. Ce premier découpage ne clôt pas encore le contrat complet de deadline et d'équité de T06.

Les rappels sont sélectionnés à chaque passage du scheduler, indépendamment du switch de lecture Google. La sélection traite au plus 100 incidents, en faisant passer en priorité ceux qui n'ont pas été examinés récemment. Une occurrence a une clé d'envoi stable, même si plusieurs passages ou retries la réexaminent. Le worker relit le lifecycle, la vigie, le compte, l'état de l'incident et son échéance avant de notifier. Il ne fait avancer l'horloge qu'à partir d'une acceptation persistée, y compris après un arrêt survenu entre acceptation et mise à jour de l'incident.

Les nouveaux envois de notification stockent `accepted` à l'acceptation par le transport ; les anciens `delivered` restent lisibles pour la compatibilité. La preuve de livraison/bounce email demeure dans `transactional_email_deliveries`, alimentée par le webhook YoDevMail. Le champ historique du canal `lastDeliveredAt` garde son nom de stockage et représente l'acceptation ; aucune réception fournisseur n'est revendiquée par les fixtures.

Preuves locales : [`docs/audits/prod-ready-lot-2/`](./audits/prod-ready-lot-2/).

Vérifications réalisées :

- 877 tests dans 133 fichiers réussis lors du passage complet de couverture, puis 37 tests ciblés réussis après centralisation de l’acceptation et ajout de cinq régressions ; 92,38 % instructions, 85,82 % branches, 93,68 % fonctions et 94,68 % lignes.
- Build final, types, lint, frontière des 73 fichiers App Router et sérialisation des transactions vérifiés.
- Base PostgreSQL jetable : invariants sans violation ; quota concurrent, arrêt de worker, demandes manuelles concurrentes, double répartition, sélection des rappels, reprise d'une acceptation et invalidation de l'ancienne échéance vérifiés.
- Recette navigateur : passage initial de 17 scénarios authentifiés/publics, sept scénarios lifecycle/mobile, puis scénario de changement d'espace corrigé et vérifié séparément. Le dernier passage combiné a donné 20 réussites, un dépassement de l'attente de navigation de 5 secondes sous compilation locale et quatre scénarios non exécutés du groupe sériel. Une relance s'est ensuite arrêtée pendant le login de fixture avant de jouer les tests. Ces échecs intermédiaires sont conservés. Le dernier passage, après préparation séparée et correction des fixtures, réussit les 25 scénarios en 6,9 minutes, sans skip ; les quatre captures FR/EN à 390/768 px sont archivées et les captures représentatives ont été inspectées.
- Le runner borne séparément la préparation du serveur, les connexions de fixture et les assertions locales ; les délais de recette distante restent inchangés. Le propriétaire Better Auth des fixtures est renseigné et les identités, espaces et sessions temporaires sont nettoyés en fin de recette.

Aucune migration supplémentaire de schéma dans ces changements ; aucun worker Google réel ni envoi de notification à un tiers n'a été exécuté. Les preuves fournisseurs et les tickets encore ouverts restent explicitement à réaliser.

Le lot de recette est committé sous `9b03262`. Les changements durables et leurs preuves sont enregistrés dans le commit qui introduit cette section. Le contrat de vérification de l’identité du candidat (T08) est raccordé dans le lot suivant ; sa preuve déployée reste distincte des tests locaux.


## Identité du candidat et gates des trois environnements

T08 raccorde maintenant l'origine HTTPS de confiance, le SHA attendu et la cible aux workflows, aux scripts et aux routes de vérification. Les sondes commerciales Google et Sentry utilisent des lectures seules ; le compte Google interne est choisi explicitement. La preuve Sentry est contrôlée sur l'événement réellement indexé, y compris son projet, sa release, son environnement, son âge et le masquage. Un exercice synthétique commercial distinct exige une activation temporaire et les en-têtes d'identité exacts. Les connexions facultatives peuvent être activées sous attestation fournisseur cohérente et fraîche ; aucune attestation réelle n'a été créée dans ce lot.

Le mode opératoire et les limites de confiance des attestations sont décrits dans [`RELEASE_VERIFICATION.md`](./RELEASE_VERIFICATION.md). Aucun secret distant, switch de production ni variable GitHub n'a été modifié. Aucun événement Sentry réel ni appel Google réel n'a été exécuté pour cette recette.

Preuves locales : [`audits/prod-ready-lot-3/`](./audits/prod-ready-lot-3/).

- 905 tests applicatifs / 139 fichiers réussis ; couverture 92,63 % instructions, 86,07 % branches, 93,91 % fonctions et 94,98 % lignes.
- Cinq tests Node du client CI réussis, inclus dans `npm run check` avec leur runner propre. Le premier passage complet avait échoué parce que Vitest découvrait aussi le fichier Node ; son nom distingue désormais les deux runners et le passage complet a été rejoué avec succès.
- Build Next, types, lint, frontière des 77 fichiers App Router et sérialisation transactionnelle réussis. Aucune migration de schéma ; la base et les E2E déjà vérifiés au lot précédent n'ont pas été rejoués pour ces routes internes et scripts seuls.
- La saturation du disque a temporairement empêché une écriture ; seuls les caches de compilation générés pour YoDevAds ont été supprimés avant reprise. Aucun fichier source ni preuve de recette n'a été supprimé.

T08 reste en cours jusqu'aux exercices déployés des trois cibles avec leurs prérequis réels. Les contrôles de bêta, de documents, de facturation et de santé opérationnelle restent exigés.


## Annulation des transports de rappel devenus obsolètes

Le retry d'une notification relit maintenant l'incident, le compte, la vigie et les préférences du canal avant le transport. Résolution, acquittement, snooze actif, compte/vigie désactivé, changement d'intervalle ou préférence de sévérité devenue incompatible produisent un état terminal `cancelled`, sans acceptation ni avance de l'horloge. Les clés de rappel déjà en file restent comprises. L'acceptation par un premier canal laisse les autres canaux de la même occurrence admissibles, jusqu'à l'intervalle suivant, tant qu'une autre notification ou un changement d'état ne la rend pas obsolète.

Un job de transport encore indisponible ou désactivé n'est plus déclaré terminé. Le traitement existant des `sending` abandonnés doit encore être complété par une récupération et une réconciliation explicites ; cette correction ne revendique pas sa clôture. La rétention inclut l'état terminal `cancelled`.

Preuves locales : [`audits/prod-ready-lot-4/`](./audits/prod-ready-lot-4/).

- 57 tests ciblés réussis : orchestration des transports/workers, horloge et rappels ; contrôles de types et lint.
- Recette PostgreSQL 17 depuis une base vide : 44 migrations, RLS/rôles/contraintes/invariants et concurrence. Deux workers tentant un même rappel résolu obtiennent `cancelled`, avec une seule tentative persistée et sans identifiant de transport. La destination de fixture est volontairement indéchiffrable ; aucune émission externe n'est possible dans ce scénario.
- Docker ne répondait plus aux diagnostics ; le premier runner a été arrêté, sans redémarrer le moteur partagé. La recette a réussi sur une nouvelle instance native isolée : `postgresql://postgres@127.0.0.1:56187/yodev_test`, données temporaires dans `/tmp/yodev-prod-ready-pg-20260907-0058`. Le runner vérifie désormais la connexion avec une attente maximale de dix secondes avant les migrations ; le refus d'une base inaccessible a été exercé.
- Aucun changement de schéma, aucun envoi fournisseur réel. Les E2E et le build du lot T08 ne sont pas présentés comme des preuves de ces nouvelles branches serveur ; les tests ciblés, les types et la base réelle constituent la validation de ce correctif.


La récupération des jobs ferme aussi les deux dernières failles d'historique constatées : le claim ne réattribue plus directement un `running` expiré, et la récupération terminale insère son alerte d'exploitation dans la même transaction. Le worker d'alertes lui-même est exclu pour éviter une boucle d'alertes. Tests : 25 scénarios ciblés réussis, types/lint, puis PostgreSQL réel avec deux récupérateurs, une tentative retryable clôturée avant réattribution et une seule alerte durable pour la tentative épuisée. La preuve est celle de la file et de l'audit ; aucun email d'exploitation réel n'a été envoyé. Preuves supplémentaires dans `audits/prod-ready-lot-4/recovery-*`.


## Réservations et réconciliation des notifications

La migration `0044_notification_delivery_leases` ajoute deux colonnes nullables et un index sur la table existante. Les nouvelles tentatives marquent l'intention de transport sous réservation, puis clôturent leur résultat avec le numéro de tentative. La récupération distingue absence de transport, acceptation email attribuable et ambiguïté. Les livraisons nouvelles disposent d'une clé d'idempotence propre au canal ; les retries manuels ne la changent pas. Le job de secours est persisté avec la livraison avant la première tentative. Les erreurs terminales/ambiguïtés ont une alerte d'exploitation dédupliquée et la gate refuse leur ouverture non résolue.

Une preuve d'acceptation YoDevMail attribuable peut résoudre une ambiguïté et mettre à jour l'horloge de l'incident sans second appel HTTP. Les anciens identifiants partagés entre canaux ne sont pas utilisés pour attribuer automatiquement une acceptation. La reprise et les limites de compatibilité sont décrites dans [`NOTIFICATION_RECOVERY.md`](./NOTIFICATION_RECOVERY.md).

Preuves locales : [`audits/prod-ready-lot-5/`](./audits/prod-ready-lot-5/).

- 928 tests / 141 fichiers lors du passage complet, puis 55 tests ciblés après les dernières régressions de compatibilité, d'identité et de réconciliation du canal. Couverture : 92,69 % instructions, 86,23 % branches, 93,95 % fonctions, 95,07 % lignes. Ces nombres ne sont pas présentés comme un second passage complet du code après les dernières petites modifications.
- Build final, types, lint, frontière des données et sérialisation transactionnelle réussis.
- PostgreSQL 17 natif isolé : migration depuis la base à 44 migrations puis recette sur base vide `yodev_test_leases_clean`, avec les 45 migrations, 46 tables RLS et 33 contraintes validées ; invariants sans violation et protocoles concurrents réussis.
- Un serveur HTTP dans le processus de fixture, lié uniquement à loopback, accepte un seul message simulé malgré deux claims et une récupération de réservation. Une preuve email tardive est ensuite réconciliée sans nouvel appel. Aucun email réel ni message fournisseur n'a été envoyé.
- Les échecs intermédiaires venaient du nettoyage de cette fixture (double réponse), puis d'un identifiant fournisseur fixe réutilisé alors que les enregistrements email survivaient à la suppression du workspace. Diagnostic PostgreSQL : contrainte unique `transactional_email_deliveries_message_idx`. La fixture utilise un UUID neuf et nettoie ses enregistrements avant le workspace ; les recettes ont été rejouées avec succès. L'hypothèse initiale de surcharge a été écartée par une reproduction à environ 200 ms.

La migration n'a pas été appliquée à un environnement distant. Le parcours opérateur de revue des ambiguïtés et les exercices fournisseurs T18/T19 restent à compléter ; les tests locaux ne prouvent pas la réception effective d'une notification.


## Échéances DB/HTTP et équité des agences

Le budget du scheduler couvre désormais sa planification. Les transactions sous échéance utilisent les limites locales PostgreSQL 17, y compris la durée totale et les attentes de verrou. Les connexions expirées sont retirées sans arrêt du processus et leurs erreurs ne journalisent que le code. Les appels Teams, YoDevMail et les webhooks utilisent le même budget restant ; le DNS d’un webhook ne peut plus retarder le worker indéfiniment ni déclencher un POST après expiration.

La migration `0045_job_workspace_fairness` ajoute un index de recherche de la dernière attribution. Le claim alterne entre workspaces admissibles et le groupe système, puis respecte les priorités internes ; son verrou court ne couvre jamais l’exécution. Le [mode opératoire](./WORKER_EXECUTION.md) documente le prérequis PostgreSQL, le changement d’ordre, les limites, le déploiement et le rollback.

Preuves locales : [`audits/prod-ready-lot-6/`](./audits/prod-ready-lot-6/). 931 tests / 141 fichiers réussis ; couverture 92,73 % instructions, 86,23 % branches, 93,97 % fonctions, 95,08 % lignes. Build, types, lint, frontière des données et sérialisation transactionnelle réussis. La recette PostgreSQL applique la migration à la base précédente (46 migrations au total), puis vérifie RLS, contraintes, invariants et concurrence. Deux vagues de six claims servent chacune deux fois une agence avec 2 000 jobs, une petite agence et le groupe système, sans doublons. Une transaction comportant deux requêtes individuellement courtes est interrompue sur sa durée totale et ses écritures annulées ; le pool survit à une expiration inactive et les paramètres ne fuient pas.

Seules des lectures de version ont été faites sur Neon EU et la connexion locale historique US (17.11). Aucune migration, émission fournisseur ni promotion distante ; pas de nouvelle recette navigateur pour ce lot serveur. T06 reste en cours pour les checkpoints des scans, les collectes historiques découpées et les exercices déployés.


## Observations atomiques et reprise par vigie

Les scans enregistrent désormais chaque observation avec ses incidents, ses notifications en file, son audit et son checkpoint dans une transaction unique. La réservation du job est vérifiée au début et à la fin. Une reprise saute les vigies déjà terminées sans nouveau compteur ni transport ; les résultats indiquent explicitement les notifications en file. Les empreintes séparent les vigies de même type, préservent les anciennes identités attribuables et donnent une identité distincte à chaque réouverture. Une lecture plus ancienne ne peut pas annuler une observation plus récente. Les transports de monitoring devenus obsolètes sont annulés avant émission.

La migration `0046_monitoring_observation_lookup` ajoute un index partiel de recherche du dernier résultat par agence/vigie/compte. Le [protocole et ses limites de compatibilité](./MONITORING_CHECKPOINTS.md) documentent le rollback et les jobs antérieurs sans checkpoint. Aucune migration distante.

Preuves : [`audits/prod-ready-lot-7/`](./audits/prod-ready-lot-7/). Passage complet : 964 tests / 142 fichiers, couverture 92,75 % instructions, 86,50 % branches, 94,05 % fonctions, 95,13 % lignes. Le passage complet utilise `--maxWorkers=2`. Après l'ajout de l'index, 97 tests ciblés, build final, types, lint, frontière des données et sérialisation réussissent. PostgreSQL : 47 migrations, RLS/contraintes/invariants/concurrence réussis, puis protocole de checkpoint réel (concurrence, reprise, rollback, dérive de configuration, lecture tardive, identité ancienne et résolution isolée). Aucun appel fournisseur.

Les cinq premières erreurs de tests venaient du double de base, qui ne capturait pas `onConflictDoUpdate` ; cette capture est ajoutée et les transitions vérifiées. Le même passage avait rencontré un import Better Auth dépassant les cinq secondes sous concurrence complète, puis une interférence du test expiré avec le suivant. Les tests ciblés et le passage complet à deux workers réussissent, sans modifier le délai ni supprimer de scénario. Le premier EXPLAIN utilisait l'ancien index en raison des statistiques antérieures à l'insertion massive de fixture ; après ANALYZE local, l'index ciblé est utilisé, vérifié avec 1 000 observations d'autres comptes.

T06/T07 conservent leurs exercices fournisseurs et de charge déployée ; T09 doit encore qualifier la couverture et découper la collecte historique. Les traces de monitoring ne constituent pas une certification de complétude des réponses Google.

## Historique découpé et couverture des jours

T09 dispose maintenant d'un répartiteur reprenable et de lots de sept jours, avec rattrapage initial, relecture des fenêtres de conversion et rotation de l'historique plus ancien. La migration `0047_metric_date_coverage` qualifie les dates par fuseau, état et version ; les lignes antérieures restent `legacy` jusqu'à relecture. Les écritures compte/campagne, l'audit et le checkpoint sont atomiques ; les réponses anciennes et workers périmés ne peuvent pas remplacer une observation plus récente. Le [protocole](./METRIC_HISTORY.md) décrit la compatibilité, le déploiement et le retour arrière.

Le pacing et les nouvelles observations de mutation consomment uniquement les dates complètes qualifiées. Une lacune masque les variations et projections au lieu d'extrapoler un mois incomplet. Le cockpit conserve le suivi budgétaire enregistré quand Google est déconnecté ou échoue. Le contrat calendrier des futurs rapports est préparé ; leurs nouvelles périodes ne sont pas encore activées.

Preuves : [`audits/prod-ready-lot-8/`](./audits/prod-ready-lot-8/). Passage complet : 990 tests / 146 fichiers, couverture 92,89 % instructions, 86,80 % branches, 94,21 % fonctions, 95,31 % lignes. PostgreSQL : 48 migrations, contrôles RLS/contraintes/invariants/concurrence réussis ; une fixture supplémentaire vérifie les zéros, corrections tardives, rollback, reprises, fuseaux et consommation par les observations. Aucun appel fournisseur. Build, types, lint, frontière des données et sérialisation réussissent. Le dernier build inclut l'accès au pacing sans connexion ; les derniers ajustements de libellés sont vérifiés par types/lint.

La première recette navigateur a trouvé que le suivi enregistré était masqué avec le panneau de connexion Google. Après séparation de ces conditions, les deux scénarios FR/EN à 1440 px réussissent, sans skip, avec couverture complète puis lacune volontaire. Les captures ont été inspectées ; elles précèdent les derniers ajustements de traduction du panneau de connexion et du statut de couverture. Le serveur a aussi été contrôlé avec agent-browser (page de connexion lisible, aucune erreur navigateur) ; ses fixtures sont nettoyées en fin de recette.

Aucune migration distante ni réconciliation Google réelle n'est revendiquée. T09 reste à certifier sur compte contrôlé et en charge ; T10 doit encore migrer les autres vues sur le stockage et qualifier les anciennes observations déjà clôturées.

## Consultation persistée et centre de synchronisation

T10 fait passer cockpit, analyse et insights sur les résultats PostgreSQL de 17 familles. Les workers figent les dates, conservent la dernière réussite et enregistrent résultat/audit/checkpoint atomiquement. Le centre affiche les dates, l'âge, les tentatives réelles, les reprises et les échecs sûrs. L'actualisation est tenantée, soumise aux droits et dédupliquée avec un délai de 15 minutes ; la reconnexion respecte le rôle. Les pages sont consultables en grâce sans appel Google ni commande de collecte. Les données sont invalidées après suspension, désactivation ou suppression.

Les totaux du cockpit utilisent les journées complètes du compte, y compris l'activité absente d'une liste de campagnes. Une lacune ou une devise incompatible masque les agrégats ; les sommes entières sont exactes avant formatage. L'API expose les lacunes et versions. Les anciennes observations de mutation sont qualifiées à la lecture, sans altération des preuves initiales. L'export et la rétention comprennent le nouveau stockage.

La migration `0048_analytical_collections` ajoute la table, RLS forcée, SELECT seul pour l'application, contrainte composite agence/compte et index des dernières demandes. Le [protocole](./ANALYTICAL_COLLECTIONS.md) précise les limites de liste, l'absence de cache tenant partagé non autorisé, les opérations et le retour arrière.

Preuves : [`audits/prod-ready-lot-9/`](./audits/prod-ready-lot-9/). Dernier passage complet : 1 017 tests / 148 fichiers ; couverture 92,34 % instructions, 86,50 % branches, 93,91 % fonctions et 94,85 % lignes. Build final, types, lint, frontière des données et sérialisation réussissent. PostgreSQL : migration depuis le lot précédent puis depuis une base vide `yodev_test_analytics_clean` (49 migrations), RLS, 34 contraintes, invariants et concurrence réussis. La nouvelle fixture interdit les transports et prouve cache froid/chaud, double écriture, réservation, rollback, lecture ancienne, droits, grâce, révocation, cooldown et cascade.

La recette navigateur complète a réussi 29 scénarios sans skip. Après le raccordement final des totaux, les quatre scénarios concernés ont été rejoués avec succès ; le cockpit affiche 456 € de total compte alors que la campagne conservée vaut 123 €. Les deux parcours de lecture ont ensuite été rejoués pour archiver et inspecter les captures FR/EN. Une recette séparée du bouton, avec identifiants Google vides et token local indéchiffrable, réussit deux scénarios FR/EN : 18 jobs après la première demande, aucun doublon après nouvelle soumission, commandes absentes pour l'analyste et aucune mise en file après révocation. Aucun worker fournisseur n'y est exécuté. Le serveur local a aussi été inspecté avec agent-browser.

Les deux échecs initiaux du passage applicatif étaient des fixtures à mettre à jour : famille supplémentaire attendue dans le scheduler et nouvelle table dans le double d'export. Un contrôle de types a ensuite demandé la syntaxe `BigInt(0)` compatible avec la cible TypeScript du dépôt ; calculs exacts et build final sont vérifiés. Les logs intermédiaires et finaux sont conservés.

Aucune migration distante ni validation OAuth/Google réelle dans ce lot. T10 dispose de son code et de ses preuves locales ; les mesures en charge, la relecture sur compte contrôlé et la promotion restent à effectuer. T11 peut maintenant séparer l'inventaire MCC des comptes effectivement choisis par l'agence.

## Sélection persistante des comptes et quotas prévisibles

T11 sépare l’inventaire MCC, les préférences ordonnées et les comptes actifs sous quota. Les synchronisations conservent les choix ; un nouveau compte reste à sélectionner. Un downgrade garde les préférences et l’historique, avec possibilité de réordonner les choix au-delà du quota ou de garder seulement les comptes actuellement gérés. La facturation prévisualise les comptes mis en pause. Les sauvegardes concurrentes sont protégées par verrou et version ; inventaire ancien, connexion modifiée et identifiants hors périmètre sont rejetés.

L’intégration a également corrigé un repli dangereux : un identifiant explicite de compte absent ou inactif ne sélectionne plus un autre annonceur actif. Les rapports planifiés ignorent un compte en pause ; les liens publics dynamiques ne collectent plus un compte inactif ou une connexion révoquée. L’admission finale d’une mutation relit compte et droits actuels avant soumission, sous le verrou partagé avec la sélection. Une opération déjà admise peut terminer ; aucune annulation d’effet externe déjà engagé n’est promise.

La migration `0049` conserve les états actifs de l’ancien modèle et attribue une priorité stable, sans fabriquer de date d’inventaire Google. Une base locale neuve a reçu les 49 premières migrations, des comptes de l’ancien modèle, puis la cinquantième migration : conservation des comptes actifs et absence de sélection automatique des inactifs vérifiées. La fixture PostgreSQL contrôle aussi limites 3/15/50, MCC imbriqués, concurrence, downgrade/restauration, reconnexion, historique et admission finale sans appel fournisseur.

Le [protocole](./ACCOUNT_SELECTION.md) décrit le fonctionnement, le déploiement compatible et ses limites. Les [preuves du lot 10](./audits/prod-ready-lot-10/) comprennent les 31 parcours navigateur complets réussis sans skip et les captures FR/EN inspectées. Les 1 042 tests applicatifs / 151 fichiers réussissent ; couverture : 91,60 % instructions, 86,00 % branches, 92,93 % fonctions, 94,27 % lignes. Le premier test navigateur vérifiait trop tôt une ancienne notification de sauvegarde ; il attend désormais la nouvelle version du formulaire avant d’interroger PostgreSQL. Le test de repli de compte a été corrigé pour vérifier la nouvelle garantie. Une annotation du tableau de cas invalides a ensuite été précisée pour TypeScript. Les deux parcours FR/EN ont enfin été rejoués avec 31 comptes pour vérifier la pagination, la recherche et la touche Entrée sans sauvegarde involontaire (2 réussites, aucun skip).

T11 est implémenté et vérifié localement. Aucune migration distante, mutation Google réelle ni promotion n’est revendiquée. Le traitement des très grands inventaires reste suivi dans T14. T12 poursuit les périodes de rapport et les éditions immuables.
