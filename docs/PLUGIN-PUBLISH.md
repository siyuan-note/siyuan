# Plugin publishing

[中文](PLUGIN-PUBLISH.zh-CN.md)

Publish permissions apply to visitors, not individual browser plugins. Published data can be downloaded by visitors and read by other code in the same page. Never publish tokens, passwords, registration codes, or private notebook content.

## User interactions and feedback

A public snapshot is a separate copy of data that a plugin prepares for publishing-service visitors. Allowing a plugin in the publishing service, authorizing its data fields, and generating public data are three separate steps. Authorization does not generate data or copy private settings.

### Interface responsibilities

Data authorization is accessed through the upload icon button beside the plugin card's **Publish service** switch. Its tooltip is **Publish plugin data**, and it opens the **Plugin published data** dialog. References to the **Plugin published data** action below mean this icon button.

| Action | Provided by | Interface and behavior |
| --- | --- | --- |
| Enable the publishing service | SiYuan | Enable the service in settings; downloaded plugin cards then show the per-plugin **Publish service** switch and **Plugin published data** button |
| Allow plugin publishing | SiYuan | The card's **Publish service** switch controls whether the plugin can be published; when the author prohibits publishing, the switch is disabled and the data authorization icon button is hidden |
| Grant or revoke data access | SiYuan | The **Plugin published data** dialog shows the package name, declared fields, and grant or revocation information, with **Cancel** and **Confirm** buttons |
| Generate or update public data | Plugin | The plugin provides an action or documented automatic updates in the administrator environment; SiYuan has no shared generate-snapshot button |
| Display public content and read status | Plugin | The plugin displays content and handles missing authorization, missing snapshots, and read failures; SiYuan returns corresponding API errors rather than rendering a shared plugin content area |

### First use

1. The administrator enables the publishing service in settings and configures access and document permissions through the existing publishing features
2. Open <kbd>Settings</kbd> - <kbd>Marketplace</kbd> - <kbd>Downloaded</kbd>, select **Plugin**, check that plugins are globally enabled and the target plugin is enabled, then turn on its card's **Publish service** switch
3. If the plugin needs public data, click **Plugin published data** on the same card; when no fields are declared, SiYuan reports that the plugin has not declared publishable fields and does not open a grant dialog; plugins using only frontend resources do not need a data grant
4. Review the package name and complete field list, including the disclosure scope and notice that the previous snapshot will be cleared; the current dialog grants the declared fields as a group without individual checkboxes, and **Cancel** leaves authorization unchanged
5. Click **Confirm** to submit the grant and close the dialog; closing it does not mean data has been generated and must not be treated as proof that saving succeeded; there is currently no separate grant-success notification or snapshot-status panel, and reopening **Plugin published data** reads the current grant, showing revocation information when access is granted
6. Follow the plugin's instructions to generate data in the administrator interface or trigger its automatic update condition; the plugin should explain the entry point, public content, and update timing, reporting an update only after saving succeeds
7. Visitors open the published page, where the plugin reads and displays public data; if authorization exists but generation has not succeeded, the plugin should display a missing-snapshot message or safe defaults without attempting to read private settings

### Updates and stopping publication

* Update: regenerate public data through the plugin in the administrator environment; updates within the existing scope need no new grant, and the plugin must explain whether saving private settings also updates public data
* View updates: visitors reload the published page or use the plugin's refresh action; SiYuan has no shared plugin-snapshot refresh button
* Revoke: click **Plugin published data** again, review the revocation information, and click **Confirm**; success removes the grant and snapshot and denies subsequent data reads, while frontend resources remain controlled by the plugin's publishing switch
* Pause all publishing for a plugin: turn off its card's **Publish service** switch to deny subsequent resource and data reads; this does not revoke the data grant, so turning it back on can make the retained snapshot readable if its grant remains valid
* Grant again: after revocation, a new grant still requires the plugin to generate new public data; expanding the declaration also requires a new grant, which clears the previous snapshot
* Uninstall and reinstall: uninstall removes authorization and the snapshot, so reinstall requires authorization and generation again; stopping publication cannot recover content already downloaded by visitors

### Error feedback and interaction acceptance

The following table specifies feedback that plugins should provide. Each plugin implements its own entry points and wording; the table does not describe an existing shared SiYuan status interface. After a failed public read, stop using the previous snapshot and show a message or safe defaults without falling back to private storage.

| Scenario | Expected administrator or visitor feedback | Acceptance criteria |
| --- | --- | --- |
| Missing authorization or unavailable plugin (403) | Visitors see that data is unavailable; the plugin's administrator action prompts checking the publishing switch and data grant | No private data is displayed, and the plugin does not grant itself access |
| Authorized but not generated (404) | Visitors see a missing-snapshot message or defaults; administrators follow the plugin's generation instructions | Verify authorization and generation separately; a missing snapshot must not prevent the whole plugin from loading |
| Read, network, or storage failure | The plugin reports a read failure and provides a retry suitable for its interface | Do not treat errors as valid empty data or continue displaying previously read content |
| Save failure or changed fields during authorization | Administrators see failure feedback and reopen the grant dialog to review current fields when needed | No false update-success message or scope expansion through a stale field list |
| Read after revocation or publishing disablement | Visitors cannot obtain public data; disabling plugin publishing also denies its resources | Subsequent requests are denied; already downloaded copies cannot be recalled |

