# Monorepo migration

## Scope and invariants

The two original repositories are now npm workspaces in one root Git repository:

- `northstar-backend/` → `apps/backend/`
- `northstar-frontend/` → `apps/frontend/`

Application code, API URLs, auth behavior, Prisma schema and migrations, frontend
extension assets, and backend Vercel routing/cron are unchanged. There are no
shared packages, new build frameworks, dependency upgrades, or database changes.
Application-specific docs and tooling stay with their owners instead of merging
potentially different endpoint/feature specifications.

The root is private, pins Node 24.17.0/npm 11.13.0, exposes workspace commands,
ignores local secrets/artifacts, and owns the only active npm lockfile. Both apps
remain independently deployable. Backend Prisma CLI configuration now reads an
optional URL so install-time type generation needs no credentials. Runtime URL
validation is unchanged; database CLI commands still fail if the URL is absent.

## Git history and local backups

Both histories were imported with **unsquashed Git subtree additions**. Original
commit IDs are preserved and are ancestors of the monorepo branch `main`.
Historical commits retain their original root-relative paths; the import commits
place the apps under their new prefixes.

| Original repository | Original HEAD | Tag |
| --- | --- | --- |
| Backend | `89c81ebc6d9549228cd8c9aa68fada653d4df0d1` | `migration/backend-before-monorepo` |
| Frontend | `8727f5c4fd3420abcba920f9cd60aa24887f7d9a` | `migration/frontend-before-monorepo` |

For example, inspect original backend history with:

```sh
git log migration/backend-before-monorepo -- src/server.ts
```

Local, ignored backups:

```text
.pi/migration-backups/
├── backend.bundle
├── frontend.bundle
└── originals/
    ├── northstar-backend/   # original source/local files and .git
    └── northstar-frontend/  # original source/local files and .git
```

Both source worktrees were clean before import. Bundles include all original
refs and were verified before moving directories. The original directories also
preserve ignored/local files; those files were not copied into the active apps.
Only `node_modules` folders generated during baseline checks were removed to
free disk space for fresh-clone verification. Source and Git backups are intact.
Copy any needed local configuration manually, without committing secrets.

These backups are local only, not off-machine disaster recovery. Keep them until
staging and production cutover are approved. No remote was added to the new root
repository, and no push or hosting change was performed.

## Verification

Baseline and migrated results on Node 24.17.0 / npm 11.13.0:

| Check | Before | After |
| --- | --- | --- |
| Frontend build | Pass | Pass |
| Backend build | Pass | Pass |
| Both app linters | Pass | Pass |
| Frontend tests | 6 files / 19 tests pass | Same |
| Backend tests | 156 pass / runner reports 4 failed | Same |
| Dependency versions and integrity hashes | Separate lockfiles | Preserved in root lockfile |
| Root `npm ci`, no app secrets | Not applicable | Pass |
| Root `npm run prisma:generate`, no URL | Not applicable | Pass |
| Fresh clone: install, build, lint, Prisma generation, tests | Not applicable | Install/build/lint/generation pass; tests match baseline |
| `prisma migrate status`, no URL | Config load fails | Explicit missing datasource URL error; no connection |
| Backend dev startup / health | Not tested before move | Pass on port 3100 with non-production placeholder config |
| Frontend dev startup / HTML | Not tested before move | Pass on port 5173 |

The Node test runner's four failures comprise **three failing leaf tests and the
failed parent Notes security test**:

- `auth.security.test.ts`: trusted-origin checks reject arbitrary extensions.
- `auth.security.test.ts`: CORS rejects arbitrary extension origins.
- `notes.security.test.ts`: untrusted CORS origins are rejected before Notes I/O.

These are existing security behavior failures, not migration regressions. They
were neither fixed nor hidden. `npm test` and the CI test step correctly exit
nonzero until they are addressed separately. Do not consider the repo production
cutover approved just because install, build, and lint succeed.

The root install reports 24 dependency vulnerabilities (9 moderate, 14 high,
1 critical). Dependencies were preserved; no audit fixes or upgrades were applied.
A full source/history secret audit was not performed.

Port 3000 is occupied by another process in this environment. Local startup used
`PORT=3100` without changing committed app configuration. The default Vite proxy
to port 3000 is unchanged but its complete end-to-end flow was not verified here.
No live database, email, Unsplash, Supabase, or production service was used.

## Deployment cutover (manual)

1. Choose/create the new repository remote, review the combined history, then
   push `main` and the migration tags. Keep the old remotes available.
2. Connect the existing frontend and backend hosting projects to this repository.
3. Follow root README installation/root-directory settings. Make the root
   manifest, lockfile, and workspaces accessible to each Vercel install.
4. Retain each project's environment values, public URLs, origins, cookie
   behavior, and backend cleanup cron; confirm effective Node/build settings.
5. Deploy staging first. Verify health, frontend-to-API requests, login, refresh,
   logout, protected routes, Notes operations, and cron configuration.
6. Resolve the existing security failures before treating CI as a release gate.
7. Switch production only after staging passes. Retain originals/backups until
   rollback is no longer needed.

Repository consolidation does not require database migrations or changing DNS.
Do not automatically run seeds or production database migration commands during
this cutover.

## Rollback

Before changing deployment configuration, rollback requires no hosting action:
the old remote repositories and deployments are untouched. If deployment wiring
was switched, reconnect each project to its old repository and redeploy the
recorded original commit with its original root/build settings and environment.

To restore independent repositories **without deleting the monorepo**, run from
this repository root into unused sibling directories:

```sh
git clone .pi/migration-backups/backend.bundle ../northstar-backend-restored
git clone .pi/migration-backups/frontend.bundle ../northstar-frontend-restored
```

Alternatively use the full original working directories under `originals/`,
which retain remote configuration and local files. Do not delete the monorepo or
backups before preserving any work made after import. The migration changed no
database data, so no schema/data rollback is needed.
