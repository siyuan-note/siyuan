---
name: siyuan-plugin-development
description: Official frontend plugin development workflow. After the user explicitly opts in, clarify missing requirements, confirm a short plan, implement in a managed copy, verify, and package. Installation and activation require separate authorization.
---

# SiYuan Frontend Plugin Development

This is a read-only official skill shipped with SiYuan. Its current scope is creating and modifying frontend plugins, using CommonJS JavaScript without third-party runtime dependencies by default. Full development, verification, and recovery of kernel.js are outside this workflow's scope.

Replace example placeholders such as ${PLUGIN_NAME} according to the confirmed plan. Do not treat user-defined variable settings as official content.

## Obtain an Explicit Choice, Then Confirm the Plan

- Use this skill only when the user explicitly asks to develop or modify a plugin. Do not automatically turn ordinary template, document, or theme requests into plugins
- Initiate the official choice with workflow.action="choose" in the question tool; questions may be an empty array. The server displays a fixed, localized yes/no question. Do not treat ordinary questions, chat text, the model's own consent, or the user's previous answers as permission for this task
- After the user chooses yes, load the body through skill with action="load", source="builtin", and name="siyuan-plugin-development". Continue only after the server confirms successful loading. Do not read the official body if the user declines or cancels, or if the skill is disabled; user-requested custom development may still proceed under its original permissions
- Extract known requirements from the current conversation, and ask only about gaps that would change the implementation: functionality, entry points, triggers, target frontend, data-read and data-write effects, and deliverables. Do not repeat questions already answered, guess a notebook, or expand the scope to every platform
- Submit a short plan through question with workflow.action="plan", bound to the taskId returned by the choice. The full plan must clearly state the plugin name, frontend, functionality and entry points, data changes, delivery scope, import source, and files allowed in the package. The server freezes and displays the entire plan; do not write source code before actual acceptance is confirmed
- Update the plan and obtain new confirmation when changing a confirmed goal, source-code origin, data effects, or packaging scope. Do not fabricate a taskId, plan digest, or confirmed state; previous questions and versions do not authorize a new task

Example choice call: {"questions":[],"workflow":{"action":"choose"}}. Use newTask=true only when the user explicitly requests another plugin; reconsider=true may be used when the user explicitly changes the current workflow choice. Ordinary repeated calls reuse the current choice without asking again.

Plan fields: taskId, proposal (at most 2000 characters), packageName, frontend (one of desktop, desktop-window, browser-desktop, mobile, or browser-mobile), dataEffects and deliverables (at most 1000 characters each), and files (at most 200 exact relative file paths). Before importing an existing plugin, call bazaar's project_status with taskId, sourcePath, and exact sourceFiles; sourceFiles must match the workflow.files awaiting confirmation. The host returns a sourceRevision for the selected existing safe files; include that digest and sourcePath in the plan. Do not implicitly read or hash the entire repository. List excluded paths such as .git, node_modules, and config without reading their contents. Omit source fields when creating a new project. The technical file list is also shown to the user; do not add unapproved files after confirmation. The allowlist may contain optional files that do not yet exist, but this does not permit omitting the entry point, manifest, or declared resources.

## Verify Tools and APIs First

Read references/development.md first. Read every resource through skill with source="builtin" and name="siyuan-plugin-development/relative-path". Check the tools currently available and the target SiYuan version; consult the official plugin-sample, petal, and source code for that version as needed. Do not treat type declarations, outdated README versions, or unreleased APIs as evidence of support in the current host.

Use CommonJS JavaScript by default. Use TypeScript only when the required dependencies and build tools actually exist and are authorized for use; source code is not equivalent to a runnable index.js. Native agents are not guaranteed to have a shell, dependency-installation tools, or arbitrary code execution. If a tool is missing, report the exact blocked step. Do not invent execution results or bypass a tool denial. If the user specifies TypeScript, confirm an alternative approach before switching to JavaScript.

## Implement in a Managed Copy

