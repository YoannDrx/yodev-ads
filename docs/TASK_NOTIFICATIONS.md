# Notifications personnelles de tâches

Les mentions et récapitulatifs utilisent l’adresse actuelle vérifiée dans Better Auth. L’ancienne adresse chiffrée dans les préférences n’est plus une source de destinataire. Une préférence existante ne suffit pas à autoriser l’envoi.

## Admission de l’envoi

`taskNotificationRecipient` retrouve la préférence, son workspace et l’adhésion actuelle. Il stabilise ces trois lignes par des verrous partagés puis relit l’identité vérifiée et l’heure PostgreSQL dans une nouvelle instruction. Le rôle système garde son accès en lecture seule aux utilisateurs Better Auth ; aucun privilège UPDATE supplémentaire n’est accordé. Le contrôle exige `portfolio:read`, la capacité `monitoring` et le switch de notifications. Membre retiré, rôle client, essai expiré, accès inactif ou email non vérifié conduisent à un abandon sans soumission.

Le worker passe le job revendiqué au service. Workspace, type, préférence, commentaire ou clé de récapitulatif doivent correspondre au payload stocké. Le job doit encore être en cours, avec le même propriétaire de bail et la même tentative, avant expiration.

Le contrôle a lieu avant préparation du message puis de nouveau après l’éventuelle attente pour revendiquer sa ligne dans le registre d’envoi. Une nouvelle adresse implique l’abandon du message préparé pour l’ancienne adresse. La mention exige encore le consentement et le même commentaire ; le récapitulatif exige la même cadence, heure et zone, et une clé non encore traitée. La cadence d’un ancien job doit correspondre à celle actuellement choisie.

La transaction de contrôle termine avant l’appel HTTP. La garantie porte donc sur l’état courant observé lors de ce dernier contrôle, y compris les changements commités pendant l’attente du registre ; PostgreSQL et le fournisseur ne forment pas une transaction distribuée. Un retrait postérieur au contrôle ne permet pas de rappeler un message déjà soumis.

## Registre et vocabulaire

La revendication verrouille la livraison existante avant de lire son état et de la passer à `submitting`. Si le destinataire est refusé, une première tentative non soumise devient `failed`. Une ancienne tentative `ambiguous` ou `submitting` reste `ambiguous` : le refus actuel n’efface pas l’incertitude du précédent transport. Si la vérification échoue techniquement, la première tentative reste reprenable en `pending`, les anciennes incertitudes restent ambiguës.

Les clés métier et les empreintes de contenu/destinataire sont conservées. Un message déjà accepté n’est pas soumis une seconde fois. Un conflit de contenu ou de destinataire exige une revue et ne justifie pas de changer automatiquement de clé.

Les nouveaux audits utilisent `task.mention_accepted` et `task.personal_digest_accepted`. Les anciens événements `*_delivered` restent historiques. Une réponse acceptée ne certifie pas une réception dans la boîte du membre ; le registre et les événements fournisseur portent cette preuve.

## Préférences personnelles

La page `/account/notifications`, liée depuis `/account`, permet aux membres de gérer leurs seules préférences dans l’espace actif, sans permission administrateur. Le rôle client voit une explication : ses préférences peuvent être enregistrées, mais aucun contenu de tâche ne lui est envoyé. La page de sécurité `/account` reste accessible lorsque l’accès métier de l’agence est restreint.

Le même formulaire est utilisé dans les paramètres administrateur. Il porte l’identifiant de l’espace affiché et le serveur refuse un formulaire issu d’un autre espace. Le chemin de retour est limité à ces deux pages. Les dates de dernier traitement sont affichées dans le fuseau des préférences ; l’utilisateur voit une explication d’échec sans diagnostic technique brut.

## Preuves et limites

[Lot 40](./audits/prod-ready-lot-40/README.md) : protocoles PostgreSQL avec rôles réels et attentes observées, transport intercepté en mémoire, recette navigateur FR/EN et contrôle général du projet. Aucun email réel n’est envoyé par ces tests. La réception, la reprise opérateur et le fonctionnement du candidat déployé restent à certifier. Le [lot 41](./audits/prod-ready-lot-41/README.md) complète cette preuve avec 521 tâches assignées, un aperçu borné explicitement annoncé et une consultation intégrale paginée.


## Complétude du récapitulatif et échéances

`personalTaskDigestSnapshot` lit le nombre exact de tâches ouvertes assignées et leur aperçu dans une même instruction SQL (`count(*) over ()`). Le corps reste borné à 50 tâches, triées par échéance croissante, sans échéance en dernier, puis date de création et UUID. Les anciennes égalités de dates disposent ainsi d’un départage stable. Le total n’est pas déduit de la taille de l’aperçu. Tâches terminées/annulées, non assignées, d’un autre membre ou d’un autre espace sont exclues.

L’objet et le corps annoncent le total réel. Au-delà de 50, le texte précise « 50 tâches sur N » et renvoie vers la liste complète des tâches ouvertes assignées. Le lien porte l’espace concerné et conserve ces paramètres au fil des pages et des recherches. Un autre espace actif affiche une explication et ne charge pas sa collection à la place de celle attendue. La liste consultée reste une vue actuelle, pas une copie historique de l’email.

Le contrôle avant soumission relit également le total et les éléments affichés. Une modification de titre, statut ou assignation pendant l’attente qui change l’aperçu entraîne l’abandon du message préparé. Cette lecture conserve la limite transaction/fournisseur décrite plus haut ; elle ne prétend pas figer les changements après le dernier contrôle. La clé métier est inchangée et un conflit de contenu au retry reste soumis à revue.

Les échéances de l’email utilisent le fuseau personnel explicitement affiché et un libellé FR/EN, avec date et heure. Le HTML déclare UTF-8 et la langue. L’audit et le résultat du job séparent désormais `taskCount` (total exact) et `shownTaskCount` (taille de l’aperçu). Les événements historiques sans ce second champ conservent leur ancienne signification.

Les formulaires de tâches refusent les dates calendaires impossibles, au lieu de les normaliser vers le mois suivant. Le calcul de fin de journée vérifie aussi que la date locale existe dans le fuseau. Années bissextiles, hiver/été et journée entièrement sautée sont couverts ; une date invalide transmise directement à l’action ne crée aucune tâche.
