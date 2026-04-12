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

**1. Documents List (home screen)**
- List of all documents (proposals, invoices, past due notices), newest first
- Each card: doc type badge, client name, total, date, status (draft / sent)
- "Duplicate" button on each card — clones for quick re-quoting
- "Convert" button — proposal→invoice or invoice→past due (one tap)
- Filter tabs: All | Proposals | Invoices | Past Due
- "New Document" button at bottom
- Settings gear icon in top bar

**2. New Document (or duplicated draft)**
- Document type selector: **Proposal** (default) | **Invoice** | **Past Due Notice**
  - **Proposal:** pre-work quote. Header: "Proposal" / "Propuesta". Shows validity period.
  - **Invoice:** post-work bill. Header: "Invoice" / "Factura". Shows due date, invoice number. Payment is expected — Ways to Pay and financing are prominent.
  - **Past Due:** overdue collection. Header: "Past Due Notice" / "Aviso de Pago Vencido". Shows original due date + days overdue. Auto-enables financing QR (the whole point is offering a payment path).
  - A proposal can be **converted** to an invoice (one tap — copies all line items, switches type, adds due date). An invoice can be converted to past due. Natural lifecycle: Proposal → Invoice → Past Due.
- Client name — autocompletes from previous proposals (fills phone/email/address too)
- Client phone (optional), email (optional), address
- Document language toggle (EN/ES) — controls PDF output, independent of UI language
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
| doc_type | text | 'proposal', 'invoice', or 'past_due' |
| language | text | 'en' or 'es' |
| deposit_amount | numeric, nullable | null = no deposit |
| show_financing | boolean | default false |
| notes | text, nullable | |
| due_date | date, nullable | For past_due docs — original due date |
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

## 5. Brand Treatment

### Philosophy

Uncle's brand is stronger than he knows. 28 years, real crew, real website, QuickBooks invoicing, social media presence across 5+ platforms. The problem isn't the business — it's that the client-facing artifacts (verbal quotes, generic Intuit invoices) don't match the quality of the work.

The proposal app doesn't invent a new brand. It surfaces the one that's already there and presents it at the level his clients deserve to see. Every design choice asks: does this make Orellana Landscaping look like a 28-year-old company that takes its work seriously?

### What to preserve

- The green/brown/leaf color palette from the existing logo and website — this is his identity
- The tree-in-circle logo mark — recognizable, well-designed, don't touch it
- The "Gardening & Construction Services" tagline — accurate scope descriptor
- The bilingual character of the business — Spanish is not an afterthought, it's core
- The directness — uncle tells you the price, no games. The proposal should feel the same way.

### What to modernize

- **Typography:** Plus Jakarta Sans replaces system defaults. Geometric, modern, high readability — signals a business that's current without trying to look like a tech startup.
- **Document structure:** Line items, totals, deposit breakdown — things uncle already communicates verbally, now presented in a format that builds trust and survives being forwarded.
- **Payment options visibility:** Uncle already accepts Visa, Mastercard, Discover, Amex, bank transfer, PayPal, and Venmo through QuickBooks Payments. His clients don't know this until the invoice arrives. The proposal should surface these options earlier — reduce the gap between "I want this" and "here's my money."
- **Financing as a feature:** The QR-code BNPL option positions Orellana alongside contractors twice his size. Homeowners comparing 3 landscapers will notice which one offers monthly payments.

### What to add

