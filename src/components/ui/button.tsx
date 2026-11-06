import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ComponentType, ReactNode, Ref } from "react";
import { LoaderCircle } from "lucide-react";
import { cx } from "@/lib/utils";

/*
 * Button / ButtonLink — adapted from BoardUI's Button (MIT, https://www.boardui.com/components/button).
 * Same API shape (variant, size, leadingIcon/trailingIcon as component refs, iconOnly), restyled with
 * RandevuN tokens (globals.css): 44px touch target at the default size, Apple-style press scale.
 * Presentation only.
 */

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "danger-outline";
export type ButtonSize = "medium" | "small";

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false"; strokeWidth?: number }>;

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  children?: ReactNode;
};

const styles = {
  base:
    "pressable focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap select-none rounded-control disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
  size: {
    medium: "min-h-11 min-w-11 px-4 py-2.5 text-subhead font-semibold",
    // Compact look (36px) with an invisible 4px hit-area extension on every side, so the
    // touch target is 44px (Apple HIG) without growing dense toolbars and lists.
    small:
      "relative min-h-9 min-w-9 px-3 py-1.5 text-footnote font-semibold after:absolute after:-inset-1 after:content-['']",
  },
  iconOnlySize: {
    medium: "size-11 p-0",
    small: "size-9 p-0",
  },
  icon: {
    medium: "size-5 shrink-0",
    small: "size-4 shrink-0",
  },
  variant: {
    primary: "bg-action text-on-action shadow-card hover:bg-action-hover",
    // Confirmation moment only (e.g. final booking submit); at most one per screen. Label is navy.
    accent: "bg-accent text-on-accent shadow-card hover:bg-accent-hover",
    secondary: "border border-separator bg-surface text-ink shadow-card hover:bg-surface-muted",
    ghost: "text-ink hover:bg-surface-muted",
    danger: "bg-destructive text-on-action shadow-card hover:bg-destructive-hover",
    "danger-outline": "border border-destructive/40 bg-surface text-destructive hover:bg-status-rejected-bg",
  },
} as const;

/** Class string for a button look; use when a third-party element must look like a Button. */
export function buttonClassName({
  variant = "primary",
  size = "medium",
  iconOnly = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; className?: string } = {}) {
  // Filled primary/danger actions keep the larger iOS body label at the default size.
  const prominent = size === "medium" && (variant === "primary" || variant === "accent" || variant === "danger") && "px-5 py-3 text-body";
  return cx(styles.base, styles.size[size], prominent, styles.variant[variant], iconOnly && styles.iconOnlySize[size], className);
}

function Content({
  size = "medium",
  iconOnly,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  pending,
  children,
}: CommonProps & { pending?: boolean }) {
  const iconClass = styles.icon[size];
  return (
    <>
      {pending ? (
        <LoaderCircle className={cx(iconClass, "animate-spin motion-reduce:animate-none")} aria-hidden />
      ) : Leading ? (
        <Leading className={iconClass} aria-hidden strokeWidth={2} />
      ) : null}
      {!iconOnly && children}
      {!iconOnly && Trailing ? <Trailing className={iconClass} aria-hidden strokeWidth={2} /> : null}
    </>
  );
}

export interface ButtonProps extends CommonProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Shows a spinner, sets aria-busy and disables the button. */
  pending?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant,
  size,
  iconOnly = false,
  leadingIcon,
  trailingIcon,
  pending = false,
  children,
  className,
  type = "button",
  disabled,
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClassName({ variant, size, iconOnly, className })}
      {...props}
    >
      <Content size={size} iconOnly={iconOnly} leadingIcon={leadingIcon} trailingIcon={trailingIcon} pending={pending}>
        {children}
      </Content>
    </button>
  );
}

export interface ButtonLinkProps extends CommonProps, Omit<ComponentProps<typeof Link>, "children" | "className"> {
  className?: string;
}

/** Navigational counterpart (Next.js Link). */
export function ButtonLink({ variant, size, iconOnly = false, leadingIcon, trailingIcon, children, className, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size, iconOnly, className })} {...props}>
      <Content size={size} iconOnly={iconOnly} leadingIcon={leadingIcon} trailingIcon={trailingIcon}>
        {children}
      </Content>
    </Link>
  );
}

/** Plain <a> counterpart for external URLs (tel:, https:, wa.me). */
export function ButtonAnchor({
  variant,
  size,
  iconOnly = false,
  leadingIcon,
  trailingIcon,
  children,
  className,
  ...props
}: CommonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">) {
  return (
    <a className={buttonClassName({ variant, size, iconOnly, className })} {...props}>
      <Content size={size} iconOnly={iconOnly} leadingIcon={leadingIcon} trailingIcon={trailingIcon}>
        {children}
      </Content>
    </a>
  );
}
