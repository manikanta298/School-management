# Database backups

The repository provides backup and restore-verification commands for the PostgreSQL service in the Docker Compose stack. They are intended for development or an isolated staging copy, not for a managed production database.

## Create a backup

Ensure the Compose PostgreSQL service is running, then run from the repository root:

```powershell
npm run db:backup --prefix backend
```

The command writes a PostgreSQL custom-format archive to `backups/` in the repository root, named with a UTC timestamp. A different output directory can be supplied:

```powershell
npm run db:backup --prefix backend -- D:\school-backups
```

The command exits nonzero on failure and removes an incomplete archive. Backup files under the default `backups/` directory are ignored by Git. Keep backups outside the application repository for real use.

## Verify a backup

Restore the archive into a uniquely named temporary database in the Compose PostgreSQL service, then remove that database:

```powershell
npm run db:verify-backup --prefix backend -- backups\school-YYYY-MM-DDTHH-MM-SS-sssZ.dump
```

Run verification against a development or isolated staging database only. It creates and drops a temporary database; never run it against production. Confirm the command reports a successful restore and exits with status zero. If cleanup fails, it reports the temporary database name so an operator can remove it after checking the target environment.

## Schedule and retain backups

On Windows, register a daily Task Scheduler job at 2:00 AM from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\register-postgres-backup-task.ps1
```

The task runs as the current user with limited privileges and only while that user is signed in. Docker Compose must be running. The wrapper logs output and the exit code under `%ProgramData%\SchoolManagement\postgres-backup.log`; inspect it regularly and configure monitoring for failures. The helper does not store credentials.

Copy backups to an approved, access-controlled off-site destination, encrypt them in transit and at rest, and define retention based on the school's recovery requirements. The script does not upload, encrypt, prune, or monitor archives for you. Test restoration regularly against an isolated copy and keep the restore procedure and recovery contacts documented.

## Production recovery

Use the database provider's managed backup, point-in-time recovery, or documented export/restore process for production. Confirm retention, off-site protection, restore permissions, and recovery time with the provider. Before a production migration or restore, take a fresh backup and follow the approved maintenance procedure. Never use `docker compose down -v` as a backup or recovery action; it deletes the Compose database volume.
