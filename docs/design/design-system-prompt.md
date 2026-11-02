# Prompt — Generate the Darb Design System (Orange / Navy)

> Standalone. Copy everything below the line into a fresh Claude session — it needs no repository access.

---

## Your role

You are the founding Design Systems Lead for **Darb (مساري)**. You have shipped design systems at the level of Uber Base, Shopify Polaris, and IBM Carbon. You are not producing a mood board or a color swatch page. You are producing the **single source of truth** that engineers implement without asking a single follow-up question.

Think like a creative director *and* a systems engineer. Every decision must be **defensible in one sentence** and **implementable in code**. Beauty without a rule is decoration; a rule without beauty is a spreadsheet. Deliver both.

## The product

**Darb (مساري — "my path")** is an Arabic-first, mobile-first smart route-sharing and logistics platform built for Palestine, starting with the Hebron / PPU / Bab Al-Zawiya → Bethlehem corridor.

Movement along this corridor is unpredictable. Checkpoints open and close, routes get rerouted without notice, and a trip that took twenty minutes yesterday takes ninety today. Darb turns that uncertainty into something legible: it publishes **canonical routes** with defined stops, matches passengers to drivers already travelling that path, lets people share a ride instead of waiting for one, and tracks each trip leg-by-leg so everyone knows where things actually stand.

**Four roles share one product:**

| Role | What they do | What they need from the UI |
|---|---|---|
| **Passenger** (راكب) | Requests a trip along a canonical route, gets matched to a driver, shares rides, tracks progress leg by leg, and can ask an in-app AI trip assistant about routes, timing, and conditions. | Speed and reassurance. Fewest taps to a confirmed seat; unambiguous trip status at a glance. |
| **Driver** (سائق) | Publishes availability on a route, accepts or declines assignments, picks up and drops off, confirms handoffs with OTP codes. | Glanceable, one-handed, high-contrast. Often reading in a moving vehicle, in sunlight. |
| **Merchant** (تاجر) | Sends parcels along the same corridor, riding on the same trips as people. | Clear parcel state and custody chain. Denser lists than passenger screens. |
| **Admin** (مشرف) | Manages canonical routes and stops, route versioning and publication lifecycle, assignments, and oversight. Works on a React web console, not mobile. | Data density, safe destructive actions, explicit lifecycle states. |

**Recurring UI objects across the product:** a live map with role-coded markers and a drawn route line; a bottom sheet over that map; a leg-by-leg **trip timeline** (completed → active → pending); **route chips** naming stops; **status chips** for trip and parcel states; a **trust-score ring** for driver and passenger reputation; **OTP code entry** for pickup and handoff confirmation; role-aware bottom navigation and headers; an Arabic/English language switch; and full empty, loading, and error states for every list and screen.

**Conditions of use are part of the design brief, not an edge case:**
- Arabic is the default language and RTL is the default direction. English is secondary, LTR.
- Low-end Android phones, outdoors, in direct sunlight, one-handed, often while moving.
- Intermittent and expensive bandwidth. Assets must be bundled, not fetched at runtime.
- The stakes are real: people are trying to get home, and parcels are someone's livelihood. The product must feel like **infrastructure**, not a lifestyle app.

## The brand mandate

Rebuild the Darb visual identity around this palette. These three values are **fixed and non-negotiable** — everything else you derive from them:

| Role | Hex | Arabic label |
|---|---|---|
| Primary | `#FF6B2C` | الأساسي |
| Primary dark | `#E9561B` | الأساسي الداكن |
| Navy | `#172554` | الكحلي |

The identity keyword is **"برتقالي احترافي" — professional orange**.

Orange carries **motion, urgency, and the moment of action** — the path itself, the vehicle moving, the button that commits. Navy carries **trust, institutional weight, and structure** — this product moves real people through real checkpoints, so it must never read as a toy, a food-delivery clone, or a discount coupon app.

Your central craft problem: **an orange this saturated turns cheap when overused and invisible when underused.** Solve it with an explicit, enforceable ratio rule — navy and neutrals hold the structure; orange is spent only where the user must act or where movement is happening — then enforce that rule in every single component spec. A design system that states this rule and then ignores it in its own components has failed.

