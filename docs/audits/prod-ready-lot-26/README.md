# Lot 26 — Registre actuel et preuves historiques

Base applicative : `6e884f3`. Documentation uniquement, sans nouveau déploiement ou migration.

`IMPLEMENTATION_STATUS.md` décrit désormais l’état local du 7 septembre, les fonctions présentes, leurs limites et les prochaines gates. Les anciennes affirmations de staging d’août sont conservées dans une archive explicitement historique, avec leurs liens relatifs adaptés. Le document de gates signale également que ses cases historiques ne certifient pas le candidat courant.

Le README remplace les lectures/rapports « live » par les collectes stockées et les éditions immuables, porte le nombre de modèles à dix, explique les périodes de rapports et la qualification d’historique, et indique le caractère privé de l’API et le consentement de la mesure d’audience. Le registre détaille aussi les suites locales encore ouvertes et les preuves externes nécessaires, sans annoncer la commercialisation.

Vérifications : liens Markdown locaux résolus pour README, registre, gates et archive ; `git diff --check` réussi. Les valeurs et comportements sont comparés aux contrats de fonctionnalités, à `monitoring.ts`, aux offres et aux preuves des lots 20–25. Aucun test applicatif répété pour ces changements documentaires. Les 1 320 tests, 53 scénarios navigateur et 56 migrations cités gardent leur provenance et leur date.

T20 reste ouvert : la landing doit adapter ses CTA à la bêta effective ; la matrice d’offre/aide, le support et le dossier commercial doivent encore être finalisés. Cette livraison ne constitue pas une validation juridique, fiscale ou fournisseur.
