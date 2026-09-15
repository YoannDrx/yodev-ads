# Lot 52 — Formulaires de rapports liés à leur espace

Base : `5708d75`. Suite T04/T12/T15/T17. Aucune migration ni modification des services SQL.

Les neuf actions de membre liées aux rapports sont regroupées dans `web/src/app/report-actions.ts` : publication, révision, révocation, création/modification/désactivation de modèle, création de planification, suspension/réactivation et renouvellement du lien. La page utilise ces actions dédiées. Les OTP et retours publics conservent leur module et leur contrôle propre.

Chaque action vérifie la permission du contexte authentifié, puis exige exactement un identifiant d'espace dans le formulaire, identique à l'espace courant. Un formulaire ancien, absent ou contenant plusieurs identifiants est refusé avant lecture de ressource, création de token, écriture ou révélation. Le champ caché exprime l'espace affiché ; il ne remplace jamais les contrôles de permission ni l'autorisation transactionnelle des services.

Les neuf formulaires portent cet identifiant et une clé React dépendant de l'espace et de l'action. Un changement d'espace recrée les champs au lieu de transporter silencieusement un brouillon non contrôlé vers le nouvel espace. Le refus est traduit et propose de recharger la page.

Les erreurs de ces actions passent par une liste de messages applicatifs autorisés. Les conflits, indisponibilités de données, baux, permissions et quotas restent compréhensibles. Les diagnostics Zod sont remplacés par un message de validation ; les erreurs imprévues, notamment les requêtes SQL et leurs paramètres, ne sont plus copiées dans les URL de redirection. Les traductions manquantes des erreurs de période/lien/fuseau ont été complétées.

## Preuves

- `check.log` : **1 592 tests / 201 fichiers**, huit tests de scripts, lint, TypeScript, frontières, build et audit runtime sans vulnérabilité détectée. Couverture **91,32 / 86,11 / 92,86 / 94,23 %**.
- Les **60 nouveaux tests** couvrent les neuf appels autorisés, les refus d'espace absent/différent/multiple et de permission, les erreurs internes filtrées pour chaque action, les dates invalides et la traduction des erreurs. Un message arbitraire commençant comme une erreur connue reste filtré.
- `browser.log` : **six parcours passent sans skip en 23,7 s**. Les deux nouveaux utilisent Better Auth pour changer réellement l'espace de la session en conservant le formulaire initial. Le même acteur dispose des permissions dans les deux espaces : l'ancien formulaire est néanmoins refusé, aucun modèle n'est créé dans l'un ou l'autre, le brouillon est vidé dans le nouvel espace, puis une saisie fraîche y est enregistrée. FR/390 px et EN/1440 px sont couverts.
- Les quatre parcours existants de rapports passent également : publication/révision, éditions HTML/PDF/CSV, données manquantes, modèles, renouvellement/suspension/réactivation, refus pendant un bail et après rétrogradation. Le déplacement des actions conserve ces résultats. Aucun worker ni fournisseur réel ; les fixtures et sessions sont nettoyées. Agent-browser vérifie le contenu de connexion et l'absence de dialogue d'erreur Next.

## Limites et suite

Pas de nouvelle recette PostgreSQL exhaustive dans ce lot : aucun service, schéma ou protocole de verrou n'est modifié. La dernière suite exhaustive est celle du lot 51 ; les parcours navigateur de ce lot utilisent bien PostgreSQL et Better Auth réels en local. La dernière recette navigateur générale reste celle du lot 43 (76 parcours) ; **84 scénarios sont maintenant disponibles** avec les deux contrôles locaux.

Le filtrage concerne les neuf actions de rapports, sans prétendre certifier toutes les redirections de l'application. Poursuivre les ressources référencées par les rapports, les domaines et le lifecycle, les collections restantes et les validations du candidat. Aucun déploiement, réception fournisseur ou gate commerciale n'est certifié ici ; l'objectif complet reste actif.
