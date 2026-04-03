interface HeaderProps {
  lastFetch: string | null;
  onRefresh: () => void;
}

function formatLastFetch(iso: string | null): string {
  if (!iso) return "Never fetched";
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function Header({ lastFetch, onRefresh }: HeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1rem 1rem 0.5rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
        Surf Pacitan
      </h1>

      <button
        onClick={onRefresh}
        title="Refresh forecast"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          color: "var(--text-dim)",
          fontSize: "0.75rem",
          padding: "0.35rem 0.65rem",
          cursor: "pointer",
          lineHeight: 1.3,
        }}
      >
        {lastFetch ? `Updated ${formatLastFetch(lastFetch)}` : "Refresh"}
      </button>
    </header>
  );
}
