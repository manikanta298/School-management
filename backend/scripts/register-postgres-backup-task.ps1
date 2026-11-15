param(
    [string]$TaskName = 'SchoolManagement-PostgresBackup',
    [datetime]$At = (Get-Date '2:00AM')
)
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runner = Join-Path $PSScriptRoot 'run-scheduled-postgres-backup.ps1'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $repositoryRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Creates a local Docker Compose PostgreSQL backup.' -Force | Out-Null
Write-Output "Registered daily task '$TaskName' at $At for user $userId."
Write-Output 'The user must be signed in and Docker Compose must be running; see the task log under ProgramData\SchoolManagement.'
