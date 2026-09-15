# Lot 12 — rendu et marque des rapports

Implémentation locale de T13, 7 septembre 2026. Contrat : [REPORT_RENDERING.md](../../REPORT_RENDERING.md).

- `check-final.log` : 1 130 tests / 158 fichiers, couverture au-dessus des seuils inchangés, build, types, lint, frontières et sérialisation, cinq tests de preuve de release, audit runtime sans vulnérabilité.
- `postgres-branding.log` : gel du logo normalisé/couleur, révision après suppression, trois forfaits et toute la fixture des éditions. Le transport est simulé localement ; aucun appel réseau fournisseur.
- `pdf-text-verification.json` : deux PDF A4, 13 pages chacun, 80 campagnes, 5 000 caractères par champ éditorial, aucun marqueur ni texte manquant, marges vérifiées.
- `report-fr.pdf`, `report-en.pdf` et textes extraits : fixtures artificielles, très grand montant, remboursement, grec/cyrillique et substitution explicite CJK/emoji. `expected.json` contient les textes attendus.
- `fr-contact.png`, `en-contact.png`, `en-01.png`, `fr-13.png` : inspection des 26 pages et de détails représentatifs, sans chevauchement ou texte tronqué observé.
- `font-tracing.json` : fichiers de police inclus dans la fonction de production PDF.
- `browser-report-rendering.log` : deux parcours FR/EN réussis en 16,7 secondes, sans skip. Couleur réellement appliquée avant/après Server Action, longues sections sans débordement horizontal, grand montant, cinq périodes, exports, révision, erreurs OTP conservant l’édition, couverture manquante, révocation et quota PDF.
- `report-long-*.png`, `report-public-*.png`, `report-editions-*.png` : captures finales à 390/1440 px. Les tokens affichés sont ceux de fixtures nettoyées ; ils sont masqués dans le journal texte.

La première inspection navigateur avait détecté la couleur bloquée par la CSP, puis la perte de couleur après redirection avec un nonce de requête renouvelé. Le passage final vérifie le correctif qui conserve le nonce du document. La couverture PDF des glyphes reste celle des fontes embarquées ; les écritures non couvertes sont explicitement signalées.

Ces preuves ne certifient ni le déploiement final ni un upload Blob réel. Les grands volumes sont suivis dans T14.
