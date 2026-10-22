-- Each user may have at most one primary login identifier.
CREATE UNIQUE INDEX "user_identifiers_one_primary_per_user"
ON "user_identifiers" ("user_id")
WHERE "is_primary" = true;
