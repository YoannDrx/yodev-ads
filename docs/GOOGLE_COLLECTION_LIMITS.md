# Lecture Google bornée et couverture analytique

Les lectures GAQL du gateway utilisent désormais `GoogleAdsService.Search` en REST. La même requête est renvoyée avec le `nextPageToken` reçu jusqu’à épuisement des pages. Aucun `pageSize` n’est envoyé : Google fixe les pages à 10 000 lignes. Les données restent ensuite consultées depuis PostgreSQL. Références officielles consultées le 7 septembre 2026 : [pagination Google Ads](https://developers.google.com/google-ads/api/docs/reporting/paging?hl=en) et [Search / SearchStream REST](https://developers.google.com/google-ads/api/rest/common/search?hl=en).

## Bornes et échec

- Au plus 16 Mio de réponse décodée par appel HTTP, vérifiés sur les octets effectivement lus, même sans `Content-Length` ou avec une longueur mensongère.
- Au plus 64 Mio reçus, 100 000 lignes et 100 pages par requête GAQL. Les octets des réponses HTTP répétées participent au budget.
- Échéance commune de 25 secondes par traversée, raccourcie par celle du worker. OAuth, retries et lecture du corps respectent le budget de travail. Le corps est annulé lorsqu’il bloque ou dépasse la borne.
- Une page invalide, une continuation cyclique, un refus fournisseur, un dépassement ou une interruption font échouer la lecture entière. Aucune liste partielle n’est retournée comme inventaire réussi. Le cache réussi précédent reste conservé par le collecteur.
- Les request IDs des en-têtes et des corps des pages reçues sont conservés et dédupliqués. Un identifiant connu reste disponible si la lecture du corps échoue.
- Une réponse de mutation illisible est une erreur 502 avec son request ID connu ; le transport ne répète pas la mutation. Le service d’approbation existant la classe comme ambiguë pour réconciliation.

Ces plafonds bornent les ressources ; ils ne promettent pas une collecte arbitrairement grande. Le chargement d’une famille analytique conserve également sa limite de stockage de 1 900 000 octets normalisés côté worker et de 2 Mio côté PostgreSQL. Les grandes familles nécessitant davantage restent à partitionner dans T14. Une lecture échouée ne certifie pas de couverture.

## Couverture enregistrée

La migration additive `0052_analytical_source_coverage.sql` ajoute un JSON nullable à `analytical_collections`. Pour chaque requête réussie, le gateway fournit le nombre de lignes brutes, pages et octets, le plafond GAQL éventuel et une empreinte de la requête. Le texte GAQL n’est pas stocké dans cette métadonnée.

Le collecteur valide ce contrat, puis enregistre couverture, données, version source, audit et checkpoint ensemble. Le verrou de lease et la protection contre une réponse antérieure restent appliqués. Un ancien worker peut encore écrire une collecte sans couverture ; celle-ci reste explicitement non vérifiée. Aucune ancienne collecte n’est requalifiée rétroactivement.

- **Résultats limités** : au moins une requête a atteint son `LIMIT`. C’est une qualification prudente, y compris lorsque le vrai total pourrait être exactement égal au plafond.
- **Toutes les pages disponibles reçues** : la fin du résultat des requêtes a été atteinte sans plafond atteint. Cela ne prouve pas l’absence de seuils de confidentialité, filtres de ressource ou différences avec les totaux Google Ads.
- **Couverture non vérifiée** : métadonnée absente, ancienne, vide ou invalide.

Les limites de sécurité des inventaires utilisés avant mutation sont conservées. Les plafonds analytiques de 500 et celui des composants restent également en place. Seul le `LIMIT 1` de la lecture non segmentée des paramètres de conversion du client est retiré : son objet est déjà le client de l’URL et il ne doit pas être signalé comme une liste tronquée.

Le détail des synchronisations affiche cette qualification en français et en anglais, indépendamment de la fraîcheur. Elle ne constitue pas un score de santé. Le nombre de lignes brutes peut différer de celui affiché après agrégation ou normalisation.

## Migration, export et vérification

Appliquer la migration avant le nouveau code. Elle ajoute une colonne nullable sans backfill ni changement RLS, index ou rôle ; l’ancienne application ignore cette colonne. Le rollback applicatif conserve les données. Les exports tenant existants lisent toute la ligne analytique, et la suppression/rétention restent celles de la collection parent.

La recette locale couvre une migration depuis la base existante et depuis une base vide, les 53 migrations cumulées, l’atomicité de la couverture avec le checkpoint, les droits SELECT de l’application, les refus inter-agence et la suppression du client. Les tests de transport simulent plus de 10 000 résultats, les plafonds de lignes/pages/octets, les erreurs intermédiaires, l’annulation du corps et les résultats vides. Les parcours navigateur FR/EN vérifient les trois qualifications en période de grâce et sur données anciennes.

T14 reste ouvert : pagination/recherche/export des lignes analytiques enregistrées, consultation au-delà des aperçus actuels, partitionnement des familles trop grandes et autres listes encore limitées. Aucune requête Google réelle ni certification du nouveau transport sur un compte contrôlé n’est revendiquée par ces tests locaux.
