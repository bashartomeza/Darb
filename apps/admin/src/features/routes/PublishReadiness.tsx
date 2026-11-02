import { translations } from "../../i18n/translations";
import type { PublicationReadinessIssue } from "./RouteManagement";

type Locale = "ar" | "en";

const checkOrder: Record<PublicationReadinessIssue, PublicationReadinessIssue> = {
  readinessMissingNames: "readinessMissingNames",
  readinessMinimumStops: "readinessMinimumStops",
  readinessStopEligibility: "readinessStopEligibility",
  readinessDateOrder: "readinessDateOrder",
  readinessPassengerPath: "readinessPassengerPath",
  readinessParcelPath: "readinessParcelPath"
};
const checks = Object.values(checkOrder);

const copy = {
  ar: { ready: "جاهز", failed: "يحتاج إلى معالجة" },
  en: { ready: "Ready", failed: "Needs attention" }
} as const;

export function PublishReadiness({ issues, locale }: { issues: PublicationReadinessIssue[]; locale: Locale }) {
  const text = translations[locale];
  const states = copy[locale];
  const issueSet = new Set(issues);

  return (
    <div className="publish-readiness" role="status">
      <ul className="publish-readiness__list">
        {checks.map((check) => {
          const failed = issueSet.has(check);
          return (
            <li
              key={check}
              className={failed ? "publish-readiness__item is-failed" : "publish-readiness__item is-ready"}
              data-readiness-check={check}
            >
              <span className="publish-readiness__symbol" aria-hidden="true">{failed ? "!" : "✓"}</span>
              <span>
                <strong>{failed ? states.failed : states.ready}</strong>
                <span>{text[check]}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {issues.length === 0 && <p className="muted">{text.routeReadinessReady}</p>}
    </div>
  );
}
