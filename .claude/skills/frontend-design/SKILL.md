---
name: frontend-design
description: >
  Use when designing, building, or modifying frontend UI components, pages, layouts,
  or styling. Applies to tasks involving React components, Tailwind CSS, Radix UI
  primitives, shadcn/ui patterns, responsive design, accessibility, theming, and
  general frontend architecture decisions.
---

# Frontend Design Skill

## Tech Stack

- **Framework:** Next.js 14 (App Router) with React 18 and TypeScript (strict mode)
- **Styling:** Tailwind CSS 3.4 with HSL CSS custom properties for theming
- **Components:** Custom shadcn/ui-style components built on Radix UI primitives
- **Icons:** Lucide React
- **Utilities:** `cn()` helper using `clsx` + `tailwind-merge` (from `@/lib/utils`)
- **Theming:** `next-themes` for light/dark mode via class strategy
- **Animations:** `tailwindcss-animate` plugin, custom keyframes in Tailwind config

## Project Structure

```
src/
├── app/              # Next.js App Router pages, layouts, API routes
│   └── globals.css   # CSS variables, base styles, custom utilities
├── components/
│   ├── ui/           # Base UI components (button, card, badge, progress, etc.)
│   ├── analysis/     # Analysis feature components
│   ├── chat/         # Chat interface components
│   ├── upload/       # File upload components
│   └── views/        # Page-level view components
├── hooks/            # Custom React hooks (use-toast, etc.)
├── lib/              # Utilities, types, API clients
└── types/            # TypeScript type definitions
```

## Design Tokens

The project uses HSL-based CSS custom properties defined in `globals.css`:

- **Primary:** Indigo (`--primary: 239 84% 67%`)
- **Secondary:** Cool gray
- **Accent:** Light indigo tint
- **Destructive/Success/Warning:** Semantic colors for status
- **Radius:** `--radius: 0.625rem` (10px)

Always reference these tokens via Tailwind classes (`bg-primary`, `text-destructive`, etc.) rather than hardcoding color values.

## Component Conventions

1. **Use existing UI primitives** from `@/components/ui/` — check what exists before creating new base components.
2. **Use `cn()` for class merging** — import from `@/lib/utils`. Combine with `cva` (class-variance-authority) for variant-driven components.
3. **Follow the shadcn/ui pattern:**
   - `forwardRef` with proper TypeScript types
   - Accept `className` prop and merge with `cn()`
   - Use `cva` for defining component variants
   - Export both the component and its variant types
4. **Radix UI for behavior** — use Radix primitives for accessible interactive components (dialogs, dropdowns, tooltips, etc.). Style them with Tailwind.
5. **Mark client components** — add `"use client"` directive only when the component uses hooks, event handlers, or browser APIs.

## Styling Rules

- **Tailwind-first** — use utility classes. Avoid inline styles or CSS modules.
- **Responsive design** — use mobile-first breakpoints (`sm:`, `md:`, `lg:`).
- **Dark mode** — use Tailwind dark variants (`dark:bg-gray-900`) where needed. Prefer semantic CSS variables that auto-switch with the theme.
- **Spacing and sizing** — use Tailwind's default scale. Keep spacing consistent within sections.
- **Typography** — use the custom font size scale defined in `tailwind.config.js` (`text-2xs` through `text-2xl`).
- **Shadows** — use custom shadows: `shadow-card`, `shadow-lifted`, `shadow-lifted-md`.
- **Animations** — use `tailwindcss-animate` classes or custom animations defined in the Tailwind config.

## Accessibility

- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<section>`, etc.).
- Radix UI handles ARIA attributes for complex widgets — don't override them.
- Ensure keyboard navigation works for all interactive elements.
- Provide visible focus indicators (Tailwind's `focus-visible:` variants).
- Use sufficient color contrast — don't rely on color alone to convey meaning.

## Patterns to Follow

- **Toast notifications:** Use the `sonner` library via the existing `use-toast` hook.
- **Forms:** Use Radix UI form primitives with Tailwind styling.
- **Drag and drop:** Use `@dnd-kit` (already installed) for sortable/draggable interfaces.
- **Markdown rendering:** Use `react-markdown` with `remark-gfm` for rich text display.
- **File uploads:** Use `react-dropzone` with the existing upload component patterns.
- **Icons:** Import from `lucide-react`. Use consistent sizing (`h-4 w-4` for inline, `h-5 w-5` for buttons).

## Anti-Patterns to Avoid

- Don't install new UI libraries when existing primitives cover the need.
- Don't use `px` values in Tailwind — use the spacing/sizing scale.
- Don't create one-off CSS files — keep everything in Tailwind utilities or `globals.css`.
- Don't skip the `cn()` utility when accepting external `className` props.
- Don't hardcode colors — use the CSS variable-based theme tokens.
- Don't create deeply nested component hierarchies — keep components flat and composable.
