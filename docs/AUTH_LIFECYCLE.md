# Authentification et sécurité personnelle

## Parcours disponibles

L’inscription par email et mot de passe reste soumise à l’ouverture de la bêta, à la liste autorisée ou à une invitation en cours. Le mot de passe respecte les limites serveur de 12 à 128 caractères. La vérification de l’email est requise avant la connexion par mot de passe et la création d’un espace. La connexion Google est affichée seulement lorsque ses identifiants sont configurés ; sa certification réelle reste distincte de la recette locale.

Les emails de vérification, de connexion magique et de réinitialisation suivent le cookie de langue explicite `yodev_locale`, avec repli français si absent ou invalide. Leur contenu est stocké chiffré dans la file durable avant une tentative d’envoi. La recette locale lit uniquement cette file avec une clé jetable ; aucun prestataire d’email n’y est appelé.

Le lien magique et le lien de réinitialisation sont consommables une seule fois, avec une validité serveur de 15 minutes. Un lien consommé/invalide affiche une explication et permet de recommencer. La réinitialisation invalide les anciennes sessions ; l’ancien mot de passe ne permet plus de se connecter. Un échec réseau rend les formulaires réutilisables sans annoncer un succès.

## Sécurité personnelle

`/account` exige une session authentifiée, indépendamment des droits d’administration d’une agence. Les cinq rôles y accèdent depuis l’icône de sécurité de l’en-tête. La page présente l’identité connectée, l’état de vérification, les passkeys enregistrées, leur date et la révocation des autres sessions. Elle ne contient aucune donnée publicitaire ni aucun secret de connexion.

Chaque utilisateur peut enregistrer une passkey, puis la retirer après confirmation dans l’interface. Le serveur vérifie la propriété de la clé ; sa suppression empêche une nouvelle authentification avec cette clé. Elle ne déconnecte pas les sessions déjà ouvertes : une action distincte révoque les autres sessions tout en conservant celle de l’utilisateur. La réinitialisation du mot de passe reste accessible depuis cette page.

L’authentification réussie, le changement d’espace et la déconnexion chargent un nouveau document pour abandonner les données de l’identité/espace précédent conservées par le routeur client. Un échec de déconnexion est affiché sans prétendre que la session a été fermée. Si les lectures de session ou des organisations échouent, le menu affiche une explication et permet de les relancer ; les limites d’authentification restent appliquées.

## Invitations et destinations de retour

Le lien d’invitation conserve sa destination pendant la connexion, l’inscription, la vérification et le lien magique. Seuls `/account` et une URL canonique `/invitation?id=…` sont acceptés comme retour personnalisé ; les URLs externes, IDs ambigus ou malformés sont remplacés par la destination habituelle. Les contrôles d’origine et CSRF du serveur restent activés.

L’acceptation vérifie l’identité destinataire, son email vérifié, la validité de l’invitation, son état et la capacité d’adhésion. Après acceptation, l’interface vérifie le résultat de l’activation de l’organisation. Une activation refusée peut être réessayée sans tenter de consommer une deuxième fois l’invitation déjà acceptée dans la même page. Si la réponse d’acceptation est entièrement perdue, une lecture serveur retrouve uniquement une invitation déjà acceptée par cet utilisateur vérifié et son adhésion toujours présente. Elle ne crée aucune adhésion. Cette reprise fonctionne aussi après réouverture du lien ; elle refuse une adhésion retirée depuis. Les IDs répétés sont rejetés et un changement d’ID remet l’état du formulaire à zéro.

Les refus prévisibles d’accès ou de quota disposent d’un précontrôle après validation du destinataire. L’interface affiche une prochaine étape en FR/EN à partir d’un code connu, sans exposer le texte technique arbitraire du prestataire. Une suspension déjà présente renvoie 403 ; une course après ce précontrôle demeure protégée par le trigger transactionnel et peut recevoir l’erreur générique de reprise.

## Recette et limites de preuve

La gestion des membres relit les droits et le propriétaire courant sous le verrou d’accès de l’agence. Retirer un membre efface l’organisation active uniquement dans ses sessions concernées. Lorsqu’une sélection historique est devenue inaccessible, l’onboarding verrouille la session encore valide et choisit une adhésion existante, ou efface la sélection sans créer de droits ni de nouvel essai. La page personnelle reste accessible. Les invitations expirées ne réservent plus de place et n’empêchent pas une nouvelle invitation ; leur historique reste enregistré. Depuis la migration 0055, le trigger d’admission complète le comptage préalable Better Auth par un verrou et un recomptage transactionnels : deux acceptations ne consomment plus la même dernière place. Il refuse aussi les workspaces inactifs et les essais expirés. L’invitation est remise en attente après ce refus de persistance ; une nouvelle tentative reste possible lorsque l’agence redevient admissible.

`web/e2e/auth-lifecycle-local.spec.ts` utilise le vrai serveur Better Auth et PostgreSQL local. Les essais couvrent FR/EN : inscription, blocage avant vérification, onboarding, langue des trois familles d’emails, lien magique et replay, reset et replay, invalidation des sessions, ancien/nouveau mot de passe, révocation ciblée, enregistrement/connexion/suppression d’une passkey virtuelle, refus d’accès et de suppression par un autre utilisateur, invitations étrangères/expirées/révoquées, acceptation vers une seconde agence et déconnexion. Un scénario supplémentaire vérifie la page personnelle pour les cinq rôles et son affichage mobile.

Les identités autorisées, clés et mots de passe de cette recette sont exclusivement jetables. Les contextes navigateur, espaces, adhésions, sessions, clés, essais et messages associés sont nettoyés. Les journaux du serveur passent par un filtre ligne par ligne, y compris lorsque le transport coupe un token entre plusieurs fragments ; liens d’authentification, de reset et de rapports sont masqués. Les erreurs d’authentification noyées dans un message Sentry sont également masquées.

La passkey virtuelle prouve le protocole de l’application avec Chromium, pas la compatibilité de tous les appareils physiques. Le transfert d’agence est également vérifié localement en FR/EN : confirmation, deux références de propriétaire, rôles, audit unique, refus du rejeu par l’ancien propriétaire et isolation de l’autre agence. La réception d’emails, la connexion Google réelle, les environnements déployés et la recette de lancement demeurent des vérifications séparées. Aucune migration de schéma supplémentaire n’est nécessaire pour ce lot.
