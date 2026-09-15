# Lot 49 — Publication et révision de rapports sous droits courants

Base : `eba7fbb`. Suite T04/T05/T17. Aucune migration ajoutée ; 60 migrations cumulées.

Publication, révision et révocation exigent maintenant `reports:manage` et `monitoring` dans leur transaction. Le garde relit rôle, adhésion, lifecycle et forfait, puis contrôle l’essai après les attentes et écritures. Un refus annule aussi les nouvelles éditions, liens, révélations, audits et jalons de la transaction. L’analyste conserve ces trois fonctions ; le quota courant reste prioritaire sur le contexte de forfait fourni par l’appelant.

La révision verrouille la planification éventuelle puis le lien avant de lire le token à révéler, dans le même ordre que le worker de livraison. Un remplacement du token pendant l’attente est donc relu avant la construction du lien de révision. L’ancienne lecture précédait le verrou acquis lors de la création d’édition et pouvait conserver un token devenu obsolète.

La révocation verrouille la planification éventuelle et contrôle son bail avec `clock_timestamp()` après l’attente. Un bail ayant expiré pendant cette attente ne bloque plus indûment la révocation. Le lien et sa planification sont désactivés dans la même transaction. Ce contrôle de bail ne prétend pas annuler un message déjà accepté chez un prestataire.

La fixture des éditions utilise désormais une vraie identité/organisation/adhésion Better Auth locale pour les publications et révisions manuelles. Les lectures système, tests d’immutabilité et éditions déclenchées par les autres chemins conservent leur contexte propre. Aucun privilège SQL n’est élargi.

## Preuves

- `reproduction.log` : avant correction, le service accepte une publication pour le rôle client (`Missing expected rejection: publish:client`).
- `public-report-actors.log` : trois matrices de droits/lifecycles, trois attentes d’adhésion et trois expirations d’essai pendant l’audit, sans édition, lien, révélation ou audit partiel. L’analyste conserve publication/révision/révocation. Le quota Solo courant est vérifié. Une rotation réelle de token sous verrou révèle le nouveau token après attente ; un bail de planification expirant pendant une attente autorise ensuite la révocation atomique. Aucun fournisseur.
- `database.log` : toute la recette PostgreSQL passe, incluant le nouveau protocole, les éditions avec vraie identité et les assertions antérieures d’immutabilité et de reprise d’envoi simulée. La dernière preuve des 60 migrations depuis une base vide demeure celle du lot 33.
- `check.log` : **1 527 tests / 199 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,40 / 86,25 / 92,88 / 94,27 %**. Les trois tests d’acteur ajoutés refusent chaque mutation avant écriture ; 24 tests ciblés de workflows/périodes passent. Les garanties de verrous/horloge proviennent du protocole PostgreSQL réel.
- `browser.log` : **quatre parcours ciblés passent sans skip en 24,9 s**. Les deux parcours de publications/révisions FR/EN conservent HTML, PDF et CSV ; les deux parcours analyste du lot 48 conservent modèles, versions, renouvellement, suspension/réactivation et refus après rétrogradation. Aucun worker ni transport réel. Agent-browser vérifie le rendu de connexion, le contenu et l’absence d’écran d’erreur ; les sessions et le serveur sont fermés.

## Limites et suite

Les OTP et avis publics gardent leurs contrôles distincts et ne sont pas transformés en opérations de membre. Les échéances des deux mutations de planifications et du worker d’envoi, les ressources référencées (notamment comptes/domaines), les plafonds de collections et les formulaires de rapports liés à leur espace restent à revoir. Aucun envoi d’email réel, contrôle fournisseur ou déploiement n’est certifié ici.

La dernière recette navigateur générale reste celle du lot 43 (76 parcours), avec 82 scénarios disponibles. Poursuivre les autres garanties de rapports, domaines et lifecycle, puis les critères fournisseurs, commerciaux, déployés et de bêta du plan. L’objectif global reste actif.
