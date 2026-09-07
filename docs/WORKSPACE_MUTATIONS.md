# Paramètres, vues personnelles et accès aux pages

Les actions de modification conservent leurs validations de formulaire et leur contrôle de session. Le service relit aussi l’acteur dans la transaction, au moyen de `withWorkspaceActorTransaction`. Ce contrôle porte sur l’adhésion, le rôle, le propriétaire, le lifecycle et, si nécessaire, la capacité du forfait courant. Les verrous stabilisent ces références jusqu’au commit ; un essai est vérifié de nouveau après les attentes métier et les écritures. Un refus annule l’ensemble de la transaction et son audit.

## Paramètres et objectifs

Les cinq opérations de `workspace-settings.ts` exigent `workspace:admin` : objectif client, langue, politique d’approbation, identité de marque et logo. Marque et logo exigent en outre `reports.white_label`. La double approbation exige `approvals.dual` ; la politique est recalculée avec l’offre relue, y compris l’interdiction d’auto-approbation sur Trial et Agency. Le mode simple/double provient du nombre d’approbations validé.

L’objectif verrouille le compte ciblé dans le bon espace, refuse un compte manager et utilise sa devise actuelle dans l’audit. Les audits de langue et de politique utilisent les valeurs précédentes relues sous verrou. Les anciens arguments de contexte restent acceptés pour compatibilité avec les appelants, mais ne définissent plus ces valeurs autoritatives.

La mutation de logo retourne l’URL qui était réellement enregistrée juste avant son remplacement ou son retrait. L’action utilise cette référence pour le nettoyage Blob, au lieu d’une valeur chargée avant l’attente. L’envoi, le retrait Blob effectif et la récupération d’un nettoyage fournisseur échoué ne sont pas certifiés par la recette PostgreSQL ; cette dernière n’appelle aucun fournisseur.

## Vues personnelles

Créer, remplacer et supprimer une vue exigent le rôle courant autorisé à `portfolio:save_view`. La restriction à l’espace/utilisateur et le jeton de version restent appliqués aux écritures. La limite de 20 vues par utilisateur/espace demeure sérialisée par le verrou commun. Un analyste conserve ces fonctions ; un membre devenu client ou retiré ne peut plus envoyer un formulaire ancien. La grâce autorise la lecture et refuse l’écriture.

## Refus d’accès aux pages

`requireWorkspacePagePermission` reçoit la permission et le chemin déclaré par la page. Il conserve les restrictions de chemin existantes, notamment en grâce, puis vérifie rôle et lifecycle. Un refus oriente vers une page de facturation ou de support accessible ; un refus de la destination elle-même devient terminal. Les 19 pages ordinaires du groupe authentifié l’utilisent. Les deux pages d’opérations conservent leur contrôle spécifique d’espace interne et de rôle, avec refus 404.

Le layout conserve l’identité, la navigation filtrée et les styles. Il ne prend plus une décision de redirection à partir de `x-yodev-pathname` : ce contexte pouvait être repris dans une redirection de Server Action et entraîner des requêtes répétées vers le support. Les Server Actions conservent `requireWorkspacePermission`, qui refuse par exception ; leur contrôle ne dépend pas du rendu d’une page ou d’un bouton.

## Ressources de sécurité

Le [lot 38](./audits/prod-ready-lot-38/README.md) étend le garde aux six opérations de clés, canaux, reprise manuelle de job et règles de sécurité. Créer/révoquer une clé exige `api_keys:manage`, réservé au propriétaire ; les autres opérations exigent `workspace:admin`. La création de clé vérifie aussi l’allowlist privée, les scopes connus, `api.read` ou `api.propose` selon les scopes demandés, puis le quota courant. Les anciens entitlements fournis par l’appelant ne définissent plus les droits. Les contrôles visibles suivent ces permissions.

La règle de sécurité valide sa portée depuis le forfait courant. Un compte client est relu sous verrou dans son espace : manager, compte absent et devise discordante sont refusés. La désactivation d’un canal remplace sa destination chiffrée par un marqueur révoqué ; la reprise de job augmente sa génération et son plafond sans effacer les tentatives acquises. Un essai expirant pendant ces écritures annule toute la transaction. Aucun fournisseur n’est appelé dans ces services.

## Périmètre de vérification

Le [lot 39](./audits/prod-ready-lot-39/README.md) protège également les cinq mutations de membres dans leur transaction système : workspace et adhésion de l’acteur verrouillés, cible de transfert verrouillée, contrôle final du temps d’essai sans invalider un transfert ou retrait volontaire autorisé. La sauvegarde des préférences personnelles utilise le garde tenant de l’acteur courant. Le [lot 40](./audits/prod-ready-lot-40/README.md) protège les destinataires de mentions et digests, puis expose les préférences dans l’espace personnel. Le formulaire partagé lie la sauvegarde à l’espace affiché et autorise seulement deux destinations de retour : paramètres ou préférences personnelles. Le [contrat de notification](./TASK_NOTIFICATIONS.md) précise les vérifications et leurs limites.

Le [lot 42](./audits/prod-ready-lot-42/README.md) étend le garde transactionnel aux deux modes de sauvegarde des comptes gérés : sélection et priorités. Il contrôle également l’essai en fin de transaction et lie le formulaire à l’espace affiché. Le [contrat de sélection](./ACCOUNT_SELECTION.md) conserve les garanties de quotas et de synchronisation distinctes.

Le [lot 43](./audits/prod-ready-lot-43/README.md) protège la persistance d’inventaire manuel par le même garde. La persistance système vérifie le job stocké, sa portée, sa tentative et son bail sous verrou ; les deux chemins verrouillent la connexion et annulent les essais expirant pendant l’écriture. Le contrôle système final inclut les réponses anciennes qui réconcilient les activations.

Les lots 37–43 relient les reproductions, les attentes PostgreSQL observées, les audits autoritatifs et les parcours navigateur. Ils ne terminent pas la revue des autres mutations : sessions OAuth, rapports, domaines et lifecycle conservent leurs chantiers identifiés dans le plan. Les garanties locales ne valent pas validation des intégrations déployées.
