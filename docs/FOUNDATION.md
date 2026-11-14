# Foundation reference (for module agents)

Run: `npm run seed` (wipes `data/ops.db` + `uploads/`, reseeds), `npm run dev` (port 3100), `npm run build`.

## Route conventions
- App shell (sidebar + topbar) lives in `src/app/(main)/layout.tsx`. **Modules go under `src/app/(main)/<route>`** (tenders, lost-analysis, projects, subcontractors, invoices, clients, settings, search; dashboard = `(main)/page.tsx`). Placeholder pages already exist for each: **overwrite** `(main)/<route>/page.tsx`.
- **Portal goes under `src/app/portal/[token]`** (outside the shell; `src/app/portal/layout.tsx` is a bare wrapper you may edit). Root layout is minimal (html/body/css only; Leaflet + geoman CSS imported globally).
- Pages are server components; `(main)` layout is `force-dynamic`. `params`/`searchParams` are Promises (Next 15): `const { id } = await params`.
- Server actions: `src/features/<module>/actions.ts` with `"use server"`, validate, transaction, `await logActivity(...)`, `revalidatePath(...)`. Queries in `src/features/<module>/queries.ts`. `src/features/settings/actions.ts` is an example.
- `formatMoney()` etc. are pure and safe in client components; currency is read from settings (published to a global by `db.ts`). In client components pass `{currency}` if needed.
- `@/lib/session.ts` (getCurrentUser) imports server-only APIs - never import it from a client component; `setCurrentUser` lives in `session-actions.ts` ("use server") and is re-exported from `session.ts`.

## lib/db.ts
- `getDb(): Database` singleton (WAL, FK on, schema applied from `src/lib/schema.sql`, hot-reload safe). `getSetting(key, fallback?)`, `setSetting(key, value)`, `DB_PATH`.
- Synchronous: `getDb().prepare(sql).all(...) / .get(...) / .run(...)`, `getDb().transaction(() => {...})()`.
- Row types for every table in `src/lib/types.ts` (`Tender`, `Project`, `Stage`, `Assignment`, `ProgressReport`, ...; enum unions `TenderStatus`, ...).

## lib/session.ts
- `getCurrentUser(): Promise<User>` (cookie `ops_user_id`, defaults to user 1)
- `setCurrentUser(userId: number): Promise<void>` (server action)

## lib/activity.ts
- `logActivity(entityType: EntityType, entityId: number, action: string, message: string, userId?: number | null): Promise<void>` (userId undefined = current user; pass `null` for portal)
- `getActivity(entityType, entityId, limit = 100): (ActivityLog & { user_name })[]`

## lib/files.ts
- `saveUpload(file: File, entityType, entityId, category?: string|null, opts?: { note?, uploadedBy? }): Promise<Attachment>` (uploadedBy `null` = anonymous/portal)
- `saveUploadsFromForm(form: FormData, fieldName, entityType, entityId, category?, opts?): Promise<Attachment[]>`
- `listAttachments(entityType, entityId)`, `deleteAttachmentFile(a)`, `UPLOAD_DIR`
- Download: `GET /api/files/:id` (inline for images/pdf/text; `?download=1` forces download).

## lib/status.ts
- `ENUMS` (kinds: role, clientType, tenderKind, category, quantityUnit, tenderStatus, sectionStatus, revisionStatus, budgetCategory, reviewDecision, negotiationChannel, lossReason, lossStatus, projectStatus, stageStatus, subcontractorStatus, docType, docStatus, assignmentStatus, responsibility, progressSource, progressStatus, invoiceStatus, certType, certStatus, issueStatus, rag), each value `{label, tone}`.
- `statusLabel(kind, value)`, `statusBadgeClass(kind, value)`, `statusTone`, `statusHex(kind, value)` (maps/charts), `statusOptions(kind): {value,label}[]`, `enumDef`, `RAG_HEX`, `TONE_HEX`, `TONE_CLASSES`.
- Constants: `TENDER_PIPELINE`, `OPEN_TENDER_STATUSES`, `REVIEW_DEPARTMENTS` (Technical, Finance, Operations, Management), `DEFAULT_TENDER_SECTIONS: [dept, title][]`, `DEFAULT_ONBOARDING_ITEMS`, `DEPARTMENTS`, `ATTACHMENT_CATEGORIES`.

## lib/format.ts (pure)
`formatMoney(v, {decimals?, currency?, compact?})`, `compactNumber`, `formatNumber(v, decimals=0)`, `formatDate(iso)` -> "DD MMM YYYY", `formatDateTime`, `pct(v, decimals=1)`, `formatRatio(v)` (SPI/CPI), `formatKm`, `todayISO()`, `addDays(iso, n)`, `daysBetween(a, b)`, `daysUntil(iso)`, `countdownLabel(iso)`, `getCurrency()`.

