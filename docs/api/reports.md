# Reports

Operational counts over the corridor (legacy) product. Canonical multi-route trips are excluded. All figures are computed from stored records; there is no cost, fare or earnings data, so none is reported.

| Endpoint | Role | Returns |
| --- | --- | --- |
| `GET /admin/reports/summary?from&to` | admin | Passenger requests, merchant orders (+ parcels), trips and matches grouped by status; driver totals. |
| `GET /admin/reports/export?dataset=requests\|orders\|trips&from&to` | admin | CSV download, newest first, at most 5,000 rows, no contact details. |
| `GET /merchant/reports/summary?from&to` | merchant | The caller's own orders (+ parcels) and deliveries grouped by status. |

`from` / `to` are optional ISO timestamps filtering on `created_at`; `from > to` is rejected with `400`.

CSV cells beginning with `= + - @`, tab or CR are prefixed with `'` so user-entered labels cannot execute as spreadsheet formulas; the file starts with a UTF-8 BOM so Excel reads Arabic correctly.

Not built: PDF/Excel files, scheduled reports, mobile file export.
