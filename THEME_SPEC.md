# Rebrand & theme — "BizBook Project" (build contract)

This app is the **Project module of the BizBook ERP** suite (https://bizbookerp.com). Match the BizBook visual language as closely as possible. Values below were measured from the live site on 2026-11-13.

## 1. Naming
- Product name: **BizBook Project** (wordmark: "BizBook" in dark slate + "Project" in primary violet, like "BizBook **ERP**" on the site). Browser titles: `<Page> · BizBook Project`. `<title>` default "BizBook Project".
- Subtitle under logo in sidebar: "Project module · BizBook ERP" (small, muted).
- The customer company name (settings `company_name`, e.g. "Al Noor Infrastructure LLC") stays as the *tenant* shown in the topbar (pill like the site's "Al Noor LLC ▾"), not as the product name.
- Replace every "Operations Module" / "Operations" product string (layout metadata, sidebar, login, portal header, README, package.json `name` → `bizbook-project`, seed printouts). Portal header: "BizBook Project · Subcontractor portal" + tenant company name.

## 2. Design tokens (exact BizBook values)
```
--primary:        #635BFF   (buttons, links, active nav, accents)
--primary-dark:   #4F46E5   (hover/pressed)
--primary-50:     #EEF2FF   (chips, active nav bg, soft fills)
--primary-100:    #E0E7FF
--secondary:      #2563EB
--bg:             #F8FAFC   (app background)
--dark:           #0F172A   (headings)
--sidebar:        #111827   (sidebar background — dark)
--text:           #111827
--muted:          #6B7280
--border:         #E5E7EB   (inputs use #E2E8F0, 1.5px)
--success:        #22C55E
--danger:         #EF4444
--warning:        #F59E0B
```
- Font: **Manrope** (Google Fonts, weights 500/600/700/800) via `next/font/google` with system fallback `"Segoe UI", system-ui, sans-serif`. Body 14px in the app (site marketing uses 16px); headings weight 800, tight letter-spacing (-0.02em), colour `--dark`.
- Radius: buttons 10px, inputs 12px, cards 16px, pills/chips 999px.
- Primary button: bg #635BFF, white text, weight 700, radius 10px, shadow `0 8px 20px rgba(99,91,255,.35)` (smaller shadow `0 4px 12px rgba(99,91,255,.25)` for sm size), hover #4F46E5. Secondary button: white bg, 1.5px #635BFF border, #635BFF text (like "See pricing"). Ghost: transparent, slate text, hover #EEF2FF.
- Inputs: height ~44px in forms (36px in dense tables/grids), white bg, `1.5px solid #E2E8F0`, radius 12px (8px in dense grids), focus ring `0 0 0 4px rgba(99,91,255,.15)` + border #635BFF, placeholder #94A3B8.
- Cards: white, 1px #E5E7EB border, radius 16px, shadow `0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.04)`.
- Eyebrow labels: uppercase, 11–12px, weight 800, letter-spacing .08em, colour #635BFF (e.g. "YOUR WORKSPACE AWAITS"); pill variant on #EEF2FF bg.
- Status badges: soft pill style (tinted bg + coloured text + small dot), consistent with the site's "● Active" green pill. Keep `lib/status.ts` tones but restyle to this look; change any `blue` primary tone to violet where it represents "primary/in progress".
- Charts (recharts) palette: primary #635BFF, then #2563EB, #22C55E, #F59E0B, #EF4444, #06B6D4, #A855F7, #64748B. Planned/budget series in #CBD5E1 / slate; actual in #635BFF.
- Map: completed slice #635BFF (or green kept for "done" if clearer — use #22C55E for completed, #635BFF for selected/active), remaining #CBD5E1.

## 3. Logo
Recreate the BizBook mark in code (no image download): `components/brand/Logo.tsx` — 32×32 rounded square (radius 8px) filled `#111827`, white bold "BB" glyph (Manrope 800, ~14px, tight tracking), plus wordmark "BizBook" (#0F172A, 800) + " Project" (#635BFF, 800). Variant for dark backgrounds (sidebar): wordmark "BizBook" white. If `public/brand/logo.png` exists, use it instead of the drawn square (so the real logo can be dropped in). Favicon: generate `src/app/icon.svg` with the same BB square.

## 4. App shell
- Sidebar: dark `#111827`, width 248px, logo at top (dark variant), section group labels (uppercase 11px, #6B7280: "OVERVIEW", "SALES & TENDERING", "PROJECTS", "SUBCONTRACTING", "FINANCE", "ADMINISTRATION"), nav items 14px weight 600 #CBD5E1 with lucide icons, hover bg rgba(255,255,255,.06), **active item: bg #635BFF, white text, radius 10px** (or soft violet `rgba(99,91,255,.18)` bg with white text + left accent — pick the one closer to the site; default to solid #635BFF). Badge counts as small violet/white pills. Footer: user avatar initials circle (#635BFF bg), name, role, and a "BizBook ERP" link-out hint.
- Topbar: white, 64px, bottom border #E5E7EB, slight blur when scrolled; search input with radius 12px and #F8FAFC bg; right side: tenant pill (company name with building icon, bg #EEF2FF text #635BFF), notifications/approvals bell with count, user menu (avatar initials, name, role, My account, Sign out).
- Page header: breadcrumb (muted), H1 24px weight 800 #0F172A, optional eyebrow, actions right.
- Background `#F8FAFC`. Tabs: underline style with #635BFF 2px active indicator and #635BFF text; or pill tabs on #EEF2FF — keep underline for detail pages.
- KPI `Stat` tiles: white card, small icon in a 32px rounded-10 #EEF2FF square with #635BFF icon, label uppercase 11px muted, value 22px weight 800.
- Tables: header row #F8FAFC, 12px uppercase muted 700, rows 14px, hover #F8FAFC, borders #F1F5F9.

## 5. Login page (match https://bizbookerp.com/accounts/login/)
Two-column split, full height:
- **Left brand panel (≈46% width, hidden < 1024px)**: background `linear-gradient(160deg, #F3F0FF 0%, #EEF2FF 48%, #F8F7FF 100%)` with soft blurred decorative circles (violet, low opacity). Top row: Logo + "BizBook **Project**", right "← Back to BizBook ERP" link (href `https://bizbookerp.com`). Headline 40–44px weight 800: "Welcome back to" (#0F172A) / "your projects." (#635BFF). Sub-copy (#475569): "Tenders, budgets, sites and subcontractors — all in one connected workspace." A floating white card (radius 16px, shadow) "BizBook Project Autopilot" with green "● Active" pill, a faux prompt row "✦ What would you like to get done?" with a violet round arrow button, and 3 task rows with ✓ / spinner + status chips: "Prepare tender TND-2026-014 · Completed", "Verify subcontractor progress · Completed", "Certify invoice SC-004 · In progress" (violet chip). Below: 3 check items: "Tender to project in one flow", "Live site progress on the map", "Multi-level approvals & audit trail". Footer line muted: "Part of BizBook ERP. You stay in control."
- **Right form panel** (white): top-right small text "Part of BizBook ERP · bizbookerp.com". Centered form max-width ~440px: eyebrow "YOUR WORKSPACE AWAITS", H1 "Sign in to BizBook **Project**" (Project in #635BFF), sub "Pick up right where you left off." Fields "Email" (keep email login) and "Password" with eye toggle and right-aligned "Forgot password?" (link to a small page telling the user to contact their administrator — no email flow), inputs 52px tall, 1.5px #E2E8F0, radius 12px. Checkbox "Remember me for 30 days" with helper "Leave unchecked to sign out when you close the browser." (make the non-remember session cookie a session cookie — no maxAge — to match the helper text; server-side expiry 12h still applies). Full-width primary button "Sign in →" 52px, radius 12px, violet shadow. Error alert soft red pill box. Footer row: "© 2026 BizBook ERP" · Privacy · Terms (plain text links to #) · "🌐 English / العربية" (static, non-functional label).
- Keep all existing login logic (lockout, next redirect, must-change-password) — restyle only.
- Apply the same split-layout styling to `/account/password` forced-change screen if it renders outside the shell, and to `/forbidden` (simple centered card).

## 6. Scope rules
- Theme through shared pieces first: `globals.css` (Tailwind v4 `@theme` tokens: `--color-primary`, etc., and Manrope as `--font-sans`), `components/ui/*`, `components/shell/*`, `lib/status.ts` badge classes, chart colour constants. Then sweep feature pages for hard-coded `blue-*`/`indigo-*`/`sky-*` accent classes and replace with the primary token (keep semantic red/amber/green). Don't change layouts/logic of feature pages beyond colour/typography/radius consistency.
- Must look right at 1440px and 800px; sidebar collapses to the existing mobile nav below `md`.
