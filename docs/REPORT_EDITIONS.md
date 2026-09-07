# Rapports datés et éditions immuables

Le lecteur public, le CSV et le PDF utilisent un même modèle enregistré dans `report_editions`. Ils ne déclenchent plus d’appel Google Ads. Une nouvelle publication exige un historique journalier complet et qualifié ; une édition existante reste consultable même si une collecte ultérieure échoue ou si les identifiants Google sont révoqués. Le compte doit rester sélectionné et actif, et le workspace autorisé à partager ses rapports.

## Périodes et provenance

- 7, 30 ou 90 jours complets dans le fuseau du compte annonceur.
- Mois civil précédent, y compris février et les années bissextiles.
- Intervalle personnalisé inclusif de 1 à 730 jours, dans la fenêtre de rétention, sans jour courant/futur et entièrement couvert.
- Les anciens liens sans `period_config` utilisent leur `period_days` numérique. Les valeurs 7/30/90 sont reconnues ; un intervalle invalide ou non collecté affiche une indisponibilité explicite.

La publication verrouille le lien et partage le verrou d’historique du collecteur. Les totaux de compte viennent des métriques journalières du compte ; ils ne sont pas reconstruits à partir d’une liste de campagnes potentiellement incomplète. Les campagnes supprimées restent présentes. Les sommes entières de coûts, valeurs, clics et impressions restent exactes ; les conversions sont additionnées à quatre décimales avant leur conversion pour l’affichage. La version SHA-256 couvre les dates, le fuseau, la devise, les versions de couverture et les valeurs utilisées.

## Lien dynamique, bilan figé et correction

Un lien dynamique publie une édition quand les données enregistrées changent. Des ouvertures concurrentes des mêmes données réutilisent l’édition. Le téléchargement porte toujours `?edition=<id>` pour désigner exactement le bilan affiché.

Un bilan figé conserve sa première édition comme destination par défaut. Le bouton « Publier une édition corrigée » crée une révision aux mêmes dates, dans le même fuseau, avec les mêmes noms et la même marque, à partir des données corrigées. Son URL est révélée une seule fois et pointe vers le nouvel identifiant. Les anciennes éditions ne sont pas écrasées. Un ancien lien dont le token ne peut plus être révélé doit être remplacé par un nouveau rapport ; le système ne révoque pas silencieusement le lien existant pour fabriquer une révision.

Les propositions et retours client sont explicitement présentés comme le suivi actuel, en dehors des chiffres figés du bilan. La révélation d’une nouvelle URL réinitialise son composant, même après plusieurs créations sur la même page.

## Envois programmés

Chaque job est rattaché au workspace, à la planification, à sa clé d’occurrence et à sa tentative détenue en base. La période utilise la date de création persistée du job, sans glisser au jour d’une relance. Les jours 29 à 31 sont ramenés à la fin des mois plus courts.

La publication enregistre dans une seule transaction l’édition et le contenu chiffré de son email : expéditeur, destinataires, sujet, HTML et URL de l’édition. Une relance conserve ce contenu, même si les destinataires ou le modèle ont changé. Une clé de fournisseur stable et le registre des emails permettent de reprendre une acceptation déjà enregistrée sans nouvelle soumission. Un état en cours, ambigu ou en échec ne constitue plus une réussite d’envoi.

Avant le transport, puis après l'attente du registre email immédiatement avant chaque nouvelle soumission, le worker relit ses deux réservations, l’état du workspace, du compte, de la planification et du lien. Une rotation/révocation du token bloque la reprise de l’ancienne capacité. Les destinataires figés doivent toujours appartenir à la planification lors d'une nouvelle soumission ; les acceptations déjà enregistrées sont rapprochées sans renvoi même si cette liste a changé. Les échéances du job, de l'essai et des réservations sont contrôlées avec l'horloge PostgreSQL après les verrous et les écritures. La finalisation est conditionnée au propriétaire de réservation et à la tentative du job ; un ancien worker ne peut pas effacer la réservation d’un successeur. Un effet externe déjà admis ne peut pas être annulé par une révocation ultérieure.

La suspension/réactivation et le renouvellement du lien verrouillent la planification avant sa lecture et avant toute écriture du lien. Un bail acquis pendant l'attente bloque la modification ; un bail expiré pendant l'autorisation ne la bloque plus. Le refus est affiché en FR/EN sans changer le token ou l'état.

Le champ historique `lastDeliveredAt` correspond à la finalisation d’une acceptation du transport. La réception, les rebonds et les plaintes restent suivis dans le registre email et les webhooks fournisseur. La fixture locale prouve le protocole avec un transport intercepté ; elle ne prouve aucune réception réelle.

## Conservation et protection

La migration additive `0050` crée les éditions et les champs compatibles des liens/modèles/planifications. Les anciennes lignes ne sont pas supprimées. Les nouveaux rapports sont figés par défaut ; les anciens liens restent dynamiques.

Chaque édition expire 90 jours après sa publication. Prolonger un lien pour une nouvelle édition ne prolonge pas les anciennes éditions. Le worker de rétention supprime les éditions expirées. La suppression du workspace, du compte ou du lien cascade ; supprimer une planification conserve ses éditions tant que le lien existe. La référence à une édition précédente est un identifiant historique, sans cascade.

Les rôles applicatifs peuvent lire/insérer les éditions dans leur tenant, sans modifier ni supprimer leur contenu. Le rôle système peut supprimer les éditions expirées et mettre à jour uniquement la colonne chiffrée de livraison pour la rotation des clés. Les charges métier, dates, versions et identifiants restent immuables. Les exports du workspace incluent les éditions et leurs données, sans token ni contenu chiffré de transport.

## Vérification et déploiement

Preuves : [lot 11](audits/prod-ready-lot-11/). Le runner `npm run db:verify-local`, avec une URL `YODEV_TEST_DATABASE_URL` sur loopback, intègre la fixture d’éditions. Les tests navigateur utilisent de vraies sessions Better Auth et des données jetables, sans fournisseur actif. Les compteurs d’abus restent actifs et la réponse 429 est testée.

Pour un déploiement : appliquer la migration avant le code qui lit les nouvelles colonnes, vérifier les privilèges et les contraintes, puis déployer un candidat exact et rejouer les parcours dans l’environnement cible. Une restauration de code conserve les nouvelles tables ; supprimer les éditions pour revenir en arrière détruirait des publications et n’est pas un rollback acceptable. Aucune migration distante ni promotion n’est effectuée par ce lot.

Le rendu PDF Unicode, la pagination complète des textes, la localisation des montants et le logo/couleurs sont encore suivis dans T13. La pagination serveur de l’historique et les très grands volumes restent sous T14. L’écran annonce explicitement qu’il présente les 100 dernières éditions. Les preuves fournisseur réelles et les critères de lancement restent distincts de cette validation locale.
