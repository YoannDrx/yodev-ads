# Qualification des alertes

Chaque agence peut qualifier une alerte comme **utile**, **bruit** ou **faux positif**. Une alerte sans avis reste **non évaluée** ; son absence de résolution ou de commentaire n’est pas utilisée comme avis implicite.

- Utile : signal pertinent pour une décision ou une action.
- Bruit : signal réel, mais redondant ou sans action utile dans ce contexte.
- Faux positif : anomalie incorrecte après vérification.

La qualification ne résout, ne masque ni ne rouvre l’alerte. Elle ne modifie pas la vigie, son seuil, sa planification ou Google Ads. Les définitions sont disponibles dans le formulaire FR/EN.

## Observation et concurrence

L’avis conserve le numéro d’observation examiné, la date, l’auteur et une version de revue. Le compteur d’observations avance à chaque détection enregistrée. Une nouvelle détection rend donc l’ancien avis historique : il reste lisible, mais une nouvelle évaluation est nécessaire pour qualifier l’observation actuelle.

Le formulaire envoie le compteur d’observation et la version qu’il a affichés. Une modification concurrente de l’un ou l’autre refuse l’écriture et demande une actualisation. Deux avis simultanés sur la même version ne peuvent pas tous deux réussir. Réenregistrer un avis identique déjà courant ne crée pas de nouvelle version ; retirer l’avis produit une nouvelle version et un audit.

Les audits conservent les catégories avant/après, les numéros d’observation et la version. Ils ne copient pas les métriques publicitaires ni des commentaires libres. Les colonnes suivent la RLS, l’export d’agence et la cascade de suppression existants de l’alerte.

## Autorisation transactionnelle

La fonction PostgreSQL `lock_workspace_actor` n’expose que le rôle et les droits du contexte courant. Elle refuse un espace ou un acteur différent des paramètres tenant configurés par le serveur. `yodev_app` conserve son interdiction de lecture des tables globales d’authentification.

Le verrou d’accès commun est acquis, puis les lignes workspace et adhésion sont verrouillées en lecture jusqu’au commit. Le rôle, le propriétaire, l’offre et le lifecycle sont relus avant la mutation. L’expiration d’essai est évaluée après l’acquisition des verrous avec l’heure réelle ; l’heure de début de transaction ne suffit pas lorsqu’une demande attend.

Le service passe par `withWorkspaceActorTransaction` : après les attentes sur la ligne d’alerte et les écritures, un essai est contrôlé de nouveau. Une expiration annule l’avis et son audit, et refuse également le réenregistrement identique. Le [lot 35](./audits/prod-ready-lot-35/README.md) reproduit puis vérifie ces trois cas sur PostgreSQL.

Ce garde est utilisé ici pour les avis de qualité. Il ne signifie pas que toutes les autres mutations existantes ont déjà été migrées vers ce contrôle.

## Mesure affichée

La synthèse porte sur toutes les alertes correspondant aux filtres et à la borne de pagination, pas seulement les 25 lignes visibles. Elle distingue avis utiles, bruit, faux positifs, avis anciens et absence d’avis.

Le taux utile a pour dénominateur les seuls avis portant sur la dernière observation de chaque alerte. Sans avis courant, il est indisponible. Un avis « courant » correspond au dernier numéro d’observation, pas à une garantie de fraîcheur en heures. Les personnes évaluent un échantillon volontaire : ce taux n’est pas une estimation automatique de la précision de toutes les vigies. La calibration sur les pilotes et les seuils métier reste à conduire.

## Migrations et exploitation

`0057_alert_quality_reviews` ajoute les colonnes, la contrainte de cohérence et le garde d’acteur. Aucun avis historique n’est fabriqué. `0058_locked_actor_expiry` corrige le franchissement d’une échéance pendant une attente, reproduit après application locale de 0057 ; elle conserve la signature et les ACL de la fonction.

Aucun appel fournisseur n’est nécessaire. La lecture reste disponible en grâce ; l’écriture exige `alerts:manage` dans un état autorisé. La synthèse est propre à l’agence ; aucun nouveau tableau multi-agence ou calcul de coûts n’est déduit de ces avis.
