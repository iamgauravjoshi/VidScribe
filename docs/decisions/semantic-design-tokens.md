# Centralize VidScribe UI Design Tokens

## Problem

The frontend had theme colors split between global CSS, component styles, and dark-mode overrides. Repeated text sizes, spacing, radii, and shadows were expressed as unrelated pixel values, making a full UI restyle prone to inconsistencies.

## Chosen approach

Define semantic color, typography, spacing, shape, elevation, and motion tokens in `frontend/src/styles/design-tokens.css`. Light mode is the default `:root` theme; dark mode overrides semantic roles through `:root[data-theme='dark']`. Global resets stay in `index.css`, while layouts and components consume tokens from `App.css`.

## Why

Components can express intent such as `--surface`, `--text-soft`, `--danger`, or `--space-4` without embedding palette decisions. A theme change then updates shared roles consistently while preserving component-level structure. The CSS variables keep the design system lightweight and require no runtime styling dependency.

## Failure and maintenance considerations

If a component adds a literal color instead of a semantic token, it may become unreadable in dark mode. Tokens should only be added when a reusable role exists; unique icon geometry and provider branding can remain component-specific. Visual review should cover light and dark themes, mobile navigation, source lifecycle states, and focus/disabled states whenever shared tokens change.

## Trade-offs

CSS custom properties are simple and work across the current Vite application, but they do not enforce token names at TypeScript compile time. A larger component library could generate CSS and TypeScript token contracts from one source later; that tooling is not needed for this small frontend today.

## Interview explanation

We centralized design decisions as semantic CSS variables rather than adding a styling framework. Components depend on roles and scales, not individual colors, which lets light/dark themes and future refinements stay consistent without adding runtime dependencies. We keep the token set small and add new values when a repeated design role appears.
