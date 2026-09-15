# Lot 30 — Parcours d’activation par cohorte

Base : `c93301c`. Aucun changement de schéma, de fournisseur ou de configuration distante.

Les huit jalons partagent maintenant leur définition entre enregistrement, compteurs et cohortes. Les 12 semaines UTC affichent Google, inventaire, compte sélectionné, analyse qualifiée, vigie, rapport publié, acceptation et paiement. Chaque étape possède son délai médian depuis l’inscription parmi les espaces ayant effectivement atteint cette étape dans les cohortes retenues. Les marqueurs historiques non qualifiés, événements antérieurs à la création ou futurs restent exclus.

Le dénominateur global exclut désormais aussi les espaces créés dans le futur. Les cellules sont des taux sur les espaces inscrits de chaque cohorte, sans imposer un ordre artificiel aux jalons. Les semaines vides affichent un taux indisponible ; une médiane absente n’est pas remplacée par zéro. Le tableau précise la date UTC d’observation, la semaine incomplète et les limites de comparaison. Les espaces supprimés/internes sont exclus : cette vue suit les espaces commerciaux actuels, pas une mesure historique de churn.

## Vérifications

- `check.log` : **1 335 tests / 184 fichiers**, sept tests de scripts, lint, TypeScript, frontières et sérialisation, build et audit runtime sans vulnérabilité. Couverture **92,57 / 87,21 / 93,39 / 95,21 %**.
- `focused.log` : 15 tests ciblés sur les étapes intermédiaires, médianes avec échantillons incomplets, anciennes cohortes, frontière dimanche/lundi au changement d’année, états vides et tableau accessible au clavier.
- `browser.log` : **trois scénarios réussis en 6,9 s** sur Better Auth/PostgreSQL locaux, compteur et huit cellules comparés à SQL, exclusion interne/futur, défilement clavier et absence de débordement du document à 390 px ; non-régression de l’analyse FR/EN. Captures desktop/mobile inspectées.
- `browser-initial.log` conserve l’erreur de typage d’un paramètre UUID concaténé dans la fixture ; casts explicites ajoutés avant la réussite finale.
- Pas de migration supplémentaire : 57 restent en place. La suite PostgreSQL complète depuis une base vide demeure datée du lot 29 ; la nouvelle recette navigateur exerce les requêtes modifiées sur PostgreSQL.

Aucune collecte personnelle supplémentaire. Le tableau est réservé à l’espace interne comme auparavant. Il ne constitue pas une mesure des coûts, une preuve de réception email, un taux de churn ou une preuve de lecture humaine. Aide aux abandons, qualité des alertes et coûts par offre restent ouverts pour T21.
