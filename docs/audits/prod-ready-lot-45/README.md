# Lot 45 — Connexion Google sous droits, version et échéance courants

Base : `e309ab1`. Suite T04/T06/T11/T17. Aucune migration ajoutée ; 60 migrations cumulées.

Le service pouvait sauvegarder une connexion pour un acteur devenu analyste. La persistance exige maintenant la permission `google:connect` et la capacité `google.read` sous transaction. Le départ OAuth signe la version de la connexion et le retour la compare après verrouillage : identifiant, statut, MCC, credentials et scopes. Une première insertion concurrente est aussi refusée au lieu d’être écrasée. Les dates d’usage ne changent pas cette version.

L’échéance OAuth est contrôlée avec l’horloge PostgreSQL avant et après les écritures ; le garde commun contrôle l’expiration de l’essai. Un refus annule connexion, inventaire, audit et jalon. Une connexion autorisée conserve sélection et priorités, invalide l’accessibilité de l’inventaire et efface l’ancienne date d’utilisation réussie. Le retour exige le scope Google Ads, l’identité, l’espace et le MCC signés. Il ne supprime plus un cookie OAuth potentiellement remplacé par une autorisation plus récente ; son échéance reste limitée et le code Google est à usage unique.

Un échec local ne révoque plus automatiquement le jeton reçu : la [documentation officielle Google](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke) indique que la révocation retire les autorisations du projet et invalide aussi les jetons associés au grant combiné du compte. Le jeton non persisté est abandonné sans stockage ni journalisation. Cela ne signifie pas que le grant a été retiré chez Google. La déconnexion explicite et la suppression, notamment lorsqu’un compte Google sert plusieurs espaces, restent à examiner et certifier séparément.

## Preuves

- `reproduction.log` : refus manquant pour un analyste avant correction.
- `google-actors.log` : refus des rôles/révocations/lifecycles invalides ; attentes réelles sur adhésion, remplacement/révocation de connexion et audit ; rollback après expiration OAuth ou essai ; refus de replay et insertion initiale concurrente ; succès autorisé avec sélection/priorité conservées et usage antérieur effacé. Aucun appel fournisseur.
- `database.log` : recette PostgreSQL complète, incluant le nouveau protocole dans le runner partagé avec la CI. La dernière preuve des 60 migrations depuis une base vide demeure celle du lot 33.
- `check.log` : **1 494 tests / 195 fichiers**, huit tests de scripts, lint, types, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,43 / 86,27 / 92,84 / 94,24 %**. Les tests de routes substituent le fournisseur ; ils couvrent contexte signé, scope refusé, grâce, absence de révocation et conservation du cookie. Les tests de version couvrent remplacement et ordre des scopes.

## Limites et suite

Aucun navigateur ni fournisseur réel n’a été lancé pour ce lot de services et routes. Dernière recette générale : 76 parcours au lot 43 ; six parcours ciblés au lot 44. L’échange OAuth, les scopes réels, la révocation explicite et les mutations Google du candidat déployé ne sont pas certifiés ici. Poursuivre Teams OAuth, rapports, domaines et lifecycle, puis les preuves fournisseurs, de lancement et de bêta prévues par le plan. L’objectif global reste actif.
