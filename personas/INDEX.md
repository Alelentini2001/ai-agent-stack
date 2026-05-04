# Agency-Agents — Curated Index for Appaltami

184 agents are installed in `~/.claude/agents/` from `msitarzewski/agency-agents`. These ten are the most relevant to Appaltami's roadmap. Assign them to Multica tasks that match the description; the four custom Italian regulatory personas (see below) should take precedence for domain-specific work.

---

## Curated personas

| File | When to use |
|------|-------------|
| `engineering-backend-architect.md` | Designing new Supabase edge functions, API route refactors, or the approval-gate service architecture. |
| `engineering-database-optimizer.md` | Writing or reviewing migration SQL, query plans on `tenders_raw`, or anything touching the 153+ migrations. |
| `engineering-security-engineer.md` | Security reviews before a feature ships — auth flows, RLS policies, GDPR compliance checks, secret handling. |
| `engineering-code-reviewer.md` | Pre-merge review of any PR that doesn't already have a dedicated reviewer. |
| `engineering-frontend-developer.md` | React/Next.js 15 component work, App Router pages, or client-side state in the feed/pipeline/workspace views. |
| `design-ui-designer.md` | Design system tokens, shadcn/ui component extensions, or pitch-deck / marketing-page visual direction. |
| `product-trend-researcher.md` | Competitive analysis of Spanish/Italian procurement SaaS; surfacing features that ANAC or MEPA buyers want. |
| `support-legal-compliance-checker.md` | Reviewing any feature that touches billing, cookie consent, GDPR data exports, or SEC-2 obligations. |
| `engineering-email-intelligence-engineer.md` | Improving the Resend notification templates, magic-link delivery, or the digest / referral email flows. |
| `engineering-sre.md` | Incident response on the Supabase project, monitoring Sentry (de.sentry.io), or setting up alerting for the ingestion workers. |

---

## Custom Italian regulatory personas (Phase 3)

These live in `tools/agent-stack/personas/` and are symlinked into `~/.claude/agents/`:

| File | Domain |
|------|--------|
| `appaltami-sdi-fatturapa-specialist.md` | Italian e-invoicing — SDI, FatturaPA XML, AdeE validation |
| `appaltami-mepa-tender-specialist.md` | MEPA / CONSIP tenders — RDO, CIG/CUP, procedure types |
| `appaltami-anac-compliance-officer.md` | ANAC reporting, D.lgs. 36/2023, transparency obligations |
| `appaltami-italian-legal-monitor.md` | Gazzetta Ufficiale + Normattiva change monitoring |

---

## How to add a new persona

1. Write the `.md` file following the agency-agents format (frontmatter: `name`, `description`, `color`; then Identity → Core Mission → Critical Rules → Technical Deliverables → Workflow → Success Metrics).
2. Place it in `tools/agent-stack/personas/`.
3. Symlink: `ln -sf "$PWD/tools/agent-stack/personas/<file>.md" ~/.claude/agents/<file>.md`
4. Restart the Multica daemon: `multica daemon stop && multica daemon start`
