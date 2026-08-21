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
* Publish `visible:false` ("hidden") unlisted semantics: Hiding a notebook or document in publish access (`visible:false`) removes it from the published file tree, but the content remains directly accessible via its ID or link — this is unlisted-style sharing by design, not a confidentiality boundary, and the UI documents it as "Not publicly visible, can be accessed directly". Access control in publish mode is provided by the password and disable levels, which are enforced across content and raw-file APIs; bypasses of those are still in scope. Reports that treat `visible:false` as a confidentiality boundary are not considered vulnerabilities
* Config file encryption: Credentials stored in the workspace config (e.g., cloud login token, sync credentials, AI API keys, and Secrets) are obfuscated with a hardcoded AES key and IV instead of being truly encrypted, because the config must remain readable across devices and reinstallations. An attacker who can read the config file can recover these credentials. The security boundary is access control over the workspace directory and the OS user account
* Opening external links with unvalidated URLs: Handing off arbitrary URLs to the OS with no URL-scheme allowlist is expected behavior because opening external links in the system browser or launching the default handler for custom URI schemes is a common user need; whether the OS-level URI-handler chain is exploitable depends on the user's OS and installed software, outside SiYuan's security boundary. This applies to the Electron main process `shell.openExternal()` at `windowNavigate` and `setWindowOpenHandler` (`app/electron/main.js`), and to the mobile WebView bridges (Android `JSAndroid.openExternal()` / `exportByDefault()` reaching `Intent.ACTION_VIEW` via `openByDefaultBrowser()` in `Utils.java`, HarmonyOS `JSHarmony.openExternal()`, and iOS `webkit.messageHandlers.openLink`)

Thank you very much!
