-- DELETE ... WHERE id requires SELECT on its predicate column as well as DELETE.
-- Keep organization names, metadata and all other auth tables unavailable to the purge role.
GRANT SELECT ("id") ON TABLE "public"."auth_organizations" TO yodev_purge;
