# Verification Record

Report only actual evidence for each item: passed, failed, unverified, or not applicable. Completed source code and ZIP files do not replace runtime evidence.

- Source code: implementation matches the confirmed plan, frontend and resource declarations are accurate, and there are no unapproved data effects
- Static checks: syntax, type, or lint checks actually run and their results; mark as unverified if no parser is available
- Build: the actual TypeScript command, exit status, and artifacts; not applicable for plain JavaScript
- ZIP: package path, hash, source revision, file list, and validation results returned by package_local
- Simulated tests: identify SDK substitutes, DOM environments, or standalone Electron environments; do not describe them as an actual SiYuan instance
- Installation: authorized target, package hash, revisions before and after installation, and actual native installation results
- Activation: actual configuration state; successful installation does not imply activation
- Frontend loading: check entry points and errors separately in desktop Electron and the desktop browser; neither substitutes for the other
- Functional execution: main operation, error feedback, repeated clicks, unloading after partial initialization, and late asynchronous responses
- Data writes: target, count, and actual returned status; verify unknown results read-only first to avoid duplicate submissions

If an actual SiYuan instance, target frontend, or necessary permission is unavailable, explicitly leave the corresponding stages unverified. Do not compensate for a missing test environment by installing into the user's actual environment. Rolling back code does not roll back user data.

Recovery is not guaranteed to handle every process crash automatically. If a temporary file is only partially written, or a conditional create has published the target but has not yet cleaned up the temporary hard link, the tool preserves both names, their bytes, and the logs, and returns result_unknown; manual inspection may be necessary. Do not delete files whose state is uncertain, weaken hard-link checks, or blindly retry to claim that recovery is complete.
