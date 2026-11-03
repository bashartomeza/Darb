# Demo reset database isolation

Demo reset is destructive: it clears operational, onboarding, session, consent,
and user tables before rebuilding the deterministic demo fixture. An Admin
token or reset key never proves that the target database is disposable.

Reset therefore requires every gate below:

1. demo features are enabled in `local`, `test`, or `demo`;
2. the request has the configured reset key or a current Admin session;
3. `DATABASE_URL` contains a bounded MySQL database name;
4. that exact name appears in `DEMO_RESET_ALLOWED_DATABASES`;
5. the database is not the permanently protected real/pilot database `darb`;
6. the Serializable reset transaction finds no user with `demo_account=false`.

Missing or malformed configuration disables only reset; it does not prevent the
API from starting. The `/api/v1/capabilities` response for an Admin session
reports `demo_reset_available=false`, without disclosing the database name.
Passenger, driver and merchant sessions never receive this field, because
installed mobile builds reject capability fields they do not know. The reset
endpoint returns the bounded `demo_reset_database_not_allowed` error before a
transaction or write. Real-user detection returns
`demo_reset_real_data_present` before destructive statements.

Safe disposable example:

```text
DATABASE_URL=mysql://<user>:<password>@localhost:3306/darb_demo
DEMO_RESET_ALLOWED_DATABASES=darb_demo
```

CI uses explicit exact names, for example:

```text
DEMO_RESET_ALLOWED_DATABASES=darb_ci,darb_canonical_matching_ci,darb_canonical_shared_ci
```

`darb` is never resettable, even if accidentally added to the allow-list.
Do not use substring checks, wildcard entries, `migrate reset`, or `db push` as
a substitute for disposable database provisioning.