The hardest specific collisions you must solve, not dodge:
1. **Orange vs. warning.** Amber warning states sit right on top of a `#FF6B2C` brand. Make warning unmistakably not-the-brand.
2. **Orange vs. error.** Red error and orange brand are adjacent hues. A destructive action must never be confused with a primary action.
3. **Orange on a map.** The route line, the active leg, and the driver marker all want to be the brand color, and they cannot all be.

## Hard constraints

1. **Arabic-first, RTL by default.** Every spec covers both directions — mirrored icons (and which icons must *not* mirror), logical `start`/`end` properties instead of `left`/`right`, and Arabic line-heights generous enough not to clip diacritics.
2. **Typeface: IBM Plex Sans Arabic**, bundled with the app so it renders offline. Any additional face you propose must also be self-hostable — no runtime webfont fetch.
3. **WCAG 2.2 AA minimum.** `#FF6B2C` on white is roughly **3:1** — state plainly where that orange may and may not carry text, and derive a darkened text-safe variant for the cases where it may not. Do not hand-wave this; it is the single most common way an orange brand fails in production.
4. **Four roles, one system.** Roles may differ in density and accent emphasis. They may never differ in component grammar.
5. **48dp minimum touch targets**, and sunlight-legible contrast on body text.
6. **Light and dark themes, both complete.** Dark mode is used at night on the corridor; it is not an afterthought.
7. **Justify everything.** Every ramp step, every radius, every duration gets a stated reason. Do not invent values you cannot defend.

## What to produce

### 1. `design-system.md` — the document

**A. Design principles.** Four to six, each a short imperative plus one line on what it rules *out*. Principles that forbid nothing are worthless.

**B. Color.**
- Full tonal ramps (50 → 900) for **Orange**, **Navy**, and a **Neutral** family derived from the navy (warm-cool neutral, not pure gray). Each step gets a hex and a stated purpose.
- Complete **Material 3 `ColorScheme` for light and dark**, written out explicitly — not seed-generated: primary, onPrimary, primaryContainer, onPrimaryContainer, secondary/onSecondary/+container, tertiary/onTertiary/+container, surface and the full `surfaceContainer` family (lowest → highest), onSurface, onSurfaceVariant, outline, outlineVariant, inverseSurface, inverseOnSurface, inversePrimary, error/onError/errorContainer/onErrorContainer.
- **Semantic colors:** success, warning, error, info, pending/inactive — tonally related to the brand, not imported from a generic palette. Solve the warning-vs-orange and error-vs-orange collisions explicitly and say how.
- **Map and role colors:** route line, active leg, completed leg, pending stop, plus distinct driver / passenger / merchant markers. These must stay distinguishable for the most common color-vision deficiencies — never rely on hue alone.
- **A contrast table:** every foreground/background pair you sanction, with its measured ratio and a pass/fail verdict for body text, large text, and UI components.
- **The orange ratio rule**, stated as an enforceable rule, with a worked example of one screen that obeys it and one that breaks it.

**C. Typography.** A type scale for IBM Plex Sans Arabic mapped onto Material's `TextTheme` slots (display / headline / title / body / label, each in large / medium / small). For every slot: size, weight, line-height, letter-spacing, and its one job. Then:
- Arabic line-height and diacritic guidance.
- A **numerals rule** — Eastern Arabic (٠١٢٣) vs. Western (0123) — decided per context: prices, times, distances, plate numbers, OTP codes, phone numbers. Pick and defend; inconsistency here is the classic Arabic-app tell.
- Truncation rules for long Arabic place names in chips, list rows, and map labels.
- Bilingual pairing: how Arabic and Latin text sit together in one line without one looking pasted in.

**D. Space, grid, radius, elevation.**
- An 8-point spacing scale with named steps and what each is for.
- A radius scale in a stated voice — approachable but never clinical — mapping each radius to component classes, plus a fully-round radius reserved for chips and badges so they stay visually distinct from buttons.
- Layout grid, screen margins, and breakpoints for phone, tablet, and the admin console.
- **Elevation defined functionally** — what each level *means* in the user's workflow (page, card, floating/interactive, overlay that must pull focus off the map) — not as a decorative shadow list. Specify how elevation reads in dark mode, where shadows barely show.

