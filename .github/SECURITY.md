# Security report

If you find security-related vulnerabilities, please create a Security Advisories:

https://github.com/siyuan-note/siyuan/security/advisories/new

Some areas we don't consider security vulnerabilities:

* Arbitrary file write: Writing files outside the workspace path (e.g., exporting files) is a common user need
* Chart/Formula/ABC rendering code injection: This is a common user need, for details please refer to https://github.com/siyuan-note/siyuan/pull/6917
* SQL injection
* Pandoc Argument Injection: Allowing the setting of `--lua-filter` is a common user need
* SSRF `netImg2LocalAssets` / `netAssets2LocalAssets`
* `/public/` unauthenticated access: The `/public/` route serves files without authentication because it is designed for public sharing (https://github.com/siyuan-note/siyuan/issues/8593), and users are responsible for the security of files they place in the `data/public/` directory

Thank you very much!
