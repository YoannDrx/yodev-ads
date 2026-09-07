# Collectes analytiques et consultation persistée

Le cockpit, l'analyse 360 et les insights lisent désormais des résultats PostgreSQL. Ouvrir ou recharger ces pages n'exécute aucun appel Google Ads. Le suivi journalier qualifié reste un contrat séparé : les listes analytiques peuvent être filtrées ou plafonnées et ne certifient pas les totaux financiers du compte.

Les totaux du cockpit proviennent exclusivement des 30 jours complets de l'historique du compte, dans son fuseau et sa devise. La liste de campagnes ne sert pas à reconstituer ces totaux. Une lacune, une ancienne ligne non qualifiée ou une devise incompatible masque les agrégats. Les sommes entières restent exactes avant leur formatage d'affichage.

## Exécution

Le scheduler programme après 05:00, dans le fuseau du compte, 17 familles indépendantes : campagnes, requêtes, mots-clés, annonces, mesure des conversions et les 12 sections d'insights existantes. Le compte doit être actif, non MCC, appartenir à un workspace opérationnel et avoir une connexion active. Chaque famille utilise un job `analytics.collect` avec une identité quotidienne stable. Les campagnes et les composants de l'analyse passent avant les insights secondaires.

Les dates des 30 jours terminés sont figées à la planification. Le gateway remplace la période relative de ses requêtes analytiques par cet intervalle validé, même si une reprise passe minuit. La comparaison des assets utilise la même date de référence. Les propriétés d'inventaire, de tracking et d'éligibilité restent des états observés lors de la lecture ; leur affichage ne les présente pas comme des états historiques journaliers.

Une famille échouée garde son dernier résultat. Le worker utilise les réservations, échéances et reprises de la file existante. Après lecture Google, il revérifie compte, workspace, connexion, fuseau et devise. L'upsert, l'audit et le checkpoint du job sont atomiques. Une observation plus ancienne ou une période antérieure ne remplace pas un résultat plus récent. Une reprise d'un checkpoint complet ne contacte pas Google. Les request IDs sont conservés dans le résultat et l'audit.

L'application borne un résultat sérialisé à 1,9 Mo ; la base impose une borne supplémentaire de 2 Mio sur sa représentation JSON. Un dépassement produit un échec explicite sans écraser le résultat antérieur. Le découpage des très grosses collections et leur exhaustivité restent le travail de T14.

## Lecture et actualisation

La table `analytical_collections` conserve la dernière réussite par compte/famille. L'identité de lecture comprend l'agence, le compte, la famille, les dates, le fuseau, la devise et la version du contrat. Les données brutes sont indépendantes de la locale ; les libellés sont calculés pour FR/EN à la lecture. Seuls les payloads nécessaires à la page sont chargés, avec les métadonnées des autres familles pour le centre de synchronisation. Aucun cache mémoire partagé ni contenu tenant accessible sans nouvelle autorisation n'est introduit.

Une section est « à jour » lorsque sa version/fuseau/devise conviennent, que sa période finit hier et que son observation a moins de 26 heures. Ce libellé qualifie son âge, pas la disponibilité actuelle du fournisseur ni l'exhaustivité d'une liste. Une section ancienne demeure datée et distincte d'une section jamais collectée. Une analyse combinée n'est affichée que lorsque ses cinq familles couvrent les mêmes dates et qu'elle dispose de campagnes ; aucun score positif n'est fabriqué à partir d'un compte vide.

Le centre intégré aux trois pages présente les sections à jour, les traitements en attente/échec, les dates, la dernière réussite, la dernière tentative réelle et l'échéance de reprise. Une demande encore non démarrée est identifiée comme telle. Les erreurs fournisseur brutes ne sont pas exposées dans cette interface. Les détails restent dans les traces d'exploitation protégées.

