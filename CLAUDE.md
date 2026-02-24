# CLAUDE.md - AI Assistant Reference Guide

## Project Overview

**Client Deliverables Tracker** - Internal web app for tracking healthcare client onboarding deliverables. Tracks completion counts, weekly targets, and pace status for medical summary processing (RECAPs).

**Key Constraint**: HIPAA-compliant - stores only counts/dates, NO PHI (Protected Health Information).

**Users**: Internal operations team managing client deliverables.

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Vanilla JavaScript (ES6+) | Application logic |
| Web Components | Reusable UI elements |
| Tailwind CSS (CDN) | Styling |
| Chart.js 4.4.4 (CDN) | Data visualization |
| Supabase | PostgreSQL backend + Auth |

**No build step** - pure static files served directly.

---

## File Structure

```
├── index.html          # Dashboard - KPIs, charts, due this week
├── clients.html        # Client list with CRUD operations
├── client-detail.html  # Single client view with weekly targets
├── staffing.html       # SPH metrics, capacity planner
├── partners.html       # Sales partner grouping view
├── login.html          # Authentication
│
├── script.js           # Main logic (dashboard, clients, partners) ~1660 lines
├── staffing.js         # SPH calculations, capacity planning ~420 lines
├── auth.js             # Authentication (signIn, signOut, requireAuth)
├── supabaseClient.js   # Singleton Supabase client
├── env.js              # Credentials (SUPABASE_URL, SUPABASE_ANON_KEY)
│
├── navbar.js           # <app-navbar> component
├── kpi-card.js         # <kpi-card> component
├── status-badge.js     # <status-badge> component (R/Y/G)
├── footer.js           # <app-footer> component
├── toast.js            # Toast notification system
│
└── style.css           # Minimal custom CSS (Tailwind handles most)
```

---

## Database Schema (Supabase/PostgreSQL)

### clients
```sql
id UUID PK, name TEXT, acronym TEXT, total_lives INT,
contact_name TEXT, contact_email TEXT, instructions TEXT,
sales_partner TEXT, completed BOOL, paused BOOL
```

### weekly_commitments
```sql
id UUID PK, client_fk UUID FK, weekly_qty INT,
start_week DATE, active BOOL
```
*Baseline weekly target. `active=true` is current commitment.*

### weekly_overrides
```sql
id UUID PK, client_fk UUID FK, week_start DATE,
weekly_qty INT, note TEXT
```
*Per-week target overrides (takes precedence over baseline).*

### completions
```sql
id UUID PK, client_fk UUID FK, occurred_on DATE,
qty_completed INT, qty_utc INT, note TEXT
```
*`qty_utc` = Unable To Complete count.*

### staffing_snapshots
```sql
id UUID PK, effective_date DATE, staff_count INT, note TEXT
```
*Staff headcount history for SPH calculations.*

### Related Tables
- `client_addresses` - Multi-address per client (line1, line2, city, state, zip)
- `client_emrs` - EMR systems per client (vendor, details)

---

## Core Concepts

### Work Week
- **Monday-Friday** workweek
- All dates use **America/New_York** timezone
- Staff hours: **8 hours/day**

### Weekly Target Calculation
```
Final Target = Override (if exists) OR Baseline
Required = Final Target + Carry-in from last week
Remaining = Required - Completed this week
```

### Status (R/Y/G)
- **Red**: Has carry-in from previous week
- **Yellow**: >100 remaining per day
- **Green**: On pace

### SPH (Summaries Per Hour)
```
SPH = daily_completed / (staff_count × 8)
```

---

## Key Functions (script.js)

### Date Utilities
```javascript
ymdEST(d)              // Date → 'YYYY-MM-DD' in EST
todayEST()             // Today as Date at midnight EST
mondayOf(date)         // Get Monday of week
fridayEndOf(monday)    // Friday 23:59:59
toYMD(val)             // Coerce string/Date → 'YYYY-MM-DD'
```

### Business Logic
```javascript
// Find baseline for a specific week
pickBaselineForWeek(commitRows, clientId, refMon) → Number

// Find override for a specific week (or null)
overrideForWeek(overrideRows, clientId, refMon) → Number|null

// Get final target (override ?? baseline)
baseTargetFor(ovr, wk, clientId, weekMon) → Number

// Sum completions in date range
sumCompleted(rows, clientId, from, to) → Number

// Check if client has started (has commitment or completions)
isStarted(clientId, commits, completions) → Boolean
```

### Page Loaders
```javascript
loadDashboard()      // Fetches data, renders KPIs + chart + table
loadClientsList()    // Renders clients table with filters
loadClientDetail()   // Renders single client view
loadPartnersPage()   // Renders partner tabs + table + PDF report UI
```

### Recommendations Engine
```javascript
allocatePlan(rows, days, options) → { slots, totals }
// Distributes work across days using scenarios:
// - 'even': Equal distribution
// - 'risk': Prioritize red/yellow status
// - 'frontload': More work early in week
// - 'capacity': Honor daily capacity limits
```

