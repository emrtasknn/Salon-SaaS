import Link from "next/link";

/**
 * Top-left back link with a concrete target (standalone PWA has no browser back button).
 * Never relies on history.back() alone.
 */
export function BackLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={`focus-ring tap-target -ml-2 inline-flex items-center gap-1 rounded-control px-2 text-body font-medium text-ink hover:bg-surface-muted ${className}`}
    >
      <span aria-hidden="true" className="text-title leading-none">‹</span>
      <span>{label}</span>
    </Link>
  );
}
