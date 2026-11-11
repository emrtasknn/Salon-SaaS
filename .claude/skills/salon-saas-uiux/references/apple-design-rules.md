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
- [ ] UI text: Inter (`font-sans`, self-hosted by `next/font`), system stack as fallback.
- [ ] Display: Fraunces (`font-display`, self-hosted by `next/font`) for page titles and large numerals only. `text-title` and `text-large-title` already use it; never set it below 22px, and never on buttons, fields, tables or times. A smaller label inside a title element takes `font-sans`. Italic only in the logo and short confirmation lines.
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
- [ ] RandevuN palette "Çam & Lila" (owner 2026-11-11; replaces the 2026-11-06 navy set). Mist `canvas` (#F6F6FA), pine `action` (#1F3B38) for primary buttons and selected segments; in the dark theme the canvas is night pine (#0B1413) and `action` is lilac (#DCDCF8) with dark text. Lilac `tint` + `on-tint` for soft highlights (selected tab, row icon tiles, avatars). `brand` + `on-brand` are the pine tile, identical in both themes: logo mark and at most one brand-filled card per screen. Steel blue (#B0C4DE) is reserved for decoration and has no token until it is first used; never text.
- [ ] Emerald `accent` only for confirmation moments (final booking CTA = `<Button variant="accent">`, selected time slot, success feedback) and the logo dot; at most one accent button per screen; text on it is always `on-accent` (dark, never white). Emerald text/icons use `accent-ink`; selected tints use `accent-soft` + `on-accent-soft`. `status-confirmed` stays a separate, deeper green.

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
- [ ] Text on glass ≥4.5:1 against the worst-case background (black content scrolled beneath). Light: 82% canvas (#F6F6FA) glass gives `ink` ≈10.2:1 and `ink-muted` ≈4.8:1 over black content. Dark: 90% surface (#121E1D) glass gives `ink` 11.7:1 and `ink-muted` 5.6:1 over white content. Do not lower either opacity without re-running `src/app/_ui/theme-contrast.test.ts`.

### Motion
- [ ] Animate only `transform` and `opacity` (color/background transitions on press are acceptable). Never `transition: all`; list exact properties.
- [ ] Popovers/dropdowns ≤300ms, ease-out (never ease-in), `transform-origin` at the trigger. Modals open centered.
- [ ] Tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; durations `--duration-fast` 150ms, `--duration-base` 200ms, `--duration-slow` 300ms.
- [ ] `prefers-reduced-motion: reduce` disables non-essential motion (the `pressable` scale is removed).
- [ ] Selection indicators slide, they do not jump: the tab-bar pill (`app-nav.tsx`) and the calendar view thumb (`ViewSwitch`) are one shared `motion` element (`layoutId`) on a short spring. The tab pill moves on tap, before the new page arrives (`shownNavHref`).
- [ ] Theme switch opens the new theme as a circle from the toggle (`theme-reveal.ts`, View Transitions API; instant where unsupported or with reduced motion). Do not start other view transitions without checking the global `::view-transition-*` rule in `globals.css`.
- [ ] Confirmation moment: `<SuccessMark>` (accent disc, drawn tick, one ring). The only place the tick draw animates a stroke; use it once per confirmed outcome, next to the heading that states it.
- [ ] Motion never carries information alone: every animated state is also complete at rest.

### Logo
- [ ] Use `Wordmark` / `LogoMark` from `src/components/ui/logo.tsx` (generated outlines; no font needed). Never retype the name as styled text in place of the logo.
- [ ] Letters and N share one colour (`currentColor`); only the dot is coloured, always `accent`.
- [ ] Clear space: at least half the N's height. Below 24px use `LogoMark`; the 16px favicon has no dot.
- [ ] Icon files in `public/icons/` and `src/app/favicon.ico` are generated from the same outlines; regenerate them together, never edit one by hand.

### Do not
- [ ] Do not change server actions, data loaders, auth, tenant resolution, RLS or booking semantics for visual reasons.
- [ ] Do not change legal notice text or make the WhatsApp opt-in pre-checked/required.
- [ ] Dark mode comes only from the token overrides in `globals.css` (system default + `data-theme` toggle). Never use `dark:` variants or raw palette classes (`zinc-*`, `bg-white`, `text-black`) in components; `theme-contrast.test.ts` must stay green.
