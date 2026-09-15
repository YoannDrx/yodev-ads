# Lot 47 — Autorisations Teams ordonnées et sélection liée au formulaire

Base : `1ba5a2e`. Suite T04/T05/T15/T17. Aucune migration ajoutée ; 60 migrations cumulées.

Chaque départ OAuth crée une demande temporaire de dix minutes dans les sessions existantes, sous le garde d’acteur. Le marqueur d’attente est chiffré avec le même format que les autres secrets et reste compatible avec leur rotation. Le départ remplace les anciennes sessions du même acteur/espace, sans modifier les canaux déjà connectés. L’identifiant de demande et son échéance sont signés avec la preuve PKCE.

Le callback doit retrouver cette demande encore en attente sous verrou avant d’enregistrer le refresh token et d’ouvrir les quinze minutes de sélection. Une demande remplacée, consommée ou expirée est refusée. Une session encore en attente ne peut pas être utilisée pour obtenir un accès Microsoft ou créer un canal. Les contrôles finaux d’échéance et d’essai du lot 46 restent appliqués.

Les cookies OAuth portent le nonce de leur demande dans leur nom ; les cookies de sélection portent leur identifiant de session. Aucun retour ou formulaire ancien ne les supprime. La consommation unique provient de la transition en base et de la suppression transactionnelle à la complétion, tandis que les cookies expirent. Une réponse ancienne ne peut donc pas écraser le cookie d’une autre demande. Les tentatives de départ conservent leur limite existante.

La page reçoit espace/session dans son URL et les conserve dans ses deux formulaires. L’action déplacée dans `teams-connection-actions.ts` compare formulaire, cookie signé et identité courante avant accès Microsoft, puis utilise les noms de destination vérifiés auprès du fournisseur. Les sélecteurs ont des noms accessibles et une équipe sans canal explique l’absence de destination. Les erreurs de chargement affichent une page FR/EN avec retour aux paramètres ; les détails internes du fournisseur sont masqués.

## Preuves

- `database.log` : toute la recette PostgreSQL passe. Le protocole Teams conserve les attentes, révocations, quotas et expirations du lot 46 ; il ajoute demande d’attente inutilisable, retour remplacé/consommé refusé, nouvelle demande autorisée et attentes d’adhésion/expiration d’essai au départ. **14 réponses Microsoft simulées, aucun appel réel.**
- `check.log` : **1 524 tests / 199 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,40 / 86,22 / 92,88 / 94,27 %**. Les tests couvrent départ/callback, transition de demande, action liée au formulaire, sélection rendue et erreurs de page FR/EN. La première vérification de types a demandé de typer explicitement les cas paramétrés d’un test ; l’import devenu inutilisé dans les anciennes actions a été retiré.
- `browser.log` : **quatre parcours ciblés réussissent sans skip en 11,0 s**, dont les deux parcours existants de ressources de sécurité et les deux pages Teams indisponibles FR/390 px et EN/1440 px. Le connecteur Teams reste désactivé : ces deux parcours prouvent le rendu de refus, l’absence d’erreur JavaScript, le retour aux paramètres et l’absence de débordement, pas un échange OAuth ni la sélection d’une destination réelle. Captures inspectées. Agent-browser a aussi vérifié le rendu de connexion, son contenu et l’absence d’écran d’erreur ; sa session et le serveur sont fermés.

## Limites et suite

Les sélections réussies et les pannes Graph sont couvertes au niveau du rendu serveur et de l’action avec fournisseur substitué. La certification de l’échange OAuth/PKCE, des scopes Microsoft réellement accordés, de la liste de destinations et d’un message reçu reste externe. Une nouvelle autorisation remplace volontairement la sélection en cours pour cet acteur/espace ; les anciens onglets doivent recommencer. Aucun grant Microsoft n’est prétendu révoqué lors de ce remplacement local.

La dernière recette générale navigateur reste celle du lot 43 (76 parcours) ; 80 scénarios sont désormais disponibles avec les contrôles locaux. La capture EN montre aussi un texte secondaire de navigation encore en français, hors du composant Teams : la finition T15 demeure ouverte, de même que la langue des refus précoces de feature flag avant chargement du contexte dans certaines actions. Poursuivre les mutations de rapports, domaines et lifecycle, puis les validations fournisseurs et du candidat déployé, les exigences commerciales et la bêta prévues au plan. L’objectif global reste actif.
