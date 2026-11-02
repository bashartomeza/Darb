import type { User } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Card, CardHeader, StatusBadge, TechnicalValue } from "../../ui";

/** Read-only account details from the authenticated `GET /me` response. */
export function ProfilePanel({ admin }: { admin: User | null }) {
  const { role, t } = useLocale();

  return (
    <BentoGrid>
      <Card span={6}>
        <CardHeader title={t("profileTitle")} />
        <div className="stack stack--tight">
          <div className="split">
            <span className="kv__key">{t("profileName")}</span>
            <span>{admin?.name ?? "—"}</span>
          </div>
          <div className="split">
            <span className="kv__key">{t("adminPhone")}</span>
            <TechnicalValue>{admin?.phone ?? "—"}</TechnicalValue>
          </div>
          <div className="split">
            <span className="kv__key">{t("profileRole")}</span>
            <StatusBadge tone="info">{admin ? role(admin.role) : "—"}</StatusBadge>
          </div>
        </div>
        <p className="muted profile-panel__note">{t("profileReadOnly")}</p>
      </Card>
    </BentoGrid>
  );
}
