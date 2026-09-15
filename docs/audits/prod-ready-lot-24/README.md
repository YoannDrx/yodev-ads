# Lot 24 — Admission atomique des membres

Base : `17b14c7`. Migration **0055**, soit **56 migrations cumulées**. Aucune migration distante ni émission fournisseur.

## Reproduction et correction

`verify-membership-admission.ts` utilise deux connexions PostgreSQL avec le rôle `yodev_auth`. Les deux lectures préalables voient quatre membres sur une offre Studio de cinq places, puis tentent chacune une insertion. Avant la migration, les deux réussissent : **six membres pour cinq places**, enregistré dans `reproduction.log`.

La migration ajoute un trigger d’admission sur l’insertion et le changement d’organisation d’une adhésion. Pour un workspace déjà mappé, il prend le verrou d’accès commun, relit son état/offre sous verrou de ligne et compte les membres dans la transaction. Une seule des deux insertions concurrentes réussit ; l’autre reçoit `23514`. Grâce, suspension, suppression en cours/terminée et essai expiré refusent une nouvelle adhésion. L’état interne et l’offre interne restent sans plafond dans cette frontière de persistance.

Les adhésions historiques ne sont ni supprimées ni revalidées par la migration. Les modifications de rôle sans changement d’organisation restent possibles après un downgrade. L’onboarding conserve son ordre atomique existant : premier propriétaire puis workspace mappé, dans la même transaction. La fonction `SECURITY DEFINER` utilise un `search_path` fixé, des tables qualifiées et aucune permission publique d’exécution.

## Preuves

- `upgraded-database.log` : suite locale existante après passage de 55 à 56 migrations.
- `fresh-database.log` : **toutes les 56 migrations depuis une base vide et tous les protocoles**, y compris l’admission concurrente, le refus des quatre états inactifs, l’essai expiré même avec offre interne et la préservation des membres/rôles après downgrade. Cette nouvelle recette est incluse dans le runner commun local/CI.
- Lint et TypeScript passent après ajout du script et du parcours. Le contrôle applicatif complet du lot 23 (1 316 tests, build, audit) n’a pas été répété pour ce lot qui modifie le schéma et sa recette, sans changement du code applicatif.
- `browser.log` : **deux parcours réels Better Auth/PostgreSQL FR/EN réussis sans skip en 23,8 s**. L’agence passe en grâce avant acceptation ; l’insertion est refusée, aucune adhésion n’est créée et Better Auth remet l’invitation à `pending`. Après restauration, le même lien fonctionne, y compris la réponse perdue et sa reprise. Les autres étapes du cycle d’authentification passent toujours.
- La page de connexion est inspectée avec agent-browser, sans erreur détectée. Captures de la recette dans `browser/`.

## Déploiement et limites

La migration prend le verrou DDL nécessaire à l’ajout du trigger sur `auth_members` ; elle n’effectue aucun backfill. En cas de retour arrière validé, supprimer le trigger `workspace_membership_admission` puis la fonction `public.enforce_workspace_membership_admission()` rétablit le comportement précédent **et réouvre le risque de dépassement concurrent**. Ne pas considérer un rollback applicatif comme une raison automatique de retirer ce contrôle compatible avec l’ancien code.

Le navigateur reçoit actuellement une erreur générique en cas de refus par le trigger, et Better Auth journalise une erreur serveur attendue pour les deux refus de cette recette. Un précontrôle explicite des cas prévisibles doit améliorer ce retour tout en conservant le trigger pour la concurrence. Le comptage préalable fourni à Better Auth reste distinct du garde transactionnel. Aucun résultat de ce lot ne certifie les fournisseurs réels ou le candidat déployé.
