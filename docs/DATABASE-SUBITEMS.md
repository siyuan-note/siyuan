# Database sub-items

[中文](DATABASE-SUBITEMS.zh-CN.md)

Related issues: [#21038](https://github.com/siyuan-note/siyuan/issues/21038), [#15706](https://github.com/siyuan-note/siyuan/issues/15706)

## Feature scope

This document describes database sub-items on the `v3.8.10` branch, including behavior, data constraints, API compatibility, and verification coverage.

Sub-items organize records into multiple levels within one database. Each node is an independent database item with its own field values; bound and unbound items can coexist. An item has at most one direct parent and may have multiple direct children. An item without a parent is a root item. A subtree includes an item and all its descendants.

The database owns the hierarchy, which is shared by all views and mirrors. Each table or list view independently selects a nested or flat display. The database hierarchy does not change document directories, block trees, or list-block structure.

| View | Initial behavior |
|---|---|
| Table | Nested or flat display; nested display supports expansion, collapse, and hierarchy changes |
| List | The same hierarchy capabilities as a table, using the list layout |
| Gallery | Flat display; item properties expose and edit parent and child relations |
| Kanban | Flat display, grouped by each item's own field values; properties support hierarchy changes |
| Calendar | Flat display, positioned by each item's own dates; properties support hierarchy changes |

The feature covers desktop, browser, and mobile clients. Mobile provides menu operations so that dragging is never the only entry point. Multiple nesting levels are supported; iterative traversal, on-demand loading, and response-size controls handle deep structures.

Task dependencies express ordering or blocking between tasks and are outside this scope. The initial feature also excludes automatic scheduling, parent-child status propagation, date inheritance, and cross-database hierarchies. Implementation reuses the existing stack and local data mechanisms without introducing external services, data uploads, or paid dependencies.

## User interaction

### Enabling and displaying sub-items

Enable the feature under `Database settings - Sub-items` to create the `Parent` and `Sub-items` self-relation fields, or select existing self-relation fields. Existing fields must pass checks for a single parent, valid targets, cycles, and reverse-relation consistency. A failed check identifies the affected items and preserves the original data; it must not automatically choose a parent or remove relations.

Automatically created fields are hidden from table columns by default. They can be shown through property settings and viewed or edited in the item property panel. Fields are identified by ID, so renaming does not change their role. While the feature is enabled, the designated fields cannot be deleted, converted to another type, or retargeted to another database. Replacing the designated fields requires validation of the complete replacement before committing.

Enabling the feature from a table or list switches the current view to nested display while preserving the display of other views. New views default to flat display; duplicated views retain their display mode. `View settings - Nested display` affects only the current view and does not change relations.

Disabling sub-items for the database restores flat display in all views and preserves the relation fields and their values. Re-enabling requires validation of the existing relations. Disabling does not delete fields or downgrade the storage format.

### Creating and moving items

Table and list views show indentation and an expansion control before the primary field. The item menu provides `Add sub-item`, `Change parent`, and `Promote one level`. The parent selector excludes the current item and its descendants, and supports clearing the parent to move the item to the root level.

| Operation | Result |
|---|---|
| Add sub-item | Create a regular item with the current item as its parent |
| Change parent | Move the entire subtree while preserving its internal relations |
| Promote one level | Make the item a sibling of its former parent; if that parent is a root, the item becomes a root |
| Drag into an item | Make the dragged item a child of the target; the drag indicator identifies the target parent |
| Drag between siblings | Change sibling order; an insertion line identifies the target position |
| Clear parent | Make the item a root while retaining its descendants |

Ordinary fields on a new sub-item use the existing template, filter, and group defaults. An explicitly selected parent takes precedence over defaults. Reparenting, promotion, and subtree moves do not automatically change ordinary fields such as status or dates. If an added or moved item does not match the current filter, report that it was saved but is outside the current results; do not rewrite its fields to keep it visible.

With automatic sorting enabled, sort rules determine sibling order and manual reorder dragging is disabled. Reparenting remains available, with the destination's sibling rules determining position. Operations must not infer a target parent solely from the displayed row number.

Selecting a parent does not implicitly select its descendants. Moves and duplication operate on subtrees, processing descendants already covered by a selected ancestor only once. Deletion affects only explicitly selected items.

Multirow paste in a nested view follows the current page's visible item order, including context ancestors. Excess rows retain the existing behavior of creating top-level items without overwriting collapsed items or items on other pages.

### Filtering and searching

A nested view evaluates filters for each item before adding the ancestor paths of matching items. Ancestors included only for context use subdued styling and a context marker so that they are not mistaken for filter matches.

| Condition | Display |
|---|---|
| A child matches but its parent does not | Show the child and its complete ancestor path |
| Other siblings do not match | Hide those siblings |
| A parent matches but its children do not | Show the parent without adding nonmatching children |
| No items match | Show an empty result without retaining context items that have no matching descendants |

Search uses the same ancestor rules and temporarily expands matching paths. Clearing the search restores the previous expansion state. Filter changes do not rewrite relations or promote filtered-out children to roots. Context items retain their existing editing permissions; ancestor inclusion, counts, and navigation must not broaden data visibility.

### Grouping and sorting

In nested display, the entire tree follows the root item's group value. Children retain their own values even when shown in their parent's group. For example, a child marked `Done` remains `Done` when displayed below a parent marked `In progress`. Flat views continue grouping each item by its own field values.

When multi-select or relation fields place a root in multiple groups, each group may display the same tree. These display instances refer to the same items. Selection and bulk operations deduplicate by item ID. Counts within a group deduplicate items, and the database total must not be calculated by summing group counts.

Moving a root between groups follows the existing group-field update rules. Its tree follows the new group placement without changing child fields. Dropping a child onto empty space in another group must not assign an ambiguous parent; users must choose a target parent or first promote the item to the root level before changing its group. Groups based on read-only calculated fields retain their existing mutation restrictions.

Sorting applies only among the direct children of the same parent, with roots treated as siblings. Equal sort values retain a stable order. Sorting must not separate children from their parents, and different views retain their own manual order.

### Deletion, duplication, and undo

Deleting a parent promotes its surviving direct children by one level. Deleting a root makes its direct children roots. When a batch deletes multiple levels, surviving items attach to their nearest surviving ancestor, or become roots if none remains. Preserve internal subtree relations and relative sibling order, placing promoted items at the deleted parent's former position.

Removing an item from a database does not itself delete its bound document or block. Handling a deleted binding source continues to follow existing binding rules. If that handling removes the database item, it must also promote children instead of leaving parent relations pointing to a nonexistent item.

In a database with sub-items enabled, duplication defaults to the complete subtree, including descendants hidden by collapse or filtering. Every copy receives a new item ID, and internal relations are remapped to those IDs. The copied subtree root retains the original item's external parent and becomes its sibling. Ordinary fields and ordinary relations retain their existing duplication semantics.

Duplication preserves the existing unbound-copy behavior: a copy of a bound item is unbound and does not duplicate its document or block body. Hierarchy fields must be rebuilt separately; copying the `Sub-items` field directly must not reparent original children under the copy.

Creation, moves, reparenting, deletion, and duplication must support complete undo and redo, including hierarchy, reverse relations, view order, and affected configuration. Undo must not overwrite unrelated edits made after the operation. Conflicts preserve the current state and return an identifiable error.

### Statistics, pagination, and navigation

Filtered statistics count actual matches and exclude ancestors added only for context. Parents and children remain independent items; child numbers are not automatically added to parent values. Expansion and collapse do not change statistics. Group statistics follow the nested view's group assignments.

Nested pagination counts root items, with separate paging inside each group of a grouped view. The interface distinguishes root counts from matching-item counts instead of interpreting flat row counts as nested page counts. Expanding a node loads its direct children, with previous and next controls for large child collections, displaying the current page in a bounded window. Navigation can jump directly to the target child page without returning every preceding child; response-size limits must not make later children inaccessible.

Navigating to a deep item locates its group and root page, expands its ancestors, and loads the child page containing the target. If the target is excluded by the current filter, return an explicit status without silently changing filters. A target already present as an ancestor of a matching descendant can be located normally. For targets in multiple groups, prefer an explicitly requested group; otherwise use stable view order.

## Data and storage

### Relation model

The hierarchy reuses `Relation` and the item IDs in relation values instead of adding an independent copy of the parent value. The parent field stores at most one item ID, and the sub-items field is the maintained reverse relation. Item IDs must remain distinct from bound block IDs: binding the same block does not determine an item's hierarchy identity within a database.

| Configuration or data | Ownership and rules |
|---|---|
| Sub-items configuration | Database-level enabled state and parent/sub-items field IDs; one hierarchy definition per database |
| Parent relation value | Item-level source of hierarchy decisions; an empty value indicates a root |
| Sub-items relation value | Reverse representation of parent relations, maintained with parent changes |
| Nested display mode | View-level setting for table and list layouts only; defaults to flat |
| Manual sibling order | Ungrouped views reuse view item order; groups retain separate nested manual order and flat membership order, interpreted within each parent |
| Hierarchy index | Rebuildable parent, child, and ancestor indexes derived from authenticated source data; not another authoritative source |

Ordinary self-relations do not gain single-parent or acyclic constraints. These constraints apply only to fields designated for an enabled hierarchy. Adding or removing entries through the sub-items field must become corresponding parent changes. Adding an existing child to another parent also removes the former parent's reverse relation.

### Persistence and local state

Hierarchy configuration, relation values, and view display modes remain in the existing attribute-view data and sync with the database. Ordinary databases continue using `data/storage/av/<avID>.json`. Encrypted databases use their notebook's existing authenticated encrypted storage without copying configuration or relations into ordinary database storage or global plaintext indexes.

For ordinary databases, expansion state is a local mapping keyed by database, view, group display instance, and item ID. Store it in `data/storage/local.json` through `window.siyuan.storage` and `setStorageVal`, without browser `localStorage`. Temporary search expansion is separate and must not overwrite regular expansion state. For encrypted databases, expansion state remains in the current unlocked session and is cleared when the notebook locks or closes; its hierarchy must not be written into ordinary local state.

After relation changes, each view reinterprets its own item order. An explicitly requested insertion position affects its view and group, while other views and groups retain stable order. Groups store nested manual order separately so a child's own grouping value cannot remove its position in its parent's group; this order changes neither parent-child relations nor flat group membership. Existing data without nested group order falls back to existing group and view order. Hierarchy changes must not reset unrelated group order, field values, or view settings.

## Implementation and interfaces

### Module responsibilities

| Module | Implementation scope |
|---|---|
| `kernel/av` | Sub-items configuration, format versions, relation validation, hierarchy indexes, and render data structures |
| `kernel/model/attribute_view.go` and related transaction modules | Relation writes, subtree duplication, promotion after deletion, reverse relations, and undo/redo |
| `kernel/model/attribute_view_render.go` and sorting, grouping, and navigation modules | Hierarchical filtering, grouping, sibling sorting, statistics, pagination, and target navigation |
| `kernel/apicontract` and corresponding API handlers | Typed contracts, input compatibility, authorization, and response semantics |
| `app/src/protyle/render/av` and related mobile entry points | Table/list rendering, menus, dragging, property editing, selection, focus, and refresh |

Existing flat rendering processes items through filtering, sorting, calculation, and pagination. Nested display requires a hierarchy-aware processing path rather than frontend indentation of flat rows. Reuse the existing table, list, relation, menu, and property-panel components.

### Validation and transactions

All write paths share kernel validation, including relation cells, property panels, dragging, bulk paste, templates, APIs, and automation. Validate item existence in the current database, single-parent constraints, self-parenting, cycles, and reverse consistency against the final structure of the entire batch. A valid batch must not fail solely because of an intermediate state.

Revalidate against the latest source before committing, reusing the existing transaction and snapshot recovery mechanisms. A structural change maintains parent values, reverse child values, affected view order, and caches together. Failure must not be reported as complete success or leave a partially applied hierarchy. Ordinary two-way relations involving other databases retain their existing transaction and encryption boundaries.

Duplication first determines the deduplicated source subtrees and allocates all new IDs, then copies ordinary fields and rebuilds internal relations. If the response is uncertain, check the generated items before retrying; do not automatically duplicate them again. The kernel records sufficient source state for undo and redo and must not accept fabricated recovery snapshots from clients.

Hierarchy fields do not bypass existing automation write constraints or introduce parent-child completion or date propagation. Refresh affected views after the operation, avoiding duplicate structural operations caused by reverse-relation updates.

### Rendering and caches

Nested reads follow this sequence:

1. Validate database access, read-only state, and encrypted read leases, then read the appropriate source version
2. Build the hierarchy index from the complete item identities and parent relations, then calculate filter and search matches
3. Add ancestors within the authorized scope, distinguishing actual matches from context items
4. Group by root items, apply sort rules among siblings at each level, and calculate matching counts and statistics
5. Page roots and direct children of expanded nodes, generating row content only for the requested response
6. Return hierarchy metadata and navigation information while reusing existing frontend cell rendering and conditional colors

Use iterative traversal and visited markers to prevent stack overflow on deep structures or endless expansion on cycles. Building the structure index should scale linearly with item count rather than repeatedly scanning the entire database for every item's descendants. Field filters may still read necessary data, but rendering every row in the tree before slicing a page is not permitted.

The frontend reuses table and list virtual scrolling, treating the expanded row count separately from the root page size. Root and direct-child paging limit the width read at each level; fully expanded deep paths or many subtrees still produce responses and server memory usage proportional to the returned items. Virtual scrolling limits mounted rows and does not imply constant server cost. The existing grouped layout retains group headings and at least one row per nonempty expanded group, so the mounted total also depends on the number of groups; the row-window budget is not a fixed DOM limit across all groups. Groups share one batch of rendered item contents, so repeated display instances do not evaluate templates again.

Caches must incorporate the source version and configuration affecting hierarchy results. Relation, filter, sort, group, and field changes must invalidate them correctly. Expansion responses must be checked against the current view and request version, discarding stale results. Ordinary live databases, encrypted databases, history, and snapshots must not share source caches. After a notebook locks, caches must not continue serving protected data.

### Interfaces and declarations

Nested reads explicitly request hierarchy capabilities and return parent identity, depth, child counts, context markers, and pagination information. Existing callers that omit hierarchy capabilities retain flat responses and existing count semantics. Switching a view to nested display must not change the response shape seen by those callers. Define new nested counts separately from existing row counts.

New or extended contracts cover enabling configuration, bulk parent changes, subtree duplication, child reads, and path navigation, keeping database, item, view, and operation-context identities explicit. Existing single-item duplication calls retain single-item semantics; the interface uses an explicit subtree operation when sub-items are enabled. Reads and writes preserve existing authorization, writable checks, and encrypted notebook leases.

Contracts originate in `kernel/apicontract/`, bind through `contractHandler`, and generate frontend declarations, schemas, and Petal declarations. Do not hand-edit generated files. Document defaults, boundaries, and compatibility in contracts and corresponding maintained declarations. See [Kernel API type contracts](API-CONTRACTS.md) for maintenance and generation rules.

### Implementation order

1. Implement the data model, shared validation, relation transactions, promotion after deletion, subtree duplication, and associated kernel regression tests
2. Implement nested rendering, grouping and sorting, statistics and pagination, navigation, and caches, maintaining contracts and compatibility tests
3. Implement table, list, and mobile entry points, covering dragging, selection, focus, property panels, and refresh behavior
4. Complete existing-data, encryption, history recovery, import/export, and scale checks; synchronize all interface languages and the four bundled guide languages

Maintain tests and fixtures alongside each implementation step. Data, interaction, and compatibility acceptance together define the initial delivery; indentation or passing static checks alone does not establish complete functionality.

## Compatibility and recovery

### Format and disabling

Sub-items use database format version `Spec 14`. Only databases that actually enable the feature upgrade their format; merely opening or reading an unaffected database must not upgrade it. Older kernels without format support must reject rewriting it, preventing configuration loss or bypassed constraints. The enable control should explain that devices accessing the database need support for the new format.

Save a recoverable original state before enabling, and commit configuration and format changes only after validation. Interruptions, write failures, and unsupported source formats must preserve original data rather than clearing relations to complete an upgrade. Hiding nested display or disabling the feature does not automatically downgrade the format. Reverting to an older version uses matching backups or history sources, not an older kernel ignoring added fields.

Reading cycles, multiple parents, or missing targets returns an identifiable structural error. Do not silently choose a parent, delete relations, or overwrite the source. Repairs must explicitly operate on authenticated source data; rebuild derived indexes only after the source is valid.

### Duplication, import, and export

Whole-database duplication and native import must remap database, field, and item IDs while maintaining hierarchy configuration and reverse relations. Statically resolved field ID references in templates follow the mapping; dynamically computed expressions or uncertain call contexts remain unchanged, without globally replacing ordinary text. Native export, backup, and sync preserve the complete hierarchy. Flat exports retain their existing field-export semantics; visible indentation alone does not establish hierarchy round-trip support.

The initial feature does not add cross-database tree migration. Existing cross-database item operations must still validate destination field semantics. They must not write source parent IDs as destination hierarchy relations or automatically enable sub-items in the destination. If structure cannot be preserved, explain the outcome before committing or return an error instead of silently changing source relations.

### History, encryption, and failure recovery

History and snapshots use their own versions of configuration, items, and relations instead of completing past structures from the current database. Rollback restores data and hierarchy configuration together and invalidates affected derived indexes.

Existing encrypted data is the compatibility baseline. Upgrades must preserve authenticated reads and recovery for supported formats. The feature must not change keys, encrypted envelopes, AAD, or key derivation. It must not regenerate MasterSalt or require deleting or recreating notebooks. Existing isolation between ordinary and encrypted notebooks, and between different encrypted notebooks, remains in force.

Migration must authenticate the source first, preserve history, backups, and necessary recovery material, and remain recoverable after failure or interruption. Unknown formats, corruption, and authentication failures preserve the original data and return errors without falling back to plaintext reads. Encrypted hierarchies, ancestor information, counts, and error content must not leak through plaintext caches, global indexes, or unauthorized responses. See [Encrypted notebooks](ENCRYPTED-NOTEBOOK.md) for the compatibility policy.

## Verification

| Scenario | Acceptance requirements |
|---|---|
| Data constraints | Roots, multiple levels, single-parent constraints, self-parenting, cycles, missing targets, existing-field conversion, and re-enabling after disabling |
| Write paths | Identical constraints for relation cells, reverse child edits, property panels, dragging, bulk paste, templates, APIs, and automation |
| Display and filtering | Matching table/list behavior; ancestor inclusion, hidden nonmatching siblings, empty results, restored search expansion, and flat display in other layouts |
| Grouping and sorting | Whole-tree grouping, deduplication across group displays, calculated-field restrictions, sibling sorting, manual order, and cross-group operations |
| Statistics and pagination | Collapse-independent statistics, context excluded from match counts, and root/child pagination and deep navigation without duplicates or omissions |
| Structural operations | Mixed bindings, intermediate-node deletion, bulk deletion, duplication of hidden descendants, overlapping-selection deduplication, and complete undo/redo |
| Concurrency and failures | Stale views, concurrent reparenting, uncertain duplication responses, write failures, undo conflicts, and transaction recovery |
| API compatibility | Existing request defaults, flat responses, single-item duplication semantics, new contracts, authorization, read-only behavior, and lease checks |
| Persistence and recovery | Restart, mirror refresh, sync, whole-database duplication, native import/export, history, and backup recovery |
| Encryption boundaries | Authenticated reads, unlock/lock, cache cleanup, export, and recovery using supported historical-format fixtures; errors leave original ciphertext unchanged |
| Platforms and interface | Desktop, browser, and mobile menus, expansion, editing, selection, focus, narrow layouts, themes, and large fonts |
| Scale | Ten-thousand-item datasets, wide subtrees, and deep chains; check response size, loading time, memory, counts, and complete traversal, recording the environment before comparing performance |

Kernel tests cover `kernel/av`, the relevant `kernel/model` transactions and rendering, actual API responses, input compatibility, and route coverage. Run contract tests with `go test ./apicontract/...`. Tests requiring database and encryption capabilities use the maintenance guide's `fts5 sqlcipher` build tags and isolated workspaces, without replacing the product binary or restarting a running kernel.

After frontend implementation, run `pnpm run lint`, review automatic-fix diffs, and run relevant behavioral tests. Because the feature spans shared rendering, relations, sorting, and interactions, run the complete `pnpm test` suite before delivery. Test entry points come from the target branch's `app/scripts/test.mjs`; do not assume another branch's test-selection scripts are present. Browser interaction checks use `/stage/build/desktop/`.

After contract changes, generate and check declarations following the maintenance guide, first verifying the Petal checkout's path, branch, and existing changes. Synchronize all interface languages and run `python scripts/check-lang-keys.py`. Update the English, Simplified Chinese, Traditional Chinese, and Japanese user guides together. Existing test discovery must include new tests, which are maintained with their implementation.
