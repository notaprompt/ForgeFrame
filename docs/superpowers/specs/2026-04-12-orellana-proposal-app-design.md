# Orellana Proposal App — Design Spec

**Date:** 2026-04-12
**Status:** Approved
**Owner:** Alex Campos
**Client:** Orellana Landscaping LLC (uncle), Woodbridge, VA

---

## 1. What It Is

A mobile-first PWA that lets uncle (or anyone on his team) create a professional landscaping proposal in under 60 seconds and share it with the client via text, email, or WhatsApp. Single shared login. Bilingual (English/Spanish). Hosted free.

The app is a **presenter** in v0 — the user enters the price they've already decided on. Every proposal saved becomes training data for a future **calculator** layer (v1) that suggests prices based on patterns in past proposals.

**Stack:** Next.js, Supabase (auth + Postgres + storage), React-PDF (client-side generation), Vercel or Cloudflare Pages free tier.

## 2. Context

### The Business

- **Orellana Landscaping LLC** — 28 years in business, family-owned, Woodbridge VA
- **Website:** orellanalandscapingllc.net
- **Team:** ~8 people (3 on jobs, 5 on mowing crews), plus Andrea (admin/QuickBooks)
- **Services:** Lawn mowing, cleanup/mulching, concrete work, tree removal/trimming, fencing, retaining walls, power washing, grading, snow removal, planting, fertilizing, aeration/grass seed, sprinkler service
- **Current tools:** QuickBooks for invoicing, iPhone 16, Yahoo email
- **Brand colors:** Green (#2d7a1e primary), brown (#5c3a1e trunk/earth), leaf accents (yellow-green, orange)

### The Problem

Uncle gives verbal quotes — no written proposals, no system. Everything is in his head. He loses hot leads because quoting takes too long, and loses thousands per season to ghost clients who never pay.

### Recon Data (via Jonathan, 2026-04-12)

- Prices per job, not per hour. No consistent pricing model — mostly "it depends"
- ~5 quotes/week, 40-60% close rate (2-3 become jobs)
- No written quotes — all verbal
- Doesn't track profit, doesn't factor gas/equipment/labor into pricing
- Doesn't adjust pricing for difficulty (terrain, access)
- Takes any job, no minimum, no travel fees
- 50% deposit on big jobs (concrete, decks), no deposit on small jobs
- Both residential and commercial clients
- Bilingual (Spanish/English)
- OK with $10-20/mo hosting cost

### Existing Invoice Reference

QuickBooks invoice screenshot analyzed: $3,175 overdue invoice to Mr. Rahman (Springfield, VA). Line items include lawn mowing ($50/visit), cleanup ($675), aeration ($675), leaf cleanup ($400), sprinkler winterization ($350). This format is the baseline the proposal PDF improves upon.

## 3. Screens and Flow

### 4 screens, linear flow + settings:

**1. Proposals List (home screen)**
- List of all proposals, newest first
- Each card: client name, total, date, status (draft / sent)
- "Duplicate" button on each card — clones for quick re-quoting
- "New Proposal" button at bottom
- Settings gear icon in top bar

**2. New Proposal (or duplicated draft)**
- Client name — autocompletes from previous proposals (fills phone/email/address too)
- Client phone (optional), email (optional), address
- Proposal language toggle (EN/ES) — controls PDF output, independent of UI language
- "Add Line Item" button → row:
  - Service picker (from configurable list)
  - Description (optional free text)
  - Quantity (default 1)
  - Price (manual entry in v0; pre-filled with suggested price in v1)
- Multiple line items, running total at bottom
- Deposit toggle → reveals editable amount field, pre-filled with default % from settings
- Financing toggle → enables QR code on PDF (optional per proposal)
- Notes field (optional)
- Created-by name field (optional, free text)

**3. Preview**
- Rendered proposal matching the PDF output exactly
- "Edit" goes back, "Generate PDF" moves forward

**4. Share**
- PDF generated client-side (React-PDF, works offline)
- PDF preview displayed
- "Share" button → native share sheet (iOS/Android Web Share API)
- After share sheet closes: "Mark as Sent?" confirmation button
- Returns to proposals list

**Settings**
- UI language (EN/ES) — persists, controls app interface
- Service list: add, edit, remove, reorder
- Company info: name, phone, email, website, logo upload
- Default deposit percentage
- Financing: enable/disable, provider link (for QR code generation)

**Offline behavior:** New proposals and PDFs generate entirely on-device. Saved to IndexedDB immediately, synced to Supabase when connection returns.

## 4. Data Model

### Supabase Postgres — 3 tables + client-side offline layer

**`proposals`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | Generated client-side for offline stability |
| client_name | text | |
| client_phone | text, nullable | |
| client_email | text, nullable | |
| client_address | text, nullable | |
| language | text | 'en' or 'es' |
| deposit_amount | numeric, nullable | null = no deposit |
| show_financing | boolean | default false |
| notes | text, nullable | |
| status | text | 'draft' or 'sent' |
| sent_at | timestamp, nullable | |
| total | numeric | Computed client-side on save |
| created_by_name | text, nullable | Free text, no auth tie |
| created_at | timestamp | |
| updated_at | timestamp | |

**`line_items`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| proposal_id | uuid (FK → proposals) | |
| service_id | uuid (FK → services) | |
| description | text, nullable | |
| quantity | integer | default 1 |
| unit_price | numeric | |
| sort_order | integer | |

**`services`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| name_en | text | |
| name_es | text, nullable | Falls back to name_en |
| is_active | boolean | default true |
| sort_order | integer | |

### Seeded services (14)

Lawn Mowing, Cleanup/Mulching, Concrete Work, Tree Removal, Tree Trimming, Fencing, Retaining Walls, Power Washing, Grading, Snow Removal, Planting, Fertilizing, Aeration/Grass Seed, Sprinkler Service

### Client autocomplete

No clients table. New Proposal form autocompletes client_name, client_phone, client_email, and client_address from previous proposals via distinct query. Zero maintenance.

### Offline layer

IndexedDB (Dexie.js or idb-keyval) mirrors the three tables locally. All writes go to IndexedDB first. Sync worker flushes to Supabase when online. Conflict resolution: last-write-wins by updated_at (safe at ~5 proposals/week). UUIDs generated client-side.

### PDF storage

None. PDFs generated on demand client-side from proposal data. Regeneration is instant.

### v1 data payoff

Every line_items row = (service, price) data point. After 50-100 proposals:
```sql
SELECT service_id, AVG(unit_price), MIN(unit_price), MAX(unit_price)
FROM line_items GROUP BY service_id
```
→ real pricing ranges → suggested prices feature.

## 5. PDF Template

### Design Philosophy

Mirrors the QuickBooks invoice structure uncle already knows (line items, rates, totals) but wraps it in a professional, branded presentation. Not a redesign of how he communicates — a better-dressed version.

**Typography:** Plus Jakarta Sans — geometric, modern, high readability. Self-hosted woff2 embedded in React-PDF template.

**Color:** Brand green (#2d7a1e) for header border, table headers, accent text. Brown (#5c3a1e) in logo tree. Everything else black/dark gray on white.

**Generation:** React-PDF (@react-pdf/renderer) running client-side in the browser. No server needed, works offline. Matches reframed's proven pipeline pattern.

### Layout (Letter size, portrait)

**Header band**
- Logo (actual image from settings upload, SVG placeholder until then) linked to orellanalandscapingllc.net
- Business name, phone, email, website
- Green bottom border

**"Prepared For" block**
- Client name, address, phone, email
- Proposal number (auto-increment display number), date, valid-until date

**Line items table**
- Green header row: Service | Description | Qty | Price | Amount
- Alternating warm gray rows
- Tabular numerals on all dollar amounts

**Totals block**
- Total (bold, larger), deposit required, balance due

**Financing CTA (conditional — toggle per proposal)**

Two layout options preserved for uncle to choose:

- **Option A — Inline:** QR code + financing info sits left of the totals on the same row. Tighter, eye tracks from total to monthly payment naturally.
- **Option B — Below:** Full-width block below totals with QR code left, copy right. More room for explanatory text.

Both include:
- QR code linking to Wisetack (or similar) pre-filled with proposal amount
- Monthly payment estimate auto-calculated (total / term)
- "0% APR options available" callout
- Bilingual copy

**Notes block (conditional)**
- Rendered below a thin rule when notes are present

**Footer**
- "This proposal is valid for 30 days" (bilingual)
- Website link + "28 Years of Excellence"

### What it does better than QuickBooks

- Branded header (not generic Intuit chrome)
- "Proposal" framing (client sees this before work, not after as invoice)
- Deposit + balance breakdown (QuickBooks just shows total)
- Validity period (signals professionalism, creates urgency)
- Financing option (eliminates non-payment risk)
- Bilingual (client sees proposal in their language)
- Consistent every time (not dependent on QuickBooks template)

### What it keeps from QuickBooks

- Line-item structure uncle already understands
- Same data fields (service, description, qty, price, amount)
- Clean and readable — not overdesigned

## 6. Financing Integration

### The Problem It Solves

Uncle loses thousands per season to ghost clients. The financing option eliminates this: uncle gets paid in full upfront by the financing provider, client pays over time, financing company owns the risk.

### Provider

**Wisetack** (recommended) — purpose-built for home services contractors.
- Client applies in 30 seconds from phone (scan QR → soft credit check → approved)
- Contractor gets paid upfront in full
- 3-5% merchant fee (uncle currently loses 100% on non-payers)
- 0% APR options available for clients

Alternatives: Hearth, GreenSky (Goldman Sachs). Uncle can evaluate and pick.

### Implementation

- QR code generated dynamically per proposal with total amount as URL parameter
- Toggle in the New Proposal form: "Show financing option" (default off, configurable in settings)
- Monthly estimate auto-calculated: total / 12 (displayed on PDF)
- Uncle signs up as a Wisetack merchant (separate from this app — we just generate the link)

### Why This Matters

The proposal app and the payment recovery thread are now the same product. The best collection automation is making sure you never need to collect.

## 7. Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Framework | Next.js | Reuses founder's stack knowledge from reframed |
| Database | Supabase free tier | Auth + Postgres + storage in one service, free at this scale |
| PDF generation | React-PDF (client-side) | Works offline, no server dependency, proven in reframed |
| PDF font | Plus Jakarta Sans (self-hosted woff2) | Modern, geometric, high readability |
| Offline | IndexedDB + sync worker | Uncle quotes in rural VA with bad signal |
| Hosting | Vercel or Cloudflare Pages free tier | Zero cost until significant traffic |
| Auth | Supabase Auth, single shared account | Simplest possible, add team accounts in v1 if needed |
| Delivery | Native share sheet (Web Share API) | Handles SMS, email, WhatsApp, AirDrop without building any of it |
| QR generation | Client-side (qrcode.js or similar) | No server needed, dynamic per proposal |

## 8. What's NOT in v0

- Calculator/suggested prices (v1 — needs data from real usage first)
- User accounts / team roles (v1 — single shared login for now)
- Client portal / acceptance flow (not in scope)
- Payment processing (uncle uses QuickBooks for that)
- Map / polygon / lot sizing (deferred — uncle prices by job, not sqft)
- Push notifications for follow-ups (v1)
- Analytics dashboard (v1)
- Voice input (v1/v2 — form structure supports it later)
- Photo attachment on proposals (v1/v2)

## 9. Success Criteria

Uncle opens the app from his truck, creates a proposal in under 60 seconds, taps share, client gets a professional branded PDF via text. If financing is enabled, client can scan the QR code and apply for monthly payments. Uncle gets paid.

When that loop runs once for real, by uncle, the product has crossed its threshold.

---

## Appendix: PDF Mockups

Visual mockups for the PDF template are preserved at:
- `.superpowers/brainstorm/44137-1775978787/content/proposal-pdf-mockup-v6.html` (financing below totals — Option B)
- `.superpowers/brainstorm/44137-1775978787/content/proposal-pdf-mockup-v7.html` (both layouts side by side for comparison)

Serve locally to view: these are standalone HTML files.
