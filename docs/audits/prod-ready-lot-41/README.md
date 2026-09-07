# Lot 41 — Récapitulatifs de tâches et validité des échéances

Base : `7d98283`. Suite T14/T15/T17. Aucune migration supplémentaire ; 60 migrations cumulées.

Le récapitulatif annonçait la taille de sa première tranche de 50 comme nombre de tâches ouvertes. Il lit désormais total et aperçu dans une même instruction SQL, avec ordre échéance/création/UUID. Le corps reste borné et annonce explicitement sa couverture. Les statuts sont traduits et les échéances affichées dans le fuseau personnel indiqué. L’objet, l’audit et le résultat du job utilisent le total exact ; `shownTaskCount` distingue les tâches affichées.

Le lien ouvre la collection complète des tâches ouvertes assignées. L’espace est conservé dans la pagination ; si un autre espace est actif, une explication remplace la collection et invite à choisir le bon espace. Le contrôle final d’envoi compare aussi l’aperçu et le total courants pour refuser un contenu changé pendant l’attente du registre.

Les échéances calendaires impossibles, notamment le 31 février, sont refusées sans normalisation vers le mois suivant. Le calcul vérifie qu’une fin de journée locale existe dans le fuseau demandé. Le [contrat des notifications](../../TASK_NOTIFICATIONS.md) décrit ces garanties et leur limite avant transport.

## Preuves

- `task-recipients.log` : **521 tâches assignées**, total exact et aperçu de 50, ordre stable avec égalités de dates et précision à la microseconde, parcours des 521 tâches sans doublon, curseur refusé pour un autre assigné. Tâches terminées, annulées, non assignées, d’un autre membre ou espace exclues. Les deux emails simulés contiennent les compteurs, états et échéances attendus. Trois changements pendant une attente réelle du registre (assignation, statut, titre) empêchent la soumission. Les contrôles du lot 40 passent aussi : révocations, consentement, adresse et bail. Six soumissions simulées au total, aucun appel réseau au fournisseur.
- `database.log` : tous les protocoles du runner PostgreSQL passent, y compris le protocole enrichi. La dernière exécution depuis une base vide reste le lot 33. Ce journal précède uniquement l’ajout des métadonnées HTML UTF-8 ; le protocole ciblé final ci-dessus a été rejoué après cet ajout.
- `check.log` : contrôle complet du code final, **1 450 tests / 191 fichiers**, huit tests de scripts, lint, types, frontières et sérialisation, compilation et audit runtime sans vulnérabilité détectée. Couverture **92,28 / 87,06 / 93,13 / 95,00 %**. Les dix nouveaux cas couvrent aperçu/complet/échappement, fuseau, dates invalides, année bissextile et date locale supprimée. Le contrôle complet a été rejoué après l’ajout UTF-8 au document HTML.
- `task-digest-fr.html`, `task-digest-en.html` et leurs captures : corps réels interceptés à la frontière du transport de fixture, ouverts localement en navigateur. Le premier rendu sans métadonnée de charset affichait mal les accents ; le document final déclare UTF-8 et la langue. Vérifications à 390 et 1440 px : 50 lignes, couverture correcte, lien complet et aucun débordement horizontal. Ces captures ne certifient pas les clients de messagerie externes.
- `browser.log` : **quatre parcours en 15,6 s**, tâches existantes et nouveau parcours complet FR/EN. Les 55 tâches assignées sont parcourues en trois pages sans doublon ; les tâches exclues n’apparaissent pas, l’espace demeure dans les liens et le changement d’espace affiche l’explication. Une date invalide forcée dans le formulaire est refusée côté serveur sans tâche persistée.
- `browser-final.log` : les **deux nouveaux parcours passent en 7,0 s** après attente des polices et recentrage pour les captures. Les captures initiales de contrôles étaient coupées en bas ; les captures finales montrent la navigation complète. Pas d’erreur de page ni de débordement. `types-final.log` et `lint-final.log` couvrent cet ajustement du test. Agent-browser vérifie également la page de connexion du serveur, puis ses sessions sont fermées.

## Suites ouvertes

La dernière recette générale reste celle du lot 37 (66 parcours). Les deux contrôles locaux donnent maintenant accès à 74 scénarios ; aucun passage général de ces 74 n’est revendiqué. Aucun fournisseur réel, déploiement, migration distante ou CI distante dans ce lot.

Les autres plafonds T14 (certaines collectes Google, métadonnées de rapports et retours d’approbation) restent à traiter. La sélection des comptes et les mutations OAuth, rapports, domaines et lifecycle poursuivent leur revue d’autorisation courante. Les critères externes et de lancement du plan restent ouverts : le rendu local d’un email et un total exact ne valent pas certification de production.
