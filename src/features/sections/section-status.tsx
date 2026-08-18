interface SectionStatusProps {
  title: string;
  serverName: string;
  description: string;
}

export function SectionStatus({ title, serverName, description }: SectionStatusProps) {
  return (
    <article className="section-status panel">
      <header className="section-status__header">
        <div>
          <p className="eyebrow">{serverName}</p>
          <h1>{title}</h1>
          <p className="section-status__description">{description}</p>
        </div>
        <span className="status-badge status-badge--planned">Planned</span>
      </header>
      <div className="empty-state">
        <span className="empty-state__mark" aria-hidden="true">◆</span>
        <h2>Planned vertical slice</h2>
        <p>
          This destination is part of the product structure, but its normalized data contract
          and adapter have not shipped yet. No telemetry is being inferred or fabricated.
        </p>
      </div>
    </article>
  );
}
