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
| T07 | En cours | Récupération bornée des leases expirés, y compris dernière tentative, historique et audit ; finalisation conditionnée au numéro de tentative. Test PostgreSQL avec arrêt SIGKILL de la dernière tentative et deux récupérateurs concurrents réussi. Rappels indépendants du scan Google, horloge 4/12/24 h en temps écoulé, snooze/acquittement/résolution, déduplication par incident/échéance et reprise depuis acceptation persistée implémentés. Les nouveaux états de notification distinguent acceptation du transport et livraison email effective ; un échec ne fait plus avancer lastNotifiedAt. Requêtes et reprise vérifiées sur PostgreSQL sans envoi externe. Échéances réelles/réception fournisseur, notification en cours abandonnée et alertes d’exploitation après récupération restent à valider/finaliser. |
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
