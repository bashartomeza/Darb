import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import type { Tone } from "./StatusBadge";

/** The five-across KPI row at the top of the Stitch overview dashboard. */
export function KpiCard({
  icon,
  tone = "info",
  label,
  value,
  unit,
  delta,
  status,
  loading = false,
  loadingLabel,
  metricId
}: {
  icon: IconName;
  tone?: Tone;
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: { text: string; tone: Tone };
  status?: { text: string; tone: Tone };
  loading?: boolean;
  loadingLabel?: string;
  metricId?: string;
}) {
  return (
    <div className="kpi" data-metric={metricId}>
      <div className="kpi__top">
        <span className={`kpi__icon kpi__icon--${tone}`}>
          <Icon name={icon} size={20} />
        </span>
        {delta && <span className={`kpi__delta kpi__delta--${delta.tone}`}>{delta.text}</span>}
      </div>
      <p className="kpi__label">{label}</p>
      <h3 className="kpi__value" aria-live="polite">
        {loading ? <span className="kpi__skeleton" role="status" aria-label={loadingLabel} /> : value}
        {!loading && unit && <span className="kpi__unit">{unit}</span>}
      </h3>
      {status && <p className={`kpi__status kpi__status--${status.tone}`}>{status.text}</p>}
    </div>
  );
}
