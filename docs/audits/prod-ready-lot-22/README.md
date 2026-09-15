# Lot 22 — Reprise d’invitation et transfert de propriété

Base : `d808f01`. Aucun déploiement, fournisseur ni nouvelle migration ; 55 migrations cumulées inchangées.

## Changements

Après une réponse d’acceptation perdue ou le rejeu d’un lien accepté, une Server Action déduit l’identité de la session courante, puis lit seulement l’organisation d’une invitation acceptée adressée à cet email vérifié et dont l’utilisateur est toujours membre. Aucun droit n’est créé par cette reprise. L’activation habituelle de Better Auth reste requise. Les identifiants ambigus sont refusés et le formulaire est recréé lorsque l’invitation change.

Le champ de confirmation du transfert d’agence possède maintenant un nom accessible. Le service de transfert existant n’a pas été modifié dans ce lot ; sa recette réelle est ajoutée.

## Preuves

- Contrôle complet : **1 311 tests applicatifs / 178 fichiers**, sept tests de scripts, lint, TypeScript, frontières App Router et transactions, build et audit runtime sans vulnérabilité.
- Couverture : **92,53 %** instructions, **87,06 %** branches, **93,31 %** fonctions et **95,20 %** lignes.
- **Quatre scénarios navigateur FR/EN réussis sans skip en 26,9 secondes.** La recette exécute l’acceptation sur Better Auth/PostgreSQL, puis interrompt volontairement uniquement sa réponse HTTP. La page récupère l’adhésion sans doublon. Réouverture du lien, invitation étrangère/expirée/révoquée et adhésion retirée sont vérifiées.
- Transfert : mauvaise confirmation refusée, rôles et deux références de propriétaire mis à jour, événement d’audit unique, ancien formulaire rejoué par l’ancien propriétaire refusé, droits du nouveau propriétaire présents et autre agence inchangée.
- Les captures sont dans `browser/` et ont été inspectées. Le premier passage, dans `initial-browser/`, réussit les deux reprises d’invitation mais échoue sur un conflit de types PostgreSQL dans la restauration de la fixture après le transfert français. La correction de ce nettoyage a permis la relance complète des quatre scénarios.

La suite générale de 51 scénarios du lot 21 n’a pas été répétée dans ce lot ciblé ; les deux nouveaux scénarios de transfert portent désormais le total possible à 53 lorsque les contrôles analytiques sont activés. La réception fournisseur, Google sign-in réel et les validations déployées restent distinctes.

## Suite

T04/T05 restent ouverts pour les droits des opérations de membres relus après verrou, la session ayant perdu son organisation active et le quota des invitations expirées. Ces cas identifiés ne sont pas couverts par la seule recette séquentielle de transfert. Le contrat d’authentification est mis à jour dans [`AUTH_LIFECYCLE.md`](../../AUTH_LIFECYCLE.md).
