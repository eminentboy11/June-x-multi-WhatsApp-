# June X — Plain External Auth Mirror

This update removes the AES-encrypted external-auth feature and replaces it with a **direct remote auth mirror**.

## What changes

- `JUNE_AUTH_BACKUP_KEY` is no longer used.
- The encryption helper is removed.
- Verified local SQLite auth rows are mirrored directly to configured PostgreSQL and/or MongoDB:
  - `session_creds`
  - `session_keys`
  - `session_auth_meta`
- PostgreSQL uses a dedicated `session_auth_state` table.
- MongoDB uses the `auth-state` record in `june_mirror_records`.
- If the local SQLite auth state is missing and no usable file session exists, June X restores the latest direct remote auth state before normal startup.
- A deliberate logout/session clear deletes the direct remote auth state too.
- After the first successful direct mirror, the old compatibility auth record from the previous feature is removed automatically.

## Required GitHub deletion

A ZIP upload cannot delete an existing GitHub file. Before or after uploading this bundle, use GitHub's **Delete file** action to delete exactly:

```text
utils/juneDb/authBackup.js
```

Do not delete `utils/juneDb/auth-state.js`; that is the active SQLite/Baileys auth implementation.

## Upload

Upload and overwrite these bundle files at the matching repository paths:

```text
database.js
index.js
README.md
utils/juneDb/mongoAdapter.js
utils/juneDb/pgAdapter.js
utils/juneDb/postgres-schema.sql
```

Then restart the bot normally.

## Panel variables

No backup key is required for this version. You may remove this unused panel variable after the code is uploaded:

```text
JUNE_AUTH_BACKUP_KEY
```

No new variable is required. Optional timing only:

```text
JUNE_AUTH_MIRROR_DEBOUNCE_MS=2000
```

## Expected startup logs

With PostgreSQL available and verified local auth:

```text
[ PG ] Connected; remote persistence enabled for bot_id=...
[ AUTH MIRROR ] External auth state mirror scheduled.
```

During a recovery startup where the local SQLite auth rows are missing:

```text
[ AUTH MIRROR ] Restored postgres auth state (... key rows).
```

or:

```text
[ AUTH MIRROR ] Restored mongo auth state (... key rows).
```

## Important operational note

This version stores the selected auth state directly in the configured external database. Restrict PostgreSQL/MongoDB access to trusted administrators and do not expose database dumps, connection URLs, or auth data in logs or chat.

Do not delete the live `database/` directory as an immediate test. First upload, restart, wait at least 15 seconds for the mirror job, and confirm the safe startup log above. A destructive recovery test should be done later on a copied/staging deployment.

## Validation completed locally

- `database.js`, `index.js`, `mongoAdapter.js`, and `pgAdapter.js` parse successfully.
- PostgreSQL and Mongo direct-auth mirror adapter round trips were tested with local in-memory test doubles.
- The removed encryption helper is not referenced by the updated runtime source.
