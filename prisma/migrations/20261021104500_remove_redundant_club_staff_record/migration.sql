-- Staff records belong to memberships; clubs do not own a single staff record.
ALTER TABLE "clubs"
  DROP CONSTRAINT IF EXISTS "clubs_staffRecordId_fkey";

DROP INDEX IF EXISTS "clubs_staffRecordId_key";

ALTER TABLE "clubs"
  DROP COLUMN IF EXISTS "staffRecordId";
