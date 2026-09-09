# Tab Block

[中文](TAB-BLOCK.zh-CN.md)

A tab block groups content in a single container and switches between groups through top or left navigation. Each tab item is a container with its own block ID and can contain ordinary blocks and nested tab blocks.

Related issue: https://github.com/siyuan-note/siyuan/issues/17642

## Data model

| Node or attribute | Meaning |
| --- | --- |
| `NodeTabs` | Tab container whose direct content blocks are `NodeTabItem` nodes |
| `NodeTabItem` | An item containing a title and body; documents, bare list items and bare tab items are not valid direct children |
| `TabItemTitle` | Inline Markdown title using the same inline representation as callout titles |
| `tabs-title="true"` | Marks the item's first `NodeParagraph` as a separate title block; when present, this paragraph is the sole title source and overrides `TabItemTitle` |
| `tabs-active-id` | Selected direct item ID in the container IAL; missing or invalid values fall back to the first item |
| `tabs-position` | Container IAL layout attribute: `top` or `left`, defaulting to `top` |
| `tabs-task` | Optional task-state character in the item IAL; absence means an ordinary tab |
| `tabs-placeholder="true"` | Marks an empty body paragraph added during list-to-tabs conversion |

Child order determines tab order. Empty and duplicate titles are valid, and UI placeholder text is not saved as content. A separate title paragraph retains its ID, block attributes and complete inline content.

Canonical data contains at least one item and at least one body block per item, using an empty paragraph when needed. The kernel's `NormalizeTabs` fills empty containers and bodies and repairs selection and invalid layout attributes. When the frontend deletes or moves away the last item, it converts the original container into an empty paragraph while retaining the container ID.

Moving preserves IDs. When copying, inserting templates, importing or restoring regenerates IDs, it also remaps `tabs-active-id` and internal block references and block links in titles; external references retain their targets. A standalone item is a valid editing fragment and receives a tab container when pasted into ordinary content. Internal Markdown round trips temporarily wrap such fragments and restore their original fragment identity afterward.

## Markdown syntax

```markdown
::: tabs
@tab **Windows**

Instructions for Windows.

@tab:active Linux

Instructions for Linux.
:::
```

Opening fences contain at least three colons followed by spaces or tabs before `tabs`; canonical output uses one space. `@tab` or `@tab:active` starts a direct item. A nonempty inline title is separated from the marker by spaces or tabs. Items have no closing marker; the group closes with a standalone colon fence matching its opening length.

The first valid `@tab:active` in a group selects an item and takes precedence over `tabs-active-id` in the group IAL. Without that marker, a valid attribute is retained; otherwise the first item is selected. Internal Markdown emits the selected item as `@tab:active`. Nested groups are handled independently.

Tabs can nest inside lists, blockquotes, super blocks and other tab items. An outer fence must be longer than the fences it contains. Indentation is optional. Canonical output computes fence lengths from nesting depth without adding body indentation: three colons for a single level, four outside and three inside for two levels. The syntax has no fixed nesting-depth limit.

```markdown
:::: tabs
@tab First outer tab

::: tabs
@tab First inner tab

Inner content.
:::

@tab Second outer tab

Outer content.
::::
```

Markers inside code blocks remain literal. Escape literal item markers at the start of body lines as `\@tab` or `\@tab:active`. An isolated `@tab` outside a group is ordinary text. Content before the first marker becomes an item with an empty title. Incomplete input closes within the parser's scope, and canonical output supplies closing fences. Old `:::tabs` and `:::tab` forms are not tab syntax; existing `.sy` tab node structures are unaffected.

Item IAL goes immediately after the title marker with no intervening blank line, followed by a blank line before the body. Group IAL follows the closing fence, and body-block IAL follows its corresponding block. Task state also uses item IAL:

```markdown
::: tabs
@tab:active Example task
{: id="20260905120000-item001" tabs-task="/"}

Body.
{: id="20260905120000-para001"}
:::
{: id="20260905120000-tabs001" tabs-active-id="20260905120000-item001" tabs-position="left"}
```

