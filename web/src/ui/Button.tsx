import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "glass";
type Size = "m" | "s";

type Common = {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  busy?: boolean;
  children?: ReactNode;
};

const cls = (v: Variant, s: Size, extra?: string) => `btn btn--${v} btn--${s}${extra ? ` ${extra}` : ""}`;

export const Button = forwardRef<HTMLButtonElement, Common & ButtonHTMLAttributes<HTMLButtonElement>>(
  function Button({ variant = "secondary", size = "m", icon, busy, children, className, disabled, type, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cls(variant, size, className)}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...rest}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === "s" ? 16 : 18} /> : null}
        {children ? <span>{children}</span> : null}
      </button>
    );
  }
);

export function LinkButton({
  variant = "secondary",
  size = "m",
  icon,
  children,
  className,
  ...rest
}: Common & LinkProps) {
  return (
    <Link className={cls(variant, size, className)} {...rest}>
      {icon ? <Icon name={icon} size={size === "s" ? 16 : 18} /> : null}
      {children ? <span>{children}</span> : null}
    </Link>
  );
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  { icon: IconName; label: string; variant?: Variant; size?: Size } & ButtonHTMLAttributes<HTMLButtonElement>
>(function IconButton({ icon, label, variant = "ghost", size = "m", className, type, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={`btn btn--${variant} btn--${size} btn--icon${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === "s" ? 16 : 20} />
    </button>
  );
});
