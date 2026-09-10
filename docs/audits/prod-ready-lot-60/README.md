# Lot 60 — propriétaire courant, annulation J+30 et purge Better Auth

10 septembre 2026, branche `codex/prod-ready`. Avancement T04/T17/T19 ; objectif intégral T00–T23 non achevé.

## Défauts reproduits et corrections

`reproduction.log` montre qu’un administrateur non propriétaire pouvait créer un export en appelant directement le service. Les quatre services — demande d’export, demande de suppression, prise en charge et finalisation d’une annulation — utilisent maintenant le garde d’acteur transactionnel. Le propriétaire doit toujours avoir une adhésion courante. Un transfert de propriété ou un retrait d’adhésion commis pendant l’attente est observé avant toute écriture.

Les espaces supprimés sont refusés ; un espace interne ne peut pas être supprimé par ce parcours et une suppression déjà programmée ne peut pas être réinitialisée. L’export reste un droit du propriétaire après downgrade, en grâce, suspension, essai expiré ou pendant la suppression. Aucune capacité payante supplémentaire n’est imposée.

L’annulation verrouille la demande avant de lire son état et l’horloge PostgreSQL. Une nouvelle prise en charge exige une échéance encore future, avec un second contrôle après l’UPDATE ; une attente dépassant J+30 annule la transaction. Une annulation déjà acceptée (`cancelling`) exclut la purge et reste reprenable après l’échéance initiale. Sa finalisation vérifie de nouveau le propriétaire, l’espace, l’identifiant et l’état enregistré dans la demande : un paramètre ancien ou falsifié ne peut pas restaurer un état interne/actif différent. La purge prend le verrou de l’espace avant celui de la demande, comme l’annulation.

La recette générale a ensuite révélé que l’ancienne fixture d’annulation ne créait pas d’identité Better Auth. Après son remplacement par deux propriétaires et organisations locaux, une vraie purge échouait sur `DELETE auth_organizations WHERE id = ...` : `purge-reproduction.log` conserve ce second défaut. La migration additive **0062** accorde uniquement `SELECT(id)` au rôle `yodev_purge`, qui possédait déjà `DELETE`. Les noms et métadonnées des organisations restent hors de ce privilège ; le rôle applicatif ne peut pas lire leurs identifiants. La [documentation PostgreSQL 17 sur DELETE](https://www.postgresql.org/docs/17/sql-delete.html) confirme le besoin de lecture du prédicat. La recette vérifie la suppression de l’organisation et de ses adhésions, la conservation du compte utilisateur partagé et du tombstone.

## Vérifications

- `lifecycle.log` : quatre matrices réservées au propriétaire, huit attentes réelles sur propriétaire/adhésion, export après changement d’état, refus des demandes internes/dupliquées, expiration après verrou puis après UPDATE, identité/état de restauration, reprise après J+30 et exclusion de la purge. Aucun fournisseur appelé. La fixture crée une identité propriétaire réelle et est enregistrée dans `db:verify-local`.
- `check.log` : **1 733 tests / 206 fichiers**, huit tests de scripts, lint, TypeScript, frontières des données et transactions, build et audit runtime réussis. Couverture instructions/branches/fonctions/lignes : **91,51 / 86,41 / 93,04 / 94,42 %**. Le contrôle est rejoué après les ajustements finaux de migration et de fixtures.
- `database.log` : suite PostgreSQL complète réussie sur la base jetable locale, avec migration 0062 et contrôle des privilèges. Les échecs initiaux de fixture et de purge sont conservés séparément. `migration.log` : nouvelle base vide, migrations 0000–0059, fixture historique puis migrations restantes jusqu’à 0062 (**63 migrations**), avec réexécution idempotente ; base temporaire supprimée à la fin.
- Aucun écran modifié ; navigateur non rejoué. Dernière matrice générale : 86 parcours sans skip au lot 59. Les nouveaux cas temporels sont exécutés directement contre PostgreSQL, avec les services applicatifs réels.

## Migration et limites

Migration uniquement locale. Appliquer 0062 avant la recette de purge du candidat distant. Elle ne modifie ni données, ni schéma de tables, ni privilèges d’écriture. Un retour arrière ciblé est `REVOKE SELECT (id) ON TABLE public.auth_organizations FROM yodev_purge`; il réintroduirait l’échec de purge des organisations et impose de suspendre cette opération. Ne pas exécuter ce retour arrière sur un service en fonctionnement sans procédure de release.

Ce lot ne certifie pas les actions fournisseurs du cycle de vie. Les appels Google/Stripe précédant certaines écritures dans les Server Actions, leur admission répétée, les reprises durables, le rattachement des formulaires à l’espace affiché, l’enqueue atomique, l’export Blob réel et la révocation Google à portée partagée restent à traiter. Les opérations durables ordinaires de domaines/Blob, la réconciliation/libération des réservations, les collections restantes, les certifications du candidat et la bêta prévue au plan restent ouvertes. Aucune émission applicative externe, déploiement ou migration distante.
