# Security report

If you find security-related vulnerabilities, please create a Security Advisories:

https://github.com/siyuan-note/siyuan/security/advisories/new

Some areas we don't consider security vulnerabilities:

* Arbitrary file write: Writing files outside the workspace path (e.g., exporting files) is a common user need
* Chart/Formula/ABC rendering code injection: This is a common user need, for details please refer to https://github.com/siyuan-note/siyuan/pull/6917
* SQL injection
* Pandoc Argument Injection: Allowing the setting of `--lua-filter` is a common user need
* SSRF: SiYuan supports user-configured network proxies and outbound requests to user-specified URLs. Outbound requests initiated by authenticated users through features such as `netImg2LocalAssets`, `netAssets2LocalAssets`, and MCP tools are expected behavior. This exclusion does not apply to unauthenticated access or authentication/authorization bypasses
* Sync storage tampering: SiYuan treats user-configured sync storage and principals with write access to the sync repository as trusted. Data loss, rollback, or sync corruption caused by a malicious or compromised storage operator or a principal with write access is outside the security boundary. This exclusion does not apply when an attacker can tamper with sync data without storage write access, such as through an authentication/authorization bypass or a transport security failure
* `/public/` unauthenticated access: The `/public/` route serves files without authentication because it is designed for public sharing (https://github.com/siyuan-note/siyuan/issues/8593), and users are responsible for the security of files they place in the `data/public/` directory

Thank you very much!
