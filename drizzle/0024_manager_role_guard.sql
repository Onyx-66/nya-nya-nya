DROP TRIGGER IF EXISTS `users_role_insert_guard_v12`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `users_role_update_guard_v12`;--> statement-breakpoint
CREATE TRIGGER `users_role_insert_guard_v12`
BEFORE INSERT ON `users`
WHEN NEW.`primary_role` NOT IN
  (
    'OWNER',
    'ADMINISTRATOR',
    'MANAGER',
    'MODERATOR',
    'TEAM_LEADER',
    'UPLOADER',
    'USER'
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_user_role');
END;--> statement-breakpoint
CREATE TRIGGER `users_role_update_guard_v12`
BEFORE UPDATE OF `primary_role` ON `users`
WHEN NEW.`primary_role` NOT IN
  (
    'OWNER',
    'ADMINISTRATOR',
    'MANAGER',
    'MODERATOR',
    'TEAM_LEADER',
    'UPLOADER',
    'USER'
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_user_role');
END;
