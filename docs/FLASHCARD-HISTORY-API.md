# Flashcard source history API

These endpoints use the standard `{code, msg, data}` response envelope and require an authenticated administrator. They require the v2 flashcard store to be active. Restore is unavailable in read-only mode. Source history contains settings and references, not document text or review events.

## List source revisions

`POST /api/flashcard/getSourceHistory`

```json
{"sourceID":"source-id","limit":50,"offset":0}
```

`limit` defaults to 50 and accepts 1–100. `offset` must be nonnegative. `data.versions` contains source entity revisions ordered by descending `updatedAt`, then descending `revisionID`. Revisions include `revisionID`, `parentRevisionIDs`, `updatedAt`, `deleted`, and `payload`. Ordering is for browsing; restoration uses causal ancestry rather than timestamps.

## Inspect a source revision

`POST /api/flashcard/getSourceHistory`

```json
{"sourceID":"source-id","revisionID":"revision-id"}
```

`data` contains `revision`, the ordered historical `references`, presentation `modes`, and `documents`. The `documents` object maps available referenced block IDs to their current `rootID`, `notebookID`, and human-readable `title` path. Missing blocks have no document entry. These locations are not historical document snapshots. Cross-source revisions, tombstones and ambiguous or incomplete historical references return an error.

## Restore source settings

`POST /api/flashcard/restoreSourceHistory`

```json
{"operationID":"unique-operation-id","sourceID":"source-id","revisionID":"historical-revision-id","expectedRevisionID":"current-revision-id","updatedAt":1789200000000}
```

On success, `data` is the new source entity revision. Source configuration, its block references, and generated card changes are persisted atomically. Existing stable cards retain their identity and review state. Current source scheduling preset, priority and lifecycle status are retained. Restoring a configuration does not undelete a source or roll back document text, images, shared templates, tags or deck membership.

Reuse the same request and operation ID when retrying after an uncertain response. A different request must use a new operation ID. Stale expected revisions, unresolved relevant entity conflicts, missing or encrypted block references, missing inline cloze marks, incompatible source schemas, and plugin sources are rejected without applying the restore. Restore document content first if required references or marks are missing.

The authoritative storage format is unchanged. History is retained through projection rebuilding. A history revision does not represent a complete historical rendering of the card. If references were edited independently through low-level entity APIs rather than a source operation, their relationship to source versions cannot be reconstructed safely; version inspection and restoration reject that history instead of guessing. Document history remains available separately.

# 卡源配置历史接口

上述接口要求管理员身份和已激活的新版闪卡存储；恢复接口在只读模式下不可用。列表接口通过 `limit` 和 `offset` 分页，详情接口通过 `revisionID` 选择版本。详情中的文档位置是当前可访问的文档位置，不是历史正文。恢复接口必须携带当前的 `expectedRevisionID`，并在一次原子写入中恢复配置、引用和生成卡片，保留已有复习进度以及卡源当前的预设、优先级和删除／失效状态。恢复已删除卡源仍需单独执行软删除恢复操作。

正文、图片、共享模板、标签和卡包成员关系不参与回退。引用块、行级挖空标记或图片所属关系已失效时，先恢复关联文档；存在同步冲突时先解决冲突。失败不会部分应用恢复，也不会修改已有历史数据。
