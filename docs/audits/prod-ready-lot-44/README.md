# Lot 44 — Révélation unique sous droits et ressources courants

Base : `ede7096`. Suite T04/T05/T15/T17. Aucune migration ajoutée ; 60 migrations cumulées.

Le service consommait une révélation en vérifiant seulement espace, destinataire et échéance chargée avant l’attente. Il relit maintenant l’acteur et le type sous verrou, puis applique la permission correspondante : propriétaire pour les clés API, gestion des rapports ou administration du domaine. Il vérifie aussi la ressource courante, son statut et ses échéances. Une révocation ou expiration après attente annule le marqueur de consommation.

Le formulaire lie espace, type et identifiant affichés au cookie attendu. Les composants se réinitialisent par espace/identifiant ; un ancien onglet ne peut pas consommer un autre secret plus récent. L’API renvoie un refus opaque et non mis en cache. L’usage unique provient du marqueur SQL, sans suppression du cookie susceptible d’effacer une valeur plus récente lors d’une réponse retardée.

Les erreurs réseau/JSON libèrent le bouton et les refus sont expliqués en FR/EN. La copie est une commande explicite avec confirmation ou repli manuel. Les champs DNS sont séparés, avec copie de leur nom ou valeur TXT. Voir le [contrat](../../SECRET_REVELATION.md).

## Preuves

- `reproduction.log` : le protocole appliqué au service de base échoue avec `Missing expected rejection: api_key: client must not reveal`. Le rôle devenu client pouvait encore consommer la clé.
- `secret-revelations.log` : les trois types refusent retrait/rétrogradation/lifecycle invalide, destinataire étranger et type inconnu. Trois attentes d’adhésion, six attentes dépassant l’expiration du secret, trois retraits de ressource pendant attente et deux expirations de ressource après autorisation sont observés dans PostgreSQL. L’essai et une édition expirant pendant la consommation annulent également le marqueur. L’analyste conserve les rapports, l’admin ne peut révéler une clé du propriétaire ; scopes après downgrade, domaine hors forfait, hôte étranger, édition absente, API désactivée et compte inactif sont refusés. Trois doubles consommations concurrentes produisent chacune exactement une réussite. Aucun transport fournisseur.
- `database.log` : toute la suite PostgreSQL passe avec le nouveau protocole intégré au runner commun à la CI. Les éditions restent sans droit UPDATE pour le rôle applicatif. La dernière recette des 60 migrations depuis une base vide demeure celle du lot 33.
- `check.log` : **1 480 tests / 193 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,58 / 86,38 / 92,89 / 94,37 %**. Les tests ajoutés à la route et au composant couvrent le contexte affiché, les refus opaques, les réponses malformées, la reprise réseau, la réinitialisation, la copie et les champs DNS. La preuve des verrous et du rollback est celle de PostgreSQL réel.
- `browser-initial.log` : la première recette expose un verrou FOR SHARE demandant un privilège UPDATE absent sur les éditions immuables. La lecture et le contrôle final d’échéance remplacent ce verrou, sans élargir les privilèges. Elle révèle aussi un sélecteur d’alerte de test ambigu avec l’annonceur de navigation Next ; le sélecteur est précisé.
- `browser-edition-fix.log` : les quatre parcours existants de rapports et sécurité passent ; les deux nouveaux parcours atteignent le refus visuel puis échouent sur une requête de restauration de fixture aux types SQL ambigus. La conversion text explicite corrige la fixture.
- `browser-secrets.log` : les deux nouveaux parcours passent en **6,8 s** avant ajout de la commande de copie. La fixture vérifie réseau coupé, identifiant/espace/type incohérents, remplacement du secret en attente, usage unique, ancienne valeur effacée et refus après transfert/révocation.
- `browser.log` : **six parcours FR/EN réussis sans skip en 29,6 s**, incluant les nouveaux parcours de révélation/copie et les anciens de clés API/rapports HTML-PDF-CSV. La copie de la valeur affichée est vérifiée via l’API de navigateur substituée, sans toucher au presse-papiers du poste. Captures de refus FR/390 px et EN/1440 px inspectées ; aucun secret affiché dans ces captures. Agent-browser confirme le rendu de connexion et l’absence d’écran d’erreur ; toutes les sessions sont fermées.

## Limites et suite

Les rapports sont de vraies éditions locales, les clés et challenges sont de fixture. La copie utilise une API de navigateur substituée dans le test et ne modifie pas le presse-papiers du poste. La recette générale reste celle du lot 43 (76 parcours) ; 78 scénarios sont disponibles avec les deux contrôles locaux. La création/vérification d’un domaine auprès des fournisseurs reste distincte de la révélation de son challenge.

Poursuivre les sauvegardes de connexion Google et les sessions OAuth Teams, puis les autres mutations de rapports, domaines et lifecycle. Les preuves du candidat déployé, les certifications fournisseurs et les critères de bêta du plan restent ouverts. L’objectif global n’est pas déclaré terminé.
