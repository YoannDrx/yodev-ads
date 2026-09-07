# Rendu des rapports — T13

Le modèle de l’édition conserve désormais les données de marque en plus des dates, agrégats et commentaires. HTML, PDF et CSV utilisent ce même modèle. Le CSV conserve les nombres bruts et inclut le nom de marque, la couleur et l’empreinte du logo ; il n’embarque pas d’image. Les éditions antérieures sans champ `branding` restent lisibles avec la couleur par défaut et sans logo. Cette extension JSON ne nécessite pas de migration.

## Texte, nombres et pagination

Le PDF embarque Noto Sans Regular/Bold avec `@pdf-lib/fontkit`. Les fichiers, leur licence SIL OFL 1.1 et leurs empreintes SHA-256 sont conservés dans `web/src/assets/fonts/`. Les sources officielles sont épinglées au commit `ffebf8c1ee449e544955a7e813c54f9b73848eac` du dépôt `notofonts/noto-fonts`. Le build Next trace ces deux fichiers dans la fonction PDF.

Les caractères disponibles dans les deux fontes sont conservés, après normalisation NFC. Les caractères non rendables, dont les emoji et les caractères CJK absents de cette fonte, ont un remplacement explicite `[U+XXXX]`, accompagné d’une explication. Le texte original reste dans HTML et CSV. Ce rendu n’est pas une couverture universelle de toutes les écritures.

Le texte éditorial et le plan d’action passent intégralement à la page suivante. Les mots trop longs sont découpés par points de code ; une recherche par préfixes limite les mesures de police coûteuses. Les lignes de campagne peuvent continuer sur plusieurs pages, avec répétition de l’en-tête de tableau. Les grands montants et compteurs sont visibles en entier, y compris les remboursements. Le calcul monétaire conserve les micros en entiers, arrondit à la précision de la devise, puis localise séparateurs et symbole en FR/EN. Les conversions conservent jusqu’à deux décimales dans le rendu.

Les métadonnées de publication sont celles de l’édition. Deux rendus du même modèle avec le même code produisent les mêmes octets dans les tests ; une évolution du moteur de rendu peut modifier les octets d’un ancien PDF, sans modifier les données figées. Le stockage n’archive pas encore un binaire PDF par version du moteur.

## Logos et couleurs

Un nouveau logo doit être PNG, JPEG ou WebP, sous 2 Mio. La validation décode effectivement l’image, refuse les fichiers tronqués et multipages, limite le décodage à 4 194 304 pixels et normalise un PNG de 512 × 512 au maximum. La taille normalisée reste bornée à 2 Mio.

À la publication, le chargeur accepte seulement une URL HTTPS Blob contrôlée, dans le chemin du workspace courant, sans paramètres, credentials, port ou fragment. Aucun suivi de redirection ni URL alternative. Le téléchargement a un délai de cinq secondes et une limite cumulée de 2 Mio ; les octets normalisés et leur empreinte sont figés dans l’édition. Une erreur de logo déclenche un repli décoratif sans empêcher de lire les données. Un cache de 32 entrées évite les téléchargements répétés. Les réouvertures et révisions utilisent les octets figés, même si le logo original a été supprimé.

Solo utilise la marque YoDevAds ; Studio utilise la marque de l’agence avec attribution ; Agency utilise la marque de l’agence sans attribution. Les révisions conservent la présentation de l’édition source. La couleur doit être un hexadécimal à six chiffres ; le texte noir ou blanc est choisi selon la luminance.

La feuille de style de marque conserve le nonce du document courant, car une navigation React ou une Server Action reçoit un nouveau nonce de requête sans remplacer la politique CSP du document. Cette règle est utilisée aussi par l’accent du workspace. La CSP n’a pas été élargie. Les formulaires de retour client conservent l’identifiant de l’édition dans les redirections ; il reste un état de navigation, l’accès étant revérifié par le lecteur tenanté.

## Vérification reproductible

Depuis `web/` :

```sh
npm run check
NODE_OPTIONS=--conditions=react-server npx --no-install tsx scripts/verify-report-rendering.ts
python3 scripts/verify-report-pdf-text.py
YODEV_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:56187/yodev_test npm run test:e2e:local -- --grep 'published report editions'
```

L’extraction exige `pdfplumber`. PostgreSQL doit être une base locale jetable migrée ; le vérificateur refuse une autre cible. La fixture PostgreSQL `verify-report-editions.ts`, incluse dans `db:verify-local`, vérifie gel du logo/couleur, réouverture, révision et attribution des trois forfaits avec transport simulé.

Les deux PDF contiennent chacun 80 campagnes, 5 000 caractères de commentaire, 5 000 caractères de plan d’action, des mots longs, des caractères latins/grecs/cyrilliques et des remplacements CJK/emoji. L’extraction vérifie chaque marqueur, l’intégralité des deux textes et les marges de chaque page. Les planches des 26 pages et des pages représentatives ont été inspectées. Les captures navigateur couvrent 390 px en français et 1440 px en anglais, la couleur effective avant/après redirection, les textes longs, le grand montant et l’absence de débordement horizontal.

Les [preuves du lot 12](./audits/prod-ready-lot-12/README.md) sont locales. Elles ne remplacent pas un exercice Blob ou une recette du déploiement final. T14 traite séparément les grands volumes et la pagination des collections.
