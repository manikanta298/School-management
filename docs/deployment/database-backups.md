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

Configure a daily task using the operating system scheduler and an account permitted to run Docker Compose. For Windows Task Scheduler, use the repository root as **Start in**, run `npm.cmd`, and set the arguments to `run db:backup --prefix backend`. Configure scheduler logging and alert on any nonzero exit. Do not put credentials in the task arguments.

Copy backups to an approved, access-controlled off-site destination, encrypt them in transit and at rest, and define retention based on the school's recovery requirements. The script does not upload, encrypt, prune, or monitor archives for you. Test restoration regularly against an isolated copy and keep the restore procedure and recovery contacts documented.

## Production recovery

Use the database provider's managed backup, point-in-time recovery, or documented export/restore process for production. Confirm retention, off-site protection, restore permissions, and recovery time with the provider. Before a production migration or restore, take a fresh backup and follow the approved maintenance procedure. Never use `docker compose down -v` as a backup or recovery action; it deletes the Compose database volume.