## Resource declaration

Standard frontend entries (`index.js`, `index.css`, and direct `i18n/*.json` language files) remain available for enabled plugins. Declare every additional frontend file in `plugin.json`:

```json
{
  "name": "example",
  "version": "1.0.0",
  "minAppVersion": "3.8.4",
  "publish": {
    "resources": ["images/logo.png", "views/index.html"],
    "data": ["theme", "showAuthor"]
  }
}
```

Resources are exact relative filenames using `/`, without directories, wildcards, absolute paths, parent traversal, percent encoding, or links. `plugin.json` and `kernel.js` cannot be published. The limits are 4,096 resource files and 128 data fields. Plugins loading extra script chunks, images, fonts, or HTML must list them; plugins using only the standard entries need no resource declaration.

Static routes, the file API, and plugin loading apply the same plugin availability checks. Global disablement, plugin disablement, uninstall, author publish disablement, or user publish disablement denies subsequent reads. Published loading responses exclude kernel code. Links inside the data directory, including linked package directories and Windows junctions, are rejected for publishing; administrator access retains its existing behavior.

Published documents retain their existing permissions. Widgets retain publish availability and accessible-document reference checks. `data/public` remains explicitly public, independently of document passwords. `/api/file/readDir` remains administrator-only, and `data/storage/petal` remains private.

## Data authorization and migration

`publish.data` lists public scalar fields. Names may contain ASCII letters, digits, `_`, or `-`, up to 128 characters. Values must be strings, numbers, booleans, or `null`; objects and arrays are rejected. Flatten selected public values so adding a nested field cannot silently enlarge a grant. Do not serialize private objects into strings as a substitute for selecting public content. Encoded values may total at most 1 MiB per snapshot.

Use **Plugin published data** on the downloaded plugin card to review and authorize fields. This permission is separate from the publishing-service switch and starts disabled. New fields need authorization again; updates within the approved fields do not. Granting or revoking clears the previous snapshot. The plugin must generate a fresh one after authorization.

The SDK provides `loadPublishData(): Promise<Record<string, string | number | boolean | null>>` and `savePublishData(data: Record<string, string | number | boolean | null>): Promise<void>`. Saving requires administrator access and replaces the entire snapshot, removing omitted fields. An empty object publishes an empty snapshot. Reading requires an installed, enabled, publish-enabled plugin and a valid grant. Both methods reject on failure and never fall back to private storage. Existing `loadData` and `saveData` retain their private-storage semantics.

After authorization, select public values in the administrator environment:

```typescript
const settings = await this.loadData("settings.json");
await this.savePublishData({
    theme: settings.theme === "dark" ? "dark" : "light",
    showAuthor: settings.showAuthor === true,
});
```

In published pages, use `await this.loadPublishData()` instead of reading private settings. Provide a plugin action or regenerate after a settings change or administrator-side reload. Handle a missing snapshot before the first successful generation without failing the entire plugin or falling back to private storage.

Versioned grants and snapshots live in `conf/plugin-publish/<name>.json`, separate from public files and synced plugin storage. Do not edit or expose them directly. Authorization is local to the workspace installation and is not transferred by data synchronization. Removed declaration fields are pruned when state is next accessed. Uninstall removes grants and snapshots; reinstall cannot inherit them. Unknown formats, corruption, and failed updates preserve the source and return an error. Revocation cannot recover copies already downloaded.

## HTTP APIs

All endpoints use POST and the standard `{code, msg, data}` envelope. Success is `0`; strict decoding failures use `-1`; invalid declarations, scopes, or values use `400`; missing authorization or unavailable plugins use `403`; a valid grant without a snapshot uses `404`; storage failures use `500`. Authentication, administrator, and read-only middleware preserve their existing HTTP admission responses.

| Endpoint | Access | Request | Success data |
| --- | --- | --- | --- |
| `/api/petal/getPluginPublishInfo` | Administrator | `{ "packageName": "example" }` | `{ "resources": ["images/logo.png", "views/index.html"], "fields": ["showAuthor", "theme"], "granted": false }` |
| `/api/petal/setPluginPublishDataGrant` | Administrator, writable | `{ "packageName": "example", "fields": ["showAuthor", "theme"], "enabled": true }` | `null` |
| `/api/petal/savePluginPublishData` | Administrator, writable | `{ "packageName": "example", "data": { "theme": "dark" } }` | `null` |
| `/api/petal/loadPluginPublishData` | Authenticated; plugin publishing and data grant required | `{ "packageName": "example" }` | `{ "theme": "dark" }` |

The information response lists additional resources; standard entries are implicit. Enabling a grant requires the exact current field set, preventing approval of a changed declaration from an outdated dialog. To revoke, send `enabled: false` and `fields: []`. Administrators reading the snapshot use the same public view. Generated request and response types are exported by `siyuan`.
