# Plugin publishing

[中文](PLUGIN-PUBLISH.zh-CN.md)

Publish permissions apply to visitors, not individual browser plugins. Published data can be downloaded by visitors and read by other code in the same page. Never publish tokens, passwords, registration codes, or private notebook content.

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
