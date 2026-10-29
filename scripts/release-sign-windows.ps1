$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# 在同一进程内缓存智能卡 PIN，再调用 Authenticode 签名，避免跨进程重复认证。
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public static class SiYuanReleaseKey {
    [DllImport("crypt32.dll", SetLastError=true)]
    private static extern bool CryptAcquireCertificatePrivateKey(IntPtr certificate, uint flags, IntPtr reserved,
        out IntPtr key, out uint spec, out bool callerFree);
    [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)]
    private static extern int NCryptSetProperty(IntPtr key, string name, IntPtr value, uint length, uint flags);
    [DllImport("ncrypt.dll")]
    private static extern int NCryptSignHash(IntPtr key, IntPtr padding, byte[] hash, uint length,
        byte[] signature, uint signatureLength, out uint resultLength, uint flags);
    [DllImport("ncrypt.dll")]
    private static extern int NCryptFreeObject(IntPtr key);
    public static void Authenticate(IntPtr certificate, string pin, bool rsa) {
        IntPtr key;
        uint spec;
        bool callerFree;
        const uint acquireFlags = 0x00040000 | 0x00000040 | 0x00000001;
        if (!CryptAcquireCertificatePrivateKey(certificate, acquireFlags, IntPtr.Zero, out key, out spec, out callerFree))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        IntPtr padding = IntPtr.Zero;
        IntPtr algorithm = IntPtr.Zero;
        try {
            if (spec != 0xffffffff) throw new Exception("The signing key is not a CNG hardware key");
            IntPtr value = Marshal.StringToHGlobalUni(pin);
            try {
                int status = NCryptSetProperty(key, "SmartCardPin", value, (uint)((pin.Length + 1) * 2), 0);
                if (status != 0) throw new Exception("Set signing PIN failed: 0x" + status.ToString("x8"));
            } finally { Marshal.ZeroFreeGlobalAllocUnicode(value); }
            uint flags = 0x40;
            if (rsa) {
                algorithm = Marshal.StringToHGlobalUni("SHA256");
                padding = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(padding, algorithm);
                flags |= 2;
            }
            byte[] hash;
            using (SHA256 sha = SHA256.Create()) {
                hash = sha.ComputeHash(System.Text.Encoding.ASCII.GetBytes("SiYuan signing preflight"));
            }
            uint length;
            int code = NCryptSignHash(key, padding, hash, (uint)hash.Length, null, 0, out length, flags);
            if (code != 0) throw new Exception("Signature query failed: 0x" + code.ToString("x8"));
            byte[] signature = new byte[length];
            code = NCryptSignHash(key, padding, hash, (uint)hash.Length, signature, length, out length, flags);
            if (code != 0) throw new Exception("Hardware authentication failed: 0x" + code.ToString("x8"));
        } finally {
            if (padding != IntPtr.Zero) Marshal.FreeHGlobal(padding);
            if (algorithm != IntPtr.Zero) Marshal.FreeHGlobal(algorithm);
            if (callerFree) NCryptFreeObject(key);
        }
    }
}
'@

function Set-VerifiedFileSignature($file, $certificate) {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
    $file = [IO.Path]::GetFullPath($file)
    $temporary = Join-Path ([IO.Path]::GetDirectoryName($file)) ('.siyuan-sign-' + [guid]::NewGuid().ToString('N') + [IO.Path]::GetExtension($file))
    $inputFile = $null
    try {
        # Deny concurrent writes until the verified replacement is installed.
        $inputFile = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read,
                                   ([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
        $originalHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        $copy = [IO.File]::Create($temporary)
        try { $inputFile.CopyTo($copy) } finally { $copy.Dispose() }
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $originalHash) {
            throw 'Signing input changed during copy'
        }
        $script:stage = 'signing'
        $null = Set-AuthenticodeSignature -LiteralPath $temporary -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
        $script:stage = 'verification'
        $signature = Get-AuthenticodeSignature -LiteralPath $temporary
        [Console]::Error.WriteLine('SIGNING_STATUS:' + [int]$signature.Status + ':' + [int]($null -ne $signature.TimeStamperCertificate))
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or
            $null -eq $signature.TimeStamperCertificate) { throw 'Signature or timestamp verification failed' }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $originalHash) {
            throw 'Signing input changed before replacement'
        }
        [IO.File]::Replace($temporary, $file, [System.Management.Automation.Language.NullString]::Value)
    } finally {
        if ($null -ne $inputFile) { $inputFile.Dispose() }
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

$payload = $null
$certificate = $null
$stage = "request"
try {
    # PIN 仅通过标准输入传递，失败信息不包含请求内容。
    $payload = [Console]::ReadLine() | ConvertFrom-Json
    if ($payload.thumbprint -notmatch '^[0-9a-fA-F]{40}$' -or [string]::IsNullOrEmpty($payload.pin)) {
        throw "Invalid signing request"
    }
    $stage = "certificate"
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')
    $certificate = Get-Item -LiteralPath ("Cert:\CurrentUser\My\" + $payload.thumbprint)
    if (!$certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date) -or
        $certificate.NotBefore -ge (Get-Date) -or
        !($certificate.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3')) {
        throw "The code signing certificate is unavailable"
    }
    $oid = $certificate.PublicKey.Oid.Value
    if ($oid -notin @('1.2.840.113549.1.1.1', '1.2.840.10045.2.1')) {
        throw "The signing key must use RSA or ECDSA"
    }
    $stage = "authentication"
    [SiYuanReleaseKey]::Authenticate($certificate.Handle, $payload.pin, $oid -eq '1.2.840.113549.1.1.1')
    $payload.pin = $null
    foreach ($file in $payload.files) {
        Set-VerifiedFileSignature $file $certificate
        Write-Output ("Signed and verified: " + $file)
    }
} catch {
    $codes = @([regex]::Matches($_.Exception.ToString(), '0x[0-9a-fA-F]{8}') | ForEach-Object { $_.Value })
    $codes += '0x' + $_.Exception.HResult.ToString('x8')
    [Console]::Error.WriteLine('SIGNING_DIAGNOSTIC:' + $stage + ':' + ($codes -join ','))
    [Console]::Error.WriteLine("Windows hardware signing failed; check the PIN, token, certificate and timestamp connection")
    # 仅标识设备通信中断，PIN 错误不重试，避免消耗智能卡重试次数。
    if ($_.Exception.ToString() -match '0x8010001f|0x80100068') { exit 20 }
    exit 1
} finally {
    if ($null -ne $payload) { $payload.pin = $null }
    if ($null -ne $certificate) { $certificate.Dispose() }
}
