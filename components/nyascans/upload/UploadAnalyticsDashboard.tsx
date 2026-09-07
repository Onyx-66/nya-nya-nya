"use client";

import { useEffect, useRef, useState } from "react";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";

type Analytics = {
  days: number;
  teams: Array<{ id: string; name: string }>;
  summary: { uniqueViewers: number; seriesViews: number; chapterViews: number; chapterCompletions: number; seriesCount: number; comments: number };
  timeline: Array<{ day: string; seriesViews: number; chapterViews: number }>;
  topSeries: Array<{ slug: string; title: string; views: number; seriesViews: number; chapterViews: number }>;
  topChapters: Array<{ seriesSlug: string; seriesTitle: string; chapterSlug: string; chapterNumber: string; views: number }>;
  topComments: Array<{ id: string; seriesSlug: string; chapterSlug: string | null; seriesTitle: string; body: string; author: string; reactions: number; spoiler: number }>;
};
const count = (value: number) => Number(value || 0).toLocaleString();
const titleLink = (slug: string) => `/title/${encodeURIComponent(slug)}`;

export function UploadAnalyticsDashboard({ canUpload, canRequestSeries }: { canUpload: boolean; canRequestSeries: boolean }) {
  const chartRef = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(780);
  const [days, setDays] = useState("30");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch(`/api/v1/upload-analytics?days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Analytics & { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "Your analytics could not be loaded.");
        if (!controller.signal.aborted) setData(payload);
      }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, revision]);
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const resize = () => setChartWidth(Math.max(280, Math.round(chart.clientWidth)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chart);
    return () => observer.disconnect();
  }, [data, loading]);
  const plotEnd = chartWidth - 32;
  const maximum = Math.max(1, ...data?.timeline.flatMap((day) => [day.seriesViews, day.chapterViews]) ?? []);
  const points = (key: "seriesViews" | "chapterViews") => data?.timeline.map((day, index) => `${48 + index * (chartWidth - 80) / Math.max(1, data.timeline.length - 1)},${220 - day[key] / maximum * 180}`).join(" ");
  return <section className="upload-analytics-dashboard" aria-busy={loading}>
    <header className="upload-analytics-heading"><div><h2>Your publishing analytics</h2><p>Reading and discussion across your teams’ series and your published contributions.</p></div>
      <div className="upload-analytics-filters"><UnifiedSingleSelect value={days} aria-label="Analytics period" onChange={(event) => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></UnifiedSingleSelect><button type="button" className="button button-secondary" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
    </header>
    <nav className="upload-analytics-actions" aria-label="Publishing actions">
      {canRequestSeries ? <a className="button button-primary" href="/dashboard/upload-center/add-series">Create new series</a> : null}
      {canUpload ? <><a className="button button-secondary" href="/dashboard/upload-center/single">Upload a chapter</a><a className="button button-secondary" href="/dashboard/upload-center/multi">Upload a batch</a></> : null}
    </nav>
    {error ? <p className="upload-alert is-error" role="alert">{error}</p> : loading ? <p role="status">Loading your analytics…</p> : data ? <>
      <p className="upload-analytics-scope">{count(data.summary.seriesCount)} related series · {data.teams.length ? data.teams.map((team) => team.name).join(", ") : "Your published contributions"}</p>
      <div className="upload-analytics-metrics">{([
        ["Total views", data.summary.seriesViews + data.summary.chapterViews], ["Series views", data.summary.seriesViews],
        ["Chapter views", data.summary.chapterViews], ["Unique readers", data.summary.uniqueViewers],
        ["Chapters finished", data.summary.chapterCompletions], ["Comments", data.summary.comments],
      ] as const).map(([label, value]) => <article key={label}><span>{label}</span><strong>{count(value)}</strong></article>)}</div>
      <section className="upload-analytics-card"><header><h3>Reading activity</h3><div className="analytics-legend"><span className="series">Series views</span><span className="chapters">Chapter views</span></div></header>
        {data.summary.seriesViews + data.summary.chapterViews ? <>
          <svg ref={chartRef} className="upload-trend-chart" viewBox={`0 0 ${chartWidth} 260`} role="img" aria-label={`Daily series and chapter views over the last ${data.days} days`}>
            {[0, .5, 1].map((part) => <g key={part}><line x1="48" x2={plotEnd} y1={220 - part * 180} y2={220 - part * 180} className="chart-grid" /><text x="40" y={225 - part * 180} textAnchor="end">{count(Math.round(maximum * part))}</text></g>)}
            <polyline points={points("seriesViews")} className="chart-line series" /><polyline points={points("chapterViews")} className="chart-line chapters" />
            <text x="48" y="250">{data.timeline[0]?.day}</text><text x={plotEnd} y="250" textAnchor="end">{data.timeline.at(-1)?.day}</text>
          </svg>
          <details className="analytics-data-table"><summary>View daily values</summary><div><table><thead><tr><th>Date</th><th>Series views</th><th>Chapter views</th></tr></thead><tbody>{data.timeline.map((day) => <tr key={day.day}><td>{day.day}</td><td>{count(day.seriesViews)}</td><td>{count(day.chapterViews)}</td></tr>)}</tbody></table></div></details>
        </> : <p className="analytics-empty">No reading activity in this period. Views will appear when readers open your related series and chapters.</p>}
      </section>
      <div className="upload-analytics-columns"><section className="upload-analytics-card"><h3>Top series</h3><p>Series and chapter views combined</p>
        {data.topSeries.length ? <ol className="analytics-ranking">{data.topSeries.map((series) => <li key={series.slug}><a href={titleLink(series.slug)}>{series.title}</a><strong>{count(series.views)}</strong><div className="analytics-bar"><span style={{ width: `${series.views / Math.max(1, data.topSeries[0].views) * 100}%` }} /></div><small>{count(series.seriesViews)} series · {count(series.chapterViews)} chapter views</small></li>)}</ol> : <p className="analytics-empty">No series views yet.</p>}
      </section><section className="upload-analytics-card"><h3>Top chapters</h3><p>Most opened chapters in your related series</p>
        {data.topChapters.length ? <ol className="analytics-ranking">{data.topChapters.map((chapter) => <li key={`${chapter.seriesSlug}:${chapter.chapterSlug}`}><a href={`${titleLink(chapter.seriesSlug)}/chapter/${encodeURIComponent(chapter.chapterSlug)}`}>{chapter.seriesTitle}<small>Chapter {chapter.chapterNumber}</small></a><strong>{count(chapter.views)}</strong><div className="analytics-bar chapters"><span style={{ width: `${chapter.views / Math.max(1, data.topChapters[0].views) * 100}%` }} /></div></li>)}</ol> : <p className="analytics-empty">No chapter views yet.</p>}
      </section></div>
      <section className="upload-analytics-card"><h3>Top comments</h3><p>Most reacted visible comments posted during this period</p><div className="analytics-comments">
        {data.topComments.length ? data.topComments.map((comment) => <article key={comment.id}><header><a href={`${titleLink(comment.seriesSlug)}${comment.chapterSlug ? `/chapter/${encodeURIComponent(comment.chapterSlug)}` : ""}#comment-${encodeURIComponent(comment.id)}`}>{comment.seriesTitle}</a><span>{count(comment.reactions)} reactions</span></header>{comment.spoiler ? <details><summary>Spoiler — show comment</summary><p>{comment.body}</p></details> : <p>{comment.body}</p>}<small>{comment.author}</small></article>) : <p className="analytics-empty">No comments in this period.</p>}
      </div></section>
    </> : null}
  </section>;
}
