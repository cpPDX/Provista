import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ShellErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React shell failed', error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="shell-state">
          <section className="shell-state-card">
            <h1>Provista could not load this view</h1>
            <p>The existing application is still available while the React migration is in progress.</p>
            <a className="shell-button shell-button-primary shell-link-button" href="/app">Open Provista</a>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
