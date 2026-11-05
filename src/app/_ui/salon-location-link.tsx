// Public salon location link. Presentation only: `directionsUrl` is computed and allowlisted on
// the server (src/domain/tenant.ts salonDirectionsUrl); this component never builds URLs.

export type SalonLocationView = Readonly<{ address: string | null; directionsUrl: string }>;

function MapPinIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0 text-ink-muted"
    >
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function SalonLocationLink({ location, className = "" }: { location: SalonLocationView; className?: string }) {
  return (
    <a
      href={location.directionsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`pressable focus-ring tap-target inline-flex max-w-full items-start gap-2 rounded-control py-2.5 text-left hover:opacity-80 ${className}`}
    >
      <MapPinIcon />
      <span className="min-w-0">
        {location.address && <span className="block text-subhead text-ink break-words">{location.address}</span>}
        <span className="block text-subhead font-semibold text-focus underline underline-offset-2">Yol tarifi al</span>
        <span className="sr-only"> (haritada, yeni sekmede açılır)</span>
      </span>
    </a>
  );
}
