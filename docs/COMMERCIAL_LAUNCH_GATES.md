# Ads by Yodev — gates de commercialisation B2B

Dernière mise à jour : 2026-08-18. Ce document est la checklist de décision de mise
en production. Une case ne peut être cochée qu’avec un lien vers une preuve horodatée
(exécution CI, événement fournisseur, facture, rapport de drill ou validation signée).

## État de lancement

Le produit reste en **bêta privée**. Les valeurs de sécurité attendues en production
avant le début de la bêta sont :

```dotenv
PUBLIC_BETA_ENABLED=0
PUBLIC_API_ENABLED=0
PRIVATE_API_WORKSPACE_IDS=
STRIPE_CHECKOUT_ENABLED=0
GOOGLE_READS_ENABLED=0
GOOGLE_MUTATIONS_ENABLED=0
FORCE_READ_ONLY=1
```

Ces valeurs ne sont pas une preuve de disponibilité : elles empêchent seulement une
ouverture accidentelle. Toute modification de flag doit être enregistrée avec auteur,
heure, motif, ancienne valeur, nouvelle valeur et résultat du smoke test.

## Gate 1 — code

- [x] Migrations `0035` à `0041` appliquées et vérifiées sur une base PostgreSQL 17
  jetable.
- [x] Migrations `0035` à `0041` appliquées sur la base staging européenne, avec
  sauvegarde et comptages avant/après. Preuve du 2026-08-17 : branche de restauration
  conservée `backup-pre-0041-20260817` (`br-wandering-firefly-b2brmy7p`), historique
  passé de 35 à 42 migrations et comptages métier inchangés.
- [x] Le candidat de stabilisation du 2026-08-18 passe `npm run check` avec 797 Vitest
  dans 120 fichiers, une couverture de 92,36 % statements / 85,58 % branches /
  93,30 % fonctions / 94,76 % lignes, 6 E2E publics locaux, 15 pytest, Ruff, les audits
  npm/Python, le SBOM web et toutes les vérifications PostgreSQL. La preuve staging
  authentifiée 5/5 du 2026-08-17 reste historique : le workflow de promotion exige
  désormais cinq nouveaux storage states éphémères et échoue s'ils sont absents.
- [ ] Matrice owner/admin/strategist/analyst/client testée par UI, Server Actions et
  routes directes en FR et EN, y compris l’isolation inter-workspace.
- [x] La route directe d'export renvoie 403 aux rôles sans permission et 404 au owner
  pour l'UUID d'un export appartenant au workspace fixture étranger. Un onzième scénario
  capture la vraie requête `updateWorkspaceLocale`, exclut explicitement le cookie owner,
  puis la rejoue avec chaque session pour prouver que la Server Action réautorise owner/
  admin et refuse strategist/analyst/client. Tous deviennent obligatoires en promotion.
- [x] `release:verify` et le workflow manuel `release-readiness.yml` bloquent une
  promotion en maintenance, sans scheduler/notifications, sans Google Sign-In,
  YoDevMail, Sentry, Stripe ou sans matrice Playwright authentifiée complète.
