# Paycheck Split — Hong Kong

A one-page, no-build budget splitter for Hong Kong paychecks. Enter your gross monthly income; MPF and a salaries-tax provision are deducted first, then the rest splits into five buckets. Line items go under each bucket, and everything can be exported to / imported from CSV.

**Live:** https://budget.logansolaman.com

## Why the tax line exists

Hong Kong has no monthly tax withholding. The employer pays out gross (less MPF) and the IRD bills you after the year is assessed, so a salaried person has to provision the tax themselves. The split in most social-media budget templates (55/5/10/15/15 on a US paycheck) assumes tax is already gone. Here the order is:

1. Gross monthly income
2. − employee MPF (5%, capped at HK$1,500/month)
3. − monthly salaries-tax provision
4. = amount to allocate, split into Essentials / Fun / Debt / Save / Invest

## Tax calculation

Salaries tax is annualised (monthly income × 12), then:

- **Net income** = gross − MPF deduction (capped at HK$18,000/year)
- **Net chargeable income** = net income − basic allowance
- **Progressive**: 2%, 6%, 10%, 14%, 17% on successive HK$50,000 bands above the allowance
- **Standard rate**: 15% on net income up to HK$5,000,000, 16% above
- Tax = **lower** of the two. Monthly provision = annual tax ÷ 12.

Defaults for year of assessment 2026/27: basic allowance HK$145,000 (raised from HK$132,000), MPF cap HK$1,500/month. Both are editable in the "Tax assumptions" panel.

Assumes a full year of Hong Kong employment, no dependants, no other deductions, and no one-off tax reduction applied. It is a planning tool, not tax advice — reconcile against the IRD demand note.

**Year two caveat:** the first real IRD bill is normally final tax for the past year *plus* provisional tax for the current year, so cash out is roughly double one year's tax. The monthly provision should stay parked, not be spent once the first bill clears.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup — single page |
| `styles.css` | Styling, light + dark via `prefers-color-scheme` |
| `app.js` | All logic: tax engine, split allocation, line items, localStorage, CSV |
| `CNAME` | Custom domain for GitHub Pages |

No framework, no build step, no backend, no dependencies. State lives in `localStorage` under `paycheck-split.hk.v1`; the CSV is for moving settings between browsers or devices.

## CSV format

Four columns, one row per setting or line item — readable and editable in Excel or Sheets:

```
type,category,name,amount
setting,income,,30000
setting,mpf_on,,1
setting,mpf_rate,,5
setting,mpf_cap,,1500
setting,tax_on,,1
setting,allowance,,145000
setting,pct_essentials,,55
setting,pct_fun,,5
setting,pct_debt,,10
setting,pct_save,,15
setting,pct_invest,,15
item,essentials,Rent,12000
item,essentials,Groceries,3500
```

- `type` is `setting` (uses `category` + `amount`) or `item` (uses `category` as the bucket key, plus `name` + `amount`).
- Bucket keys: `essentials`, `fun`, `debt`, `save`, `invest`.
- Toggles use `1`/`0`. Import is tolerant: header optional, unknown rows ignored, `true`/`yes` accepted.
- Names containing commas must be quoted (exports handle this automatically).

## Local development

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly over `file://` works too.

## Deploy

Static hosting on GitHub Pages from the `main` branch root, with `CNAME` set to `budget.logansolaman.com`. DNS is a CNAME record for `budget` → `logansolaman.github.io` (DNS only, not proxied).