« Actualiser les données » exige le droit existant `monitoring:run`, la capacité `google.read`, les switches de lecture et de scheduler, puis un compte/une connexion actifs. La transaction revérifie les droits du workspace, déduplique les demandes concurrentes et refuse une nouvelle collecte lorsqu'une précédente attend ou qu'une demande date de moins de 15 minutes. Elle programme les familles et le rafraîchissement journalier sans effectuer de transport dans la requête utilisateur. Après un échec terminal, une nouvelle actualisation peut reprendre les collectes lorsque ce délai est passé. Les liens de reconnexion respectent le droit `google:connect`.

La grâce donne accès aux trois nouvelles vues persistées, sans commandes de collecte ni mutation. Suspension, désactivation du compte et suppression invalident les lectures. La déconnexion Google conserve les données autorisées mais empêche de nouveaux commits. Les validations autoritatives Google avant mutation restent inchangées.

Les anciennes observations de mutation sont maintenant qualifiées à leur lecture sans réécriture de la preuve stockée. L'API de performances ajoute un objet `coverage` avec les dates complètes, partielles, manquantes ou non qualifiées et les versions correspondantes ; la présence de lignes anciennes ne suffit plus à indiquer une couverture complète.

## Migration et exploitation

`0048_analytical_collections` crée la table, la clé unique compte/famille, la contrainte composite agence/compte et les index de consultation. RLS est activée et forcée. Le rôle applicatif dispose seulement de SELECT ; seuls système et purge écrivent cette table. Un index partiel sur les jobs accélère la recherche de la dernière demande par famille. Les scripts de vérification comprennent la table et sa contrainte.

La suppression d'un compte ou workspace supprime ses collectes par cascade. L'export privé inclut ces données dans `raw.json`. La rétention supprime les résultats dont la fin de période dépasse 730 jours. Les request IDs et la version restent traçables même après suppression des jobs, sans clé étrangère empêchant leur rétention normale.

Appliquer l'extension de schéma avant de déployer les pages et le worker ensemble. Préparer les collectes des comptes contrôlés avant la promotion : une base sans cache affiche une absence de collecte, sans fallback Google synchrone. Mesurer la durée et le coût de ces 17 familles sur les volumes réels avant d'étendre la fréquence. Les plafonds sont des garde-fous techniques, pas une preuve de coût commercial validé.

Pour revenir à l'ancien code, suspendre et drainer les jobs `analytics.collect` avant de réactiver un worker qui ne connaît pas ce type. Conserver les colonnes/table et les preuves. L'ancien code rendrait les pages dépendantes de Google et refermerait leur accès en grâce ; un correctif progressif est préférable.

## Validation

Le dossier du lot 9 conserve les vérifications locales. Les fixtures PostgreSQL exercent cache froid/chaud, RLS, réservation, concurrence, rollback, observation ancienne, déconnexion, grâce, suspension, désactivation, délai de coût et cascade. Les transports sont interdits dans cette fixture. Les tests de gateway contrôlent les dates effectives dans la requête et rejettent les dates invalides.

Les scénarios navigateur utilisent Better Auth, PostgreSQL local et tous les fournisseurs désactivés. Ils affichent le cockpit, l'analyse et un segment d'insights, passent en grâce, puis vieillissent la collecte pour vérifier que les données restent accessibles et datées. Les traces locales ne constituent pas une recette OAuth réelle ni une mesure de charge déployée. Ces preuves fournisseurs et le déploiement du candidat restent à réaliser.

Une recette séparée du bouton utilise `YODEV_TEST_ANALYTICS_CONTROLS=1` avec le runner local et le filtre `--grep 'analytical refresh enqueues'`. Ce mode active seulement les autorisations de planification/lecture, conserve les identifiants Google vides et emploie un token de fixture indéchiffrable ; aucun worker n'est lancé. Il vérifie en FR/EN la soumission, le refus d'une seconde mise en file, les contrôles masqués pour l'analyste et le refus après révocation de la connexion. Le mode normal du runner garde tous les fournisseurs désactivés.
