# Pagination de l’API v1 privée

Les listes `/api/v1/alerts`, `/api/v1/approvals` et `/api/v1/reports` conservent l’enveloppe `{ data, meta: { requestId, nextCursor } }`. L’authentification, les scopes, les restrictions de bêta privée et les contrôles de lifecycle s’exécutent avant la lecture.

- `limit` : entier de 1 à 100, 50 par défaut ; une ligne supplémentaire détermine la présence d’une suite.
- `cursor` : valeur opaque renvoyée par `nextCursor`, à transmettre sans la décoder ni la modifier. Taille maximale : 2 048 caractères. Expiration : 24 heures après la première page.
- Alertes : filtre `status` inchangé. Le curseur lie l’espace, la clé API, la collection et le statut. Un changement de filtre ou de clé nécessite une nouvelle lecture sans curseur. La taille de page peut changer.
- Ordre : création décroissante, puis UUID décroissant. Les alertes sont désormais triées par leur création immuable ; `detectedAt` reste exposé mais une nouvelle détection ne déplace plus une alerte pendant la traversée.
- Précision : les six décimales PostgreSQL sont conservées pour la comparaison SQL, sans passage par un `Date` JavaScript pour le curseur.
- Première page : une borne de création fixe le début de la traversée. Les insertions ordinaires ultérieures sont exclues ; recommencer sans curseur permet de les voir. Les états métier ne sont pas figés : une suppression ou un changement de statut peut changer les résultats d’un filtre.

Un curseur expiré, altéré, étranger ou provenant de l’ancien format base64 non authentifié reçoit `400 INVALID_CURSOR`. Le client doit recommencer sans curseur. Les autres paramètres invalides reçoivent `400 INVALID_INPUT`, avec un message sûr. La migration de curseur ne transforme pas l’API privée en contrat public stable.

Aucun champ technique de pagination n’est ajouté aux objets métier. Le curseur utilise le chiffrement authentifié et le trousseau de clés existants. La suppression d’une ancienne clé invalide les curseurs qu’elle protégeait.

La recette PostgreSQL locale parcourt 521 lignes de chaque collection avec des horodatages séparés par une microseconde et des égalités départagées par UUID. Elle vérifie absence de doublons/manques, modification de `detectedAt`, nouvelle insertion, filtres et clés étrangères. Les tests HTTP vérifient l’enveloppe, les scopes refusés, les tailles autorisées et les erreurs 400. La recette de charge existante utilise également les curseurs réellement émis. Ces preuves locales ne constituent pas une certification HTTP du déploiement distant.
