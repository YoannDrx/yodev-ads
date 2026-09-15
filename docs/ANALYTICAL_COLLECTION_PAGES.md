# Consultation complète des collectes enregistrées

La page `/insights/{family}?client={id}` permet de parcourir chacune des 17 familles analytiques enregistrées, dont les requêtes, mots-clés, annonces et paramètres de conversion. Elle est accessible depuis le détail de synchronisation du cockpit, de l’analyse et des insights. Les cartes d’insights affichent aussi leur nombre de lignes visibles et enregistrées, avec un accès direct à la collection complète.

## Parcours et données

- Pages serveur de 25 lignes, dans l’ordre de la collecte enregistrée. Les objets identiques restent deux lignes distinctes lorsque leur position diffère.
- Recherche `q` sur toute la collection, jusqu’à 120 caractères. Les caractères `%`, `_` et `\` sont littéraux. La recherche porte sur la représentation JSON de chaque ligne, donc également sur ses noms de champs.
- Compteurs séparés : éléments affichés, résultats correspondant à la recherche et lignes enregistrées. Ils sont lus avec la page et la métadonnée dans une seule requête PostgreSQL.
- Détail dépliable de chaque ligne, sans suppression de champs. Les montants en micros sont localisés sans conversion intermédiaire vers un nombre flottant. L’export conserve les valeurs sources.
- Période, fuseau, date, fraîcheur et couverture de la source restent visibles. Les résultats Google non collectés ou exclus par ses seuils ne sont jamais comptés comme présents.

Les aperçus des insights sont désormais bornés dans la requête SQL à 200 lignes au maximum par famille, avant le rendu des 100/200 lignes affichées. Les autres consommateurs conservent leur lecture complète ; ce changement ne réduit pas les données servant au diagnostic ou au score. Les liens vers les collections n’effectuent pas de préchargement automatique de toutes les familles.

## Curseurs et actualisation

Le curseur est chiffré et authentifié avec le trousseau existant. Il lie l’espace, le client, la famille, la recherche, la version source et la dernière position. Sa durée de validité est de 24 heures, sans prolongation à chaque page. Les jetons invalides, expirés ou étrangers sont refusés.

Une actualisation remplace la version source de la collecte. Les curseurs de la précédente version affichent un message demandant de recommencer ; aucune nouvelle ligne n’est fusionnée silencieusement dans une traversée ancienne. Ce mécanisme ne conserve pas un historique de toutes les collectes : les rapports figés continuent d’utiliser leurs propres éditions immuables.

## Export et permissions

L’export JSON contient toute la collecte enregistrée, même si une recherche est active. Il comprend le client, la période, le fuseau, les dates, la version, la qualification de couverture et tous les enregistrements. Son URL exige la version affichée ; une actualisation intermédiaire produit un HTTP 409 et nécessite de rouvrir la collection. Les réponses sont privées, non mises en cache et accompagnées d’une empreinte SHA-256. Un export supérieur à 4 Mio est refusé explicitement, sans troncature.

La consultation et le téléchargement exigent `portfolio:read`. Le service vérifie le lifecycle, l’espace du client et son statut actif d’annonceur ; un compte étranger, désactivé ou un espace suspendu est refusé. La grâce conserve les lectures stockées. Aucun accès Google ni autre fournisseur n’est effectué pour parcourir ou exporter ces pages.

## Vérification et limites

La recette PostgreSQL parcourt 701 lignes sans doublon ni perte, cherche une ligne au-delà de l’ancien aperçu, compare l’export complet, invalide une version remplacée et vérifie les frontières tenant/lifecycle. Elle vérifie aussi la lecture du singleton de suivi des conversions et l’absence de chargement des payloads non demandés. Elle fait partie de `db:verify-local`.

Les tests navigateur FR à 390 px et EN à 1 440 px couvrent le parcours depuis l’aperçu, la page suivante, une recherche littérale, les détails longs, l’export complet, le changement de version, les liens invalides, un client introuvable et l’accès anonyme refusé. Les parcours de synchronisation déjà présents sont rejoués. Voir [les preuves du lot 16](./audits/prod-ready-lot-16/README.md).

Aucune nouvelle migration n’est nécessaire au-delà de la couverture ajoutée en 0052. Ces pages ne lèvent pas les [plafonds de collecte Google et de stockage](./GOOGLE_COLLECTION_LIMITS.md). Le partitionnement des familles dépassant ces plafonds, les autres listes encore limitées et les validations fournisseur restent suivis dans T14 et les tickets de certification ; la consultation exhaustive des données enregistrées ne vaut pas certification de l’exhaustivité Google.