## lib/metrics.ts (single source of truth, SPEC s5)
Pure:
- `lineAmounts(qty, unitCost, marginPct): {cost, price, margin_value}`
- `computeTotals(lines: {quantity, unit_cost, margin_pct}[]): {cost, price, margin_value, margin_pct (on price), markup_pct (on cost)}`
- `plannedPctAt(start, end, date): number`, `ragFromIndices(spi, cpi): RagStatus`, `stageWeights(stages)`, `stageActualPct(stage, verifiedReports, asOf?)`

DB-backed (verified progress reports only):
- `getRevisionTotals(revisionId): RevisionTotals` = Totals + `{revisionId, lineCount, byCategory: {category, cost, price, margin_value}[]}`
- `refreshRevisionTotals(revisionId)` - **call after any budget line change**; writes total_cost/total_price/margin_pct onto tender_revisions.
- `getStageProgress(stageId, asOf?): {stageId, actualPct, plannedPct, cumulativeQty, plannedQty, spi, lastReportDate, delayDays, rag}`
- `getProjectMetrics(projectId, asOf?): {projectId, bac, ev, pv, ac, spi, cpi, eac, vac, actualPct, plannedPct, committed, delayDays, reportedDelayDays, forecastFinish, rag, stages: (StageProgress & {weight})[]}` (spi/cpi null when undefined; rag `green|amber|red|grey`). Sub-projects are separate projects (parent metrics do not include children).
- `getProjectSCurve(projectId): {date, planned, actual|null}[]` (weekly)
- `getDelayAttribution(projectId | null): {total:{days,cost}, byResponsibility:{responsibility,days,cost,count}[], bySubcontractor:{subcontractorId,name,days,cost}[]}` (null = portfolio)
- `getAssignmentProgress(assignmentId, asOf?): {actualPct, plannedPct, spi, cumulativeQty, delayDays, lastReportDate, invoiced, certified, paid, certifiedPct}`
- `getSubcontractorPerformance(subcontractorId?): SubcontractorPerformance[]` (`{subcontractorId, name, trade, status, rating, assignmentCount, activeAssignments, contractValue, progressPct, plannedPct, spi, delayDays, invoiced, certified, paid}`; sorted worst SPI first; all subs with assignments when id omitted)
- Cost auto-posting (idempotent, call from your actions): `syncInvoiceCost(invoiceId)` (posts `subcontract` cost = certified_amount when invoice is approved/paid, removes otherwise; source_type `sub_invoice`), `syncProgressMaterialCosts(reportId)` (posts `material` costs when report is verified, removes otherwise; source_type `progress_material`, source_id = progress_materials.id). Call after verify/reject, invoice status change, or material edits.

## UI (`src/components/ui`, barrel `@/components/ui`)
- `Button({variant: primary|secondary|danger|ghost|success, size: sm|md, ...button props})`, `LinkButton({href, variant, size})`, `buttonClass(variant,size)`
- `Card({className})`, `CardSection({title, subtitle, actions, flush, className})`
- `Badge({tone, className})`, `StatusBadge({kind: EnumKind, value})`
- `Table, THead, TBody, TR, TH({num}), TD({num})` (num = right-aligned tabular)
- `Tabs({tabs: {key,label,count?}[], active, basePath, extraQuery?})` + `resolveTab(searchParams, tabs, fallback?)` - URL `?tab=`
- `Stat({label, value, hint, tone: default|good|warn|bad, icon})`
- `Modal({open,onClose,title,wide})` (client); `ModalButton({label, title, variant, size, wide, icon, children})` - opens a modal with server-rendered children (e.g. `<form action={serverAction}>`), auto-closes after form submit
- `Field({label, hint})`, `Input`, `Textarea`, `Select({options?: {value,label}[], placeholder?})`
- `EmptyState({title, description, action})`, `ProgressBar({value, planned?, tone, showLabel})`, `PageHeader({title, description, actions, breadcrumbs, badges})`, `cn()`
- `AttachmentsPanel({entityType, entityId, revalidate: string, categories?, readOnly?, title?})` (server comp; `revalidate` = current page path) in `@/components/AttachmentsPanel`
- `ActivityTimeline({entityType, entityId, limit?, title?})` in `@/components/ActivityTimeline`
- `ComingSoon({title})` placeholder.

