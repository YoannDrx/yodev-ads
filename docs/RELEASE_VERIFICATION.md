# Vérification d'un candidat déployé

Ces contrôles identifient le candidat, sa configuration et ses preuves opérationnelles. Leur implémentation locale ne vaut pas certification du déploiement. Le journal `PROD_READY_EXECUTION.md` distingue les tests locaux des exercices fournisseurs réellement exécutés.

## Cible, origine et commit

Les trois cibles sont `staging`, `private_beta` et `public`. `RELEASE_TARGET` côté serveur et `NEXT_PUBLIC_RELEASE_TARGET` à la compilation doivent correspondre à la cible choisie. Le serveur expose le commit de `VERCEL_GIT_COMMIT_SHA`, ou `NEXT_PUBLIC_RELEASE_SHA` dans un déploiement sans Vercel.

Dans chaque environnement GitHub, configurer la variable `RELEASE_VERIFICATION_ALLOWED_ORIGIN` avec l'origine HTTPS autorisée, indépendamment de l'URL saisie au déclenchement du workflow. Le workflow fournit `RELEASE_VERIFICATION_EXPECTED_SHA=${{ github.sha }}` : sélectionner le ref du candidat effectivement déployé. Il ne valide pas automatiquement le dernier déploiement trouvé.

Les scripts exigent :

- `RELEASE_TARGET`, `RELEASE_VERIFICATION_EXPECTED_SHA` (40 caractères hexadécimaux) ;
- `RELEASE_VERIFICATION_BASE_URL` ou `PLAYWRIGHT_BASE_URL`, et `RELEASE_VERIFICATION_ALLOWED_ORIGIN` ;
- `RELEASE_VERIFICATION_TOKEN`, fourni comme secret d'environnement.

L'URL doit être une origine HTTPS sans chemin, identifiants, paramètres ni fragment. Les redirections sont refusées. L'origine est contrôlée avant l'envoi du token. Le serveur contrôle les en-têtes d'identité avant l'accès fournisseur ; les scripts vérifient de nouveau la cible, le SHA et une réponse datée de moins de dix minutes. Les erreurs affichent des codes de diagnostic, sans contenu de secret ni message brut du fournisseur.

Les scripts ne chargent pas automatiquement les fichiers `.env`. Fournir explicitement l'environnement de recette et utiliser les commandes du dossier `web`. Ne pas exporter les secrets dans un journal ni conserver de fichier de sessions navigateur dans Git.

## Lecture Google Ads

`npm run verify:deployed-google-ads-read` choisit le drill staging ou la sonde commerciale selon la cible. Le drill staging conserve ses exigences de lecture seule globale. La sonde commerciale appelle uniquement l'interface de lecture du gateway, même si les familles de mutations du produit sont activées.

La sonde commerciale exige `GOOGLE_READS_ENABLED=1` et deux UUID explicites côté serveur :

- `GOOGLE_ADS_VERIFICATION_WORKSPACE_ID` : espace interne disposant d'une connexion Google active ;
- `GOOGLE_ADS_VERIFICATION_CLIENT_ID` : annonceur actif, non gestionnaire, appartenant à cet espace.

L'absence du compte choisi bloque la preuve ; aucun autre client n'est sélectionné à sa place. Le renouvellement OAuth et les familles MCC, campagnes, Performance Max, Shopping, conversions et diagnostics hors ligne sont exercés, avec leurs identifiants de requête. La route borne le travail à 50 secondes et n'exécute aucune mutation publicitaire. OAuth et les lectures consomment les quotas normaux du fournisseur.

## Preuve Sentry et lecture commerciale

`npm run verify:deployed-sentry` produit et vérifie un événement synthétique en staging. Pour `private_beta` et `public`, il appelle uniquement la sonde GET lisant une preuve déjà indexée.

La preuve doit appartenir au projet du DSN, au même environnement et au même commit que le candidat. Elle doit dater de moins de 24 heures, porter le marqueur de drill, contenir la substitution `[REDACTED_API_KEY]` et ne contenir ni email ni token synthétique brut. Une ancienne release ou un événement sans preuve de masquage ne peut pas valider le candidat.

