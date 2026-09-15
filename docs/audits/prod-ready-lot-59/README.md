# Lot 59 — Sonde de domaine et destinations publiques

Base : `61ce235`. Suite T01/T04/T17/T18. Aucune migration ajoutée.

La sonde acceptait tout HTTP 200 sur `/api/health`, sans preuve d’identité de l’application ni épinglage DNS. Le filtre réseau partagé refusait certaines IPv6 uniquement par leur représentation textuelle. `reproduction.log` reproduit neuf adresses spéciales acceptées avant correction, dont loopback développé, IPv4 privée mappée en hexadécimal, traduction/tunnel et plages de documentation.

Le filtre compare désormais les adresses binaires via `BlockList`. Il réserve IPv4 spéciale et IPv6 hors unicast global, ainsi que les plages spéciales/tunnels de cet espace. La politique refuse également les IPv4 mappées et NAT64, même si l’adresse incorporée semble publique. Les réponses DNS mixtes sont refusées. La restriction historique excessive de tout `192.0/16` est remplacée par les sous-réseaux spéciaux concernés.

La nouvelle sonde HTTPS utilise exclusivement les adresses publiques validées, impose la validation du certificat, garde le hostname TLS et ne suit aucune redirection. Son socket ne réutilise pas une connexion d’un autre appel ; la même isolation et la validation TLS explicite sont appliquées aux webhooks. Elle transmet un challenge aléatoire chiffré lié au hostname, au périmètre applicatif/projet/équipe/environnement/SHA et à une durée de 60 secondes. La route dédiée doit déchiffrer ce challenge pour produire la preuve attendue ; un HTTP 200, une réflexion du challenge et une ancienne réponse ne suffisent pas. Les en-têtes sont bornés à 8 Kio, le corps à 4 Kio et l’opération à huit secondes. La route refuse les mauvais hôtes, les en-têtes forwarded-host de substitution, le HTTP, les ports non standards, la maintenance et le switch fermé ; elle ne renvoie pas de détail interne et n’est pas mise en cache.

L’acteur et la révision du domaine sont revérifiés après la résolution DNS, avant la connexion. Le garde final existant reste requis avant activation. Le protocole PostgreSQL intercepte explicitement DNS et HTTPS, utilise la vraie fonction de preuve et conserve ses scénarios de révocation pendant la sonde.

## Correctifs de dépendances révélés par la recette

Le contrôle du 10 septembre détecte quatre vulnérabilités npm (deux entrées modérées, une élevée, une critique) après réussite des tests et du build. Le détail est conservé dans `check-before-security-updates.log`. Les versions installées sont Next/ESLint Next 16.3.4, Sharp 0.35.4 et Vitest/coverage 4.1.11 ; pas de changement de version majeure ni de codemod de migration nécessaire. Les avis [Next AVIF](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), [Next Windows](https://github.com/advisories/GHSA-p293-qw3h-jr36), [Sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) et [Vitest mocker](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) justifient la correction. Leur détection ne constitue pas une preuve d’exploitation sur le produit. L’audit complet identifie aussi [Hono](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv) et [js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh) dans les outils de développement ; une correction compatible actualise uniquement ces deux dépendances indirectes vers 4.13.7 et 4.3.2. L’audit final couvre également ces outils.

## Hydratation détectée par le navigateur

La première recette générale sur les dépendances corrigées termine avec 82 succès, deux échecs et deux scénarios suivants non exécutés dans leurs groupes séquentiels. `browser-before-hydration-fix.log` conserve le détail. Un cache Better Auth rempli avant l’hydratation faisait apparaître le sélecteur d’espace ou une erreur dans le premier rendu client alors que le serveur ne les avait pas rendus. Quatre tests FR/EN reproduisent ce défaut (`hydration-reproduction.log`). Le menu fournit maintenant un état initial identique pendant SSR/hydratation via `useSyncExternalStore`, puis expose les données courantes ; le titre contenant l’email suit la même règle. Référence : [rendu serveur des stores React](https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering).

Le second échec était une ambiguïté du test de statut entre le message de curseur invalide et l’annonceur de route Next portant aussi le rôle `alert`. Le sélecteur exige désormais le texte attendu dans la bonne langue. Les assertions d’absence d’erreurs et de confidentialité des incidents sont conservées.

## Vérifications

- `check.log` : **1 721 tests / 206 fichiers**, huit tests de scripts, lint, TypeScript, frontières, build Next 16.3.4 et audit runtime réussis. Couverture des bibliothèques, instructions/branches/fonctions/lignes : **91,53 / 86,32 / 93,02 / 94,42 %**. Les tests couvrent adresses spéciales, épinglage/TLS, refus de corps/statuts invalides, preuve fraîche/périmètre/hôte, délais DNS et réautorisation, erreurs de certificat et interruption.
- `audit.json` : audit de toutes les dépendances, développement inclus, **zéro vulnérabilité signalée** après les mises à jour.
- `database-fresh.log` : toutes les **62 migrations** installées sur une nouvelle base PostgreSQL 17 locale et suite complète réussie. `database.log` : toute la suite rejouée après les ajustements finaux et les mises à jour de dépendances. Le premier contrôle général avait identifié un cast de surcharge DNS dans la fixture, corrigé avant la recette finale.
- Vérification agent-browser du serveur Next : page de connexion lisible, sans overlay ; `sign-in.png` inspectée. Un GET réel local sans challenge sur `/api/domain-probe` retourne HTTP 400, JSON fixe et `Cache-Control: private, no-store`. Le succès cryptographique est testé via le vrai handler avec requête HTTPS construite et le transport HTTPS simulé ; cette vérification locale ne certifie pas un certificat Vercel réel.

- `browser-targeted.log` : **quatre parcours FR/EN de rapports et statut passent en 33,5 s** après la correction d’hydratation et du sélecteur.

- `browser.log` : **86 parcours réussis sans skip en 4,3 minutes**, cinq rôles, FR/EN, mobile, trois contrôles locaux activés. Aucune erreur d’hydratation signalée dans cette dernière exécution. Les fixtures sont nettoyées à la fin. Cette recette sur le code et les dépendances finaux remplace celle du lot 58 comme référence générale locale.

## Références et limites

- [Node HTTPS](https://nodejs.org/api/https.html#httpsrequesturl-options-callback), [BlockList](https://nodejs.org/api/net.html#class-netblocklist), registres spéciaux [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) et [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry), consultés pendant ce lot. La politique applicative est volontairement plus restrictive que la seule routabilité IANA pour les tunnels et adresses de protocole.
- Cette preuve constate le routage HTTPS vers une application possédant la clé et le périmètre attendus. Elle ne certifie pas la santé globale des workers et ne remplace pas les preuves DNS TXT et Vercel. La configuration Vercel réelle, le certificat et le routage du candidat restent à certifier. Un déploiement de SHA/configuration différente pendant la vérification impose une nouvelle tentative.
- Les opérations ordinaires durables Vercel/Blob et la réconciliation/libération des réservations restent ouvertes. Aucun fournisseur réel, déploiement ou migration distante ; objectif intégral T00–T23 actif.
