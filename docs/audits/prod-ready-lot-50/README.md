# Lot 50 — Admission des rapports planifiés après les attentes

Base : `4ba9d14`. Suite T04/T06/T12/T17. Aucune migration ni extension de privilèges SQL ; 60 migrations cumulées.

Le worker verrouille workspace, planification, job, compte et lien avant d'utiliser leur état. L'échéance du job est contrôlée par une requête distincte après les verrous : le prédicat temporel d'un `SELECT FOR UPDATE` pouvait être évalué avant une attente. La capacité de reporting et l'expiration effective de l'essai sont vérifiées sur le workspace courant.

La fin de préparation contrôle à nouveau job et essai, après les écritures de publication. Leur expiration annule édition et réservation dans la même transaction. Le bail d'envoi commence avec l'horloge PostgreSQL à la réservation, après la préparation. Une réservation précédente est également comparée à cette horloge après verrouillage.

L'admission est répétée après l'attente du registre durable des emails, immédiatement avant chaque soumission fournisseur. Elle contrôle les deux baux, les états courants, le token, l'expiration du lien et de l'édition, et le flag notifications. Tous les destinataires du contenu figé doivent encore appartenir à la planification courante. Une nouvelle adresse ajoutée n'est pas injectée dans un email déjà figé. Un refus métier devient un refus d'admission ; une erreur de vérification ou un bail perdu reste une erreur reprenable. Une acceptation précédemment incertaine conserve son état ambigu.

Un email déjà accepté dans le registre conserve sa voie de rapprochement sans nouvelle soumission, même si les destinataires de la planification ont changé. Le contenu, les destinataires et la clé d'idempotence restent ceux de l'édition. La finalisation verrouille la planification avant le job et contrôle les deux échéances après l'audit ; si elles expirent pendant l'attente, le marqueur de finalisation et l'audit sont annulés, puis une reprise rapproche l'acceptation existante.

## Preuves

- `check.log` : **1 530 tests / 199 fichiers**, huit tests de scripts, lint, TypeScript, frontières des données/transactions, build et audit runtime sans vulnérabilité détectée. Couverture **91,31 / 86,10 / 92,85 / 94,22 %**. Les 13 tests du worker couvrent notamment le hook d'admission, le refus de destinataires retirés, les adresses autorisées normalisées et le contenu figé en reprise.
- `database.log` : recette PostgreSQL complète, incluant le nouveau protocole `verify-scheduled-report-admission.ts`, désormais exécuté par le runner partagé avec la CI. Les protocoles antérieurs d'éditions et de réconciliation restent présents. La preuve des 60 migrations depuis une base vide demeure celle du lot 33.
- Le nouveau protocole provoque cinq refus de lifecycle, des attentes sur les lignes job/lien, deux expirations pendant l'insertion de l'édition, puis douze révocations pendant l'attente réelle d'insertion dans le registre email. Il vérifie l'absence de soumission et les états `failed` ou `pending` attendus. Une tentative ambiguë reste ambiguë après retrait du destinataire. Deux reprises après acceptation, dont une expiration pendant l'audit de finalisation, n'effectuent aucun renvoi. **Trois soumissions simulées, zéro appel fournisseur réel.**

## Limites et suite

Aucune UI modifiée : les parcours navigateur n'ont pas été rejoués dans ce lot. La dernière recette générale reste celle du lot 43 (76 parcours), et les quatre parcours ciblés de rapports celle du lot 49 ; 82 scénarios sont disponibles.

Cette admission fixe le dernier contrôle avant soumission ; elle ne peut annuler un effet externe déjà admis. Le champ historique `lastDeliveredAt` et l'audit historique du worker désignent toujours une acceptation du transport, pas une réception attestée. Les reçus et ambiguïtés fournisseur restent suivis séparément.

Les deux mutations de gestion des baux, les ressources de modèles/domaines et les formulaires de rapports liés à leur espace restent à revoir. Domaines/lifecycle, volumes T14 et validations fournisseurs, commerciales, déployées et de bêta restent dans l'objectif actif. Aucun déploiement, envoi réel ni certification de production dans ce lot.
