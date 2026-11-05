# Apple-referenced design rules (PWA)

Owner decision 2026-11-05: the PWA takes Apple's design language as its visual reference.
These are **our own paraphrased rules**, not Apple text. Repository governance, security
boundaries and booking semantics still take precedence over anything here.

Tokens and utilities implementing these rules live in `src/app/globals.css` (`@theme`) and
`src/app/_ui/` (`styles.ts`, `app-bar.tsx`). Use them instead of raw values.

## Sources

- Apple Human Interface Guidelines — paraphrased numbers and principles only (no copied text or assets).
- emilkowalski/skills — MIT — motion/interaction rules.
- Reviewed and **skipped** (no new npm dependencies in this pass):
  - **lenis** — smooth-scroll hijacking breaks native mobile/iOS momentum scroll and assistive scrolling.
  - **liquid-glass-js** — WebGL + html2canvas; too heavy for a PWA, fragile on low-end phones. CSS `backdrop-filter` covers the look.
  - **GSAP** — CSS transitions cover the motion we need; not worth the bundle.
  - **react-bits** — MIT + Commons Clause; do not copy components until the owner confirms the license.

## Checklist

### Typography
- [ ] System font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif` (`font-sans`). No web font download.
- [ ] Body text 17px on mobile (`text-body`); dense desktop (≥1024px) may step to 16px. Never below 11px.
- [ ] Form controls ≥16px (we use 17px) so iOS Safari does not zoom on focus.
- [ ] Avoid light/thin weights for small text.
- [ ] Large headings use `letter-spacing: -0.02em` (`text-title`, `text-large-title`).
- [ ] Times, durations, phone numbers and counts use `tabular-nums`.
- [ ] Running text max ~65ch (`measure`).

### Color & contrast
- [ ] Text 4.5:1 minimum; 3:1 only for ≥18px or bold large text.
- [ ] Input borders and other essential UI boundaries ≥3:1 (`border-field-border`).
- [ ] Status is never color-only: every status badge carries a text label.
- [ ] Use semantic tokens (`ink`, `ink-muted`, `canvas`, `surface`, `action`, `destructive`, `status-*`), not raw palette classes, in new or touched code.

### Touch & interaction
- [ ] Touch targets 44×44px by default (`tap-target` / `min-h-11`); 28px is an absolute floor for secondary inline controls only.
- [ ] Visible keyboard focus on every control (`focus-ring`, blue `focus` token, 2px offset). Inside clipped groups use a negative offset.
- [ ] Press feedback: buttons `scale(0.97)` on `:active` (`pressable`); full-width list rows use a background highlight instead of scaling.
- [ ] Disabled controls keep their label and explain why nearby when not obvious.

### Layout
- [ ] iOS "inset grouped" lists for related rows (`inset-group` + `inset-row`): white rounded group on `canvas`, hairline separators inset from the leading edge, group label outside (`group-label`).
- [ ] One primary CTA per screen, full width on mobile (`buttonPrimary`).
- [ ] Continuous-feeling large radii: controls 12px, cards 16px, sheets 22px.
- [ ] Standalone PWA: `viewport-fit=cover`; sticky/fixed bars pad with `env(safe-area-inset-*)` (`safe-top`, bottom bars `max(0.5rem, env(safe-area-inset-bottom))`); body pads left/right insets.

### Glass material
- [ ] CSS only: `backdrop-filter` + `-webkit-backdrop-filter` (`glass` utility).
- [ ] Only on the floating functional layer: sticky top bar (`AppBar`), bottom bar/install banner, sheet/dialog backdrops. **Never** on content cards. **Never** glass on glass.
- [ ] Solid fallbacks: `@supports not (backdrop-filter…)`, `prefers-reduced-transparency: reduce`, `prefers-contrast: more`.
- [ ] Text on glass ≥4.5:1 against the worst-case background (black content scrolled beneath). Our 85% white glass gives `ink` ≈11:1 and `ink-muted` ≈4.7:1 in that case; do not lower the opacity without re-checking.

### Motion
- [ ] Animate only `transform` and `opacity` (color/background transitions on press are acceptable). Never `transition: all`; list exact properties.
- [ ] Popovers/dropdowns ≤300ms, ease-out (never ease-in), `transform-origin` at the trigger. Modals open centered.
- [ ] Tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; durations `--duration-fast` 150ms, `--duration-base` 200ms, `--duration-slow` 300ms.
- [ ] `prefers-reduced-motion: reduce` disables non-essential motion (the `pressable` scale is removed).

### Do not
- [ ] Do not change server actions, data loaders, auth, tenant resolution, RLS or booking semantics for visual reasons.
- [ ] Do not change legal notice text or make the WhatsApp opt-in pre-checked/required.
- [ ] Do not add a dark theme ad hoc; it needs its own token set and contrast pass.
