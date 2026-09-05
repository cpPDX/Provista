import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/http';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../shell/ToastProvider';

interface HelpAboutPageProps {
  onStartTour: () => void;
}

interface CategoryMigrationResponse {
  message: string;
}

export function HelpAboutPage({ onStartTour }: HelpAboutPageProps) {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [migratingCategories, setMigratingCategories] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);

  const migrateCategories = async () => {
    if (migratingCategories) return;
    setMigratingCategories(true);
    setMigrationResult(null);
    try {
      const result = await apiFetch<CategoryMigrationResponse>('/api/admin/migrate-categories', { method: 'POST' });
      setMigrationResult(result.message);
      showToast(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Category migration failed';
      setMigrationResult(`Failed: ${message}`);
      showToast('Could not fix category names', { tone: 'error' });
    } finally {
      setMigratingCategories(false);
    }
  };

  return (
    <section className="more-page more-help-page" aria-labelledby="help-about-title">
      <header className="more-heading more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more')} aria-label="Back to More">
          <span aria-hidden="true">‹</span>
          More
        </button>
        <p className="more-eyebrow">Help &amp; About</p>
        <h1 id="help-about-title">Plan together. Shop with clarity.</h1>
        <p>Provista helps your household plan meals, shop, and keep Pantry in sync.</p>
      </header>

      <div className="more-help-stack">
        <article className="more-help-card">
          <div className="more-help-brand" aria-hidden="true">
            <img src="/brand/provista-mark.svg" width="56" height="56" alt="" />
          </div>
          <h2>How Provista works</h2>
          <p>
            Think of Provista as one household workflow: <strong>Home → Plan → List → Shop → Pantry</strong>.
            Home shows what needs attention, Plan helps decide meals, List collects what you need, and finishing a shopping stop updates the household history behind the scenes.
          </p>
          <button type="button" className="shell-button shell-button-secondary more-help-action" onClick={onStartTour}>
            Restart App Tour
          </button>
        </article>

        <article className="more-help-card">
          <h2>Shopping</h2>
          <ul>
            <li>Use rapid capture to add several groceries quickly.</li>
            <li>Use <strong>Add with details</strong> when you need quantity, store preference, or a new catalog item.</li>
            <li>Checking an item means <strong>I bought it</strong> and responds immediately.</li>
            <li>For prices, choose <strong>Use</strong>, <strong>Update price</strong>, or <strong>Later</strong>. A missing price never blocks shopping.</li>
            <li><strong>Finish shopping</strong> completes one store stop at a time, updates Spending and optional Pantry quantities, and removes only purchased items from the active list.</li>
            <li>If you choose Later, Home keeps the missing price available for review after the trip.</li>
          </ul>
        </article>

        <article className="more-help-card">
          <h2>Pantry</h2>
          <p>
            Pantry does not require perfect inventory. Use <strong>Simple tracking</strong> for Have, Running low, or Out.
            Use <strong>Exact tracking</strong> only when a number is useful; Provista can then mark an item low automatically from its threshold.
            Running low and Out items surface on Home and can be moved onto the shopping list.
          </p>
        </article>

        <article className="more-help-card">
          <h2>Prices &amp; Spending</h2>
          <p>
            Prices and Spending live under <strong>More → Insights</strong>. Household price history represents prices your household actually paid or confirmed.
            Open Prices observations are community-reported shopping context only; they do not become household Spending unless you confirm a purchase price.
          </p>
        </article>

        <article className="more-help-card">
          <h2>Household</h2>
          <p>
            Everyone in the household shares the meal plan, List, and routine Pantry activity. Owners and Admins manage household settings, stores, invites, and other administrative tools.
          </p>
        </article>

        <article className="more-help-card">
          <h2>Why the name?</h2>
          <p>
            <strong>Provista</strong> combines <em>provisions</em> - the food and essentials that keep a household moving - with <em>vista</em>, a clear view of what lies ahead.
            It brings meals, shopping, Pantry, and spending into one shared view.
          </p>
        </article>

        <article className="more-help-card">
          <h2>About Provista</h2>
          <p>
            Provista is a household grocery planning and shopping assistant built for busy families. Meal planning, the shared List, Pantry, prices, and Spending work together so the household can see what is next and shop with confidence.
          </p>
          <p className="more-help-credit">Created by Chris Phelan</p>
          <p>Built for our household. Shared with yours.</p>
        </article>

        {isAdmin && (
          <article className="more-help-card">
            <h2>Data Maintenance</h2>
            <p>Normalize legacy category names, such as Dry to Pantry, from older CSV imports.</p>
            <button
              type="button"
              className="shell-button shell-button-secondary more-help-action"
              onClick={() => void migrateCategories()}
              disabled={migratingCategories}
            >
              {migratingCategories ? 'Fixing…' : 'Fix Category Names'}
            </button>
            {migrationResult && <p className="more-maintenance-result" role="status">{migrationResult}</p>}
          </article>
        )}
      </div>
    </section>
  );
}
