import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Admin driver verification API client", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends Google credentials only to the Admin endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ token: "admin-token" }));
    vi.stubGlobal("fetch", fetchMock);
    await createApiClient("http://api.test").googleLogin("credential");
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/v1/auth/admin/google", expect.objectContaining({ body: JSON.stringify({ id_token: "credential" }) }));
  });

  it("uses the Admin email boundary with no phone payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ token: "admin-token" }));
    vi.stubGlobal("fetch", fetchMock);
    await createApiClient("http://api.test").login("admin@example.com", "secret");
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/v1/auth/admin/login", expect.objectContaining({ body: JSON.stringify({ email: "admin@example.com", password: "secret" }) }));
  });

  it("loads the pending queue and detail with the Admin bearer token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ verifications: [], page: 1, limit: 50, total: 0 }))
      .mockResolvedValueOnce(response({ verification: { id: "verification_1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.driverVerifications("admin-token", "pending");
    await api.driverVerification("admin-token", "driver/user 1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://api.test/api/v1/admin/driver-verifications?status=pending&page=1&limit=50", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer admin-token" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://api.test/api/v1/admin/driver-verifications/driver%2Fuser%201", expect.objectContaining({ method: "GET" }));
  });

  it("sends revision-protected approval with only explicit profile values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ verification: { status: "approved" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.approveDriverVerification("admin-token", "driver_1", 4, {
      vehicle_type: "sedan",
      seats_total: 4,
      parcel_capacity: 6
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v1/admin/driver-verifications/driver_1/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expected_revision: 4, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 6 } })
      })
    );
  });

  it("sends expiry dates with an approval and queries the expiring and re-review lists", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({ verifications: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.approveDriverVerification("admin-token", "driver_1", 4, undefined, { licence: "2027-10-28", insurance: null });
    await api.driverVerificationsExpiring("admin-token", 14, "insurance");
    await api.driverVerificationsReReview("admin-token", "awaiting_driver");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://api.test/api/v1/admin/driver-verifications/driver_1/approve", expect.objectContaining({
      body: JSON.stringify({ expected_revision: 4, expiry: { licence: "2027-10-28", insurance: null } })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://api.test/api/v1/admin/driver-verifications/expiring?within_days=14&kind=insurance&page=1&limit=50", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://api.test/api/v1/admin/driver-verifications/re-review?state=awaiting_driver&page=1&limit=50", expect.anything());
  });

  it("sends the required rejection reason and preserves conflict status for stale reloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: "driver_verification_state_conflict" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await expect(api.rejectDriverVerification("admin-token", "driver_1", 2, "Documents are unclear")).rejects.toEqual(
      expect.objectContaining({ message: "driver_verification_state_conflict", status: 409 })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v1/admin/driver-verifications/driver_1/reject",
      expect.objectContaining({ body: JSON.stringify({ expected_revision: 2, reason: "Documents are unclear" }) })
    );
  });

  it("loads the bounded user directory with role, status, search, and demo filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ users: [], page: 2, limit: 25, total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.users("admin-token", "driver", "pending", 2, 25, "QA driver", "real");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v1/admin/users?page=2&limit=25&search=QA+driver&role=driver&account_status=pending&demo_account=false",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer admin-token" }) })
    );
  });

  it("unwraps the safe user detail and sends an expected-status guard", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ user: { id: "user_1", role: "passenger" } }))
      .mockResolvedValueOnce(response({ user: { id: "user_1", account_status: "suspended" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await expect(api.user("admin-token", "user/1")).resolves.toEqual({ user: { id: "user_1", role: "passenger" } });
    await api.updateUserStatus("admin-token", "user_1", "suspended", "policy breach", "active");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://api.test/api/v1/admin/users/user_1/status", expect.objectContaining({ body: JSON.stringify({ status: "suspended", reason: "policy breach", expected_status: "active" }) }));
  });

  it("refuses an Admin status mutation without the visible expected status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ user: { id: "user_1", account_status: "active" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await expect(
      api.updateUserStatus("admin-token", "user_1", "active", undefined, undefined as never)
    ).rejects.toThrow("Expected account status is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the dedicated bounded Admin trip APIs and sends the visible status snapshot", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ trips: [], page: 2, limit: 25, total: 0 }))
      .mockResolvedValueOnce(response({ trip: { id: "trip/1", status: "accepted" } }))
      .mockResolvedValueOnce(response({ trip: { id: "trip/1", status: "pickup_started" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.adminTrips("admin-token", "accepted", "legacy", 2, 25, "QA driver");
    await api.adminTrip("admin-token", "trip/1");
    await api.advanceAdminTrip("admin-token", "trip/1", "pickup_started", "accepted");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://api.test/api/v1/admin/trips?page=2&limit=25&search=QA+driver&status=accepted&kind=legacy",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer admin-token" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://api.test/api/v1/admin/trips/trip%2F1", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://api.test/api/v1/admin/trips/trip%2F1/status", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ status: "pickup_started", expected_status: "accepted" }),
    }));
  });

  it("sends observed current-version expectations for every route lifecycle mutation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ version: { id: "version_1" } }))
      .mockResolvedValueOnce(response({ version: { id: "version_1" } }))
      .mockResolvedValueOnce(response({ version: { id: "version_1" } }))
      .mockResolvedValueOnce(response({ route: { id: "route_1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.routeVersionAction(
      "admin-token",
      "version_1",
      "pause",
      { reason: "review", expected_current_version_id: "version_1" },
      "pause-key"
    );
    await api.routeVersionAction(
      "admin-token",
      "version_1",
      "resume",
      { expected_current_version_id: "version_1" },
      "resume-key"
    );
    await api.routeVersionAction(
      "admin-token",
      "version_1",
      "retire",
      { reason: "superseded", expected_current_version_id: "version_1" },
      "retire-key"
    );
    await api.retireServiceRoute(
      "admin-token",
      "route_1",
      { reason: "service ended", expected_current_version_id: null },
      "route-retire-key"
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      reason: "review",
      expected_current_version_id: "version_1"
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expected_current_version_id: "version_1" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      reason: "superseded",
      expected_current_version_id: "version_1"
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      reason: "service ended",
      expected_current_version_id: null
    });
  });
});

