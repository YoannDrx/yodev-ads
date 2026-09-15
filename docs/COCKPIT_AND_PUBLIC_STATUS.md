# Cockpit et statut public — contrat de qualification

Le cockpit et le registre public décrivent des observations différentes. Leur absence de données ne permet pas d’attribuer une bonne santé au client ou au service.

## Score du client

`getClientAlertSummary` compte en SQL toutes les alertes du workspace et du client sélectionné dont le statut est `open` ou `reopened`. Les incidents critiques constituent un sous-ensemble de ce total. Aucun plafond de liste ni incident d’un autre client ne participe au calcul. Les états `acknowledged`, `snoozed` et `resolved` sont exclus. Les cartes restent visibles si la collecte Google manque.

`dashboardScoreCampaigns` exige une collection de campagnes au contrat courant, dans la devise et le fuseau du client, couvrant les 30 jours terminés hier dans son fuseau. Son observation doit être récente selon le contrat analytique (26 heures maximum, tolérance future de 60 secondes). Toutes les requêtes de la collection doivent avoir une couverture valide `query_complete` ; une couverture absente, inconnue ou `limit_reached` interdit le score. Une collection vide confirmée ne produit pas de score.

La formule existante est conservée : départ à 100, pénalité de 20 par campagne active sans impression, sinon 12 par campagne ayant plus de 100 unités monétaires de dépense et aucune conversion ; 8 par incident critique ouvert/rouvert. Le résultat est borné entre 0 et 100. Les chaînes entières sont comparées sans arrondi flottant. Les métriques malformées et résumés incohérents interdisent le score. Il s’agit d’une règle de vigilance explicable, pas d’une prédiction de rentabilité.

Les données anciennes restent consultables, avec leur qualification, mais le score et sa jauge sont indéterminés. La jauge disponible représente la valeur réelle ; elle ne conserve plus un arc décoratif fixe. Le lien vers le centre d’alertes conserve le client sélectionné.

## Registre du service

L’état sans incident est `unknown`, présenté comme « État du service non vérifié ». Lire la table d’incidents ne teste pas Google, Stripe, les emails ou le scheduler. Aucun composant n’est déclaré opérationnel par défaut. L’horodatage indique la consultation du registre en UTC, sans prétendre à une sonde réussie.

La synthèse agrège **tous les incidents publics non résolus**, sans limite d’âge ou de pagination. Le SQL retourne au plus 24 groupes composant/impact (contraintes du schéma) et leur nombre exact. L’impact le plus élevé l’emporte. Les incidents privés ne participent pas à cette synthèse. L’en-tête de l’application ne charge que cet agrégat, jamais l’historique ou ses messages.

`/status` présente les incidents publics non résolus, ainsi que les incidents commencés dans les 90 derniers jours. Les filtres `status=active` et `status=resolved` modifient la liste, jamais la synthèse. La limite des 90 jours est fixée à l’ouverture de la traversée. Une page contient 25 incidents, leur total correspondant et un curseur vers les plus anciens. L’ordre porte sur la création immuable et l’UUID, avec précision PostgreSQL à la microseconde et borne de création. Une nouvelle insertion ordinaire ne décale pas les pages existantes ; les changements de statut ou de visibilité restent vivants.

Chaque incident affiché charge ses trois messages les plus récents par une requête latérale bornée à quatre lignes. Le quatrième signale la présence de messages supplémentaires. `/status/[id]` permet de consulter tous les messages, par pages de 25, du plus récent au plus ancien. Cette route exige que l’incident soit encore public ; un identifiant invalide, privé ou supprimé retourne 404. Un ancien incident public résolu reste consultable par son URL même au-delà de l’horizon de la liste.

Les curseurs authentifiés expirent après 24 heures et sont liés à la collection, au filtre ou à l’incident. Un curseur falsifié, expiré ou déplacé produit une erreur explicite avec retour aux résultats récents ; la synthèse globale reste visible. Le code de pagination commun conserve les règles des [collections métier](./WORKSPACE_COLLECTIONS.md).

Aucune migration supplémentaire. Les index existants sur la visibilité/date des incidents et l’incident/date des messages restent employés ; une mesure de charge déployée demeure nécessaire pour les volumes réels. Le registre n’est pas une preuve de disponibilité ni le remplacement de sondes externes. Les preuves de réception d’alertes, exercices de panne, contrôles fournisseurs et bêta restent sous T18–T23.
