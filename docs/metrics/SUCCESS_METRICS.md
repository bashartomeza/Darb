# Masari success metrics

Source: Team 6 project proposal, section 9.6 "Success Targets" (page 22), plus the AI success metric in section 9.3 (page 21).
The PDF table is laid out in two columns that extract out of order; the pairing below follows the row order of both columns.

Implementation: `apps/api/src/services/successMetrics.ts` (pure computation), `GET /api/v1/admin/success-metrics` and `/export` (admin only), admin page "Success metrics" inside the Reports module.
All values are aggregates; no names, phones, emails or ids are returned or exported. Records are scoped to the legacy corridor product (`operational_mode = legacy`), like the existing reports.

| Key | Metric (PDF) | Target (PDF) | Definition used | Data source | Status |
|---|---|---|---|---|---|
| `matching_time` | Passenger matching time | Less than 2 minutes in demo scenario | Median seconds from `PassengerRequest.created_at` to the creation of its trip (driver acceptance) for trips created in the range. Pass when the median is below 120 s. | `trips`, `passenger_requests` | Computed |
| `ai_understanding` | AI request understanding | At least 85% on test examples | Share of labelled pilot examples understood correctly. | none (no labelled example set or harness) | No data yet |
| `status_continuity` | Delivery tracking completion | At least 95% status continuity | Of trips that reached `completed`, the share whose recorded status history walks every step `accepted, pickup_started, picked_up, in_transit, delivered, completed` with no gap. Pass at 95% or more. | `trips`, `audit_events` (`trip_status_updated`) | Computed |
| `batch_efficiency` | Batch delivery efficiency | Lower cost than individual delivery | Trips per parcel on batched deliveries (cost proxy; individual delivery is 1.0 trip per parcel). Pass when below 1.0. | `trips`, `parcel_batches`, `parcels` | Computed |
| `driver_utilization` | Driver utilization | More requests served per route | Completed passenger requests and merchant orders per driver route used by trips in the range. Pass when above 1.0 (the one request per trip of the nearest-driver baseline). | `trips`, `driver_routes` | Computed |
| `user_satisfaction` | User satisfaction | 4 out of 5 or higher | Mean of optional 1-5 post-trip ratings. Pass at 4.0 or more. | none yet; no rating model exists on this branch | No data yet |
| `driver_verification` | Driver verification | 100% of active pilot drivers verified | Share of drivers with an `active` account whose profile is verified. A point-in-time snapshot, not range-scoped. | `driver_profiles`, `users` | Computed |
| `pickup_clarity` | Pickup clarity | Clear reduction in pickup confusion | Needs a pickup-confusion signal (for example a post-trip "was the pickup clear" answer). | none | No data yet |
| `route_deviation` | Route deviation | Kept within acceptable route limits | Needs actual driven path versus planned route. | none (location events are demo-simulated) | No data yet |

## Trend

Every computed metric is also computed for the immediately preceding window of equal length. The trend is `improving`, `worsening`, `flat` or `none` (a window had no data), judged in the direction that is better for that metric (lower is better for matching time and batch cost).

## Gaps and how to close them

- Satisfaction: when the passenger rating model from the trust-score work lands, pass its 1-5 values to `computeSuccessMetrics` as `ratings`; the metric then switches from "no data yet" automatically. No schema was added here to avoid a conflicting migration.
- AI understanding: needs a labelled Palestinian Arabic example set and an evaluation script.
- Pickup clarity and route deviation: need new capture (a post-trip question; GPS traces from the driver app).
