"use client";

// Must be statically exported so the service worker can pre-cache it at install time
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "0 24px",
        textAlign: "center",
        background: "var(--color-background, #fcf8ff)",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-surface-container, #ece6f0)",
          fontSize: 36,
        }}
      >
        📵
      </div>
      <p style={{ fontSize: 20, fontWeight: 700, color: "var(--color-on-background, #1c1b1f)", margin: 0 }}>
        You&apos;re offline
      </p>
      <p style={{ fontSize: 15, color: "var(--color-on-surface-variant, #49454f)", margin: 0, maxWidth: 280 }}>
        No internet connection. Open the app while online at least once to enable offline access.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8,
          padding: "12px 28px",
          borderRadius: 24,
          border: "none",
          background: "#1f108e",
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
