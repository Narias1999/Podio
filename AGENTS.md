<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# UI components

This project uses [shadcn/ui](https://ui.shadcn.com) (configured for Radix UI primitives, see `components.json`) as its design system.

- Before building any new UI element, check `components/ui/` and `components/` for an existing component that already covers it — reuse and compose existing components instead of writing new markup from scratch.
- When a needed primitive isn't installed yet, add it via the CLI (`npx shadcn@latest add <component>`) rather than hand-rolling it, so it stays consistent with the rest of the design system (styling, variants, Radix primitives).
- Composite components that aren't single registry items (e.g. date picker, data table) live in `components/` (not `components/ui/`) and are built by combining existing `components/ui/` primitives, following the patterns shadcn documents for these cases.
