# Sélection des comptes et changements de quota

## Contrat

L’inventaire MCC et la sélection gérée sont distincts. `google_accessible` décrit l’accès connu au dernier inventaire complet ; `inventory_observed_at` date cette observation. `managed_selected` conserve le choix de l’agence et `management_priority` son ordre. `active` représente le sous-ensemble effectivement géré : annonceurs sélectionnés et accessibles, dans la limite actuelle, et administrateurs accessibles sans consommation de quota.

Un nouvel annonceur découvert reste non sélectionné. Les synchronisations préservent les préférences existantes. Une disparition du MCC met le compte en pause sans supprimer sélection, mesures, vigies ou rapports. Son retour peut le réactiver à sa position dans le quota. Une reconnexion Google suspend les comptes jusqu’au prochain inventaire vérifié, tout en conservant les préférences et l’historique.

Un downgrade applique la priorité enregistrée, puis l’identifiant Google et l’identifiant interne pour départager les égalités. Les choix au-delà du quota restent mémorisés : une montée en gamme peut les restaurer. L’administrateur peut enregistrer uniquement un nouvel ordre lorsque les préférences conservées dépassent le quota ; cette opération doit conserver exactement les mêmes comptes. Une nouvelle sélection explicite doit respecter le quota. Le bouton « Garder les comptes actuellement gérés » permet de réduire les préférences au sous-ensemble actuel.

## Parcours

`/accounts` expose inventaire, recherche, pages de 25 lignes, sélection, priorités et conséquences avant sauvegarde. Les nouveaux comptes ou ceux hors quota restent visibles. Les administrateurs peuvent agir ; les analystes disposent de la lecture seule. Les liens de connexion respectent aussi le rôle et le cycle de vie.

`/billing` affiche l’effet de chaque offre sur la sélection enregistrée, nomme les comptes qui seraient mis en pause et propose de modifier les priorités. L’aperçu dépend de l’inventaire actuel : une modification d’accès Google avant l’échéance peut changer le sous-ensemble final.

Un conflit de sauvegarde réaffiche l’état actuel avec un message explicite ; aucune fusion silencieuse n’écrase les choix d’un autre administrateur. Le cockpit sans compte choisi guide vers la sélection. Une demande portant explicitement sur un compte inactif, absent ou étranger ne retombe plus sur un autre compte actif.

## Concurrence et effets

Sélection et inventaire prennent le verrou transactionnel d’accès à l’espace puis le verrou de ligne de l’espace. Le quota est relu après acquisition. Les webhooks Stripe modifient cette même ligne avant de recalculer les comptes actifs. Ils n’acquièrent pas le verrou consultatif après la ligne, ce qui évite l’inversion de verrou avec une sauvegarde de sélection.

La version de formulaire comprend le forfait et l’état sémantique des comptes. Un formulaire obsolète échoue avant modification. La sélection, les activations et l’audit sont atomiques. Les mises à jour des priorités sont groupées en SQL.

Depuis le lot 42, les deux modes de sauvegarde utilisent aussi `withWorkspaceActorTransaction` : adhésion et rôle actuels, permission `google:connect`, capacité `google.read`, lifecycle et essai sont vérifiés dans la transaction. Un retrait ou changement de rôle effectué sans verrou applicatif est observé par le verrou de l’adhésion. Si l’essai expire pendant une attente métier, l’ensemble sélection/activation/jalon/audit est annulé. La présence d’une version de sélection valide ne remplace pas l’autorisation courante.

Le formulaire porte l’identifiant de l’espace affiché ; sa sauvegarde est refusée si l’espace actif a changé. L’éditeur est réinitialisé par espace et version. Les refus de session, rôle ou lifecycle sont traités par le retour de l’action et les gardes de page ; ils ne laissent pas une exception de permission brute à l’écran. Depuis le lot 43, la persistance manuelle d’inventaire utilise également ce garde d’acteur. Les processus système vérifient leur job courant, sans exiger une adhésion humaine pour un traitement déclenché par la facturation.

La persistance système exige le job revendiqué : type `google.accounts_sync`, espace déclaré et stocké identiques, payload concordant, état `running`, même worker et même tentative. Le job est verrouillé avant la connexion ; son bail est évalué dans une nouvelle requête après attente, puis revérifié à la fin. Le quota et l’expiration effective de l’essai sont relus après verrouillage de l’espace. Toute expiration pendant l’écriture annule clients, audit, jalon et date de dernière utilisation. Le chemin de réponse ancienne, qui peut encore réconcilier les comptes actifs, passe aussi par ces contrôles finaux.