- **"Ways to Pay" section on the PDF** — payment method icons (Visa/MC/Amex/Discover/PayPal/Venmo) shown on the proposal itself, not just the invoice. Client sees payment flexibility before committing. If uncle enables Apple Pay in QuickBooks Payments (it's a toggle), add that icon too.
- **Professional validity period** — "valid for 30 days" creates soft urgency without being pushy
- **Proposal framing** — client receives a "proposal," not an "invoice." Psychologically different: a proposal is an offer to consider, an invoice is a demand to pay.

### The audience lens

Uncle's clients are Northern Virginia homeowners and commercial property managers. They're comparing him against competitors who may have slicker marketing but less experience. The proposal needs to:
- Look professional enough that a property management company would file it
- Feel personal enough that a homeowner trusts the person behind it
- Communicate price clearly enough that there's no ambiguity about what they're paying for
- Offer enough payment flexibility that "I can't afford it right now" becomes "I can do $273/mo"

## 6. PDF Template

### Design Philosophy

Mirrors the QuickBooks invoice structure uncle already knows (line items, rates, totals) but wraps it in the branded presentation described in Section 5. Not a redesign of how he communicates — a better-dressed version.

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

**Ways to Pay block**
- Row of payment method icons: Visa, Mastercard, Amex, Discover, PayPal, Venmo (+ Apple Pay if enabled)
- Small text: "We accept all major payment methods" / "Aceptamos todos los métodos de pago principales"
- Sits between financing CTA and notes — the client sees total → financing option → payment methods → notes. Natural decision flow.

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

## 7. Financing Integration

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

### Three Document Types, One Lifecycle

The same PDF engine produces three document types that represent the natural lifecycle of a job:

**Proposal → Invoice → Past Due**

| | Proposal | Invoice | Past Due |
|---|---------|---------|----------|
| **When** | Before the job | After the job | When payment is late |
| **Header** | "Proposal" / "Propuesta" | "Invoice" / "Factura" | "Past Due Notice" / "Aviso de Pago Vencido" |
| **Date field** | Valid Until | Due Date | Original Due Date + Days Overdue |
| **Financing QR** | Optional (toggle) | Optional (toggle) | Auto-enabled |
| **Ways to Pay** | Shown | Prominent | Prominent |
| **Tone** | "Here's what it'll cost" | "Here's what you owe" | "This is overdue — here's a path to pay" |
| **Goal** | Convert leads, offer flexibility | Collect payment, show professionalism | Recover money, offer installments |

**Conversion flow:** A proposal converts to an invoice with one tap (copies all line items, switches type, adds due date). An invoice converts to a past due notice (adds overdue indicator, auto-enables financing). Uncle never re-enters data — the document evolves with the job.

**The Springfield example:** Uncle already has a $3,175 overdue invoice for Mr. Rahman. He opens the app, creates a past due notice with the same line items, and texts it. Mr. Rahman scans the QR code, applies for $273/mo financing, gets approved. Wisetack pays uncle the full $3,175 immediately. The ghost client is no longer a ghost — he's a customer with a payment plan.

### Why This Matters

The proposal app and the payment recovery thread are now the same product. Prevention upstream (financing on proposals) and recovery downstream (financing on past due notices) — both powered by the same mechanism. The best collection automation is making sure you never need to collect, but when you do, make it easy for the client to say yes.

## 8. Technical Decisions

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

## 9. Relationship to Existing Stack

This app **enhances** uncle's workflow — it does not replace anything he already uses.

| What he has | What it does | What the proposal app does |
|------------|-------------|---------------------------|
| QuickBooks | Invoicing, payment collection | Stays. The proposal app sits **upstream** — generates the proposal, uncle still sends the QuickBooks invoice after the job. |
| QuickBooks Payments | Accepts Visa/MC/Amex/Discover/PayPal/Venmo | Stays. The proposal just surfaces these payment methods earlier so clients know before committing. |
| iPhone 16 | Calls, texts, verbal quotes | Stays. The app is a tool on the same phone — opens from home screen, generates PDF, shares via the same text thread. |
| Yahoo email | Business communication | Stays. Untouched. |
| Website (orellanalandscapingllc.net) | Lead generation, credibility | Stays. Logo and branding pulled from the existing site. Proposal links back to it. |
| Verbal quoting | Price communication | **Enhanced, not replaced.** Uncle still decides the price in his head. The app just turns that decision into a professional document. |
| Mental pricing model | "It depends" per-job pricing | **Captured over time.** Every proposal stores (service, price) data. After enough usage, the app can suggest prices based on his own history. His gut becomes quantified — but he's never forced to use the suggestions. |

Nothing gets uninstalled. Nothing changes about how uncle runs his business day-to-day. The app adds one new step between "I know what this costs" and "I tell the client" — and that step produces a branded PDF instead of a verbal number.

## 10. What's NOT in v0

- Calculator/suggested prices (v1 — needs data from real usage first)
- User accounts / team roles (v1 — single shared login for now)
- Client portal / acceptance flow (not in scope)
- Payment processing (uncle uses QuickBooks for that)
- Map / polygon / lot sizing (deferred — uncle prices by job, not sqft)
- Push notifications for follow-ups (v1)
- Analytics dashboard (v1)
- Voice input (v1/v2 — form structure supports it later)
- Photo attachment on proposals (v1/v2)

## 11. Success Criteria

Uncle opens the app from his truck, creates a proposal in under 60 seconds, taps share, client gets a professional branded PDF via text. If financing is enabled, client can scan the QR code and apply for monthly payments. Uncle gets paid.

When that loop runs once for real, by uncle, the product has crossed its threshold.

---

## Appendix: PDF Mockups

Visual mockups for the PDF template are preserved at:
- `.superpowers/brainstorm/44137-1775978787/content/proposal-pdf-mockup-v6.html` (financing below totals — Option B)
- `.superpowers/brainstorm/44137-1775978787/content/proposal-pdf-mockup-v7.html` (both layouts side by side for comparison)

Serve locally to view: these are standalone HTML files.