### Partner PDF Reports
```javascript
sumCompletedInMonth(comps, clientId, year, month) → Number
// Sum completions for a specific calendar month

generatePartnerPDF(partnerName, includeMonthly, includeLifetime, selectedClientIds) → void
// Generates branded PDF with jsPDF + jspdf-autotable
// Includes logo, table with selected columns, disclaimer
// Filters to only selected clients if selectedClientIds provided

getClientStatus(client, wk) → 'active' | 'paused' | 'completed' | 'not_started'
// Determines client status for display and default selection

getStatusBadgeHTML(status) → String
// Returns HTML for colored status badge (green/amber/blue/gray)

wirePartnerReportUI() → void
// Wires up partner report form:
// - Populates client checklist when partner selected
// - Pre-checks Active/Completed, unchecks Paused
// - Handles Select All / Deselect All
// - Validates partner, columns, and client selection
```

---

## Key Functions (staffing.js)

```javascript
fetchData(daysBack)                    // Get completions + snapshots
groupCompletionsByESTDay(comps)        // Map<'YYYY-MM-DD', total>
staffCountForDate(dateYMD, snapsSorted) // Lookup staff for date
buildDailySeriesEST(compsMap, snaps, days) // Build metrics arrays
computeMetrics(sphSeries)              // {l7avg, l7p90, l30avg, l30p25}
recalcPlanner(metrics)                 // Calculate required staff
```

---

## State Management

### Global Variables (script.js)
```javascript
__weekOffset        // Week navigation (0 = this week, -1 = last, +1 = next)
__rowsForRec        // Cached data for recommendations modal
__dashboardSort     // {col: 'remaining', dir: 'desc'}
__dashboardRows     // Cached dashboard table data
__clientsCache      // {clients: [], wk: [], comps: []}
__clientsSort       // {col: 'name', dir: 'asc'}
```

### Data Flow
1. Page loads → `requireAuth()` checks session
2. Data fetched from Supabase
3. Results cached in global variables
4. DOM rendered with template literals
5. User actions → Supabase mutations → Re-fetch → Re-render

---

## Common Patterns

### Supabase Queries
```javascript
const supabase = await getSupabase();
if (!supabase) return toast.error('Supabase not configured.');

const { data, error } = await supabase
  .from('table')
  .select('columns')
  .eq('field', value);
```

### Modal Open/Close
```javascript
// Open
modal.classList.remove('hidden');
modal.classList.add('flex');

// Close
modal.classList.add('hidden');
modal.classList.remove('flex');
```

### Table Row Event Delegation
```javascript
tableBody.onclick = (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  // Handle action
};
```

### Loading States
```javascript
showLoading('elementId', 'Loading message...');
// ... fetch data ...
hideLoading('elementId');
```

---

## Web Components

| Element | File | Attributes |
|---------|------|------------|
| `<app-navbar>` | navbar.js | - |
| `<kpi-card>` | kpi-card.js | label, value, hint |
| `<status-badge>` | status-badge.js | status (red/yellow/green) |
| `<app-footer>` | footer.js | - |
| `<toast-container>` | toast.js | (auto-created) |

### Toast Usage
```javascript
import { toast } from './toast.js';
toast.success('Saved successfully');
toast.error('Failed to save');
toast.warning('Enter a value');
toast.info('No changes detected');
```

---

## Important Gotchas

1. **Timezone**: All date logic uses EST (`America/New_York`). Use `ymdEST()` for consistency.

2. **Date columns**: Supabase DATE columns store 'YYYY-MM-DD' strings. Send dates as strings, not ISO timestamps.

3. **Foreign key naming**: Uses `client_fk` (not `client_id`) for foreign keys.

4. **Active commitments**: Filter by `active: true` to get current baseline.

5. **Carry-in**: Only calculated when there's an active baseline for the prior week.

6. **Weekend handling**: Weekends are skipped in SPH calculations unless work was logged.

7. **Paused clients**: Excluded from dashboard calculations. Resume resets start_week to current week.

8. **Completed clients**: Excluded from all active calculations.

---

## Development Setup

1. Create `env.js`:
```javascript
export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

2. Serve with any static server:
```bash
npx serve .
# or
python -m http.server 8000
```

3. Access at `http://localhost:PORT/login.html`

---

## Database Setup

Run in Supabase SQL Editor:
```sql
-- See README.md for full schema
-- Key tables: clients, weekly_commitments, weekly_overrides,
-- completions, staffing_snapshots, client_addresses, client_emrs
```

Enable RLS and add policies for authenticated users.

---

## Modification Guidelines

### Adding a New Page
1. Create `newpage.html` with standard structure
2. Include common modules in script tags
3. Add nav link in `navbar.js`
4. Add page-specific logic to `script.js` or new module

### Adding a Database Column
1. Add column in Supabase Table Editor
2. Update relevant queries in JS files
3. Update forms/displays as needed

### Adding a Web Component
1. Create `component-name.js` with class extending HTMLElement
2. Define `observedAttributes` if reactive
3. Register with `customElements.define()`
4. Import in HTML pages that use it

### Modifying Calculations
- Weekly targets: `baseTargetFor()`, `pickBaselineForWeek()`
- Completions: `sumCompleted()`
- Status: Look for `status = carryIn > 0 ? 'red' : ...` pattern
- SPH: `buildDailySeriesEST()` in staffing.js

---

## Testing Checklist

When modifying core logic, verify:
- [ ] Dashboard KPIs calculate correctly
- [ ] Carry-in from previous week works
- [ ] Week navigation shows correct data
- [ ] Client create/edit/delete works
- [ ] Completion logging updates totals
- [ ] Paused clients excluded from dashboard
- [ ] Completed clients excluded appropriately
- [ ] SPH calculations respect staff snapshots
- [ ] Recommendations allocate correctly
