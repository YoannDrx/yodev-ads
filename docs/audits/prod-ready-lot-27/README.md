# Lot 27 — Accès public fidèle et catalogue partagé

Base : `bcec39c`. Aucune migration, activation de flag, souscription ou émission fournisseur.

La landing lit le statut serveur de la bêta. Ses six CTA indiquent « J’ai une invitation » en accès privé ou « Démarrer l’essai » en accès public, avec la traduction anglaise. Les textes expliquent la création de compte autorisée et la souscription séparée ; aucun essai public n’est promis lorsque la bêta est fermée. L’inscription distingue invitation à une agence, compte autorisé privé et premier espace en essai public.

Prix, noms et quotas affichés viennent du catalogue utilisé par la facturation et des entitlements applicatifs. Les cartes montrent les nombres réels de comptes, vigies, rapports et membres. L’aperçu est identifié comme données fictives ; les promesses d’autonomie et de traçabilité absolue sont remplacées par les actions proposées. Les changements Google et connecteurs sont qualifiés comme soumis à validation pour l’espace. Le header revient à la ligne sur mobile pour conserver l’accès aux boutons.

## Vérifications

- `check.log` : **1 325 tests / 182 fichiers**, sept tests de scripts, lint, TypeScript, frontières de données/transactions, build et audit runtime sans vulnérabilité. Couverture **92,53 % / 87,09 % / 93,27 % / 95,20 %**.
- Quatre tests de rendu combinent FR/EN et bêta publique activée/désactivée, contrôlent les six liens et comparent les cartes au catalogue/aux quotas. Un test d’inscription distingue l’invitation du premier essai.
- `browser.log` : **neuf scénarios réussis sans skip en 29,2 s**, regroupant les six parcours publics et les trois parcours d’authentification. Les pages FR/EN privées n’exposent pas d’essai public ; données fictives visibles, headers de sécurité, pages légales et statut restent contrôlés. Les liens de navigation sont entièrement dans le viewport à 390 px.
- Captures desktop/mobile FR/EN dans `browser/` ; landing mobile anglaise inspectée intégralement. Le bandeau de consentement y est présent tant que le visiteur n’a pas fait son choix. Agent-browser confirme contenu, liens et absence d’erreur ; capture `landing.png`.
- Revue React : statut lu côté serveur, booléen minimal transmis au formulaire, aucun effet de synchronisation ou appel externe ajouté ; navigation responsive et labels maintenus.

Les 53 scénarios généraux du lot 25 n’ont pas tous été répétés ; les parcours touchés passent ici. Aucune base de données modifiée : les 56 migrations restent celles du lot 24. Le mode public est couvert au rendu, sans ouvrir l’inscription sur un environnement réel. T20 reste ouvert pour l’aide, le support, les documents commerciaux et les validations professionnelles/fournisseurs.
