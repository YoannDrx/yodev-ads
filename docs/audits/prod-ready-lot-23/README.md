# Lot 23 — Droits des membres et reprise de session

Base : `15b8f1c`. 7 septembre 2026. Aucune migration supplémentaire, aucun fournisseur ni déploiement.

Les cinq mutations de gestion des membres relisent l’organisation, l’adhésion et le rôle de l’acteur après acquisition du verrou d’accès workspace. Le propriétaire courant est protégé du retrait et du changement de rôle ; seul ce propriétaire peut transférer. Une ancienne autorisation obtenue avant l’attente ne suffit plus. Le retrait efface la sélection d’organisation uniquement dans les sessions du membre retiré qui pointent vers cette organisation.

L’onboarding résout désormais la sélection à partir de la session encore valide, verrouillée et liée à son utilisateur. Il conserve une adhésion valide ou sélectionne une agence existante, en privilégiant les agences actives puis la date d’adhésion. Sans adhésion, il efface la sélection obsolète et affiche le formulaire. Cette opération ne crée ni adhésion ni essai. La requête ayant perdu son tenant redirige avant toute opération métier. Les invitations expirées disparaissent du quota et des doublons bloquant une réinvitation, sans suppression de leur historique.

## Vérifications

- `check.log` : **1 316 tests / 179 fichiers**, sept tests de scripts, lint, TypeScript, frontières des données, sérialisation des transactions, build et audit runtime à zéro vulnérabilité. Couverture : **92,55 % / 87,11 % / 93,32 % / 95,22 %**.
- `database.log` : toutes les recettes locales des **55 migrations existantes**, plus le nouveau protocole `verify-membership-boundary.ts`. Ce protocole observe une vraie attente dans `pg_locks`, modifie les droits avant de libérer le verrou, puis exige le refus de l’opération. Il vérifie aussi le propriétaire protégé après transfert, les invitations expirées et le job durable, le périmètre des sessions, la récupération d’une autre adhésion, l’effacement d’une sélection obsolète et le refus des sessions étrangères/expirées. Aucun appel fournisseur.
- `browser.log` et `browser/` : **quatre scénarios FR/EN réussis sans skip en 29,7 s**. Les parcours réels d’authentification incluent maintenant le retrait de l’agence active puis de la dernière adhésion. Le dashboard retrouve l’agence restante ; l’absence d’adhésion mène à l’onboarding, le quota d’essai reste inchangé et la page personnelle permet toujours la déconnexion. Les deux transferts de propriété passent aussi. Capture anglaise de l’onboarding après retrait inspectée.
- Page de connexion inspectée avec agent-browser : contenu présent, contrôles accessibles et aucune erreur remontée. Le premier lancement isolé du nouveau script SQL avait un paramètre partagé entre colonnes `text`/`varchar` ; les casts explicites de la fixture ont permis son exécution puis la suite complète.
- CI : le job PostgreSQL utilise désormais `db:verify-local`, qui inclut tous les protocoles ajoutés depuis les premiers lots. Le test de charge reste distinct. YAML validé localement ; **aucune exécution GitHub distante revendiquée**.

## Limites et suite

La suite générale de 53 scénarios n’a pas été répétée dans ce lot ciblé. L’acceptation Better Auth compte encore les membres avant leur insertion : le quota concurrent et l’acceptation après suspension doivent être reproduits et sécurisés à la frontière de persistance. Ces cas ne sont pas prouvés par la sérialisation des invitations de ce lot. Les autres mutations métier, fournisseurs réels et recette du candidat déployé restent dans le plan.
