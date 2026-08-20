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

- [x] Migrations `0035` à `0043` appliquées et vérifiées sur une base PostgreSQL 17
  jetable.
- [x] Migrations `0035` à `0043` appliquées sur la base staging européenne, avec
  sauvegarde et comptages avant/après. Preuve du 2026-08-17 : branche de restauration
  conservée `backup-pre-0041-20260817` (`br-wandering-firefly-b2brmy7p`), historique
  passé de 35 à 44 migrations et comptages métier inchangés. `0042` durcit les preuves
  de configuration et `0043` ajoute l'état opérationnel `reviewed` sans supprimer les
  échecs historiques.
- [x] Le candidat de stabilisation du 2026-08-18 passe `npm run check` avec 818 Vitest
  dans 123 fichiers, une couverture de 92,27 % statements / 85,53 % branches /
  93,26 % fonctions / 94,64 % lignes, 6 E2E publics, 15 pytest, Ruff, les audits
  npm/Python, le SBOM web et toutes les vérifications PostgreSQL.
- [x] Matrice owner/admin/strategist/analyst/client testée sur le staging ouvert :
  17 scénarios Playwright sans skip couvrent pages, vraie Server Action, route API,
  permissions et isolation non énumérable d'un second workspace. Les cinq identités
  et sessions de recette sont recréées puis supprimées par la gate de promotion.
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
  résolue. Le staging ouvert du commit `9cad4b1` répond `ready: true` avec une liste
  d'issues vide. La preuve canonique est le workflow complet vert
  [32177451921](https://github.com/YoannDrx/yodev-ads/actions/runs/32177451921).
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

- [x] Le projet Ads by Yodev possède une clé dédiée active avec les scopes d’envoi brut
  requis ; les clés de transition ont été révoquées.
- [x] `POST /v1/emails` accepte le contrat Ads by Yodev, notamment
  `metadata.workspaceId`, et conserve le même UUID pour une même clé d’idempotence.
- [x] Les profils transactionnels requis sont approuvés côté YoDevMail, en mode
  hybride/raw contrôlé.
- [x] Le domaine `yodev.fr`, l'identité d'envoi et le webhook de retour sont validés
  pour le staging ; la clé dédiée a réussi une livraison fournisseur réelle. Le gate
  live puis le gate raw ont été ouverts séparément après un baseline fournisseur vert.
- [ ] Une livraison FR et EN de chaque famille critique a été reçue ; timeout, doublon,
  hard bounce, plainte, suppression et signature invalide ont été exercés.

Le contrat brut, l'idempotence et `metadata.workspaceId` sont prouvés en code et chez
le fournisseur. Un canari template (`1e86ef51…`) puis le payload brut exact de
l'application (`80f30483…`) ont atteint `delivered`. Le retry audité de la vraie alerte
`google.change_sync` a ensuite été accepté (`5dbc76a3…`). Les anciens échecs ont été
revus explicitement et le staging ne conserve aucune livraison problématique. La gate
exhaustive reste ouverte pour la matrice FR/EN et les canaries hard bounce/complaint.
Les alertes opérationnelles sont désormais adressées à `support@yodev.fr`, alias dont
la réception a été vérifiée, au lieu de l'ancienne boîte du sous-domaine Ads.

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

Preuve sandbox complémentaire du 2026-08-18 : le catalogue actif contient un seul
produit `prod_V5f47E2LQeHq1p` et trois Prices EUR mensuels 29/89/189 ; un drill réel a
validé activation Solo, upgrade Studio payé et appliqué, downgrade programmé,
annulation, impayé initial, événements hors ordre, remboursement partiel et complet.
Le compte inspecté reste cependant un compte
test américain non activé (`charges_enabled=false`, `payouts_enabled=false`) et ne
constitue donc aucune preuve Stripe live française.

### Google, stockage, OAuth et observabilité

- [x] Lectures Google Search/PMax/Shopping/conversions et diagnostics réels exercés sur
  un MCC contrôlé, request IDs conservés.
- [ ] Chaque famille de mutation activée dans l’ordre prévu avec `validateOnly`, vote,
  envoi unique, relecture, observation et rollback manuel.
- [ ] Slack, Teams, Blob et domaine personnalisé sont soit validés par un drill réel,
  soit masqués du dashboard et des promesses tarifaires.
- [ ] Sentry staging/production, releases, source maps, redaction et alertes critiques
  sont vérifiés par des événements synthétiques sans données personnelles.
- [ ] Scheduler, rétention et réconciliation Stripe ont une preuve de dernière réussite
  et une alerte externe après deux passages manqués.

Le drill runtime du 2026-08-17 avait atteint le fournisseur avec un ancien jeton révoqué.
Le 2026-08-18, le propriétaire a reconnecté le MCC avec succès et la synchronisation
staging a importé deux comptes accessibles. Les mutations restent désactivées et le
nouveau drill de promotion refuse de s'exécuter si `FORCE_READ_ONLY=1` et
`GOOGLE_MUTATIONS_ENABLED=0` ne sont pas tous deux prouvés. Le run
[32177451921](https://github.com/YoannDrx/yodev-ads/actions/runs/32177451921) a renouvelé
le refresh token, relu 2 comptes, 6 campagnes Search/PMax, 443 placements PMax,
2 asset groups, Shopping, 23 actions de conversion et les diagnostics offline. Il a
conservé 8 request IDs répartis entre les six familles du drill.

Le client Better Auth staging, le branding Ads by Yodev et les domaines OAuth Yodev
sont configurés. Les anciens domaines `vigihat.com`, `vigie-ads.vercel.app` et
`vigieads.vercel.app` ont été supprimés. Le grant propriétaire est renouvelé ; le drill
read-only conserve désormais les request IDs par famille avant toute décision de
publication des scopes ou d'ouverture d'une mutation.

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
  réussi sur `9cad4b1` dans le run
  [32177451921](https://github.com/YoannDrx/yodev-ads/actions/runs/32177451921) ; la gate
  de promotion vérifie en plus le runtime
  déployé, Sentry, Google read-only et la matrice authentifiée avant de pouvoir conclure
  au succès.

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
