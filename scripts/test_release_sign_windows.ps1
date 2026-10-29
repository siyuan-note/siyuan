$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'release-sign-windows.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Signing script has parse errors' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-VerifiedFileSignature' }, $true)
Invoke-Expression $definition.Extent.Text
$root = Join-Path ([IO.Path]::GetTempPath()) ('siyuan-sign-test-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($root)
$original = Join-Path $root 'original.exe'
$certificate = [pscustomobject]@{ Thumbprint = 'A' * 40 }
function Set-AuthenticodeSignature($LiteralPath, $Certificate, $HashAlgorithm, $TimestampServer) {
    if ($LiteralPath -eq $original) { throw 'Must sign a copy' }
    if ($HashAlgorithm -ne 'SHA256') { throw 'Unexpected digest' }
    if ($mode -eq 'throw') { throw 'Simulated signing error' }
    try {
        $writer = [IO.File]::Open($original, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
        $writer.Dispose()
        throw 'Original was writable during signing'
    } catch [IO.IOException] { }
    [IO.File]::WriteAllText($LiteralPath, 'signed-copy')
}
function Get-AuthenticodeSignature($LiteralPath) {
    [pscustomobject]@{
        Status = $(if ($mode -eq 'hash') { [System.Management.Automation.SignatureStatus]::HashMismatch } else { [System.Management.Automation.SignatureStatus]::Valid })
        SignerCertificate = [pscustomobject]@{ Thumbprint = $(if ($mode -eq 'signer') { 'B' * 40 } else { $certificate.Thumbprint }) }
        TimeStamperCertificate = $(if ($mode -eq 'timestamp') { $null } else { [pscustomobject]@{} })
    }
}
try {
    foreach ($mode in @('success', 'hash', 'timestamp', 'signer', 'throw')) {
        [IO.File]::WriteAllText($original, 'original-content')
        $failed = $false
        try { Set-VerifiedFileSignature $original $certificate } catch { $failed = $true; if ($mode -eq 'success') { throw } }
        if ($failed -ne ($mode -ne 'success')) { throw "Unexpected outcome: $mode" }
        $expected = if ($mode -eq 'success') { 'signed-copy' } else { 'original-content' }
        if ([IO.File]::ReadAllText($original) -ne $expected) { throw "Original damaged: $mode" }
        if (@(Get-ChildItem -LiteralPath $root -Force).Count -ne 1) { throw 'Temporary copy was not cleaned' }
    }
    Write-Output 'Staged signing tests passed'
} finally {
    [IO.File]::Delete($original)
    [IO.Directory]::Delete($root)
}
