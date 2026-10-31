# Merchant bulk orders and smart batching (legacy corridor)

All limits live in `apps/api/src/lib/batchingConfig.ts` (`BATCHING_LIMITS`). Nothing else hard-codes them.

| Limit | Value |
| --- | --- |
| Parcels per order | 50 (was 10) |
| Parcels per batch | 50 |
| Orders per batch | 50 |
| Rows per bulk upload | 50 |
| CSV size | 48,000 characters |
| Size-weighted load per batch | 80 units (S=1, M=2, L=4) |
| Large parcels per batch | 12 |
| Pickup radius within a batch | 1 km |
| Dropoff spread within a batch | 6 km from the batch's first dropoff |
| Bulk submits per merchant | 10 per hour |
| Bulk previews per merchant | 60 per hour |

## Smart batching

`POST /merchant/orders/:id/batch` now uses the pure planner `planBatches` (`apps/api/src/services/batchPlanner.ts`). It takes the merchant's still-submitted orders and groups them by:

- pickup within 1 km;
- dropoff proximity (centroid of each order's parcels), swept in the order dropoffs are met travelling away from the pickup;
- optional time windows (disjoint windows never share a batch; the planner accepts them, legacy orders carry none today);
- vehicle capacity: parcels, orders, size-weighted load and large parcels. When capacity is exceeded the remaining orders form further batches. A single order that alone exceeds capacity is reported as unbatchable (`order_exceeds_batch_capacity`, HTTP 400), never overloading a driver.

The result is deterministic: input order does not change the plan (ties break on order id). The batch created for the requested order contains only the orders the planner grouped with it.

## Bulk upload

Both endpoints require a merchant session.

### `POST /merchant/orders/bulk/preview`

Body `{ "csv": "..." }`. Writes nothing. Returns `total_rows`, `valid_order_count`, `errors[]`, the orders that would be created, and `batch_plan` (how they would be grouped).

### `POST /merchant/orders/bulk`

Body `{ "csv": "...", "skip_invalid": false, "auto_batch": false }` and a required `Idempotency-Key` header (8-128 chars of `A-Za-z0-9._:-`).

- Each order is created by the existing `createLegacyMerchantOrder` function (the same path as `POST /merchant/orders`) in its own transaction, with a per-order key derived from the upload key and the order content. Retrying the same upload replays every created order (`status: "replayed"`) and creates nothing twice. An edited row creates a new order while unedited rows replay. Identical rows in one file stay distinct orders.
- If any row is invalid the request is rejected with 400 `bulk_validation_failed` unless `skip_invalid` is true, in which case valid rows are created and invalid rows are listed.
- Partial failure: the response has `summary { total_rows, created, replayed, failed }` and `results[]` with a `status` of `created`, `replayed`, `failed` or `invalid` per order/row. HTTP 201 when at least one order was created, otherwise 200.
- `auto_batch: true` runs the batcher for the created orders afterwards (`batch_ids`).
- Abuse limits return 429 `bulk_rate_limit_exceeded` with `Retry-After`.

### CSV format

Header row required. Columns: `pickup_label, pickup_lat, pickup_lng, destination_label, destination_lat, destination_lng, size, priority` and optional `order_ref`. Comma, semicolon or tab separated (spreadsheet paste works). Rows sharing a non-empty `order_ref` and the same pickup become one multi-parcel order; every other row is its own order. `size` is S/M/L (also small/medium/large and Arabic words); `priority` defaults to `normal`. Arabic-Indic digits are accepted in numbers.

### Row errors

`errors[]` entries: `{ row, field, code, message_en, message_ar }`. `row` is the 1-based spreadsheet row (header = 1); `0` means the whole file. Codes: `csv_empty`, `csv_too_large`, `csv_too_many_rows`, `csv_missing_column`, `csv_unterminated_quote`, `row_missing_field`, `row_invalid_number`, `row_out_of_range`, `row_too_long`, `row_invalid_size`, `row_invalid_priority`, `row_order_ref_pickup_mismatch`, `row_too_many_parcels`.

## Flutter merchant app

`/merchant/order/bulk` (linked from the order form): paste or edit a CSV, preview (validation errors in the app language, suggested group count), choose to skip invalid rows, submit, see the per-row result. The upload keeps one idempotency key in memory until its content changes, so pressing submit again after a lost response is safe. The screen's strings live in the screen file (EN and AR) rather than the ARB files.
