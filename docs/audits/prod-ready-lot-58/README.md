# Lot 58 — Formulaires de domaines, downgrade et messages FR/EN

Base : `560a261`. Suite T04/T05/T15/T17/T18. Aucune migration.

Le service de retrait autorisait déjà le nettoyage après downgrade, mais l’action et la page exigeaient encore la capacité Agency. Les trois actions sont maintenant isolées dans `domain-actions.ts` et exigent exactement l’espace affiché avant toute génération de token, révélation ou effet. Configuration/vérification conservent leur capacité ; le retrait exige l’administrateur courant et le switch fournisseur, sans imposer de conserver le forfait Agency.

La page charge les domaines existants même lorsque le forfait ne permet plus d’en configurer. Elle explique le downgrade, garde le retrait accessible et masque configuration/vérification. Si le switch est fermé, l’état reste consultable et les opérations sont désactivées. Les formulaires possèdent leur contexte et une clé d’espace/ressource ; un changement d’espace recrée la saisie. Le hostname dispose d’un libellé accessible et les contrôles s’adaptent au mobile.

Seuls des messages applicatifs autorisés entrent dans les redirections ; détails SQL, credentials et erreurs réseau brutes sont remplacés par un message fixe. Le même filtre protège les erreurs historiques affichées. Les états techniques sont présentés en FR/EN. La validation refuse les labels DNS invalides, identifiants utilisateur, query strings, fragments et antislashs qui pouvaient être interprétés comme un autre hostname ; l’IDN valide reste normalisé.

## Preuves

- `check.log` : **1 675 tests / 204 fichiers**, huit tests de scripts, lint, TypeScript, frontières, build et audit runtime sans vulnérabilité détectée. Couverture instructions/branches/fonctions/lignes : **91,45 / 86,31 / 92,97 / 94,40 %**. Les 29 nouveaux tests couvrent contexte absent/dupliqué/obsolète, rôle/switch/forfait, cookie, succès et erreurs filtrées.

- `browser-targeted.log` : **deux nouveaux parcours réussis en 8,2 s**, FR mobile 390 px et EN desktop 1440 px, sur sessions Better Auth et PostgreSQL réels locaux. Création avec session changée refusée, formulaire neuf dans le nouvel espace, vérification/retrait anciens refusés, downgrade puis retrait admis jusqu’à la frontière fournisseur sans credentials. Captures `domain-downgrade-fr.png` et `domain-downgrade-en.png` inspectées : états et messages traduits, contrôles lisibles, aucune largeur débordante. Aucun secret TXT révélé dans les captures.

- `browser-full.log` : **86 scénarios réussis sans skip en 3,7 minutes**, avec les trois contrôles locaux analytiques, sécurité et domaines. Sessions réelles Better Auth/PostgreSQL, cinq rôles, FR/EN, mobile, rapports HTML/PDF/CSV, sécurité et collections inclus. Le serveur est vérifié par agent-browser avant la recette ; la page de connexion affiche ses contrôles sans overlay d’erreur. Le runner termine avec nettoyage des fixtures. Cette recette générale remplace celle du lot 43 comme référence locale courante.

- `database.log` : toute la suite PostgreSQL passe avec les services et les 62 migrations existantes. Les ajouts finaux de validation syntaxique de hostname et les corrections de typage des tests sont vérifiés par le contrôle général/navigateur ; ils suivent cette suite complète. Les preuves depuis base vide restent celles du lot 57.
- Le runner local propose `YODEV_TEST_DOMAIN_CONTROLS=1` et transmet `PLAYWRIGHT_DOMAIN_CONTROLS=1`. Les credentials Vercel et Blob sont explicitement vides, en plus des autres transports ; le nouveau parcours ne peut donc effectuer aucun retrait fournisseur réel.

## Limites

La recette UI de retrait après downgrade va jusqu’au refus sûr de la configuration fournisseur absente. Elle vérifie l’admission de l’administrateur Solo et la conservation du domaine ; elle ne prétend pas confirmer un retrait Vercel réel. Les succès/reprises fournisseur simulés restent couverts par les protocoles PostgreSQL et unitaires des lots 53–57.

La réconciliation/libération des réservations et la journalisation des opérations ordinaires Vercel/Blob restent ouvertes, ainsi que la sonde HTTP et les autres critères du plan. Aucun déploiement ou migration distante ; objectif intégral T00–T23 actif.
