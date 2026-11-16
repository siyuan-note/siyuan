param([string]$Source, [string]$Cases)

$ErrorActionPreference = "Stop"
. $Source -Operation Add -Scope User -KernelDirectory "C:\Unused"
$tests = [System.IO.File]::ReadAllText($Cases, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$rootPath = "Software\SiYuanPathTests-" + [Guid]::NewGuid().ToString("N")
$root = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($rootPath)
$results = @()
try {
    foreach ($case in $tests) {
        $key = $root.CreateSubKey($case.name)
        try {
            if ($null -ne $case.kind) {
                $key.SetValue("Path", $case.original, [Microsoft.Win32.RegistryValueKind]::$($case.kind))
            }
            if ($case.readOnly) {
                $key.Dispose()
                $key = $root.OpenSubKey($case.name, $false)
            }
            [Environment]::SetEnvironmentVariable("SIYUAN_PATH_TEST_HOME", $case.directory, "Process")
            $changed = $null
            $failure = $null
            $steps = @()
            try {
                $operations = if ($case.operations) { $case.operations } else { @($case.operation) }
                foreach ($operation in $operations) {
                    $changed = Update-SiYuanPath -Key $key -KernelDirectory $case.directory -Operation $operation
                    $stepValue = $key.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                    $steps += [PSCustomObject]@{changed = $changed; value = $stepValue}
                }
            } catch {
                $failure = $_.Exception.Message
            }
            $value = $key.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            $kind = if ($null -eq $value) { $null } else { $key.GetValueKind("Path").ToString() }
            $results += [PSCustomObject]@{
                name = $case.name
                changed = $changed
                failure = $failure
                value = $value
                kind = $kind
                steps = $steps
            }
        } finally {
            $key.Dispose()
        }
    }
} finally {
    $root.Dispose()
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($rootPath)
}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
ConvertTo-Json -InputObject $results -Depth 4 -Compress
