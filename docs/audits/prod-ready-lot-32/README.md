# Lot 32 — Qualification des alertes et autorisation verrouillée

Base : `fbe9d7c`. Migrations `0057_alert_quality_reviews` et `0058_locked_actor_expiry`, soit **59 migrations cumulées**. [Contrat produit et technique](../../ALERT_QUALITY.md).

Les avis utile/bruit/faux positif sont associés à la version de revue et à l’observation affichée. Ils deviennent historiques après une nouvelle détection et ne modifient aucun workflow ou fournisseur. Les compteurs couvrent toutes les alertes filtrées, avec avis anciens et absence d’avis distincts du dénominateur de qualité courant. Retirer un avis est audité.

La mutation relit les droits sous verrou, sans ouvrir les tables globales d’identité à `yodev_app`. Le garde expose seulement l’autorisation du contexte courant et conserve les verrous sur workspace/adhésion jusqu’au commit. Il est utilisé par ce nouveau service ; les autres mutations restent à reprendre selon leur propre revue T04.

## Preuves

- `check.log` : **1 362 tests / 188 fichiers**, sept tests de scripts, lint, TypeScript, frontières/sérialisation, build et audit runtime sans vulnérabilité. Couverture **92,58 / 87,25 / 93,31 / 95,18 %**.
- `focused-final.log` : **19 tests** du garde, de la concurrence de revue, des jetons d’observation, du reset, des états inconnus/anciens et des composants.
- `db-final.log` et `fresh59.log` : tous les protocoles PostgreSQL sur la base existante puis depuis une base vide. Le nouveau protocole est intégré au runner utilisé par la CI. Une seule revue concurrente réussit ; périmètre et identité falsifiés, rôle retiré, état inactif et essai expiré sont refusés. Une vraie attente sur la ligne d’adhésion est observée avant la relecture du rôle. Les tables auth restent interdites à l’app.
- `expiry-reproduction.log` : 0057 utilisait l’heure de début de transaction ; une demande commencée pendant l’essai pouvait écrire après l’échéance en sortant d’une attente. La reproduction échoue avec cette ancienne version. 0058 évalue l’heure après les verrous et le même protocole passe sur les deux bases finales. 0057 déjà appliquée localement est conservée, sans réécriture de son historique.
- `browser.log` : **quatre scénarios réussis en 37,2 s**, FR/mobile et EN/desktop, formulaire réel, avis courant/ancien, refus de formulaire obsolète, résumé de 31 alertes au-delà de la page, reset et trois audits sans changement de statut ; lecture analyste/grâce sans contrôle de gestion. La consultation des anciennes listes/discussions de 521/701 éléments passe aussi. Captures finales inspectées.
- La recette générale reste datée du lot 31 (57 scénarios) ; les deux nouveaux parcours portent désormais la matrice disponible à 59, sans revendiquer une exécution générale des 59 dans ce lot.

Aucun appel Google, envoi de notification, paiement, migration distante ni déploiement. Les avis sont un échantillon volontaire à calibrer avec les pilotes. Coûts par offre, charge déployée, support et validations de lancement restent ouverts.
