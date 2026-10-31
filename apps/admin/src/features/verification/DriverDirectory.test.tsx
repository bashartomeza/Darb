import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DriverProfile, DriverVerification } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { createDriverAccountChange, DriverDirectory, DriverReviewPanel, expiryInputFrom } from "./DriverDirectory";

function withLocale(locale: Locale, children: ReactNode) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  return renderToStaticMarkup(
    <LocaleProvider storage={storage} documentRef={documentRef}>
      {children}
    </LocaleProvider>
  );
}

function textOf(markup: string) {
  return markup.replace(/<[^>]*>/g, " ");
}

const driver: DriverProfile = {
  id: "driver_profile_1",
  vehicle_type: "van",
  seats_total: 6,
  parcel_capacity: 12,
  verified: false,
  trust_score: 86,
  created_at: "2026-07-01T00:00:00.000Z",
  user: {
    id: "user_2",
    name: "Demo Driver Hebron Route",
    phone: "+970590000002",
    role: "driver",
    account_status: "active",
    status_reason: null,
    status_updated_at: "2026-07-01T00:00:00.000Z",
    last_login_at: "2026-08-01T10:00:00.000Z",
    demo_account: true,
    created_at: "2026-07-01T00:00:00.000Z"
  }
};

const verification: DriverVerification = {
  id: "verification_1",
  revision: 1,
  status: "pending",
  rejection_reason: null,
  submitted_at: "2026-08-18T10:00:00.000Z",
  reviewed_at: null,
  reviewer: null,
  history: [],
  candidate: { ...driver.user!, account_status: "pending" },
  driver_profile: null,
  evidence: { status: "not_collected", items: [], documents: [] }
};

const panelProps = {
  busy: false,
  action: null,
  reason: "",
  profile: { vehicle_type: "", seats_total: "", parcel_capacity: "" },
  onAction: () => undefined,
  onReasonChange: () => undefined,
  onProfileChange: () => undefined,
  onConfirm: () => undefined,
  onClose: () => undefined
} as const;

describe("driver document expiry", () => {
  const restricted: DriverVerification = {
    ...verification,
    status: "documents_expired",
    renewal_submitted_at: "2026-10-29T08:00:00.000Z",
    expiry: {
      licence: { expires_on: "2026-10-01", days_left: -28 },
      vehicle_registration: null,
      insurance: { expires_on: "2026-11-20", days_left: 22 },
      contract: null
    }
  };

  it("sends only filled, well-formed dates", () => {
    expect(expiryInputFrom({ licence: "2027-10-28", vehicle_registration: "", insurance: "28/10/2027", contract: "" })).toEqual({ licence: "2027-10-28" });
  });

  it("shows recorded expiry dates and the restriction in English and Arabic", () => {
    const en = textOf(withLocale("en", <DriverReviewPanel verification={restricted} {...panelProps} />));
    expect(en).toContain("Driving licence");
    expect(en).toContain("2026-10-01");
    expect(en).toContain("expired");
    expect(en).toContain("22 days left");
    expect(en).toContain("Access restricted: documents expired");
    const ar = textOf(withLocale("ar", <DriverReviewPanel verification={restricted} {...panelProps} />));
    expect(ar).toContain("رخصة القيادة");
    expect(ar).toContain("الوصول مقيّد لانتهاء المستندات");
  });

  it("asks for new dates when approving a submitted renewal", () => {
    const en = textOf(withLocale("en", <DriverReviewPanel verification={{ ...restricted, status: "pending" }} {...panelProps} action="approve" />));
    expect(en).toContain("licence expiry is required");
  });
});

