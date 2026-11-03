# Design Guidelines

Style: clean and minimal. The name, logo and brand guidelines are not decided yet. Build the interface so they can be added later without rewriting components.

## Brand tokens

Keep all brand values in one file, `apps/web/src/brand.js`, and expose them as CSS variables:

- `appName`, logo (SVG), favicon
- Colours: primary, primary-dark, background, surface, text, muted text, success, warning, danger
- Fonts: one heading font and one body font
- Radius and spacing scale
  Placeholders for now: neutral grey scale with one calm accent colour.

## Principles

- Mobile first. The site must feel like an app: bottom tab bar on phones, installable PWA, smooth transitions.
- One main action per screen.
- Plenty of white space, few borders, clear type hierarchy.
- Large touch targets (at least 44 px).
- Light and dark theme through the same variables.

## Core screens (user app)

Onboarding and location, Home (nearby communities and items), Search, Item detail, Create item, Booking request, My bookings, Booking detail (status timeline, chat, QR), Wallet, Notifications, Profile, Settings.

## Portal screens

Care: queue, case file, decision form, user lookup. Admin: overview analytics, users, communities, agents, appeals, ads, audit log.

## Components to build once

Button, Input, Select, Modal, Bottom sheet, Toast, Skeleton loader, Empty state, Status badge, Trust score badge, Money text (always with a "Demo money" tag), Image gallery, Date range picker with blocked days, Map with pin drop, QR display and scanner, Rating stars, Ad slot.

## Content rules

- Plain, friendly wording. Short sentences.
- Show clear errors and next steps.
- Every money screen shows "Demo money".

## Accessibility

- Colour contrast at WCAG AA, visible focus, labels on all inputs, alt text on images, screen reader friendly status changes.
