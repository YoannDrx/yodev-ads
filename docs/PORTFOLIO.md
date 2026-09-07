# Portefeuille agence

Le portefeuille `/portfolio` réunit les comptes gérés actifs, leurs résultats qualifiés, le pacing budgétaire et les éléments à traiter. Il réutilise les collectes enregistrées, objectifs, alertes, tâches et décisions ; ouvrir la page ne déclenche aucun appel Google.

## Contrat des données

- Les résultats portent sur les **30 journées terminées** dans le fuseau de chaque compte. Chaque journée doit avoir une couverture `complete`, une version source non vide et la devise/le fuseau du compte. Le relevé d’hier doit dater de moins de 26 heures et ne pas être situé à plus de 60 secondes dans le futur.
- Les historiques incomplets, hérités, périmés ou incohérents affichent des valeurs inconnues. Ils ne contribuent pas aux totaux. Les zéros réellement collectés restent des zéros ; CPA sans conversions et ROAS sans dépense restent inconnus.
- Les groupes sont séparés par **devise, fuseau et bornes de période**. Chaque total affiche son nombre de comptes qualifiés sur le nombre de comptes du groupe. Aucune conversion monétaire ni comparaison de montants de devises différentes.
- Les montants restent en chaînes de micros, calculés en `numeric` PostgreSQL puis arrondis avec `BigInt` pour l’affichage. Les conversions décimales ne transitent pas par une somme JavaScript en virgule flottante.
- Le pacing utilise les journées terminées du mois courant et l’objectif mensuel. La projection linéaire extrapole leur moyenne au mois entier ; le rythme est considéré conforme entre −10 % et +10 %. Une journée manquante, une collecte périmée, le premier jour du mois ou un objectif absent empêchent de présenter un pacing fiable. Ce seuil est une règle de triage, pas une prévision statistique.
- Les compteurs incluent toutes les alertes ouvertes/réouvertes, toutes les tâches non terminées/non annulées et toutes les décisions `pending` ou `approved` (attente de validation ou d’exécution). Ils ne dépendent pas de la page visible.

## Filtres, vues et charge

Recherche littérale par nom/ID, devise, responsable de tâche et priorité : à traiter, alerte critique, données non qualifiées, tâche en retard ou décision en attente. Le filtre « à traiter » inclut aussi l’absence d’objectif et les écarts de rythme. Les comptes sont affichés par création décroissante, 25 par page ; le curseur chiffré lie l’espace, les filtres et la borne de création. Les données métier sont recalculées à chaque consultation et peuvent donc évoluer pendant la pagination.

Les liens partagent les **filtres**, sous authentification et avec les droits du lecteur dans son espace actif. Ils ne donnent pas accès à un autre espace et ne constituent pas une photographie des données. Une vue personnelle peut être créée, remplacée par les filtres affichés, renommée ou supprimée. Limite : 20 vues par utilisateur et par espace, contrôlée sous verrou. Une révision UUID empêche l’écrasement ou la suppression à partir d’un formulaire obsolète. Les conflits sont affichés sans divulguer une vue appartenant à autrui.

La charge d’équipe porte sur tout l’espace, indépendamment des filtres de comptes. Elle inclut les tâches manuelles sans client, les membres sans tâche, les tâches non attribuées et les anciens responsables encore référencés. Les tâches terminées/annulées sont exclues. Des liens ouvrent la liste des tâches ou les comptes gérés associés. Les profils affichés se limitent au nom des membres de l’agence ; les adresses email ne sont pas chargées pour cette vue.

La permission `portfolio:read` contrôle la page ; le rôle client n’y accède pas. Les rôles agence peuvent enregistrer leurs vues avec `portfolio:save_view`. La grâce conserve la lecture et interdit les écritures ; la suspension refuse l’accès. Le dépôt recontrôle le lifecycle sous verrou avant chaque écriture, en complément de l’autorisation des Server Actions.

## Synthèse hebdomadaire

Le digest utilise les mêmes totaux qualifiés, leurs périodes et leurs dénominateurs. Un groupe sans données qualifiées est signalé comme indisponible. Il mentionne aussi les alertes critiques, tâches en retard et décisions en attente. La date de création du job identifie l’occurrence sur les reprises, même le lendemain ; la date des données est celle de leurs périodes réelles au moment du traitement. L’outbox existante assure la déduplication par canal. La validation locale ne prouve pas une réception email, Slack ou Teams.

## Migration et exploitation

`0053_portfolio_saved_views` ajoute uniquement `portfolio_views`, son index, les contraintes de taille/non-vacuité et ses politiques RLS. Le rôle applicatif exige simultanément l’espace et l’utilisateur propriétaires ; le rôle d’authentification n’a pas de droit sur cette table. Les exports de l’espace incluent les vues ; la suppression de l’espace les supprime par cascade.

La migration a été vérifiée localement en cumul avec les 53 précédentes puis depuis une base PostgreSQL 17 vide. Elle n’a pas été appliquée à une base distante. Un retour applicatif à la version précédente peut laisser cette table additive en place ; ne pas supprimer les vues créées par des utilisateurs pour effectuer ce retour.

Recettes et limites : [lot 19](./audits/prod-ready-lot-19/README.md). Les mesures de charge déployée et la réception réelle des synthèses restent dans les recettes fournisseurs et de lancement du plan.