describe("driver verification module", () => {
  it("renders real driver rows rather than an unavailable placeholder", () => {
    const markup = textOf(
      withLocale("en", <DriverDirectory drivers={[driver]} search="" busy={false} onUpdateStatus={() => {}} />)
    );

    expect(markup).toContain("Demo Driver Hebron Route");
    expect(markup).toContain("+970590000002");
    expect(markup).toContain("86");
    // The placeholder copy must be gone now that the module is API-backed.
    expect(markup).not.toContain("This module is not available yet");
  });

  it("shows the trust score with its components, in both languages", () => {
    const scored: DriverProfile = {
      ...driver,
      trust_components: {
        experience: { value: 0.76, sample: 8, weight: 10 },
        cancellation: { value: 0.9, sample: 10, weight: 25 },
        departure: { value: 0.8, sample: 6, weight: 20 },
        arrival: { value: 0.7, sample: 0, weight: 15 },
        rating: { value: 0.85, sample: 4, weight: 30 }
      }
    };
    const english = textOf(withLocale("en", <DriverDirectory drivers={[scored]} search="" busy={false} onUpdateStatus={() => {}} />));
    expect(english).toContain("Passenger ratings");
    expect(english).toContain("Departure punctuality");
    expect(english).toContain("90% from 10 observed");
    const arabic = textOf(withLocale("ar", <DriverDirectory drivers={[scored]} search="" busy={false} onUpdateStatus={() => {}} />));
    expect(arabic).toContain("تقييمات الركاب");
  });

  it("says the score is not computed yet when there is no breakdown", () => {
    const markup = textOf(withLocale("en", <DriverDirectory drivers={[driver]} search="" busy={false} onUpdateStatus={() => {}} />));
    expect(markup).toContain("Not computed yet");
  });

  it("renders the real pending queue and its server-backed review action", () => {
    const markup = textOf(
      withLocale("en", <DriverDirectory drivers={[driver]} initialVerifications={[verification]} search="" busy={false} onUpdateStatus={() => {}} />)
    );

    expect(markup).toContain("Unverified");
    expect(markup).toContain("1 verification requests");
    expect(markup).toContain("Demo Driver Hebron Route");
    expect(markup).not.toContain("Approve");
    expect(markup).not.toContain("Reject");
    expect(markup).toContain("Review details");
  });

  it("renders authoritative candidate state and honestly reports missing evidence and profile", () => {
    const markup = textOf(withLocale("en", <DriverReviewPanel verification={verification} {...panelProps} />));

    expect(markup).toContain("Profile");
    expect(markup).toContain("Demo Driver Hebron Route");
    expect(markup).toContain("+970590000002");
    expect(markup).toContain("No driver profile exists yet");
    expect(markup).toContain("does not collect verification documents or evidence");
    expect(markup).toContain("Approve driver");
    expect(markup).toContain("Reject driver");
  });

  it("lists recorded evidence and offers the form only while the review is pending", () => {
    const withEvidence = { ...verification, evidence: { status: "recorded" as const, items: [{ id: "e1", kind: "driver_licence" as const, note: "Valid to 2028", recorded_by: { id: "admin_1", name: "QA Admin" }, created_at: "2026-10-26T10:00:00.000Z" }], documents: [{ id: "doc_1", kind: "national_id" as const, mime_type: "image/jpeg", size_bytes: 2048, created_at: "2026-10-26T11:00:00.000Z" }] } };
    const pendingMarkup = textOf(withLocale("en", <DriverReviewPanel verification={{ ...withEvidence, status: "pending" }} {...panelProps} onRecordEvidence={() => undefined} onDownloadDocument={() => undefined} />));
    expect(pendingMarkup).toContain("Driver licence");
    expect(pendingMarkup).toContain("Valid to 2028");
    expect(pendingMarkup).toContain("Record sighting");
    expect(pendingMarkup).toContain("Uploaded document");
    expect(pendingMarkup).toContain("National ID");
    expect(pendingMarkup).toContain("Download");

    const decidedMarkup = textOf(withLocale("en", <DriverReviewPanel verification={{ ...withEvidence, status: "approved" }} {...panelProps} onRecordEvidence={() => undefined} />));
    expect(decidedMarkup).toContain("Valid to 2028");
    expect(decidedMarkup).not.toContain("Record sighting");
  });

  it("preserves equivalent queue and decision semantics in Arabic", () => {
    const markup = textOf(withLocale("ar", <DriverReviewPanel verification={verification} {...panelProps} />));

    expect(markup).toContain("مراجعة السائق");
    expect(markup).toContain("الملف الشخصي");
    expect(markup).toContain("المركبة");
    expect(markup).toContain("التوثيق");
    expect(markup).toContain("لا يجمع مسار التسجيل الحالي مستندات أو أدلة توثيق");
    expect(markup).toContain("قبول السائق");
    expect(markup).toContain("رفض السائق");
  });

  it("requires explicit vehicle values for a candidate without a profile", () => {
    const markup = withLocale("en", <DriverReviewPanel verification={verification} {...panelProps} action="approve" />);

    expect(textOf(markup)).toContain("Confirm driver approval");
    expect(markup).toContain('type="number"');
    expect(markup).toContain("disabled");
  });

  it("shows the persisted rejection reason without further decision buttons", () => {
    const rejected = { ...verification, status: "rejected", revision: 2, rejection_reason: "Licence image was unreadable", reviewed_at: "2026-08-19T09:00:00.000Z", reviewer: { id: "admin_1", name: "Demo Admin" } } satisfies DriverVerification;
    const markup = textOf(withLocale("en", <DriverReviewPanel verification={rejected} {...panelProps} />));

    expect(markup).toContain("Rejected");
    expect(markup).toContain("Licence image was unreadable");
    expect(markup).toContain("Demo Admin");
    expect(markup).not.toContain("Approve driver");
    expect(markup).not.toContain("Reject driver");
  });

  it("offers re-review of a rejected application, and shows the prior decision history", () => {
    const rejected = {
      ...verification,
      status: "rejected",
      revision: 2,
      rejection_reason: "Licence image was unreadable",
      history: [{ id: "h1", revision: 1, decision: "rejected", reason: "Licence image was unreadable", decided_by: { id: "admin_1", name: "Demo Admin" }, created_at: "2026-08-19T09:00:00.000Z" }]
    } satisfies DriverVerification;
    const markup = textOf(withLocale("en", <DriverReviewPanel verification={rejected} {...panelProps} />));

    expect(markup).toContain("Reopen for review");
    expect(markup).toContain("Decision history");
    expect(markup).toContain("Licence image was unreadable");
  });

  it("asks for a reason before reopening", () => {
    const rejected = { ...verification, status: "rejected", revision: 2, rejection_reason: "x y z" } satisfies DriverVerification;
    const markup = textOf(withLocale("en", <DriverReviewPanel verification={rejected} {...panelProps} action="reopen" />));

    expect(markup).toContain("Reason for reopening");
    expect(markup).toContain("Confirm reopening");
  });

  it("keeps an approved application final", () => {
    const approved = { ...verification, status: "approved", revision: 2 } satisfies DriverVerification;
    const markup = textOf(withLocale("en", <DriverReviewPanel verification={approved} {...panelProps} />));

    expect(markup).not.toContain("Reopen for review");
  });

  it("offers suspension for an active account and reactivation for a suspended one", () => {
    const active = textOf(
      withLocale("en", <DriverDirectory drivers={[driver]} search="" busy={false} onUpdateStatus={() => {}} />)
    );
    expect(active).toContain("Suspend account");

    const suspended: DriverProfile = {
      ...driver,
      user: { ...driver.user!, account_status: "suspended", status_reason: "documents expired" }
    };
    const markup = textOf(
      withLocale("en", <DriverDirectory drivers={[suspended]} search="" busy={false} onUpdateStatus={() => {}} />)
    );

    expect(markup).toContain("Reactivate");
    expect(markup).toContain("documents expired");
    expect(markup).not.toContain("Suspend account");
  });

  it("captures the visible driver status for optimistic account concurrency", () => {
    expect(createDriverAccountChange(driver, "suspended")).toEqual({
      driver,
      status: "suspended",
      expectedStatus: "active"
    });

    const suspended: DriverProfile = {
      ...driver,
      user: { ...driver.user!, account_status: "suspended", status_reason: "documents expired" }
    };
    expect(createDriverAccountChange(suspended, "active")).toEqual({
      driver: suspended,
      status: "active",
      expectedStatus: "suspended"
    });
  });

  it("does not turn a pending account into a fake reactivation or approval action", () => {
    const pending: DriverProfile = {
      ...driver,
      user: { ...driver.user!, account_status: "pending" }
    };
    const markup = textOf(
      withLocale("en", <DriverDirectory drivers={[pending]} search="" busy={false} onUpdateStatus={() => {}} />)
    );

    expect(markup).toContain("Pending review");
    expect(markup).toContain("Requires a separate approval contract");
    expect(markup).not.toContain("Reactivate");
    expect(markup).not.toContain("Approve driver");
    expect(markup).not.toContain("Reject driver");
  });

  it("distinguishes loading, confirmed empty and API error states", () => {
    const loading = withLocale(
      "en",
      <DriverDirectory
        drivers={[]}
        search=""
        busy={false}
        state={{ phase: "loading", hasData: false }}
        onUpdateStatus={() => {}}
      />
    );
    const empty = textOf(withLocale("en", <DriverDirectory drivers={[]} search="" busy={false} onUpdateStatus={() => {}} />));
    const failed = textOf(
      withLocale(
        "en",
        <DriverDirectory
          drivers={[]}
          search=""
          busy={false}
          state={{ phase: "error", hasData: false }}
          onUpdateStatus={() => {}}
        />
      )
    );

    expect(loading).toContain('aria-label="Loading data"');
    expect(empty).toContain("No existing driver profiles");
    expect(failed).toContain("This section could not be loaded");
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("internal_server_error");
  });

  it("filters by the console search box", () => {
    const markup = textOf(
      withLocale("en", <DriverDirectory drivers={[driver]} search="nonexistent" busy={false} onUpdateStatus={() => {}} />)
    );

    expect(markup).not.toContain("Demo Driver Hebron Route");
    expect(markup).toContain("Nothing matches your search.");
  });
});
