UPDATE `chapters`
   SET `title` = RTRIM(
     SUBSTR(`title`, 1, INSTR(LOWER(`title`), 'revised release') - 1),
     ' ·—–-'
   )
 WHERE `id` LIKE 'fixture_v2_%'
   AND INSTR(LOWER(`title`), 'revised release') > 0;
