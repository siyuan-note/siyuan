# Security report

If you find security-related vulnerabilities, please create a Security Advisories:

https://github.com/siyuan-note/siyuan/security/advisories/new

Some areas we don't consider security vulnerabilities:

* Arbitrary file write: Writing files outside the workspace path (e.g., exporting files) is a common user need
* Chart/Formula/ABC rendering code injection: This is a common user need, for details please refer to https://github.com/siyuan-note/siyuan/pull/6917
* SQL injection
* Pandoc Argument Injection: Allowing the setting of `--lua-filter` is essential

Thank you very much!
