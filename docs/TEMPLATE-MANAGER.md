# Template manager

[中文](TEMPLATE-MANAGER.zh-CN.md)

## Feature scope

The template manager browses, edits, and organizes templates under `data/templates`, and previews template content using a selected document as context.

## User interaction

Open the manager from a template entry's Template manager button in the editor's template picker to select that template automatically, or from a document's Export - Template dialog. Desktop and browser clients also provide an entry in the top-left main menu, available even when the template list is empty. Desktop, browser, and mobile clients share the same manager. Templates can be managed without an open document; preview requires selecting a context. On desktop clients connected to a local kernel, Open file location opens the selected item's location, or the template root when nothing is selected.

### File management

The left pane displays a collapsible tree of directories and Markdown files under `data/templates`, with directories first. Search matches template names or full paths and expands parent directories of matches. Clearing search restores the previous expansion state. Clicking a directory selects it and toggles its children without changing the editor or preview. New templates and folders default to the selected directory, while Save and Preview still apply to the template being edited. Rename changes only the name and retains the parent directory; moving across directories uses a directory picker. Existing targets are not overwritten. Successful creation, rename, or move clears search and expands the target parent. Rename and move do not rewrite template paths referenced by other templates, notebook configuration, or documents; those references require corresponding updates.

Template package directories containing `template.json` cannot be renamed or moved, preserving package identity and marketplace updates. However, templates inside a package remain editable. Existing files retain their original names and are not rejected because of valid characters such as single quotes.

### Editing and saving

The right pane edits source in a plain text field. Saving checks the file version recorded when reading. If sync or another window changed the file, then the manager rejects the overwrite; retain current edits and refresh before resolving the conflict. Switching files, refreshing, or closing asks for confirmation before discarding unsaved changes. Templates with Windows line endings retain them when saved.

Deletion directly removes the selected file or directory and all its contents without writing to a separate trash folder. This cannot be undone. Templates are not part of file history, so file history cannot restore them. Existing content under `data/templates/.trash/` is not automatically cleaned up, and that hidden directory remains absent from template search and management lists.

### Preview

Preview template runs the current editor content without saving it or inserting it into a document. The default context is the document or block used to open the manager. Preview context shows the selected name, an explanation of its purpose, and a document picker that can search for another context document. This search selects the context document, not templates in the left pane. Rendering uses the selected document's title, ID, and other information without modifying that document. Title, ID, path, and SQL results depend on the selected context and current data.

Preview uses existing read-only rendering. It neither saves source nor commits a document-tree creation plan. The preview background follows the editor theme in light and dark modes rather than using a fixed white background. Database previews use tables and therefore do not reproduce every interaction available after insertion.

Templates using `createDocTree` display the planned document names, hierarchy, and count in the preview, including templates with no body.

## Data and storage

### Export memory and document attributes

The export dialog can select an existing template subdirectory. To create one, open the template manager; closing it refreshes the directory list. After a successful export, the source document remembers the template name and directory. Exporting that document or a heading subtree again restores them. A missing directory falls back to the template root. An unconfirmed name collision, failure, or cancellation does not update this memory. Internal memory attributes are omitted from exported templates.

The database-copy option appears only when the actual export range contains a database block. Databases in other heading ranges, child documents, or query-embed results do not count as part of that range.

A standalone top-level `template` or `siyuan-template` code block can declare document attributes:

````markdown
```template
{: icon="api/icon/getDynamicIcon?type=5&date=.action{now | date "2006-01-02"}" type="doc"}
```
````

These attributes are evaluated at their original template position and merged into the document root after rendering. They can therefore use local variables from conditional branches, loops, and template definitions spanning code blocks. Explicit declarations that actually execute take precedence; unexecuted branches do not override source attributes. The export flow continues to maintain document IDs, and update timestamps are not exported. Attribute blocks containing other body content or conditional statements, or nested in containers, remain ordinary template content without attribute extraction.

New exports preserve the original evaluation position of standalone attribute declarations in a code block marked `siyuan-template-doc-attrs-v1`. The renderer merges attributes and removes that block when parsing template results. Existing templates that declare document attributes directly at the end of the file remain supported without conversion.

## Implementation and interfaces

`POST /api/template/manage` requires administrator privileges and is unavailable in read-only mode. Supported `action` values are `list`, `read`, `write`, `mkdir`, `move`, and `remove`. `path` and `target` are relative to the template directory. Writing, moving, or deleting an existing item requires the `revision` returned when it was read. A new file uses an empty `revision` and must have a `.md` extension.

UI renaming reuses existing filename handling: ASCII slash `/` becomes full-width slash `／`, then the name is validated and combined with its original parent before calling `move`. The name is not interpreted as a path. Backslashes, colons, `.`, `..`, and other invalid names are rejected. New-template and new-folder paths retain `/` as the directory separator and do not apply this name conversion. `remove` validates path boundaries, symbolic links, and revisions before deleting, recursively for directories. Success returns `data: null` without a `recoveryPath`. Deletion creates no template file history and does not clean up existing hidden recovery directories.

`POST /api/template/render` accepts optional `content` in `mode: "preview"` to preview unsaved source. `path` still identifies the actual template file for resolving subtemplates in the same package. Other rendering modes reject `content`.

`POST /api/template/docSaveAsTemplate` accepts an optional relative `directory`; omission retains the template-root default.

`POST /api/template/getDocSaveAsTemplateInfo` takes a document or block `id` and returns the document's remembered template name and relative directory, plus whether the actual export range contains a database. A successful template export from the UI updates the owning document's name and directory memory through `docSaveAsTemplate`.

## Compatibility and recovery

Existing templates retain their original filenames, Windows line endings, and support for document attributes declared directly at the end of the file. New standalone attribute exports use `siyuan-template-doc-attrs-v1` to preserve evaluation position. Moving and renaming do not migrate external template references; therefore callers must update those paths.

File-version conflicts preserve current editor content and reject overwrites. Deletion creates no file history and therefore cannot be undone through the manager. Existing `data/templates/.trash/` content remains and is not automatically cleaned up.

## Verification

Verify file-tree ordering, expansion state after search, target directories for creation and moves, valid filename access, package-directory protection, version conflicts, and unsaved-change confirmation. Preview checks include unsaved source, context changes, read-only rendering, document-tree plans, and theme changes. Export checks include directory fallback, memory updates only after success, database-range detection, attribute evaluation position, and old-template compatibility. Deletion checks include path boundaries, symbolic links, revisions, and preservation of existing hidden recovery directories.
