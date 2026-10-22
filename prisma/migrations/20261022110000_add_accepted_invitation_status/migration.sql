-- Distinguish accepted invitations from pending and explicitly disrupted ones.
ALTER TYPE "ENInvitationStatus" ADD VALUE 'ACCEPTED';
