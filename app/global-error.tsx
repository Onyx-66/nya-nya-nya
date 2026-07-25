"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="fatal-error">
        <main>
          <p className="status-code">500</p>
          <h1>The panel slipped out of place.</h1>
          <p>We could not finish this request. Your reading progress is safe.</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
          <a href="/">Return home</a>
        </main>
      </body>
    </html>
  );
}
