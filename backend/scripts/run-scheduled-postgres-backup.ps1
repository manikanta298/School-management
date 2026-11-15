$ErrorActionPreference = 'Continue'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDirectory = Join-Path $env:ProgramData 'SchoolManagement'
$logPath = Join-Path $logDirectory 'postgres-backup.log'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$started = Get-Date -Format o
"[$started] Backup task started." | Add-Content -Path $logPath
Push-Location $repositoryRoot
try {
    & npm.cmd run db:backup --prefix backend *>> $logPath
    $exitCode = $LASTEXITCODE
} catch {
    $_ | Out-String | Add-Content -Path $logPath
    $exitCode = 1
} finally {
    Pop-Location
}
$finished = Get-Date -Format o
"[$finished] Backup task exit code: $exitCode" | Add-Content -Path $logPath
exit $exitCode
