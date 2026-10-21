-- Ensure coach assignments cannot point to a team owned by another club.
DROP INDEX IF EXISTS "coach_assignments_team_id_idx";

ALTER TABLE "coach_assignments"
  DROP CONSTRAINT IF EXISTS "coach_assignments_team_id_fkey";

CREATE INDEX "coach_assignments_team_id_club_id_idx"
  ON "coach_assignments"("team_id", "club_id");

ALTER TABLE "coach_assignments"
  ADD CONSTRAINT "coach_assignments_team_id_club_id_fkey"
  FOREIGN KEY ("team_id", "club_id")
  REFERENCES "teams"("id", "club_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
