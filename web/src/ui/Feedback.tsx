import type { ReactNode } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { ApiError, errorMessage } from "../api/client";
import { getIllustration } from "../lib/illustrations";
import { IllustrationCard } from "./IllustrationCard";

export function Skeleton({ lines = 3, height = 18 }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton-block" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${100 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="stack" role="status" aria-live="polite" aria-label="Wird geladen">
      <span className="sr-only">Wird geladen …</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card" aria-hidden="true">
          <div className="skeleton" style={{ height: 16, width: "46%" }} />
          <div className="skeleton" style={{ height: 14, width: "78%", marginTop: 12 }} />
          <div className="skeleton" style={{ height: 14, width: "32%", marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <span className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({
  icon = "info",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {children ? <p className="muted">{children}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "Das hat nicht geklappt",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const offline = error instanceof ApiError && error.status === 0;
  return (
    <div className="empty empty--error" role="alert">
      {getIllustration(offline ? "offline" : "error") ? (
        <IllustrationCard id={offline ? "offline" : "error"} decorative compact />
      ) : (
        <div className="empty__icon empty__icon--error">
          <Icon name="alert" size={28} />
        </div>
      )}
      <h3>{title}</h3>
      <p className="muted">{errorMessage(error)}</p>
      {onRetry ? (
        <div className="empty__action">
          <Button icon="refresh" onClick={onRetry}>
            Erneut versuchen
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function Banner({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: ReactNode;
  action?: ReactNode;
}) {
  const icon: IconName = tone === "error" || tone === "warn" ? "alert" : tone === "success" ? "check-circle" : "info";
  return (
    <div className={`banner banner--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size={18} />
      <div className="banner__text">{children}</div>
      {action}
    </div>
  );
}
