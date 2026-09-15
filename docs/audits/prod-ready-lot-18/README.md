# Lot 18 — navigation courante, clavier et sélection explicite du client

7 septembre 2026. T04/T15, sans migration ni appel fournisseur.

La navigation du layout suit `usePathname` dans un petit composant client, au lieu de conserver l’URL de la première requête. Les liens de bureau, de barre rapide et de menu complet utilisent `aria-current` et un style visible. Les sous-pages d’insights et les discussions tâches/alertes/approbations/support correspondent à leur rubrique. Le menu latéral défile sur écran peu haut. Le lien de saut au contenu déplace le focus vers le `main` sans ajouter une étape d’historique.

Les pages cockpit, analyse, insights et historique refusent désormais par 404 un client explicite malformé, vide, répété, inaccessible ou manager. Le repository valide l’UUID avant la requête et ne remplace jamais un client explicitement demandé par un autre. Le client par défaut reste réservé à l’absence du paramètre.

- `check.log` : **1 242 tests / 168 fichiers**, cinq tests de release, lint/types/frontières/sérialisation/build/audit runtime réussis. Couverture : 92,40 % instructions, 86,84 % branches, 93,18 % fonctions, 95,13 % lignes. Aucune vulnérabilité runtime.
- `database-account-selection.log` : recette PostgreSQL de sélection réussie, augmentée du rejet explicite d’un manager et d’un UUID malformé. Les 53 migrations n’ont pas changé ; la suite de base complète du lot 17 reste distincte de ce contrôle ciblé.
- `browser-final.log` : **17 réussites en 24,4 secondes, aucun skip**. Cinq rôles, export direct interdit aux mauvais tenants, navigation FR/EN, espaces et permissions, clavier, conservation du document pendant navigation Next, retour arrière, sous-pages/discussions, défilement du dernier lien à 1 280×600, barre/menu à 390/768 px et refus HTTP des mauvais identifiants de client.
- `final-ui-check.log` : lint et build final après correction du lien de saut au contenu ; le build inclut le contrôle des types.
- Captures de connexion, menus, défilement desktop et navigation mobile. Les vues représentatives FR desktop/EN mobile ont été inspectées.

Les premiers passages sont conservés : `browser.log` détecte le retour arrière après un lien d’ancrage natif ; `intermediate-skip-link.log` montre que Next Link ne transfère pas ici le focus au main ; `intermediate-nested-selector.log` révèle ensuite un sélecteur de test incluant les liens masqués du menu imbriqué. Le lien final déplace directement le focus, et le test cible les enfants directs de la barre rapide. Ces ajustements ne réduisent pas les assertions du retour arrière ou du clavier. Les diagnostics associés sont archivés.

Aucun changement de schéma, migration distante, déploiement ou envoi à un tiers. Le serveur et les fixtures navigateur sont nettoyés. Cette recette vérifie les parcours décrits ; elle ne constitue pas un audit d’accessibilité exhaustif ou une certification WCAG.
