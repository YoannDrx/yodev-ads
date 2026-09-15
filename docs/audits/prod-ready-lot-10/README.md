# Lot 10 — sélection des comptes

Implémentation T11 locale, 7 septembre 2026. Protocole : [ACCOUNT_SELECTION.md](../../ACCOUNT_SELECTION.md).

- `coverage.log` : 1 042 tests, 151 fichiers ; seuils de couverture réussis. La dernière modification du filtre de lien public est vérifiée par `database-selection-final.log`.
- `build.log` : compilation et vérification TypeScript du code final réussies.
- `lint.log` : lint réussi, sans avertissement.
- `migration-upgrade.log` : 49 → 50 migrations après création de comptes avec l’ancien schéma ; identités, états actifs et priorités vérifiés.
- `database-clean.log` : RLS, contraintes, invariants et fixtures de concurrence sur cette nouvelle base locale après migration.
- `database-selection-final.log` : fixture finale, y compris admission de mutation et protection des rapports publics, zéro appel fournisseur.
- `browser-full.log` : 31 scénarios réussis, aucun skip.
- `browser-final.log` et `browser-captures.log` : deux parcours FR/EN avec 31 comptes, pagination et recherche ; dernier passage après attente explicite du filtre avant capture.
- Captures : FR 390 px et EN 1440 px, inspectées. Les éléments de navigation fixes apparaissent au bord du viewport dans ces captures pleine page.
- Journaux intermédiaires conservés pour transparence : fixture de repli devenue invalide, attente insuffisante d’une sauvegarde dans le navigateur et annotation TypeScript d’un tableau de cas.

La frontière des données et la sérialisation des transactions ont également réussi (80 fichiers applicatifs, aucune exception). Les identifiants et jetons des fixtures sont artificiels ; aucun compte fournisseur, email ou mutation Google n’a été utilisé. Aucune migration distante ni certification du déploiement n’est attestée ici.
