# UI/UX guide

Use an original “industrial telemetry” visual language: near-black canvas, layered graphite surfaces, orange emphasis, restrained cyan/green/warning signals, hairline panel borders, and tabular numeric typography. Do not copy Satisfactory logos, artwork, iconography, or exact UI layouts.

- Status always uses text/icon in addition to color.
- Text meets WCAG 2.2 AA contrast; controls and graphical objects meet non-text contrast.
- The shell reflows at 320 CSS px without page-level horizontal scrolling.
- Minimum pointer target is 24×24 CSS px, with 44×44 preferred for primary mobile actions.
- Keyboard focus is visible and not hidden under sticky chrome.
- Honor `prefers-reduced-motion`.
- Distinguish `loading`, valid `empty`, `stale`, and `unavailable` visually and semantically.
- Mobile nav exposes primary views and a complete More menu; tables become cards or intentional scroll regions.
