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
| T04 | En cours | Décision commune rôle/lifecycle/capacité/switch, permissions de consultation en grâce, audit séparé des droits admin, support accessible aux membres suspendus. Formulaires cockpit/analyse/alertes/tâches/vigies/approbations alignés. Matrice de décisions testée ; compléter la recette directe et E2E. |
| T05 | En cours | Création et réactivation de vigie relisent les entitlements sous verrou de workspace puis verrou de quota ; transitions idempotentes et auditées. Tests du plafond et de réactivation. Concurrence réelle création/réactivation vérifiée sur PostgreSQL jetable, avec forfait obsolète fourni par le demandeur. Autres ressources et scénarios de downgrade restent à vérifier. |
| T06 | En cours | Budget worker décompté après planification ; contexte de deadline partagé avec transport Google/OAuth et retries. Aucun simple Promise.race laissant une écriture orpheline. Découpage/reprise, autres fournisseurs, DB et admission sous budget restent à livrer. |
| T07 | En cours | Récupération bornée des leases expirés, y compris dernière tentative, historique et audit ; finalisation conditionnée au numéro de tentative. Test PostgreSQL avec arrêt SIGKILL de la dernière tentative et deux récupérateurs concurrents réussi. Rappels indépendants restent à livrer. |
| T08–T14 | À faire | Contrats et dépendances inchangés dans le plan. |
| T15 | En cours | Menu mobile complet selon autorisations, liens quittant le menu, fermeture Échap et sélecteur de workspace visible sur petit écran. Recette navigateur FR/EN, rôles et largeurs restante. |
| T16–T23 | À faire | Conserver les critères du plan, y compris fournisseurs, bêta réelle et preuves de lancement. |

## Vérifications du premier lot

Preuves : [`docs/audits/prod-ready-lot-1/`](./audits/prod-ready-lot-1/).

- 853 tests / 129 fichiers réussis : `npm run test:coverage -- --maxWorkers=1 --testTimeout=60000`.
- Couverture : 92,37 % instructions, 85,82 % branches, 93,55 % fonctions, 94,68 % lignes. Seuils CI inchangés.
- `npm run lint`, `npm run typecheck`, `npm run build`, vérification frontière App Router et sérialisation transactionnelle réussis.
- Python : 15 tests réussis, Ruff réussi, pip-audit sans vulnérabilité connue (package local YoDevAds non publié exclu par pip-audit).
- PostgreSQL 17 jetable local : migrations 0000–0043, RLS/rôles, contraintes, invariants, concurrence des approbations/jobs/Stripe/suppression réussis. Nouveaux tests : dernier quota de vigie disputé entre création et réactivation ; forfait relu sous verrou ; worker tué par SIGKILL à sa dernière tentative ; deux récupérateurs concurrents ; ancien worker empêché de finaliser.
- La première recette globale a détecté des fixtures 7 jours devenues invalides et une erreur de type d’autorisation ; corrections vérifiées. L’import Better Auth a également dépassé les timeouts sous charge, contaminant le test suivant. La reprise avec un worker et un timeout de recette plus long est verte ; aucun délai produit n’a été augmenté pour masquer cet incident.
- Les E2E authentifiés du candidat, les vérifications visuelles et les preuves fournisseurs restent à exécuter. Aucun résultat historique ne sert de preuve du nouveau candidat.

Les résultats locaux ne certifient pas la production. Les prochains lots restent autorisés et l’objectif demeure actif.