Internal Markdown emits a separate title paragraph as the first paragraph, retaining `tabs-title="true"`, its ID and attributes. The `@tab` line then omits duplicate title text. Structured clipboard Markdown instead puts the complete title on the `@tab` line and omits the duplicate title paragraph.

## Menus and editing

The block icon operates on the whole container. Block icon menu - Tabbed container contains the top and left layout choices, followed by a separator and Task. All three options display their selection indicators on the right. These entries and the separator are registered in the configurable menu catalog for visibility and ordering.

A title's context menu operates on that item. It offers copying a block reference and, when editable, renaming, duplication and deletion. Task items also offer Custom task status. The header has no separate More button. Whole-container conversion is available through block icon menu - Turn into, including unordered lists, ordered lists, task lists and super blocks.

Clicking a title selects its item. Double-clicking or choosing Rename edits rich text directly at the title location, reusing callout-title inline formatting, selection and IME handling. The navigation copy is display-only; saving and reverse parsing use the original title inside the item. Font colors and other inline styles remain title content; renaming does not first expose an encoded string for the user to edit. Finishing editing preserves navigation scroll position and hides the inline toolbar. A hidden title selection cannot open the toolbar at the top of the document.

A new tab block starts with two items, each containing an empty paragraph. Adding an item appends it, selects it and starts title editing. Navigation truncates long titles visually and shows a title tooltip on hover; stored text has no fixed character cutoff. Navigation and the add button cannot be selected as body text.

### Task state

A single ASCII space in `tabs-task` means incomplete. `X` or `x` displays the completed icon; other supported single-character states display their exact character. Custom-state input uses task-list marker validation, accepting a single ASCII character other than square brackets. State is independent of title and selection and is saved and synced with the document.

Task in the block menu is a group toggle. It is checked if any direct item has `tabs-task`. Turning it off removes the attribute from every direct item; turning it on initializes all items as incomplete. A new item is an incomplete task whenever the group contains any task item. Moving between groups retains each item's state, so mixed groups remain possible and can be normalized through the group toggle.

Clicking a state icon does not select the tab or start renaming: incomplete becomes `X`, while any other state becomes a space. Right-clicking the icon or choosing Custom task status in the title menu edits the current item's state. The icon has no separate Task List tooltip.

### List and super-block conversion

List-to-tabs conversion affects only the current level. Each direct list item's first paragraph becomes its title, retaining the complete text, inline formatting, references, links, ID and attributes without duplicating it in the body. If the first block is not a paragraph, the title is empty and that block stays in the body. Nested lists and tabs are not flattened. Conversion selects the first tab.

Converting back places a separate title paragraph first, removes `tabs-title` and appends the body. A nonempty string title creates a new paragraph. Identical title and body text is not deduplicated. A list item containing only a title receives a body placeholder on conversion to tabs. Conversion back omits only a `tabs-placeholder` paragraph that is still empty and has no inline elements, user attributes or reference count.

Task-list conversion preserves incomplete, complete and custom states. Converting to a task list restores the current `tabs-task`; items without that attribute become incomplete. Conversion to an ordinary list removes the task attribute. Ordered lists restart at 1. Layout and selection are not retained as backups for reverse conversion.

Converting to a super block turns the container and its items into vertical super blocks, converts titles into paragraphs and retains container, item and body IDs. List and super-block conversions use ordinary editing transactions and support undo.

## Selection, navigation and dragging

In editable editors, explicit selection and selection triggered by search or block-reference navigation save `tabs-active-id` through the attribute API after queued editing transactions. Selection does not occupy the body undo stack or update body modification timestamps, but is written to disk and synced. Read-only pages, embedded previews, history previews and exported HTML allow temporary switching without saving selection.

When restoring position after refresh or restart, persisted selection takes precedence over a stale caret in a hidden item. Focus moves to the selected body without reusing the stale text offset. Explicit navigation to hidden content activates each containing tab. An incoming selection that would hide content currently being edited is deferred to avoid interrupting focus and IME composition.

Items use ordinary block-reference syntax, such as `((20260905120000-item001 'Tab title'))`, without a dedicated reference syntax. The target is the item ID, and navigation selects that item. Reference hover previews include the parent container for rendering. References and resources in string titles belong to the item; those in separate title paragraphs belong to the original paragraph ID.

