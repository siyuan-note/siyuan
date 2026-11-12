param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Add", "Remove")]
    [string]$Operation,
    [Parameter(Mandatory = $true)]
    [ValidateSet("User", "Machine")]
    [string]$Scope,
    [Parameter(Mandatory = $true)]
    [string]$KernelDirectory
)

function Update-SiYuanPath {
    param(
        [Microsoft.Win32.RegistryKey]$Key,
        [string]$KernelDirectory,
        [string]$Operation
    )

    $original = $Key.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($null -eq $original) {
        if ($Operation -eq "Remove") {
            return $false
        }
        $Key.SetValue("Path", $KernelDirectory, [Microsoft.Win32.RegistryValueKind]::ExpandString)
        return $true
    }

    $kind = $Key.GetValueKind("Path")
    if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and
        $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
        throw "Unsupported PATH registry value type: $kind"
    }

    $target = $KernelDirectory.TrimEnd([char[]]"\/")
    $remaining = [System.Collections.Generic.List[string]]::new()
    $found = $false
    foreach ($entry in $original.Split([char]";")) {
        $candidate = $entry.Trim().Trim([char]'"')
        # 仅在比较时展开引用，写回时使用原文和原来的注册表类型。
        if ($kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
            $candidate = [Environment]::ExpandEnvironmentVariables($candidate)
        }
        if ([string]::Equals($candidate.TrimEnd([char[]]"\/"), $target, [StringComparison]::OrdinalIgnoreCase)) {
            $found = $true
        } else {
            $remaining.Add($entry)
        }
    }

    if ($Operation -eq "Add") {
        if ($found) {
            return $false
        }
        $updated = "$KernelDirectory;$original"
    } else {
        if (-not $found) {
            return $false
        }
        $updated = [string]::Join(";", $remaining)
    }

    if ($Operation -eq "Remove" -and $remaining.Count -eq 0) {
        $Key.DeleteValue("Path")
    } else {
        $Key.SetValue("Path", $updated, $kind)
    }
    return $true
}

if ($MyInvocation.InvocationName -ne ".") {
    $ErrorActionPreference = "Stop"
    $key = $null
    try {
        if ($Scope -eq "Machine") {
            $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("SYSTEM\CurrentControlSet\Control\Session Manager\Environment", $true)
        } else {
            $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
        }
        if ($null -eq $key) {
            throw "Environment registry key is unavailable: $Scope"
        }
        $null = Update-SiYuanPath -Key $key -KernelDirectory $KernelDirectory -Operation $Operation
    } finally {
        if ($null -ne $key) {
            $key.Dispose()
        }
    }
}
