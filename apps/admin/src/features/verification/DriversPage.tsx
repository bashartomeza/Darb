import type { AccountStatus, ApiClient, DriverProfile, UserAccountStatus } from "../../api";
import type { OverviewResourceState } from "../overview/overviewState";
import { Pager } from "../shared/Pager";
import { useDebouncedValue, usePagedList } from "../shared/usePagedList";
import { DriverDirectory } from "./DriverDirectory";

export const DRIVERS_PAGE_SIZE = 50;

/**
 * The Drivers page: the verification queue plus the driver directory, which
 * it loads page by page on its own (search runs on the server), so it does
 * not wait for or depend on the overview.
 */
export function DriversPage({
  api,
  token,
  search,
  busy,
  onUpdateStatus
}: {
  api: ApiClient;
  token: string;
  search: string;
  busy: boolean;
  /** Resolves true when the server accepted the change. */
  onUpdateStatus: (userId: string, status: AccountStatus, reason: string | undefined, expectedStatus: UserAccountStatus) => Promise<boolean>;
}) {
  const query = useDebouncedValue(search.trim());
  const list = usePagedList<DriverProfile>(async (page) => {
    const result = await api.drivers(token, { page, limit: DRIVERS_PAGE_SIZE, search: query });
    return { items: result.drivers, total: result.total ?? result.drivers.length };
  }, [token, query]);

  const state: OverviewResourceState = { phase: list.phase, hasData: list.loaded };

  return (
    <DriverDirectory
      api={api}
      token={token}
      drivers={list.items}
      driversTotal={list.loaded ? list.total : undefined}
      driversFooter={<Pager page={list.page} total={list.total} limit={DRIVERS_PAGE_SIZE} disabled={list.phase === "loading"} onPage={list.setPage} />}
      search={search}
      busy={busy}
      state={state}
      onRefresh={() => void list.reload()}
      onUpdateStatus={async (userId, status, reason, expectedStatus) => {
        if (await onUpdateStatus(userId, status, reason, expectedStatus)) await list.reload();
      }}
    />
  );
}