Chaque inventaire comporte la date de début de lecture et une empreinte des paramètres de connexion conservée seulement en mémoire. La connexion est relue sous verrou de ligne conservé jusqu’au commit : une modification ou révocation concurrente invalide la réponse si elle a précédé cette admission. Un inventaire plus ancien ne remplace pas le plus récent, y compris après un inventaire vide. Les doublons normalisés identiques sont fusionnés ; les métadonnées contradictoires sont rejetées avant écriture. Seule une lecture complète est admissible.

Les planificateurs et workers de collecte contrôlent les comptes actifs ; la persistance des mesures et analyses les revérifie. Les notifications vérifient également cette condition avant transport. Un rapport planifié d’un compte inactif est ignoré, sans suppression de la planification. Les liens publics dynamiques actuels ne peuvent pas déclencher une lecture pour un compte inactif ou une connexion révoquée. L’admission finale d’une mutation Google partage le verrou de sélection et relit compte, tentative, connexion et droits du forfait avant le marqueur de soumission. Une opération déjà admise ou envoyée peut terminer après une mise en pause : une modification de sélection n’annule pas un effet externe déjà engagé. Les résultats ambigus restent soumis à réconciliation.

## Migration et exploitation

`0049_managed_account_selection` conserve exactement `active` au déploiement. Les annonceurs actifs deviennent sélectionnés ; les autres ne le deviennent pas automatiquement. L’ordre initial suit les identifiants Google. L’accès historique reprend `active`, avec une date d’observation nulle : la migration ne prétend pas avoir vérifié Google.

Déployer le schéma avant le code. Suspendre les producteurs et vider ou arrêter les anciennes versions des workers d’inventaire avant reprise : l’ancien algorithme choisissait automatiquement les premiers comptes. Ne pas rétablir cet ancien worker comme retour arrière après que des agences ont enregistré leurs préférences. En cas d’incident, conserver le schéma et les choix, couper les collectes concernées, puis publier un correctif compatible. Aucun effacement des colonnes de préférence n’est requis pour arrêter les traitements.

Le rendu est paginé côté navigateur ; le chargement de l’inventaire reste complet. Les très grands MCC et la pagination serveur sont suivis dans T14. Les compteurs d’un forfait ne comptent que les annonceurs actifs ; une préférence inaccessible conservée compte néanmoins dans une nouvelle sélection explicite, que l’agence peut réduire.

## Preuves locales

`web/scripts/verify-account-selection.ts` exerce PostgreSQL réel sans transport : 57 comptes dont deux MCC, limites 3/15/50, découverte, conservation des priorités, downgrade/restauration, priorités au-delà du quota, sauvegardes concurrentes, faux identifiants, inventaire vide puis réponse ancienne, reconnexion, historique, grâce et admission finale des mutations.

`web/scripts/verify-account-selection-upgrade.mjs` exige une base locale jetable vide. Il applique les 49 premières migrations, insère des comptes de l’ancien modèle, applique la cinquantième migration et vérifie la conservation exacte des identités et états. Les fixtures métier sont ensuite supprimées.

Recette navigateur FR à 390 px et EN à 1440 px : aperçu du downgrade, changement d’ordre, sauvegarde des priorités, sélection dans le quota, conflit de forfait concurrent, ajout d’un compte et lecture analyste sans commande. Les captures et journaux sont dans `docs/audits/prod-ready-lot-10/`. Ces preuves ne constituent pas une synchronisation d’un MCC réel ni une promotion du déploiement distant.


Le [lot 42](./audits/prod-ready-lot-42/README.md) enrichit les preuves d’autorisation : refus pour retrait/rétrogradation/lifecycle, attentes sur adhésion hors verrou applicatif, expirations pendant l’audit sans état partiel, et version invalidée par changement de forfait. La fixture de sélection utilise maintenant une vraie identité et adhésion Better Auth locales. Les validations de synchronisation réelle Google et les autres chemins de persistance d’inventaire restent distincts.

Le [lot 43](./audits/prod-ready-lot-43/README.md) ajoute le protocole `verify-google-inventory-actors.ts` à la suite PostgreSQL/CI : acteur révoqué, connexion remplacée/révoquée pendant attente, job obsolète, essai et bail expirant pendant l’audit, réponse ancienne réconciliant des activations. Les contrôles utilisent de vrais verrous et vérifient le rollback complet, sans fournisseur. La fixture métier des 57 comptes passe maintenant par le service tenant avec son identité Better Auth ; le nouveau protocole exerce aussi le service système avec un vrai job stocké.
