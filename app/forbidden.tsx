import { LockKey } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="access-page">
      <section>
        <span className="access-icon">
          <LockKey size={30} />
        </span>
        <h1>Access denied</h1>
        <p>
          This administrative area requires a higher permission level. Your
          account remains signed in, but the requested data was not disclosed.
        </p>
        <Link className="button button-primary" href="/">
          Return to NyaScans
        </Link>
      </section>
    </main>
  );
}
