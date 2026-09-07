# Lot 31 — Démarrage guidé fondé sur des preuves

Base : `34ffe37`. Aucun changement de schéma ou de fournisseur. [Contrat produit](../../GETTING_STARTED.md).

La page distingue inventaire et sélection, compte les objectifs/vigies seulement sur annonceurs sélectionnés et utilise les jalons qualifiés d’analyse/publication. Une simple programmation ou un lien de partage ne valide plus un rapport. L’acceptation commerciale exige les trois versions actuelles dans une vraie ligne d’acceptation, avec date/context cohérents ; elle est séparée des huit étapes produit.

L’aide FR/EN s’adapte aux permissions, au lifecycle et aux services désactivés. La grâce lit la progression stockée sans liens de gestion interdits. Les états manquants décrivent une action à accomplir et les réalisations historiques précisent leur portée. Le formulaire d’abonnement conserve ses contrôles indépendants, notamment l’approbation professionnelle des documents.

## Vérifications

- `check-final.log` : **1 343 tests / 185 fichiers**, sept tests de scripts, lint, TypeScript, frontières de données/transactions, build et audit runtime sans vulnérabilité. Couverture **92,54 / 87,22 / 93,28 / 95,16 %**.
- `browser-full.log` : **57 scénarios réussis sans skip en 2,6 minutes**, avec cinq rôles, FR/EN, mobile, analytics controls et vrais Better Auth/PostgreSQL. Cette recette précède le dernier ajustement des descriptions des étapes manquantes.
- `browser-final.log` : les deux nouveaux parcours FR/EN réussissent après cet ajustement en **5,8 s** ; captures finales jointes inspectées. Gestionnaire seul, annonceur non sélectionné, objectif/vigie hors sélection, lien sans édition, marqueurs anciens/futurs, DPA absent, rôle analyste et état de grâce sont éprouvés. Les fixtures créent leur propre agence et restaurent la sélection des sessions lors du nettoyage.
- `browser-initial-query.log` conserve le défaut reproduit de qualification SQL dans une projection Drizzle. Les références externes des sous-requêtes sont désormais explicites. `browser-grace-path.log` conserve le refus de navigation vers la page stockée, corrigé dans la liste des chemins autorisés en grâce.
- `focused.log` conserve les sept premiers tests de modèle ; le contrôle final inclut le huitième test sur les descriptions d’étapes manquantes.
- Les 57 migrations restent inchangées. Pas de répétition de la suite SQL complète du lot 29 ; le navigateur exerce réellement la nouvelle requête en contexte tenant, sur des agences isolées.

Aucun appel Google, envoi email, paiement ou déploiement. Le compteur ne garantit pas une fraîcheur actuelle, une réception email, une lecture humaine ou la disponibilité d’un ancien lien. La calibration des aides sur les pilotes, la qualification des alertes et les mesures de coûts/support restent nécessaires pour T21.
