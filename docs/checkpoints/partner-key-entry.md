# Entering the Aween Rayeh partner key (operator-only)

This is the private-entry path for the dedicated replacement key (register items EDIT-01 and EDIT-02). It does not enable anything by itself and makes no provider request. The key must never be typed into a chat, a prompt, a source file, a report, a screenshot or a command line. Only the person who holds the key does steps 1 and 2.

## What was verified without a real key (2026-10-26)

A synthetic dry run of the mechanism, using a random throwaway value and no provider request:

| Check | Result |
| --- | --- |
| Credential Manager stores a value and reads it back identical, then removal works | Pass |
| The launcher refuses a database whose name does not end in `_ci`, `_qa` or `_sim` (it refused the real `masari` database) | Pass |
| The API starts with only the limited partner-directory gate enabled and the key injected | Pass (live check 200) |
| The key does not appear in the process arguments of the launcher or the API | Pass |
| The key does not appear in the launcher's or the API's output | Pass |
| The launching shell's own environment never receives the key | Pass |
| Nothing is left listening afterwards | Pass |

Limits, stated plainly: this ran on one Windows machine, the key is briefly readable in the memory of the launcher and the API process by the same Windows user or an administrator, and the check shows the mechanism is sound, not that the provider accepts the key. The dry run is not part of CI.

## Step 1: store the key (you, in your own terminal)

```powershell
pwsh -NoProfile -File scripts/provider-key/set-partner-key.ps1
```

Paste the key at the hidden prompt. It is stored in Windows Credential Manager for your Windows user under `Masari/AweenRayehPartnerKey`. To remove it: add `-Remove`.

## Step 2: start an isolated API with the key (you, or an operator you authorize)

Use a disposable database (name ending in `_ci`, `_qa` or `_sim`). Set `DATABASE_URL` and `JWT_SECRET` in that shell, build the API once (`npm run build -w @masari/api`), then:

```powershell
pwsh -NoProfile -File scripts/provider-key/run-api-with-partner-key.ps1
```

Only the limited partner-directory gate is on. Every demo, map, checkpoint-feed and research gate is cleared for that process, and the key lives only in that process's environment. Use `-Synthetic` to repeat the dry run with no real key.

## Step 3: the one live read (needs your explicit go-ahead first)

Do not do this step until the owner has confirmed the historical key was revoked or rotated (EDIT-05) and has said, in writing, to make exactly one provider-backed read. Then make one authenticated read of `GET /api/v1/limited-checkpoint-directory` through Masari (never straight to the provider), repeat it within 15 seconds to confirm the cache, record only counts and pass or fail in `docs/qa/EVIDENCE_INDEX.md`, stop the API, and remove the stored key if it will not be used again.

Provider responses, IDs, headers and the key itself are never written to a report.
