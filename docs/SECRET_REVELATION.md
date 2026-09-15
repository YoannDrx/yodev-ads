# Révélation unique des secrets

Une révélation contient uniquement le secret chiffré, son type, son espace, son destinataire et sa date d’expiration. Sa consommation utilise `secret-revelation.ts`, réexporté par le dépôt de données. Aucune nouvelle colonne ni migration n’est nécessaire : le secret chiffré existant permet de retrouver la ressource par son empreinte ou son challenge DNS.

## Autorisation et ressource courante

La transaction verrouille d’abord l’espace et l’adhésion de l’acteur, puis la révélation qui lui appartient. Le type lu sous verrou choisit la permission ; les types inconnus sont refusés.

| Type | Permission et capacité | Ressource vérifiée |
| --- | --- | --- |
| `api_key` | `api_keys:manage` (propriétaire), `api.read`, et `api.propose` pour les scopes d’écriture | Programme API privé activé, clé de cet espace retrouvée par son hash, non révoquée et non expirée. |
| `report_url` | `reports:manage`, `monitoring` | Lien courant retrouvé par son hash, actif et non expiré ; compte actif et non manager ; édition éventuelle rattachée à ce lien et non expirée ; domaine applicatif ou domaine personnalisé actif et autorisé. Un analyste conserve sa permission de rapport. |
| `domain_dns` | `workspace:admin`, `custom_domain` | Nom TXT et empreinte du challenge correspondant au domaine non révoqué de l’espace. |

Les ressources mutables sont lues sous verrou partagé. Les éditions de rapport sont immuables et le rôle applicatif conserve son absence de droit UPDATE ; une lecture ordinaire relève leur échéance. La rétention ne supprime que les éditions expirées. Aucun privilège SQL n’est ajouté pour demander un verrou sur ces éditions.

La consommation écrit `revealed_at` seulement si l’expiration de la révélation reste future selon `clock_timestamp()`. Elle revérifie ensuite les droits, l’essai et toutes les échéances après les attentes métier. Le temps SQL est comparé en millisecondes numériques, indépendamment du décodage des timestamps par le pilote. Un refus annule le marqueur de consommation. Deux demandes concurrentes produisent exactement une révélation réussie.

## Formulaire et cookie

Le POST `/api/secret-revelation` exige `workspaceId`, `revelationId` et `kind` dans son JSON. L’espace doit correspondre à l’espace authentifié ; l’identifiant doit être celui du cookie HttpOnly et du formulaire affiché. Le service compare aussi le type affiché au type stocké. Une ancienne fenêtre ne peut donc pas consommer la révélation plus récente d’une autre fenêtre.

L’API ne renvoie aucun détail interne lors d’un refus : HTTP 404, code `REVELATION_UNAVAILABLE`, identifiant de requête et `Cache-Control: no-store`. La réussite est également non mise en cache. Le marqueur SQL impose l’usage unique ; l’API n’émet pas de suppression du cookie en réponse, car une réponse retardée pourrait effacer un cookie plus récent. Le cookie opaque expire selon sa durée initiale ou est remplacé par la création suivante.

Les pages identifient le composant par espace et révélation. Créer une nouvelle clé, un domaine ou une révision remplace donc la valeur précédemment affichée. Les anciens liens dépourvus d’identifiant proposent une explication et désactivent le bouton.

## Affichage et copie

L’affichage est en FR/EN, avec champ nommé et message d’erreur annoncé. Une erreur réseau ou JSON libère le chargement dans `finally`. Si une réponse a été perdue après consommation, une nouvelle tentative peut être refusée : le message explique alors la nécessité de créer une nouvelle valeur.

Le bouton de révélation de clé annonce désormais la révélation seule. Après affichage, une commande « Copier » appelle l’API du presse-papiers, affiche « Copié » en cas de réussite et propose une copie manuelle si l’accès est bloqué. Le challenge DNS affiche séparément le nom et la valeur TXT, chacun avec sa commande de copie ; l’enveloppe JSON interne n’est plus affichée comme donnée à coller dans un enregistrement DNS. Le navigateur de recette remplace cette API pour ne pas écrire de secret de fixture dans le presse-papiers du poste.

## Preuves

Le [lot 44](./audits/prod-ready-lot-44/README.md) relie la reproduction du défaut, le protocole PostgreSQL des trois types, les tests de route/composant et les parcours navigateur FR/EN. Le protocole exerce les révocations d’adhésion, les expirations après attente, les retraits de ressource, les droits de forfait, les éditions immuables et l’usage unique concurrent. Ces preuves sont locales ; elles ne certifient pas un connecteur fournisseur ou le candidat déployé.
