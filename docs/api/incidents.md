# Incident reports

A record-keeping workflow, **not an emergency channel**: filing a report notifies no ambulance, police or on-call staff. The mobile sheet and the Admin queue both say so.

## Reporter (passenger, driver, merchant)

| Endpoint | Behaviour |
| --- | --- |
| `POST /incidents` | `{category, description (3-1000 chars), trip_id?}`. `category` ∈ `safety, delay, parcel_damage, behavior, other`. A `trip_id` must belong to the caller (as driver, passenger or merchant); anything else answers `404` exactly like a missing trip. At most 10 unresolved reports per user (`429 too_many_open_incidents`). |
| `GET /incidents` | The caller's own reports (newest 50). Admin notes are never returned to the reporter. |

## Admin

| Endpoint | Behaviour |
| --- | --- |
| `GET /admin/incidents?status&category&page&limit` | Queue with reporter name/role and `open_total`. |
| `PATCH /admin/incidents/:id` | `{status: reviewing\|resolved, expected_revision, note?}`. Forward-only (`open → reviewing → resolved`, or `open → resolved`); resolved is final. A stale revision or lost race returns `409`. Audited as an `admin_action`; the reporter gets an `incident_updated` notification. |

`GET /admin/dashboard` exposes `counts.open_incidents` for the Overview KPI.

## Not built

Attachments or photos, location capture, escalation rules, SLAs, reopening, and reporting on another user.
