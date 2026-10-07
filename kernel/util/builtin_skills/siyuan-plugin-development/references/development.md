# Development References and Boundaries

## Official References

- Plugin sample: https://github.com/siyuan-note/plugin-sample
- Plugin API declarations: https://github.com/siyuan-note/petal
- Implementation of the target SiYuan version: https://github.com/siyuan-note/siyuan

Verify the currently running version and target frontend, then use the public APIs for that version. The host loads the frontend plugin entry point index.js; CommonJS uses require("siyuan") and module.exports. Do not assume the host exports an API simply because its type exists in an npm package. Take target frontend values from the current manifest specification instead of blindly reusing an all-platform array.

## Minimum Files and Builds

A minimal frontend package requires plugin.json and a real index.js, together with any i18n, README, index.css, and other resources actually used. The manifest's name, version, minimum host version, and frontend declarations must comply with the current native installer's parsing rules. Publishing metadata requires a real identity; do not invent an author or repository for a local prototype.

examples/index.js and examples/en_US.json are original, small, dependency-free examples that demonstrate only public entry points and lifecycle handling. They are not a completed plugin for the user; do not treat example text as user requirements. Verify addTopBar, showMessage, and language-file keys against the target version. Register layout-related entry points in onLayoutReady and avoid duplicate registration.

TypeScript produces an installable index.js only through an actually available build toolchain; changing a .ts extension is not a build. package_local only freezes and packages files; it does not build or execute arbitrary project scripts. If build capabilities are unavailable, accurately deliver the source code and blocker details, or switch to plain JavaScript with the user's agreement.

## Imports and Reconfirmation

Before importing, inspect the candidate source with project_status(taskId, sourcePath, sourceFiles). sourceFiles is an exact allowlist of relative file paths and must match the plan's workflow.files; sourceRevision binds the selected existing safe files, not the entire repository. The host only lists excluded paths without reading contents such as .git, node_modules, or config. An optional path on the allowlist that does not yet exist may be created later; do not treat it as an imported file.

After reconfirming a plan for an existing managed project, obtain the current sourceRevision through project_status(taskId), then establish a new checkpoint with prepare_project(taskId, expectedSourceRevision). Do not overwrite the current source code or reimport the previous source. If revisions do not match, first inspect the changes read-only, then handle their actual effects.

Packaging freezes only existing safe files on the confirmed allowlist. Missing optional files may be omitted from the package, but plugin.json, index.js, and resources declared by the manifest must be complete. Do not use optional allowlist entries to bypass entry-point or resource validation.

## Data and Lifecycle

Read and modify notes through public kernel APIs, and check code before reporting success. Do not directly modify .sy files, databases, or the actual data directory. Define the target and scope of effects clearly, access encrypted notebooks under existing permissions, and do not bypass locks or denials.

Prevent duplicate clicks during long-running writes, and retain request and instance state. In onunload, clean up the plugin's own events, timers, and observers, and cancel reads that can be canceled; after an asynchronous response, check that the instance is still valid. Canceling a request or unloading does not guarantee that a server-side write has not already executed. If the result is unknown, verify it read-only first.

## Installation

Generating a local ZIP does not grant permission to install or activate it. Install through the native local-package interface, bound to the package hash and expected installation-target revision; keep the immutable installation snapshot separate from development source code. Explain the effects of overwriting an enabled plugin before obtaining authorization for an action that may execute code. If the user approves only file delivery, stop at source code and artifacts.

Recover installation data through the existing repo snapshot and recovery tools, respecting the user's sync-ignore rules. Snapshots cover non-ignored code under data/plugins and data under data/storage/petal; they do not include the workspace conf directory or managed-project source code. Managed source code is still restored through restore_project. The agent creates a snapshot before the first local write in each conversation round, rather than creating a separate recovery point for every installation; the installer does not keep a separate plugin-code backup either. A full-repository checkout rolls back all data included in the snapshot, disables sync, and reloads the interface. Single-file recovery overwrites only the selected files and does not delete files added later. Restoring petals.json affects the entire plugin configuration. Verify snapshot contents and recovery scope first, follow the existing tool confirmation requirements, do not automatically check out the entire repository, and do not promise to stop plugin code that is already running.
