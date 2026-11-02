import { useLocale } from "../../i18n/LocaleContext";
import { Button, Card, CardHeader } from "../../ui";

/**
 * Demo-only control panel. Rendered exclusively when the demo build flag and the
 * demo API client are both present, so no demo copy can leak into a
 * staging/production bundle.
 */
export function DemoControl({
  resetKey,
  onResetKeyChange,
  steps,
  canAct,
  resetAvailable,
  busy,
  onReset,
  onRefresh,
  onRunFullDemo
}: {
  resetKey: string;
  onResetKeyChange: (value: string) => void;
  steps: string[];
  canAct: boolean;
  resetAvailable: boolean;
  busy: string | null;
  onReset: () => void;
  onRefresh: () => void;
  onRunFullDemo: () => void;
}) {
  const { t } = useLocale();
  return (
    <Card>
      <CardHeader
        title={t("demoControl")}
        action={
          <Button variant="action" icon="play" onClick={onRunFullDemo} disabled={!canAct || !resetAvailable}>
            {t("runFullDemo")}
          </Button>
        }
      />
      <div className="field-grid">
        <label className="field">
          {t("resetKey")}
          <input className="technical" value={resetKey} onChange={(event) => onResetKeyChange(event.target.value)} />
        </label>
        <div className="button-row">
          <Button variant="outline" icon="refresh" onClick={onReset} disabled={!canAct || !resetAvailable}>
            {busy === "reset" ? t("resetting") : t("resetDemo")}
          </Button>
          <Button variant="secondary" icon="refresh" onClick={onRefresh} disabled={!canAct}>
            {t("refreshData")}
          </Button>
        </div>
      </div>
      <p className="muted">{t("resetExplanation")}</p>
      {!resetAvailable && <p className="notice notice--warning">{t("demoResetUnavailable")}</p>}
      {steps.length > 0 && (
        <ol className="demo-steps">
          {steps.map((step, index) => (
            <li key={`${step}-${index}`}>{step}</li>
          ))}
        </ol>
      )}
    </Card>
  );
}
