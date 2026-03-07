interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div style={{
      padding: "20px 28px 16px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      flexShrink: 0,
      background: "var(--bg-1)",
    }}>
      <div>
        <h1 style={{
          fontFamily: "var(--font-display)",
          fontSize: "22px",
          fontWeight: 800,
          color: "var(--text-primary)",
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}>{title}</h1>
        {subtitle && (
          <p style={{
            fontFamily: "var(--font-body)",
            fontStyle: "italic",
            fontSize: "14px",
            color: "var(--text-secondary)",
            marginTop: "4px",
          }}>{subtitle}</p>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>{actions}</div>}
    </div>
  );
}
