// This scope is intentionally identical for uploaders and administrators.
// It is derived from current memberships and published personal contributions.
export const uploadAnalyticsScope = `WITH active_teams AS (
  SELECT DISTINCT t.id, t.name FROM teams t
  JOIN team_memberships tm ON tm.team_id = t.id
  WHERE tm.user_id = ? AND tm.status = 'ACTIVE'
    AND t.is_archived = 0 AND t.verification_status <> 'SUSPENDED'
), related_series AS (
  SELECT sta.series_id FROM series_team_assignments sta
  JOIN active_teams t ON t.id = sta.team_id WHERE sta.revoked_at IS NULL
  UNION
  SELECT c.series_id FROM chapters c JOIN active_teams t ON t.id = c.team_id
  WHERE c.state = 'PUBLISHED'
  UNION
  SELECT c.series_id FROM chapters c WHERE c.uploader_user_id = ? AND c.state = 'PUBLISHED'
), scoped_series AS (
  SELECT s.id, s.slug, s.title FROM series s
  JOIN related_series r ON r.series_id = s.id WHERE s.archived_at IS NULL
)`;

export async function readUploadAnalytics(db: D1Database, userId: string, days: number, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - days * 86_400_000);
  const from = start.toISOString(); const to = end.toISOString();
  const prepare = (query: string, timed = true) => db.prepare(`${uploadAnalyticsScope} ${query}`)
    .bind(userId, userId, ...(timed ? [from, to] : []));
  const [teams, summary, timeline, topSeries, topChapters, topComments, comments] = await db.batch([
    prepare("SELECT id, name FROM active_teams ORDER BY name COLLATE NOCASE", false),
    prepare(`SELECT COUNT(DISTINCT ae.session_id) AS uniqueViewers,
      COALESCE(SUM(ae.event_type = 'SERIES_VIEW'), 0) AS seriesViews,
      COALESCE(SUM(ae.event_type = 'CHAPTER_START'), 0) AS chapterViews,
      COALESCE(SUM(ae.event_type = 'CHAPTER_COMPLETE'), 0) AS chapterCompletions,
      (SELECT COUNT(*) FROM scoped_series) AS seriesCount
      FROM analytics_events ae JOIN scoped_series s ON s.slug = ae.series_slug
      WHERE ae.created_at >= datetime(?) AND ae.created_at < datetime(?)
        AND ae.event_type IN ('SERIES_VIEW', 'CHAPTER_START', 'CHAPTER_COMPLETE')`),
    prepare(`SELECT date(ae.created_at) AS day,
      SUM(ae.event_type = 'SERIES_VIEW') AS seriesViews,
      SUM(ae.event_type = 'CHAPTER_START') AS chapterViews
      FROM analytics_events ae JOIN scoped_series s ON s.slug = ae.series_slug
      WHERE ae.created_at >= datetime(?) AND ae.created_at < datetime(?)
        AND ae.event_type IN ('SERIES_VIEW', 'CHAPTER_START')
      GROUP BY day ORDER BY day`),
    prepare(`SELECT s.slug, s.title,
      SUM(ae.event_type = 'SERIES_VIEW') AS seriesViews,
      SUM(ae.event_type = 'CHAPTER_START') AS chapterViews, COUNT(*) AS views
      FROM analytics_events ae JOIN scoped_series s ON s.slug = ae.series_slug
      WHERE ae.created_at >= datetime(?) AND ae.created_at < datetime(?)
        AND ae.event_type IN ('SERIES_VIEW', 'CHAPTER_START')
      GROUP BY s.id ORDER BY views DESC, s.title LIMIT 8`),
    prepare(`SELECT s.slug AS seriesSlug, s.title AS seriesTitle, c.slug AS chapterSlug,
      c.chapter_number AS chapterNumber, COUNT(*) AS views
      FROM analytics_events ae JOIN scoped_series s ON s.slug = ae.series_slug
      JOIN chapters c ON c.series_id = s.id AND c.slug = ae.chapter_slug
      WHERE ae.created_at >= datetime(?) AND ae.created_at < datetime(?)
        AND ae.event_type = 'CHAPTER_START'
      GROUP BY c.id ORDER BY views DESC, s.title, c.chapter_number LIMIT 8`),
    prepare(`SELECT dc.id, dc.body, dc.spoiler, dc.chapter_slug AS chapterSlug, s.slug AS seriesSlug, s.title AS seriesTitle,
      u.display_name AS author, COUNT(dr.user_id) AS reactions
      FROM discussion_comments dc JOIN scoped_series s ON s.slug = dc.series_slug
      JOIN users u ON u.id = dc.user_id
      LEFT JOIN discussion_reactions dr ON dr.comment_id = dc.id
      WHERE dc.created_at >= datetime(?) AND dc.created_at < datetime(?)
        AND dc.moderation_status = 'VISIBLE' AND dc.deleted_at IS NULL
      GROUP BY dc.id ORDER BY reactions DESC, dc.created_at DESC LIMIT 5`),
    prepare(`SELECT COUNT(*) AS comments FROM discussion_comments dc
      JOIN scoped_series s ON s.slug = dc.series_slug
      WHERE dc.created_at >= datetime(?) AND dc.created_at < datetime(?)
        AND dc.moderation_status = 'VISIBLE' AND dc.deleted_at IS NULL`),
  ]);
  const records = timeline.results as Array<{ day: string; seriesViews: number; chapterViews: number }>;
  const byDay = new Map(records.map((entry) => [entry.day, entry]));
  return {
    days, startAt: from, endAt: to, teams: teams.results,
    summary: { ...(summary.results[0] as Record<string, number>), ...(comments.results[0] as Record<string, number>) },
    timeline: Array.from({ length: days }, (_, index) => {
      const day = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10);
      return byDay.get(day) ?? { day, seriesViews: 0, chapterViews: 0 };
    }),
    topSeries: topSeries.results, topChapters: topChapters.results, topComments: topComments.results,
  };
}
