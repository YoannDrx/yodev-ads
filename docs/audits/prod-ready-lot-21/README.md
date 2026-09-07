# Lot 21 — Authentification, sécurité personnelle et recette SaaS

Le lot part du commit `9a271ed`. Il ne modifie pas les 55 migrations cumulées et ne déploie rien. Son contrat est décrit dans [`AUTH_LIFECYCLE.md`](../../AUTH_LIFECYCLE.md).

## Changements

- Locale FR/EN transmise aux emails de vérification, connexion magique et réinitialisation depuis la requête authentique.
- Formulaires réutilisables après panne réseau, résultat de passkey exigé avant succès, messages de statut accessibles, liens de récupération invalides expliqués.
- Retour vers l’invitation conservé pendant la connexion ; destinations limitées aux routes connues. Le callback d’erreur du lien magique utilise une URL absolue de même origine pour rester valide après le décodage du fournisseur d’authentification.
- Activation d’organisation vérifiée après acceptation ; possibilité de réessayer l’activation sans reconsommer l’invitation dans la page. Changement d’identité/espace et déconnexion abandonnent le document précédent.
- Page `/account` personnelle pour les cinq rôles : passkeys listées, suppression confirmée, révocation des autres sessions et accès au reset. L’accès ne nécessite plus d’administrer une agence.
- Actualisation analytique proposée seulement avec une connexion Google active ; une révocation après chargement du formulaire reste contrôlée côté serveur.
- Journaux navigateur filtrés par ligne pour masquer tokens/liens privés, y compris lors d’un découpage en fragments. Masquage des liens de reset dans les messages Sentry. Captures Playwright sans injection transitoire de style de curseur pendant l’hydratation.

## Vérifications

Le contrôle complet final du code comprend **1 304 tests applicatifs / 177 fichiers**, **sept tests de scripts**, lint, types, frontières des accès App Router et des transactions, build et audit runtime sans vulnérabilité. Couverture : **92,53 %** instructions, **87,07 %** branches, **93,30 %** fonctions, **95,20 %** lignes. Voir `check.log`.

La recette ciblée a passé **trois scénarios en 22,2 s sans skip** : les cinq rôles sur la sécurité personnelle, puis les cycles réels FR/EN. PostgreSQL et Better Auth sont réellement utilisés. Le protocole WebAuthn utilise un authentificateur virtuel Chromium. Les captures sont dans `browser/`, notamment la sécurité personnelle du rôle client à 390 px, inspectée visuellement.

Les refus couvrent inscription non vérifiée, ancien mot de passe, liens consommés, anciennes sessions, passkey supprimée, accès/suppression de clé par un autre utilisateur et invitations étrangères/expirées/révoquées. Aucun mot de passe de production, token fournisseur réel, envoi d’email ou appel Google n’est utilisé.

La recette générale finale passe **51 scénarios en 2,2 minutes sans skip**, avec `YODEV_TEST_ANALYTICS_CONTROLS=1`. Elle comprend les deux scénarios de mise en file analytique, avec fournisseurs désactivés et sans worker externe. La CI locale utilise désormais ce même réglage. Le code est resté figé pendant ce passage ; aucune alerte d’hydratation n’a été relevée dans le journal. Les deux réponses PDF 429 sont intentionnelles et vérifient le plafond de téléchargement. Les violations de style attribuées aux outils Next de développement sont comptées séparément ; les deux scénarios de portefeuille enregistrent zéro erreur applicative. Voir `full-browser.log` et `full-browser/`. La CI distante n’a pas été lancée.

## Essais intermédiaires conservés

- Premier parcours français simple : réussi.
- `initial-browser-errors/` : deux problèmes de test, sélecteur d’alerte confondu avec l’annonceur Next et lecture de l’URL avant la navigation.
- Une relance a identifié le callback relatif imbriqué refusé par Better Auth. Elle a été interrompue après reproduction ; la correction a passé les deux langues.
- `initial-full-browser/` : 38 réussites, deux échecs et onze scénarios non joués. Le premier échec révèle le bouton d’actualisation sans connexion ; le second coïncide avec un Fast Refresh complet provoqué par une modification pendant la recette. Le code a ensuite été figé pour la relance générale. Ces résultats ne sont pas présentés comme une recette générale réussie.
- `rate-limit-reproduction/` : la séquence générale atteint le plafond d’authentification lorsque tous les lecteurs artificiels partagent une IP. La sélection d’espace échoue et laisse la session de fixture sur son rôle client, ce qui perturbe les essais suivants. La relance a été interrompue après reproduction. Les lecteurs sont désormais isolés par scénario/rôle, l’espace de la session est restauré même après échec et le produit propose une reprise explicite des lectures du compte. Aucun plafond de production n’a été augmenté.
- Un premier contrôle global a révélé une assertion trop précoce après un état React asynchrone ; la disparition du message d’erreur est maintenant attendue explicitement.

## Limites

La réception des emails, Google sign-in réel, les appareils physiques, le transfert d’agence et les environnements déployés restent distincts. Une perte complète de la réponse d’acceptation d’invitation reste un cas de reprise à approfondir. Les certifications fournisseurs, le candidat commercial et les 30 jours réels de bêta ne sont pas déclarés terminés. T17 reste en cours.
