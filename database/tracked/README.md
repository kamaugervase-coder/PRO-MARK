# Tracked database migrations

Put **new** application migrations in this directory using the filename format
`001_descriptive_name.sql`. Each file is applied once, in filename order, by
`npm run db:migrate`. Applied files are recorded in
`zelimu_schema_migrations` with a SHA-256 checksum; editing an applied file
stops the migration run. Every migration runs in its own transaction and must
not include `BEGIN`, `COMMIT`, or `ROLLBACK`.

The existing numbered files directly under `database/` are legacy manual
migrations. This runner intentionally does not discover or replay them:
their applied state differs between existing installations. Continue using
their documented ordering and backups; do not copy them into this directory
or mark them applied without verifying the target database.

The runner is explicit and is never called during application startup. Back up
the target database and test the migration on staging before running it in
production. Use `npm run db:backup` to create a private custom-format dump
using `pg_dump`; the script validates the resulting archive with `pg_restore`.
The PostgreSQL client tools must be installed on the machine running the
backup command.