Le token runtime dédié `SENTRY_EVENT_READ_AUTH_TOKEN` utilise `project:read`, séparément du token de publication de release. L'API est limitée à `https://de.sentry.io`, sans redirection. Le contrat des champs `eventID`, `projectID`, `dateCreated` et `release.version` et le scope sont décrits dans la [documentation officielle de lecture d'événement Sentry](https://docs.sentry.io/api/events/retrieve-an-event-for-a-project/).

Pour préparer une preuve sur une cible commerciale :

1. Déployer le candidat exact avec `SENTRY_SYNTHETIC_VERIFICATION_ENABLED=1` temporairement. Cette option permet uniquement le drill synthétique authentifié ; elle ne change pas les sondes GET.
2. Depuis l'environnement de recette autorisé, lancer `npm run verify:deployed-sentry-drill`. Cette commande émet volontairement **un événement de télémétrie synthétique**, puis attend son indexation et vérifie identité et masquage. Elle exige origine, token, cible et SHA exacts. Aucun email n'est envoyé à l'adresse synthétique.
3. Archiver la sortie contenant l'identifiant d'événement, puis configurer cet identifiant dans `SENTRY_VERIFICATION_EVENT_ID`. Remettre `SENTRY_SYNTHETIC_VERIFICATION_ENABLED=0` et redéployer le même commit avec cette configuration.
4. Exécuter la sonde GET de promotion. Refaire l'exercice si le commit, l'environnement, la chaîne de masquage ou le projet change, ou si la preuve expire.

Le budget partagé du drill est de 50 secondes, attente d'indexation comprise. Un échec d'indexation ne prouve pas l'absence d'événement : rechercher l'exercice dans Sentry avant de le répéter. Aucun exercice fournisseur réel n'a été exécuté dans le cadre des tests unitaires de cette implémentation.

## Connecteurs optionnels

Les domaines personnalisés, le stockage Blob, Slack et Teams peuvent rester explicitement désactivés (`0`). Leur activation (`1`) exige les credentials correspondants et une attestation dans `PROVIDER_CERTIFICATES_JSON`.

Une attestation est un enregistrement d'un exercice réel, examiné par l'opérateur. Ce mécanisme contrôle sa cohérence et sa fraîcheur ; il ne signe pas l'attestation, ne télécharge pas son artefact et ne remplace pas l'exercice fournisseur T18. Ne jamais inscrire `passed` à partir de tests simulés uniquement.

Chaque objet contient :

| Champ | Contrat |
| --- | --- |
| `provider` | `custom_domains`, `blob_uploads`, `slack_connector` ou `teams_connector` |
| `outcome` | `passed`, après exercice et examen de la preuve |
| `target`, `release`, `origin` | Cible, SHA exact et `NEXT_PUBLIC_APP_URL` du candidat |
| `configurationHash` | Empreinte SHA-256 de la configuration utilisée pendant l'exercice |
| `checkedAt`, `expiresAt` | Horodatages ISO UTC ; validité maximale de sept jours ; aucune date future au-delà de la tolérance d'une minute |
| `artifactUrl` | Lien HTTPS sans identifiants vers le dossier de preuve accessible aux personnes habilitées |

Calculer uniquement l'empreinte, dans l'environnement exact du fournisseur, avec `npm run provider:configuration-hash -- slack_connector` (ou l'autre identifiant). La commande exige l'origine et les credentials obligatoires, n'affiche pas leurs valeurs et ne produit pas de certificat de réussite. Une rotation des credentials, un changement de projet/d'équipe, d'origine, de cible ou de commit invalide l'attestation. Les preuves ne doivent pas contenir de tokens, de cookies ni de données client inutiles.

Les exercices doivent couvrir le parcours nominal, les refus, la déconnexion/révocation, les erreurs fournisseur et la réconciliation pertinente au connecteur. Conserver l'identité du responsable, les identifiants de requête et les résultats de ces cas dans l'artefact T18. Aucun certificat réel n'est ajouté par ce changement.

## Recette et promotion

`npm run test:release-verification` teste les gardes du client CI. Les tests Vitest couvrent l'accès aux routes, les trois cibles, les erreurs d'identité, les états fournisseur et les attestations. `npm run release:verify` conserve les contrôles de code, configuration et santé opérationnelle ainsi que la matrice authentifiée obligatoire.

Les contrôles de facturation, documents approuvés, supervision, rétention et bêta existants restent applicables. Les 30 jours de bêta et les preuves réelles ne sont pas remplacés par la réussite des tests locaux. Avant clôture de T08/T22, exécuter les trois cibles déployées sur leurs commits attendus et archiver les résultats ainsi que les échecs de configuration volontairement exercés.
