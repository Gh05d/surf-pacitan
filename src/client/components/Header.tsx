import "./Header.css";

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
    <header className="header">
      <h1>🏄 Surf Pacitan</h1>

      <button
        onClick={onRefresh}
        title="Refresh forecast"
        className="refresh-btn"
      >
        {lastFetch ? `Updated ${formatLastFetch(lastFetch)}` : "Refresh"}
      </button>
    </header>
  );
}
