# Skill manager

[简体中文](SKILL-MANAGER.zh-CN.md)

Open Workspace skills in the Skills group under Settings - Artificial Intelligence. The manager edits skills stored in the current workspace at `data/storage/ai/agent/skills/<directory>/SKILL.md`. External skills from `~/.agents/skills` remain in the adjacent read-only list, where they can be enabled individually.

## Managing files

Search the file list and select `SKILL.md` or a bundled `.md` file to edit its Markdown source. Editable source files must be valid UTF-8 and at most 8 MiB. Save writes the source back to the selected path without converting it into a SiYuan document or regenerating its YAML frontmatter. Files with consistent CRLF line endings retain that format; editing a file with mixed line endings normalizes them to LF. Leaving a file unmodified or discarding changes preserves its original source. Unsaved changes require confirmation before they are discarded.

Create a skill to add a directory containing `SKILL.md`. Inside a skill, create Markdown files and folders, rename files or folders within their current parent, and delete Markdown files or folders. A skill's root `SKILL.md` cannot be renamed or deleted on its own; delete the containing skill to remove it. Renaming a skill directory does not change the independent `name` field in its frontmatter.

Other resource files appear in the list but cannot be edited, renamed, or deleted individually in the manager. A local desktop client can open their file location for management with other applications. Deleting a folder also deletes every resource inside it, including files that the manager cannot edit, and cannot be undone through the manager.

On mobile, the manager opens as a full-screen settings subpage. Selecting a file opens an editor page with Back and Save at the top. Returning to the file list preserves its scroll position, and returning to settings preserves the existing settings page state. Unsaved-change confirmation and layout adaptation to the on-screen keyboard remain available; short confirmations and name entry use ordinary dialogs.

## File identity and concurrent changes

Operations use paths relative to the workspace's skills directory. A skill's frontmatter `name` is not its file identity: names may differ from directory names, and duplicate names do not hide files from the manager. Existing skill discovery and precedence rules remain unchanged.

Reading a file or folder returns a revision. Updating, renaming, or deleting an existing item requires that revision, and the operation is rejected if the item has changed. A conflict leaves the current on-disk contents intact; preserve your draft and reload the item before deciding how to merge the changes. The manager does not provide a force-overwrite operation.

The management interface rejects paths through symbolic links, paths outside the skills directory, and ambiguous Windows names. This does not change the agent's existing ability to load supported linked skills.

## HTTP API

`POST /api/ai/agent/manageSkills` uses the standard API response envelope and requires an authenticated administrator in a writable workspace. Requests contain `action` and, depending on the action, `path`, `target`, `content`, and `revision`. Paths use `/` separators and are relative to `data/storage/ai/agent/skills`.

| Action | Behavior |
| --- | --- |
| `list` | Return the file tree as `entries`, with `path`, `isDir`, and `editable` for each entry |
| `read` | Return the item's `revision`, plus original `content` for editable Markdown files |
| `create` | Create a top-level skill directory and its `SKILL.md` |
| `mkdir` | Create a folder inside a skill |
| `write` | Write a Markdown file inside a skill; an existing file requires its current `revision`, and a new file uses an empty revision |
| `move` | Rename an item to `target` within the same parent, using its current `revision` |
| `remove` | Delete an item using its current `revision` |

The root `SKILL.md`, non-Markdown files, symbolic links, and folder deletion follow the restrictions described above. A rejected revision or invalid operation returns an error instead of changing the item. Existing name-based skill APIs remain available for compatibility; management clients should use relative paths through this endpoint.