1. After plan confirmation, call bazaar's prepare_project with taskId so the host creates a source-code copy and baseline checkpoint; do not specify an absolute write directory yourself. For imports, first perform a read-only inspection of the exact sourceFiles, then import a copy after approval of the source and the selected files' baseline digest; leave the original directory unchanged. After reconfirming a plan for an existing managed project, obtain the current source revision with project_status(taskId), then call prepare_project(taskId, expectedSourceRevision) to establish a new checkpoint. This preserves the current source code without reimporting or overwriting it
2. Use file.write with ifAbsent=true for new files. Before editing existing text, use file.read with withMetadata=true; continue reading with the same expectedRevision and nextOffsetByte until you have fully read the original content that needs changing. truncated=true does not represent a complete file
3. Prefer file.edit for partial changes, providing expectedRevision and unique, nonoverlapping oldText/newText replacements. Use file.write with expectedRevision only when full replacement is necessary, and only after reading the entire file at that same revision. On a conflict, reread and verify first. Do not blindly retry writes or fall back to overwriting the entire file when a match is missing or ambiguous
4. Use the paths and project revisions returned by the host; verify the current source code, plan, and checkpoint through bazaar's project_status. Stop writing if a checkpoint cannot be established, and report partial failures accurately. When recovery is needed, use restore_project and respect the current revision and tool confirmation requirements
5. Do not bypass conditional writes for managed source code through copy, unzip, directory renaming, or HTTP file APIs. Do not touch host-controlled, backup, or artifact directories, or directly overwrite the actual plugin installation directory

Canceling the workflow does not automatically roll back changes. When cancellation, an unknown write result, or partial preparation prevents the ordinary plan from continuing, request recovery-only authorization through question with questions=[], workflow.action="recover", and taskId. The server displays and binds the most recently actually approved plan and its digest.
After confirmation, you may call restore_project, or retry prepare_project only for the same frozen, interrupted preparation. Recovery does not roll back notes, runtime data, or other configuration, and does not authorize further source-code changes; subsequent ordinary source changes still require normal plan confirmation.

Use the minimal entry-point pattern in examples/index.js as a reference and adapt it to the actual functionality. Create entry points through the public Plugin API and modify notes through kernel APIs; never use fs or Electron to modify data files directly. Put UI text in i18n. Handle return codes, missing targets, closed notebooks, repeated clicks, and late responses. onunload must handle partial initialization and clean up the plugin's own listeners, timers, observers, and requests; unloading cannot undo write requests that have already been sent.

## Verify, Package, and Deliver

Read references/verification.md first. Declare only frontends that are actually implemented and verified; do not declare kernels without kernel.js. Do not copy the example's author, repository, funding information, or data permissions, or invent a publishing identity for a local prototype.

Request a deterministic local ZIP through bazaar's package_local with taskId and the latest expectedSourceRevision. The host freezes only existing safe files on the allowlist. Optional paths may be absent, but plugin.json, index.js, and resources declared by the manifest must exist. It does not execute project scripts or download dependencies. If the entry point or declared resources are missing, or a secret file is detected, first correct the source code or reconfirm the scope. Retain the returned packageHash, sourceRevision, and validation results. Successful packaging does not mean JavaScript syntax, actual installation, frontend loading, or functional execution has passed verification.

Report separate results and evidence for source code, static checks, builds, ZIP packaging, simulated tests, actual installation, activation configuration, frontend loading, and functional execution. Mark builds for plain JavaScript as "not applicable"; mark steps that were not run as "unverified" and explain why. Tests using SDK substitutes or a standalone Electron DOM environment are not SiYuan integration tests; verify desktop Electron and the desktop browser separately.

Installation and activation each require the user's explicit authorization for the corresponding action and target. Overwriting an enabled plugin may execute code immediately; a disable notification does not confirm unloading in every frontend, so do not claim it automatically guarantees execution has stopped. Once authorized, use only the native installation interface, bound to the package digest and target revision returned by the host; do not install through generic file writes. Rolling back code does not roll back the user's notes or configuration.
