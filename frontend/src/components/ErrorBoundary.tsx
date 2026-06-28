"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 px-5 text-center">
          <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-error)" }}>error_outline</span>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-on-surface)" }}>Something went wrong</p>
          <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", maxWidth: 280 }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 px-5 py-2.5 rounded-xl font-medium"
            style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)", fontSize: 14 }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
