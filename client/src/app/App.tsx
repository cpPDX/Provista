const boundaries = [
  'The existing Express and Mongoose backend remains authoritative.',
  'The current authenticated application remains the production default.',
  'React features will replace legacy screens incrementally, not in a big-bang rewrite.',
  'Offline and PWA behavior must be preserved before legacy code is removed.'
];

export function App() {
  return (
    <main className="migration-preview">
      <section className="migration-card" aria-labelledby="migration-title">
        <p className="migration-eyebrow">PRO-50 · migration foundation</p>
        <h1 id="migration-title">React is running alongside Provista</h1>
        <p>
          This isolated preview proves the React, TypeScript, Vite, and TanStack Query toolchain without taking ownership of any production workflow yet.
        </p>
        <ul>
          {boundaries.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
        <a className="migration-link" href="/app">Return to the current Provista app</a>
      </section>
    </main>
  );
}
