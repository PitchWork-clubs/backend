-- Membership permission overrides are scoped to the role scope they modify.
ALTER TABLE "membership_permissions"
  ADD COLUMN "scope" "ENScopeType" NOT NULL DEFAULT 'CLUB',
  ADD COLUMN "scope_id" TEXT NOT NULL DEFAULT '';

ALTER TABLE "membership_permissions"
  DROP CONSTRAINT IF EXISTS "membership_permissions_membership_id_permission_id_key";

CREATE UNIQUE INDEX "membership_permissions_membership_id_permission_id_scope_scope_id_key"
  ON "membership_permissions"("membership_id", "permission_id", "scope", "scope_id");

CREATE INDEX "membership_permissions_membership_id_scope_scope_id_idx"
  ON "membership_permissions"("membership_id", "scope", "scope_id");