- [x] Le contrôle de configuration est exécuté dans le runtime Vercel ciblé via
  `/api/internal/release-readiness`, protégé par un jeton dédié, non mis en cache et
  limité aux codes de diagnostic. Les secrets fournisseurs sensibles ne sont pas
  dupliqués dans GitHub Actions. Il exige aussi une exécution récente réussie du
  scheduler et de la rétention, zéro dead-letter/job dû, aucun webhook Stripe échoué,
  aucune réconciliation billing, livraison email problématique ou mutation Google non
  résolue. Le déclenchement staging du 2026-08-18 a bien échoué en 503 sur exactement
  14 prérequis externes/configuration encore ouverts, après réussite des quatre jobs
  standards : [run 32140448381](https://github.com/YoannDrx/yodev-ads/actions/runs/32140448381).
- [x] Zéro appel ou dépendance directe Postmark/Resend dans YoDevAds ; les anciennes
  variables ont également été retirées du staging Vercel.
- [x] Webhooks Stripe et YoDevMail idempotents, rejouables et corrélés à leur registre
  dans le code et les tests automatisés. Les canaries fournisseurs réelles restent une
  condition distincte de la Gate 2.
- [x] `GOOGLE_READS_ENABLED` coupe toute obtention de jeton et tout appel Google Ads,
  y compris les jobs déjà en file. Le scheduler peut ainsi valider rétention et tâches
  internes avant la reconnexion Google, sans lancer de lecture ou d’email fournisseur.
- [x] Le scheduler staging a réussi sous maintenance puis à la cadence Vercel automatique
  suivante, avec zéro dead letter nouvelle. Treize anciens jobs fournisseur ont été
  explicitement annulés sans suppression de leur audit ; la file contient désormais zéro
  job dû/dead-letter et aucun job Google/notification n'a été créé depuis l'activation.
- [x] Slack, Teams, uploads Blob et domaines personnalisés disposent de switches serveur
  indépendants, explicitement fixés à `0` et imposés par la gate tant que leurs drills
  fournisseurs ne sont pas certifiés.
- [x] La confirmation de suppression est strictement `SUPPRIMER` en FR et `DELETE`
  en EN. Sur une PostgreSQL 17 jetable migrée depuis zéro, les fonctions de production
  prouvent qu'avant l'échéance l'annulation gagne contre la purge, restaure l'accès et
  produit son audit ; après l'échéance la purge gagne, cascade les données et conserve
  un tombstone de nettoyage terminé.
- [ ] Le parcours UI complet doit encore être rejoué avec deux workspaces staging
  temporaires FR/EN, puis la restauration de sauvegarde et une panne de nettoyage
  fournisseur doivent être consignées sans toucher aux workspaces réels.
- [ ] Aucun P0/P1 ouvert ; chaque P2 restant possède un contournement accepté.

## Gate 2 — fournisseurs

### YoDevMail

- [ ] Le projet YoDevAds possède une clé dédiée avec les scopes d’envoi brut requis.
- [ ] `POST /v1/emails` accepte le contrat YoDevAds, notamment
  `metadata.workspaceId`, et conserve le même UUID pour une même clé d’idempotence.
- [ ] Tous les profils transactionnels utilisés par les catégories YoDevAds sont
  approuvés côté YoDevMail.
- [ ] Le domaine `yodev.fr`, l’adresse `ads@yodev.fr`, SES/Postmark et le webhook de
  retour sont validés dans les environnements staging et production.
- [ ] Une livraison FR et EN de chaque famille critique a été reçue ; timeout, doublon,
  hard bounce, plainte, suppression et signature invalide ont été exercés.

Le dépôt YoDevMail présent localement accepte le contenu brut, le contrat
d’idempotence et `metadata.workspaceId`, conservé comme tag interne. Le schéma ciblé,
ses tests et le typecheck passent. La gate reste ouverte jusqu’au provisioning des
environnements et aux preuves de livraison, de corrélation et d’incident réelles.

### Stripe

- [ ] Entité française activée, KYC terminé, `charges_enabled` et `payouts_enabled`
  vrais, banque/descripteur/branding/MFA vérifiés.
- [x] Inventaire sandbox exporté avant mutation ; les anciens produits/prix sandbox
  sans souscription active ont été archivés. L’inventaire live reste obligatoire avant
  toute création live.
- [ ] Un produit `Ads by Yodev`, trois Prices EUR mensuels 29/89/189, portail et
  endpoint webhook créés séparément en live.
- [ ] Test Clock : achat, doublon, impayé initial, upgrades, downgrades programmés,
  renouvellement, grâce, récupération, annulation/révocation, remboursement partiel et
  complet, carte, 3DS et événements hors ordre.
- [ ] Achat Solo live interne, facture/TVA, portail, changement annulé et remboursement
  réel vérifiés sans webhook échoué.

Preuve sandbox complémentaire du 2026-08-17 : le catalogue actif contient un seul
produit `prod_V5f47E2LQeHq1p` et trois Prices EUR mensuels 29/89/189 ; un drill réel a
validé activation Solo, upgrade Studio payé et appliqué, downgrade Solo programmé à
l'échéance puis annulation du schedule. Le compte inspecté reste cependant un compte
test américain non activé (`charges_enabled=false`, `payouts_enabled=false`) et ne
constitue donc aucune preuve Stripe live française.

### Google, stockage, OAuth et observabilité

- [ ] Lectures Google Search/PMax/Shopping/conversions et erreurs réelles exercées sur
  un MCC contrôlé, request IDs conservés.
- [ ] Chaque famille de mutation activée dans l’ordre prévu avec `validateOnly`, vote,
  envoi unique, relecture, observation et rollback manuel.
- [ ] Slack, Teams, Blob et domaine personnalisé sont soit validés par un drill réel,
  soit masqués du dashboard et des promesses tarifaires.
- [ ] Sentry staging/production, releases, source maps, redaction et alertes critiques
  sont vérifiés par des événements synthétiques sans données personnelles.
- [ ] Scheduler, rétention et réconciliation Stripe ont une preuve de dernière réussite
  et une alerte externe après deux passages manqués.

Le drill runtime du 2026-08-17 a atteint le fournisseur depuis le staging, puis a été
classé en dead-letter avec un jeton OAuth Google révoqué/expiré. Il prouve le chemin
d'erreur, pas les lectures métier ; le propriétaire doit reconnecter le MCC avant la
recette read-only puis toute mutation contrôlée.

L'audit Google Cloud du 2026-08-18 confirme que le projet produit `vigieads` est encore
publié en mode Test avec un seul utilisateur de test. Le projet OAuth mutualisé voisin
affiche un branding générique et n'est pas une solution commerciale acceptable. Le
client Better Auth staging doit donc être créé dans `vigieads`, puis le branding Ads by
Yodev et la publication/validation des scopes doivent être terminés avant de considérer
un nouveau refresh token comme durable.

## Gate 3 — juridique et fiscal

- [ ] Entité contractante, adresse, SIREN/SIRET, TVA et contacts vérifiés.
- [ ] CGV B2B, confidentialité, DPA, registre des sous-traitants et remboursement
  approuvés et versionnés par les professionnels compétents.
- [ ] Régime de TVA et mentions de facture approuvés par l’expert-comptable.
- [ ] Délais et canaux de support publiés.
- [ ] `LEGAL_DOCUMENTS_APPROVED=1` activé seulement après archivage de ces preuves.

Le registre email doit refléter la chaîne réelle YoDevMail. L’implémentation locale de
YoDevMail référence actuellement Amazon SES et Postmark ; ces deux fournisseurs sont
donc présentés comme sous-traitants indirects, et non comme des transports appelés par
YoDevAds.

## Gate 4 — production et bascule

- [ ] Environnements `yodev-ads-staging` et `yodev-ads` réellement séparés : base,
  Stripe, YoDevMail, OAuth, Sentry et secrets.
- [ ] Sauvegarde complète et restauration isolée réussie avant migration.
- [ ] Ancienne production inventoriée ; décision de migration documentée par table.
- [ ] Maintenance + `FORCE_READ_ONLY=1`, migrations, comptages, variables, release
  candidate, smoke tests, domaine et fenêtre de rollback exécutés dans cet ordre.
- [ ] Ancienne production conservée en lecture seule pendant la fenêtre approuvée.
- [ ] Surveillance renforcée pendant 24 heures avec responsables identifiés.
- [x] Les jobs GitHub Actions `web`, `database`, `cli` et `secrets` ont réellement
  démarré puis réussi sur le commit `4037913`; la gate runtime distincte a ensuite
  refusé le staging incomplet :
  [run 32140448381](https://github.com/YoannDrx/yodev-ads/actions/runs/32140448381).

Rollback immédiat si authentification indisponible, fuite inter-tenant, incohérence
Checkout/webhook, migration incomplète, email critique non soumis ou mutation Google
non réconciliée.

## Gate 5 — bêta privée

Le compteur commence uniquement avec au moins trois agences actives, Stripe live,
YoDevMail production, scheduler/Sentry actifs, documents approuvés et au moins une
famille de mutation contrôlée.

- [ ] 30 jours complets, prolongés de toute interruption critique.
- [ ] 3 à 5 agences utilisatrices.
- [ ] Au moins un renouvellement live et un remboursement live réussis.
- [ ] Zéro fuite/perte de données et zéro mutation ambiguë ouverte.
- [ ] 100 % des paiements réconciliés.
- [ ] 100 % des emails avec UUID YoDevMail + état local, ou erreur terminale explicite.
- [ ] Aucun doublon logique d’email.
- [ ] Aucun cron n’a manqué deux passages consécutifs.
- [ ] Support, sauvegarde, restauration, rollback et runbooks exercés.

L’ouverture publique n’est autorisée qu’après validation signée des cinq gates.
`PUBLIC_API_ENABLED` reste à `0` au lancement public ; l’API v1 ne peut être ouverte
qu’aux UUID listés dans `PRIVATE_API_WORKSPACE_IDS` pendant sa bêta privée.
