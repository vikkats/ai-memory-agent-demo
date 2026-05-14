export function CheckInPanel() {
  return (
    <section className="card checkin-card">
      <div className="section-heading">
        <p className="eyebrow">Background autonomy</p>
        <h2>Scheduled check-ins</h2>
      </div>

      <div className="checkin-box">
        <div>
          <strong>Next evaluation</strong>
          <p>In 60 minutes, the agent can decide whether to send a check-in, save a note, or do nothing.</p>
        </div>
        <span className="status-pill">Reviewable</span>
      </div>

      <ul className="feature-list">
        <li>Cooldowns prevent noisy outreach.</li>
        <li>Every background action is logged.</li>
        <li>Users can disable or adjust autonomy at any time.</li>
      </ul>
    </section>
  );
}
