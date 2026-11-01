param([string]$Target, [ValidateSet("protect", "read")][string]$Action)
$ErrorActionPreference = "Stop"
$acl = [System.IO.File]::GetAccessControl($Target)
if ($Action -eq "protect") {
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, "FullControl", "Allow")
    $acl.SetAccessRule($rule)
    [System.IO.File]::SetAccessControl($Target, $acl)
    $acl = [System.IO.File]::GetAccessControl($Target)
}
$acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]"Access,Owner,Group")
