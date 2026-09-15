# Démarrage guidé et preuves de progression

La page `/getting-started` lit uniquement des indicateurs PostgreSQL dans le contexte de l’agence. Elle ne charge ni credentials Google, ni jetons de partage, ni payloads de rapports. Une requête à sous-requêtes bornées remplace les listes intégrales de comptes, vigies et liens ainsi que le calcul de pacing dont seule la présence d’un objectif était utilisée.

## Huit étapes produit

1. Organisation créée : existence de l’espace consultable.
2. Connexion Google : statut enregistré actif. Ce statut ne certifie pas les droits actuels chez Google ; la collecte les éprouve.
3. Inventaire : au moins un annonceur actif, à l’exclusion des managers.
4. Sélection : au moins un annonceur actif explicitement choisi pour la gestion. Un inventaire seul ne suffit pas.
5. Objectif : objectif d’un annonceur actif et sélectionné. Les objectifs d’autres comptes ne valident pas cette étape.
6. Analyse : jalon `first_qualified_analysis`, postérieur à la création de l’agence et non futur. L’ancien `first_analysis` est insuffisant.
7. Vigie : au moins une vigie activée applicable à un annonceur actif et sélectionné. Une vigie globale sans annonceur sélectionné ne suffit pas. Configuration et exécution sont distinguées.
8. Rapport : jalon `first_report_published`, postérieur à la création de l’agence et non futur. Une programmation ou un lien sans édition ne suffit pas.

Les étapes 6 et 8 sont des réalisations historiques, conservées lorsque les données ou liens vieillissent. La page le précise : elles ne certifient ni la fraîcheur actuelle, ni un lien actuellement disponible, ni la réception email, ni une lecture humaine. La consultation de l’analyse et du rapport porte ces contrôles actuels.

## Préparation commerciale séparée

L’étape avant abonnement exige une acceptation `checkout_business` contenant les versions courantes des conditions, de la confidentialité et de l’accord de traitement, dans une période cohérente avec la création de l’agence. Des champs de version sur le workspace ne suffisent pas. Cette étape ne participe pas aux huit étapes de démarrage produit et ne bloque pas visuellement le démarrage d’une agence en bêta privée.

Une acceptation enregistrée n’est ni une validation professionnelle des documents ni une autorisation de checkout. Les contrôles de disponibilité et d’approbation du parcours d’abonnement restent distincts.

## Aide et autorisations

Chaque étape explique la prochaine action et fournit une aide dépliable au clavier. Les cibles de gestion suivent la décision partagée rôle/lifecycle/offre ; les connexions et le checkout suivent aussi leur disponibilité. Les personnes sans droit reçoivent une explication et l’accès au support. Les liens restent de simples navigations ; les contrôles serveur continuent de protéger les actions.

La grâce autorise cette page de données stockées avec les liens de gestion interdits masqués. Elle n’autorise aucun appel Google ou nouveau rapport externe. Les états suspendu/supprimé et le rôle client restent soumis à leurs destinations de récupération existantes.

La progression est une liste de preuves utiles au démarrage, sans télémétrie de clics ou présomption automatique d’abandon. Le support demande l’étape et le compte concernés, sans demander de secrets. La calibration des abandons fréquents sur retours pilotes reste nécessaire.