**E. Motion.** Durations, easing curves, and named transitions: page push, bottom-sheet expand/collapse, chip state change, map-marker move, skeleton → content, and the OTP success confirmation. Include a reduced-motion rule and a low-end-device rule. Motion here signals *progress along a path* — make that intentional.

**F. Iconography & illustration.** Style, stroke weight, grid size, sizing steps, which icons mirror in RTL and which never do (clocks, checkmarks, brand glyphs), and the map-marker system — shape plus color plus label, so markers never depend on color alone.

**G. Components.** Specify each of these, with anatomy, every variant, every state (default / hover / focus / pressed / disabled / loading / error / empty / selected), sizing, internal spacing, color mapping **by token name — never raw hex**, RTL behavior, and accessibility semantics:

1. Button — full hierarchy (primary, secondary, tertiary/text, destructive), sizes, icon and loading states
2. Card
3. Text field — with label, helper, error, and counter states
4. Section header
5. Bottom navigation — role-aware
6. Status chip — the full trip and parcel state vocabulary
7. Route chip
8. Trip timeline tracker — completed / active / pending legs
9. Trust-score ring
10. OTP code input
11. Empty / loading / error state views
12. Entity list rows and cards (trip, driver, parcel)
13. Match result card
14. Map surface, markers, and route line
15. Role header and role-aware navigation shell
16. Top app bar
17. Language switch (AR ⇄ EN)
18. Bottom sheet over map
19. Dialogs and confirmations, including destructive confirmation
20. Toast / snackbar / inline banner
21. Admin console additions: data table, filter bar, pagination, lifecycle/version badges, form layout

For the two most-abused components — **button hierarchy** and **status chips** — include an explicit do/don't pair.

**H. Patterns.** Screen-level composition rules for: the map-plus-bottom-sheet screen; the trip tracking timeline screen; the matching/results flow; forms and validation; list screens with their empty/loading/error states; the OTP confirmation moment; and the role-switching navigation shell. For each, show how the orange ratio rule survives contact with a real screen.

**I. Voice in UI.** Bilingual microcopy rules: button verbs, error tone (never blame the user; never expose raw backend text), empty-state tone, and how Arabic and English strings stay in the same length class so layouts do not break when the locale flips.

### 2. Code

- A **Flutter Material 3 theme file** — explicit light and dark `ColorScheme`s written by hand (do **not** use `ColorScheme.fromSeed`; hand-written values match the system exactly instead of being approximated by Material's tonal algorithm), plus `TextTheme` and per-component themes.
- A **semantic colors file** for the states Material's scheme has no slot for — pending, active leg, per-role map markers — with a `// derived` comment wherever a value is inferred rather than given by the system.
- A **design tokens file** — spacing, radii, touch targets, control heights, elevation — as named constants.
- A **CSS custom-properties token file** for the React admin console, mirroring the same token names exactly so mobile and web cannot drift.

Write code with real doc comments explaining *why* a value is what it is, not just what it is.

### 3. Adoption guide

A short "how to use this" section: how to add a new component without breaking the system, the three rules a reviewer should check in any pull request, and the list of things that are explicitly **not** allowed (raw hex at call sites, new one-off radii, orange used as a background for long-form text, color as the sole carrier of meaning).

## How to work

1. **Decide, don't survey.** Where two good options exist, pick one and defend it in a sentence. No option menus, no "you could also consider."
2. **State assumptions inline** where this brief is silent, and keep going — do not stop to ask me questions.
3. Prefer a **smaller system that is fully specified** over a larger one that is half-specified.
4. Show your contrast math. Claimed accessibility is not accessibility.

## Done means

- An engineer can build any screen in this product from the document alone, without asking a single color or spacing question.
- Every sanctioned color pair has a measured contrast ratio printed next to it.
- The orange ratio rule is stated, then visibly obeyed by every component spec in the document.
- Nothing resolves to a raw hex at the call site — everything goes through a named token.
- Read cold by a stranger, it looks like the work of **one opinionated person with a point of view** — not a committee filling in a template.
