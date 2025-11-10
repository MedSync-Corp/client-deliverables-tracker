# Client Deliverables Tracker (MVP)

A lightweight internal web app to track onboarding client deliverables (counts and due dates only – **no PHI**). Upload a single CSV, log completions in the UI, and view live remaining and simple R/Y/G pace status.

## Repo Layout
```
client-deliverables-tracker/
├─ index.html               # Dashboard (CSV import lives here)
├─ clients.html             # Clients list
├─ client-detail.html       # Per-client view
├─ assets/
│  └─ style.css
├─ components/
│  ├─ navbar.js
│  ├─ kpi-card.js
│  ├─ status-badge.js
│  └─ footer.js
├─ js/
│  ├─ env.sample.js         # Copy to env.js and set Supabase URL + anon key
│  ├─ env.js                # ignored in Git (you’ll create locally)
│  ├─ supabaseClient.js     # Minimal Supabase client
│  └─ script.js             # Page logic (dashboard + CSV importer + simple views)
├─ data/
│  └─ sample.csv            # Example CSV for testing
└─ README.md
```

## Quick Start (no database yet)
1. Open `index.html` directly in a browser.
2. Use **Choose CSV** and **Preview** to see parsed rows. No data is persisted until you configure Supabase.

## Supabase Setup (Recommended)
1. Create a new [Supabase](https://supabase.com) project.
2. Run the SQL below in **Table Editor → SQL** to create tables and indexes:

```sql
-- Enable required extensions (if needed)
-- NOTE: In Supabase, pgcrypto may be pre-enabled; adjust as necessary.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- Core tables
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,              -- optional, from CSV
  name text not null,
  addresses text,                     -- semicolon-separated
  contact_name text,
  contact_email text,
  products text,                      -- semicolon-separated
  instructions text,
  start_date date,
  inserted_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Fallback uniqueness by name if no client_id provided
create unique index if not exists clients_name_unique_when_no_id
  on clients (lower(name))
  where client_id is null;

create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  deliverable_id text unique,         -- optional, from CSV
  client_fk uuid references clients(id) on delete cascade,
  due_date date not null,
  qty_due integer not null,
  label text,
  inserted_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Fallback uniqueness to prevent dupes when no deliverable_id provided
create unique index if not exists deliverables_fallback_unique
  on deliverables (client_fk, due_date, coalesce(label,''));

create table if not exists completions (
  id uuid primary key default gen_random_uuid(),
  deliverable_fk uuid references deliverables(id) on delete cascade,
  occurred_on date not null,
  qty_completed integer not null,
  note text,
  inserted_by text,                   -- email (optional)
  inserted_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Convenience view for remaining-to-due
create or replace view deliverable_progress as
select
  d.id as deliverable_id,
  d.client_fk,
  d.due_date,
  d.qty_due,
  coalesce(sum(case when c.occurred_on <= d.due_date then c.qty_completed end),0) as completed_to_due,
  d.qty_due - coalesce(sum(case when c.occurred_on <= d.due_date then c.qty_completed end),0) as remaining_to_due
from deliverables d
left join completions c on c.deliverable_fk = d.id
group by d.id;
```

3. **RLS:** Leave RLS enabled (default), then add basic policies for authenticated users.
   - For quick testing, you can add permissive policies (read/write for authenticated) and tighten later.

4. Create `js/env.js` (copy from `js/env.sample.js`) and set:
```js
export const SUPABASE_URL = "https://YOUR-PROJECT-ref.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

5. Serve locally (any static server) or deploy to **GitHub Pages** (Settings → Pages → select branch). Add your `https://<user>.github.io/<repo>` origin to Supabase **Auth → URL configuration** and **CORS** allowed origins.

## CSV Schema (example)
```
client_id,client_name,addresses,contact_name,contact_email,products,instructions,start_date,deliverable_id,due_date,qty_due,label
,Acme Health,"123 Main; 50 Oak","Jane Smith",jane@acme.com,"Summaries","Prioritize DX…","2025-10-20",,2025-10-31,1500,Initial drop
,Acme Health,"123 Main; 50 Oak","Jane Smith",jane@acme.com,"Summaries","Prioritize DX…","2025-10-20",,2025-11-07,1000,Weekly Friday drop
UUID-Contoso,Contoso Clinics,"22 Pine Ave","Sam Lee",sam@contoso.com,"Summaries","Focus PCP first","2025-11-01",DLV-001,2025-11-14,800,Wave 1
```

## Notes
- **Importer behavior:** Upserts Clients by `client_id` when present; otherwise searches by case-insensitive `name`. Deliverables upsert by `deliverable_id` when present; otherwise uses the composite (client, due_date, label).
- **Pace status:** Basic placeholder logic; refine once completion history accrues.
- **Security:** Keep only **counts/dates/notes**—no PHI. Restrict Supabase policies to your org’s users.
