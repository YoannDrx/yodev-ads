# Coûts d’exploitation par offre

Contrat livré au lot 33 pour T21. La page `/operations/costs`, accessible depuis le centre des opérations, est réservée aux propriétaires et administrateurs d’un workspace dont l’état courant est `internal`. Elle fournit des observations exploitables ; elle ne constitue ni une comptabilité exhaustive, ni une attestation de factures fournisseur, ni une mesure certifiée de marge.

## Sources et interprétation

Six postes sont disponibles : collectes Google, base de données, fonctions, stockage, email et support. Une ligne correspond à **une ligne de justificatif pour un mois de service UTC**, dans une seule monnaie. Sa référence opaque est unique dans le registre, y compris après correction ou changement de mois. Une facture couvrant plusieurs mois ou plusieurs postes doit être ventilée avec des références distinctes et un calcul conservé hors application. Ne pas enregistrer une deuxième fois, sous « collectes », une dépense déjà comptée sous « fonctions » ou « base de données ».

Le registre conserve la référence, la période, le montant hors taxes, l’origine déclarée, la méthode et les pourcentages de répartition. Les justificatifs, noms de clients, données de tickets, liens privés et secrets restent hors du registre. L’origine « justificatif disponible » est une **déclaration de l’opérateur** ; l’application ne télécharge ni ne vérifie elle-même les factures. Une clé de référence ne prouve pas que la source existe ou que toutes les sources ont été saisies.

- **Documenté direct / non réparti** : montant déclaré justifié, affecté intégralement à une offre sur preuve directe ou conservé dans « non réparti ».
- **Documenté réparti** : montant déclaré justifié, ventilé selon les usages ou les jours par forfait. L’attribution reste dépendante du calcul retenu ; ce n’est pas une mesure directe par offre.
- **Estimé** : montant estimé ou toute répartition manuelle, même si son montant de départ est justifié. Une répartition manuelle du temps de support est également présentée comme estimée.
- **Support non valorisé** : durée renseignée, montant vide. Le tableau signale la valorisation incomplète. Il n’invente aucun tarif horaire.
- **Zéro** : observation explicite ; une absence d’observation reste « non renseigné » ou absente du tableau. Les postes sans observation sont listés. Un poste présent peut rester incomplet pour certaines offres.

Les montants admettent six décimales et les avoirs négatifs. L’arithmétique entière conserve chaque micro-unité ; la ventilation utilise les plus grands restes, avec un ordre de départ stable pour les égalités. La durée de support utilise des centièmes de minute. Essai, Solo, Studio, Agency, Interne et Non réparti sont séparés. Les monnaies ne sont jamais converties ni additionnées entre elles. Aucun montant de dépenses publicitaires Google n’entre dans les coûts d’exploitation.

## Attribution historique et usages observés

Les répartitions concernent les offres **pendant la période du service**, avec justificatif du calcul ; elles ne sont pas recalculées depuis les abonnements courants. Pour un changement d’offre en milieu de mois, le calcul peut utiliser des jours par forfait ou des usages réellement attribués. Les coûts partagés sans preuve restent non répartis.

La migration `0059` capture automatiquement `job_attempts.billing_plan_at_start` pour les nouvelles tentatives. L’état `internal` est isolé ; les traitements sans workspace sont non répartis. Le trigger remplace toute attribution fournie à l’insertion et interdit sa modification ultérieure. Un downgrade ne modifie pas les anciennes tentatives. **Aucun backfill** ne prétend connaître l’offre des anciennes tentatives : leur attribution reste inconnue.

Le tableau d’usage agrège, sur le mois choisi et jusqu’à la lecture, les tentatives conservées, celles appartenant aux familles de lectures Google, le nombre de durées valides et leur temps écoulé cumulé. Une tentative de lecture Google peut s’arrêter avant tout appel fournisseur. Les reprises/échecs comptent ; le temps écoulé inclut les attentes réseau. Ce ne sont donc ni des requêtes Google facturées, ni des millisecondes de CPU facturées. Les durées inachevées, négatives et futures sont exclues. Les jobs et tentatives peuvent disparaître avec la rétention ou la suppression du workspace : **ce tableau n’est pas une archive de facturation**. Il ne mesure pas encore automatiquement les octets de stockage, unités DB, unités de calcul ou factures email des fournisseurs.

## Corrections et accès

La lecture et l’écriture relisent et verrouillent le workspace opérateur et son adhésion actuelle. Une révocation de rôle concurrente est observée après l’attente du verrou. Les rôles applicatifs, d’authentification et de purge n’ont aucun accès au registre global. Le rôle système peut lire, ajouter et corriger, mais pas supprimer des observations. Les identités sont fournies par la session côté action ; l’URL et les formulaires ne décident pas de l’acteur.

Une nouvelle référence commence à la version 1. Le même envoi rejoué après perte de réponse retourne le même résultat, sans nouvel audit. Une correction modifie la version attendue, conserve les valeurs avant/après dans l’audit et refuse un formulaire obsolète. « Retirée » conserve la ligne et son audit tout en l’excluant des calculs ; elle peut être réactivée par une nouvelle correction. Les justificatifs se parcourent par pages stables de 25 références ; le tri ASCII est commun à PostgreSQL et au curseur, indépendamment de la langue de la base. Les agrégats couvrent toutes les pages du mois. Au-delà de 10 000 références mensuelles, la lecture refuse de produire des totaux partiels et demande une consolidation. Les audits suivent la rétention existante du workspace interne ; conserver les justificatifs comptables indépendamment de cette application.

## Objectifs d’exploitation à calibrer avant la bêta

Les [runbooks](./OPERATIONS_RUNBOOKS.md) restent la référence pour les objectifs de disponibilité, RPO/RTO, incidents, fréquence du scheduler et protocoles de charge. Les mesures locales historiques ne représentent pas une baseline de production.

Pour chaque période pilote, l’opérateur doit :

1. Rapprocher les factures/exportations de consommation pour les six postes, inclure les avoirs, séparer les environnements et conserver les références et règles de ventilation. Déclarer les postes incomplets, y compris le support non valorisé.
2. Mesurer les temps de support sans enregistrer les contenus de tickets dans le registre ; préciser l’origine observée ou estimée. Relier les totaux de coût aux offres servies pendant la période, sans assimiler les quotas à des usages réels.
3. Exécuter les recettes de charge prévues par T14/T21/T22, notamment Agency à 50 comptes et 200 vigies, reprises et limitations fournisseur. Conserver le SHA, l’environnement, la période, les latences et les coûts observés. Le temps de compilation local ne sert pas de SLA.
4. Fixer ensuite, avec marge sous les échéances d’exécution, les plafonds de fréquence, de concurrence et de coût par offre ; documenter leur justification et les alertes de dépassement. Rejouer les mêmes scénarios après modification. Les prix et quotas existants restent inchangés pendant cette mesure.

**Seuils de coût par offre, taux de couverture des factures, coût unitaire des collectes et coût réel du support : non calibrés à ce stade.** Le registre est livré ; l’ingestion automatisée des factures/consommations fournisseur, la baseline déployée, les seuils chiffrés issus des pilotes et les objectifs effectivement atteints restent à prouver. T21 n’est pas clôturé par la seule présence de ce tableau.