Dragging a navigation title moves the entire item; dragging a body block moves content. Sorting previews move adjacent buttons out of the drop position, fade the dragged button and scroll near navigation edges, using the appropriate axis for each layout. Dropping commits one transaction; canceling or returning to the original position commits none. Cross-group moves update both groups in one transaction. Read-only targets and descendants of the dragged item reject drops.

Deleting the active item selects the next item if available, otherwise the previous one. Deleting the last item produces an empty paragraph. Ordinary text selection excludes hidden bodies; whole-container copying and deletion include every item. Backspace and Delete at body boundaries do not automatically merge adjacent items.

## Rendering and layout

`NodeTabs` renders as `.tabs` with direct `.tab-item` children. Navigation lives in `.tabs-header.protyle-action` and has no content block ID. The original title is `.tab-item-title.callout-title` inside `.tab-item-info`; the body is `.tab-item-content`, without reusing the callout body class. During editing, `.tabs-title-editor` overlays the corresponding navigation button.

The container uses a theme border and rounded corners. Top navigation scrolls horizontally. Left navigation sizes to content, with an 80px minimum header width and a column limit of the smaller of 200px and 40% of container width. A 48px gap leaves room for body block controls. Containers narrower than 420px temporarily display top navigation without changing `tabs-position`.

Navigation provides `tablist`, `tab` and `tabpanel` semantics with independent DOM IDs for each rendering instance. Arrow keys, Home and End move navigation focus; Enter or Space activates an item. Title editing follows text-editing key handling. Hidden items continue receiving data updates, and becoming visible reprocesses size-dependent render nodes and databases.

## Indexing, export and format compatibility

Titles participate in full-text indexing, reference and resource scanning, dynamic anchor text and history differences. String titles use temporary inline trees; separate title paragraphs use ordinary paragraph processing without duplicate scanning. Block names take precedence over titles as reference anchor text. Headings inside tabs do not participate in document heading numbering, and folding does not cross item boundaries.

Internal Markdown retains full structure and attributes. Structured output with `TabsMarkdown` enabled preserves fences, complete inline titles, active markers and task-state IAL. Clipboard output omits complete block IAL such as block IDs. Flattened output with that option disabled emits every item's title and body in order. Ordinary text-selection copying removes navigation, hidden bodies and container wrappers.

HTML initially shows all content and hides inactive items only after interactive initialization succeeds. Printing, PDF and Word expand all items, including nested content.

Documents containing tab nodes use `Spec 3`; ordinary documents use `Spec 2`, and upgraded documents are not automatically downgraded. JSON readers reject unsupported future versions before parsing and repair. Import paths in old clients that bypass version checks do not have this protection and must not process new-format documents. Lute supplies the nodes and syntax, so both the generated frontend script and the kernel dependency must include that support. `kernel/go.mod` records the actual dependency version.

## Code entry points

| Area | Entry points |
| --- | --- |
| Rendering, selection and title-editor placement | [`tabsRender.ts`](../app/src/protyle/render/tabsRender.ts), [`_tabs.scss`](../app/src/assets/scss/protyle/_tabs.scss) |
| Item operations and task state | [`tabs.ts`](../app/src/protyle/wysiwyg/tabs.ts), [`taskListMarker.ts`](../app/src/protyle/wysiwyg/taskListMarker.ts) |
| List conversion and deletion repair | [`tabsList.ts`](../app/src/protyle/wysiwyg/tabsList.ts), [`tabsRemoval.ts`](../app/src/protyle/wysiwyg/tabsRemoval.ts) |
| Block menu and configuration catalog | [`gutter/index.ts`](../app/src/protyle/gutter/index.ts), [`catalog.ts`](../app/src/config/entryVisibility/catalog.ts) |
| Kernel normalization and title traversal | [`treenode/tabs.go`](../kernel/treenode/tabs.go), [`model/tabs.go`](../kernel/model/tabs.go) |
| JSON format | [`SY-FORMAT.md`](SY-FORMAT.md) |
