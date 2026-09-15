# Lot 33 — Coûts par offre et attribution des tentatives

Base : `9f7aa5a`. Migration `0059_operating_cost_evidence`, soit **60 migrations cumulées**. [Contrat produit, limites et méthode d’exploitation](../../OPERATING_COSTS.md).

Le registre opérateur couvre collectes Google, DB, fonctions, stockage, email et support. Il sépare les montants documentés directs, les répartitions justifiées et les estimations ; les monnaies et offres sont distinctes, les zéros explicites et le support non valorisé restent reconnaissables. Une référence stable empêche le double enregistrement ; les corrections utilisent une version attendue et un audit avant/après. Le retrait conserve la preuve. Les totaux du mois couvrent toutes les pages et refusent une lecture tronquée au-delà de 10 000 références.

Les nouvelles tentatives de jobs conservent leur forfait au démarrage. Le trigger remplace une valeur d’insertion falsifiée et interdit la réécriture de l’attribution après downgrade. Les anciennes tentatives restent inconnues ; les jobs système sont non répartis. Les temps écoulés et familles de lecture Google sont des observations techniques sur les données conservées, pas des unités de facturation fournisseur.

La lecture et les corrections relisent le rôle et l’état interne sous verrous de workspace/adhésion. Les autres rôles DB n’accèdent pas au registre global et le rôle système ne peut supprimer ses lignes. Les accès non opérateur aux pages d’opérations et de coûts retournent une 404.

## Preuves de code et de base

- `check.log` : **1 391 tests applicatifs / 190 fichiers**, **huit tests de scripts**, lint, TypeScript, frontières des données/sérialisation, build et audit runtime sans vulnérabilité détectée. Couverture **92,66 / 87,38 / 93,31 / 95,25 %**.
- `database-upgrade.log` et `database-fresh60.log` : tous les protocoles PostgreSQL, migration sur base existante et création depuis une base vide. `database-fresh60-final.log` rejoue la suite avec les derniers ajustements de service. Le nouveau protocole est intégré au runner utilisé par la CI ; aucun lancement GitHub n’est revendiqué.
- `operating-costs-final.log` : double soumission idempotente, une seule correction concurrente, ancienne version refusée, rôle retiré pendant une véritable attente sur la ligne d’adhésion, refus des rôles DB et valeurs invalides/NaN, audit du retrait, 31 références avec agrégats au-delà de la page. Les curseurs couvrent toutes les références une seule fois, avec un ordre ASCII commun à PostgreSQL et JavaScript, indépendamment de la langue de la base. Les tentatives conservent Agency puis Solo après downgrade ; le traitement système reste non réparti.

## Recette navigateur finale

`browser-final60.log` : **60 scénarios réussis sans skip en 4,3 minutes**, avec les contrôles analytiques activés, Better Auth/PostgreSQL locaux, cinq rôles et les parcours FR/EN/mobile. Le nouveau scénario saisit et corrige un coût par un vrai formulaire, refuse une version obsolète, vérifie les totaux de 31 références au-delà de la page, retire une source sans supprimer son audit, teste le défilement clavier mobile et exige une 404 pour les lecteurs non opérateurs. Les transferts de propriété et les deux parcours analytiques passent dans cette même exécution. Captures finales du registre inspectées. `typecheck-final.log` valide aussi le dernier ajustement de sélecteur de test ; ce fichier passe ESLint.

## Reproductions conservées

- `browser-initial.log` et `browser-initial-context.md` : le premier sélecteur exact du menu « Poste » ne correspondait pas au texte du label englobant ses options. Le test utilise maintenant le nom accessible du menu et nettoie ses fixtures même si la fermeture du navigateur échoue.
- `browser-pagination-selector.log` : compter tous les éléments `details` de la page incluait un élément supplémentaire hors formulaires de correction. Le test compte les formulaires de justificatifs eux-mêmes.
- `browser-role-reproduction.log` : la saisie, la correction, le retrait, la pagination et le mobile passaient, mais l’ouverture du registre par un analyste produisait une 500. Le refus explicite retourne désormais une 404, y compris si l’autorisation change entre la page et sa lecture transactionnelle.
- `browser-general-network-reproduction.log` et `ownership-network-context.md` : première recette générale, **59 réussites et un échec réseau `ECONNRESET`** lors du rejeu de transfert. Une seule reprise de ce type d’erreur réseau est admise pour cette requête de test, selon le contrat Playwright installé ; aucune réponse HTTP n’est retentée. Le refus de l’ancien propriétaire et l’unicité de l’audit restent obligatoires. Les journaux du processus Playwright passent maintenant par le masquage, y compris les en-têtes de session ; les traces archivées sont expurgées.
- `browser-route-announcer-reproduction.log` : deuxième recette, **58 réussites, un échec de sélecteur et un scénario non exécuté** du groupe sériel. L’alerte de collection est désormais cherchée dans le contenu principal, à l’exclusion de l’annonceur de navigation Next.js. Les vérifications de version, de ligne vide, de conflit d’export et d’isolation restent inchangées.

Aucune facture réelle n’a été importée, aucun prix/forfait modifié, aucun fournisseur appelé par le protocole PostgreSQL, aucune migration distante ni aucun déploiement effectué. Les justificatifs sont déclarés par l’opérateur et conservés hors application ; la saisie ne certifie ni leur existence ni leur exhaustivité. Ingestion des consommations fournisseur, baseline déployée, valorisation du support et seuils calibrés restent ouverts pour T21. Les autres mutations métier T04 restent à durcir avant clôture du plan.
