param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Backup
)

$ErrorActionPreference = "Stop"
[System.IO.File]::Replace($Source, $Destination, $Backup, $false)
