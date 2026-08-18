import Link from "next/link";

export default function NotFound() {
  return (
    <section className="panel unavailable-state">
      <p className="eyebrow">404</p>
      <h1>Destination not found</h1>
      <p>This route is not part of the Control Center surface.</p>
      <Link className="text-link" href="/">Return to overview</Link>
    </section>
  );
}
