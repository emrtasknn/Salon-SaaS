# W10 Design System, Accessibility and QA

## Semantic tokens
Use intent tokens such as:
surface.default, surface.raised, text.primary, text.muted, action.primary, action.destructive, focus.default, status.pending, status.confirmed, status.rejected, status.cancelled, status.completed.

## Interaction states
default, hover, focus, active/pressed, disabled, loading, error, success, selected where applicable.

## Responsive
Validate 320, 390, 414, 768, 1024, 1280+.
Prioritize calendar density, staff actions, booking forms and navigation.

## Accessibility
Semantic HTML, keyboard navigation, visible focus, accessible names, form/error association, non-color-only status, adequate contrast, 44x44 touch targets, reduced-motion support.

## Anti-slop
Reject generic dashboard grids, fake metrics, arbitrary gradients, excessive containers/shadows, uniform typography without hierarchy, unexplained badges, decorative UI competing with operational tasks.

## QA verdict
PASS / FAIL / BLOCKED.
BLOCKED when domain/backend/security/product contract is unresolved.