## Map (`src/components/map`)
`import { ProjectMapLazy } from "@/components/map/ProjectMap"` (alias `ProjectMap`; client-only, ssr:false; usable from server components). Types in `map/types.ts`:
`features: MapFeature[]` (`{id, kind: 'project'|'stage', geometry (GeoJSON), color?, label?, progressPct?, popupHtml?, href?, editable?}`), `editable?`, `onSave?(FeatureCollection)` (function prop => pass from a client component wrapper), `drawKind?`, `center?: [lat,lng]`, `zoom?`, `height?`, `legend?: {label,color}[]`.
Lines with `progressPct` render grey base + green completed slice (turf lineSliceAlong). Edit mode: geoman toolbar, live length/area (km / sqm / ha) panel, Save button; saved FeatureCollection holds all editable layers (`properties: {id, kind}` for existing, `{kind, isNew:true}` for new). Fit-to-bounds on feature set change. OSM / Esri satellite switch. Verified rendering in the browser (draw toolbar + measurements).

## Seed summary (npm run seed)
8 departments, 10 users (id 1 = admin Omar Al Farsi), 6 clients, 15 tenders (4 won, 3 lost w/ loss analyses, negotiation, submitted, approved, under_review, in_preparation, draft, no_bid, cancelled) with 105 sections, 23 revisions, 646 budget lines, 236 margin changes, 44 reviews, 10 negotiations; 6 projects (4 main + 2 sub-projects of PRJ-2026-002), 23 stages, 122 project budget lines; 10 subcontractors (approved/onboarding/prospect/suspended; 36 documents incl. expiring/expired; 60 checklist rows); 23 assignments, 225 progress reports (+384 materials, 899 manpower lines; some `submitted` portal reports pending verification), 54 invoices in all statuses, 34 certificates, ~500 project cost rows (auto-posted + manual), 12 issues, 51 attachments (small text files), 94 activity rows.

Stories: PRJ-2026-001 Emirates Road (green, on track), PRJ-2026-002 fibre (red: SPI 0.62 / CPI 0.74, Gulf Trench & Cable Works failing), PRJ-2026-003 pipeline (red SPI, but delays attributed to authority/client), PRJ-2026-004 Dubai South polygon (amber), PRJ-2026-005 sub-project (green), PRJ-2026-006 sub-project (mobilizing, starts in 10 days).

Won-tender budget lines use `wbs_stage` = stage name, plus project-wide lines with `wbs_stage = "General"` (overhead + contingency) which have `stage_id = NULL` in project_budget_lines - tender-to-project conversion should do the same (no stage for "General").

Portal links are printed by the seed (`http://localhost:3100/portal/<token>`); query `assignments WHERE portal_enabled=1` for tokens.

## Deviations from SPEC
- 15 tenders (not 12) so every status appears; no_bid/cancelled included.
- `format.ts` is pure (no DB import) and reads currency from a global set by db.ts.
- `setCurrentUser` is defined in `lib/session-actions.ts` and re-exported from `lib/session.ts` (a client component cannot import session.ts).
- `ProjectMapLazy` wraps `ProjectMapInner.tsx` (cannot self-import).
- System font stack instead of next/font (offline-safe). Clients page is a placeholder (not in module list).

## Approvals (AUTH_SPEC section D)
- Engine: `src/lib/approvals/engine.ts` (sync, transactional, takes the acting user id explicitly): `submitForApproval(type, docId, {userId, note?, payload?}) -> {status: 'pending'|'auto_approved', requestId}`, `decide(taskId, 'approve'|'reject'|'return', comment, actorId)`, `cancelRequest(requestId, actorId)`, `withdrawOpenRequest(type, docId, actorId)` (module actions that withdraw/close a document), `getApprovalStatus(type, docId)`, `getMyPendingTasks(userId)`, `getPendingCount(userId)`, `hasOpenRequest(type, docId)`, `selectWorkflow`, `applicableLevels`, `resolveApprovers`, `activeDelegate`.
- Registry: `src/lib/approvals/registry.ts` holds the 10 document types (`getDocument`, `canSubmit`, `onApproved/onRejected/onReturned/onCancelled`). Add a type there + a label in `meta.ts` + a default workflow in `defaults.ts`.
- A module action that used to jump to the final status now calls `submitForApproval` (inside its own transaction); when no workflow matches the engine auto-approves and the handler applies the old transition. Never set the final status directly.
- UI: `<ApprovalPanel type documentId path user canSubmit? compact? />` (`@/components/approvals/ApprovalPanel`); inbox `/approvals`; designer `/admin/approval-workflows`.
- Tables: approval_workflows, approval_levels, approval_requests (levels snapshot in `levels_json`, action payload in `payload`), approval_tasks, approval_delegations, approval_events, project_cost_requests. Settings: `approval_cost_threshold` (default 50000), `approval_required_<type>` = 1 blocks submission when no workflow matches.
- Seed adds users Hamdan Al Zaabi (management) and Mariam Khoury (finance) so that every default level has an approver other than the requester.
