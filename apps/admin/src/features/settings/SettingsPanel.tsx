import type { ApiClient, User } from "../../api";
import type { AdminBuildConfig } from "../../config";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Card, CardHeader, StatusBadge, TechnicalValue } from "../../ui";
import { ConsentManagement } from "../consents/ConsentManagement";

/** Read-only view of the build configuration and the current session. */
export function SettingsPanel({ config, admin, api, token }: { config: AdminBuildConfig; admin: User | null; api: ApiClient; token: string }) {
  const { t, role } = useLocale();
  const flag = (enabled: boolean) => (
    <StatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? t("settingsEnabled") : t("settingsDisabled")}</StatusBadge>
  );

  return (
    <BentoGrid>
      <Card span={6}>
        <CardHeader title={t("settingsTitle")} />
        <div className="stack stack--tight">
          <div className="split">
            <span className="kv__key">{t("settingsEnvironment")}</span>
            <TechnicalValue>{config.appEnv}</TechnicalValue>
          </div>
          <div className="split">
            <span className="kv__key">{t("settingsApiBaseUrl")}</span>
            <TechnicalValue>{config.apiBaseUrl}</TechnicalValue>
          </div>
          <div className="split">
            <span className="kv__key">{t("settingsDemoFeatures")}</span>
            {flag(config.demoFeaturesEnabled)}
          </div>
          <div className="split">
            <span className="kv__key">{t("settingsRouteManagement")}</span>
            {flag(config.routeManagementEnabled)}
          </div>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader title={t("settingsSession")} />
        <div className="stack stack--tight">
          <div className="split">
            <span className="kv__key">{t("navProfile")}</span>
            <span>{admin?.name ?? "—"}</span>
          </div>
          <div className="split">
            <span className="kv__key">{t("adminPhone")}</span>
            <TechnicalValue>{admin?.phone}</TechnicalValue>
          </div>
          <div className="split">
            <span className="kv__key">{t("role_admin")}</span>
            <StatusBadge tone="info">{admin ? role(admin.role) : "—"}</StatusBadge>
          </div>
        </div>
      </Card>

      <ConsentManagement api={api} token={token} />
    </BentoGrid>
  );
}
