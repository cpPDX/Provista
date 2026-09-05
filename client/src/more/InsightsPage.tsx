import { Link, useNavigate } from 'react-router-dom';
import './more.css';
import './insights.css';

export function InsightsPage() {
  const navigate = useNavigate();

  return (
    <section className="more-page" aria-labelledby="insights-title">
      <header className="more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more')}>
          <span aria-hidden="true">←</span> More
        </button>
        <p className="more-eyebrow">Household insights</p>
        <h1 id="insights-title">Insights</h1>
        <p>Review what your household has paid and where grocery spending is going without leaving the Provista workflow.</p>
      </header>

      <div className="more-grid more-insights-grid">
        <Link className="more-card" to="/app/more/insights/prices">
          <span className="more-card-icon" aria-hidden="true">$</span>
          <span className="more-card-copy">
            <strong>Price history</strong>
            <small>Search confirmed household prices, compare recent purchases, and record a price.</small>
          </span>
          <span className="more-card-arrow" aria-hidden="true">→</span>
        </Link>

        <Link className="more-card" to="/app/more/insights/spending">
          <span className="more-card-icon" aria-hidden="true">↗</span>
          <span className="more-card-copy">
            <strong>Spending</strong>
            <small>Review monthly totals and drill into category or store purchases.</small>
          </span>
          <span className="more-card-arrow" aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