describe("Admin matching and batching monitoring API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the six read-only monitoring endpoints with encoded query values and IDs", async () => {
    const parcelPage = {
      observed_at: "2026-09-11T10:00:00.000Z",
      scope: "production_supported_legacy",
      data: {
        items: [{ id: "parcel_1", status: "pending" }],
        page: 2,
        limit: 25,
        total: 26,
        has_more: false,
        range: null,
        contents_semantics: "current_eligible_order_contents",
        merchant_order_id: "order_1"
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: {} }))
      .mockResolvedValueOnce(response({ data: { items: [] } }))
      .mockResolvedValueOnce(response({ data: { id: "match_1" } }))
      .mockResolvedValueOnce(response({ data: { items: [] } }))
      .mockResolvedValueOnce(response({ data: { id: "batch_1" } }))
      .mockResolvedValueOnce(response(parcelPage));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.monitoringOverview("admin-token", {
      from: "2026-09-01T00:00:00.000Z",
      until: "2026-09-08T00:00:00.000Z"
    });
    await api.monitoringMatches("admin-token", {
      page: 3,
      limit: 25,
      from: "2026-09-01T00:00:00.000Z",
      until: "2026-09-08T00:00:00.000Z",
      status: "sent_to_driver",
      demand_kind: "combined",
      search: "match/id + one"
    });
    await api.monitoringMatch("admin-token", "match/id one");
    await api.monitoringBatches("admin-token", {
      page: 4,
      limit: 10,
      status: "in_transit",
      search: "batch/id + one"
    });
    await api.monitoringBatch("admin-token", "batch/id one");
    await expect(api.monitoringParcels("admin-token", "batch/id one", { page: 2, limit: 25 })).resolves.toEqual(parcelPage);

    const expectedUrls = [
      "http://api.test/api/v1/admin/matching-batching/overview?from=2026-09-01T00%3A00%3A00.000Z&until=2026-09-08T00%3A00%3A00.000Z",
      "http://api.test/api/v1/admin/matching-batching/matches?page=3&limit=25&from=2026-09-01T00%3A00%3A00.000Z&until=2026-09-08T00%3A00%3A00.000Z&status=sent_to_driver&demand_kind=combined&search=match%2Fid+%2B+one",
      "http://api.test/api/v1/admin/matching-batching/matches/match%2Fid%20one",
      "http://api.test/api/v1/admin/matching-batching/batches?page=4&limit=10&status=in_transit&search=batch%2Fid+%2B+one",
      "http://api.test/api/v1/admin/matching-batching/batches/batch%2Fid%20one",
      "http://api.test/api/v1/admin/matching-batching/batches/batch%2Fid%20one/parcels?page=2&limit=25"
    ];
    expectedUrls.forEach((url, index) => {
      expect(fetchMock).toHaveBeenNthCalledWith(index + 1, url, {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: "Bearer admin-token" },
        body: undefined
      });
    });
  });

  it("omits the default date range instead of manufacturing browser dates", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: {} }))
      .mockResolvedValueOnce(response({ data: { items: [] } }))
      .mockResolvedValueOnce(response({ data: { items: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");

    await api.monitoringOverview("admin-token");
    await api.monitoringMatches("admin-token", {});
    await api.monitoringBatches("admin-token", {});

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://api.test/api/v1/admin/matching-batching/overview",
      "http://api.test/api/v1/admin/matching-batching/matches",
      "http://api.test/api/v1/admin/matching-batching/batches"
    ]);
  });

  it.each([400, 401, 403, 404, 503])("propagates monitoring HTTP %s through shared session handling", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: `monitoring_${status}` }, status));
    vi.stubGlobal("fetch", fetchMock);
    const onSessionEnded = vi.fn();
    const api = createApiClient("http://api.test", { onSessionEnded });

    await expect(api.monitoringMatch("admin-token", "match_1")).rejects.toEqual(
      expect.objectContaining({ message: `monitoring_${status}`, status })
    );
    expect(onSessionEnded).toHaveBeenCalledWith(expect.objectContaining({ status }), "admin-token");
  });
});
