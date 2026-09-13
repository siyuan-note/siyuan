// 此文件由内核契约生成，请运行 pnpm run api:generate 更新。

export type AccountLoginData = { "needCaptcha": string | null; "token": string | null; "userName": string | null; };

export type AccountLoginRequestInput = { "captcha": string; "cloudRegion": number; "userName": string; "userPassword": string; };

export type ActivationCodeRequestInput = { "data": string; };

export type AppendBlockRequestInput = { "data": string; "dataType": string; "parentID": string; };

export type AppendHeadingChildrenRequestInput = { "childrenDOM": string; "id": string; };

export type AttributeViewColorTheme = { "backgroundColor": string; "color": string; };

export type AttributeViewColorThemeInput = { "backgroundColor"?: string | null; "color"?: string | null; };

export type AttributeViewCustomColor = { "dark": AttributeViewColorTheme; "hidden"?: boolean; "index": number; "light": AttributeViewColorTheme; };

export type AttributeViewCustomColorInput = { "dark"?: AttributeViewColorThemeInput | null; "hidden"?: boolean | null; "index"?: number | null; "light"?: AttributeViewColorThemeInput | null; };

export type AutoLaunchRequestInput = { "autoLaunch": number; };

export type BacklinkAttributeViewMatch = { "defIDs": Array<string> | null; "itemID": string; "keyID": string; "keyName": string; "title": string; "valueID": string; };

export type BacklinkAttributeViewTarget = { "blockID": string; "matches": Array<BacklinkAttributeViewMatch | null> | null; };

export type BacklinkContext = { "attributeViewTargets"?: Array<BacklinkAttributeViewTarget | null>; "blockPaths": Array<BlockPath | null> | null; "dom": string; "expand": boolean; "id": string; "referenceBlockID"?: string; "revision": string; "type"?: string; };

export type BacklinkContextData = { "backlinks": Array<BacklinkContext | null> | null; "backmentions": Array<BacklinkContext | null> | null; "keywords": Array<string> | null; "revision": string; "unchanged": boolean; };

export type BacklinkDocumentRequestInput = { "containChildren"?: boolean | null; "defID": string; "highlight"?: boolean | null; "keyword": string; "knownRevision"?: string | null; "notebook"?: string; "refTreeID": string; "sourceFilter"?: BacklinkSourceFilterInput | null; };

export type BacklinkList = { "backlinks": Array<BacklinkPath | null> | null; "backmentions": Array<BacklinkPath | null> | null; "box": string; "k": string; "linkRefsCount": number; "mentionsCount": number; "mk": string; "revision": string; "unchanged": boolean; };

export type BacklinkListRequestInput = { "containChildren"?: boolean | null; "id"?: string | null; "includeMentions"?: boolean | null; "k"?: string; "knownRevision"?: string | null; "mSort"?: string | null; "mk"?: string; "notebook"?: string | null; "refDefCandidates"?: boolean | null; "sort"?: string | null; "sourceFilter"?: BacklinkSourceFilterInput | null; };

export type BacklinkPath = { "blocks"?: Array<SearchBlock | null>; "box": string; "children"?: Array<SearchPath | null>; "count": number; "created": string; "depth": number; "folded": boolean; "hPath": string; "id": string; "name": string; "nodeType": string; "number"?: string; "revision": string; "subType": string; "type": string; "updated": string; };

export type BacklinkRefDef = { "id": string; "path": string; "text": string; };

export type BacklinkRefDefs = { "refDefs": Array<BacklinkRefDef | null> | null; };

export type BacklinkSourceFilterInput = { "dailyNote"?: string | null; "excludeSelf"?: boolean | null; "excludedNotebookIDs"?: Array<string> | null; "excludedRefDefIDs"?: Array<string> | null; };

export type BackmentionDocumentRequestInput = { "containChildren"?: boolean | null; "defID": string; "highlight"?: boolean | null; "keyword": string; "knownRevision"?: string | null; "notebook"?: string; "refTreeID": string; };

export type BatchInsertBlockRequestInput = { "blocks": Array<BlockInsertInputInput>; };

export type BatchParentBlockRequestInput = { "blocks": Array<PrependBlockRequestInput>; };

export type BatchSetBlockAttrsRequestInput = { "blockAttrs": Array<SetBlockAttrsRequestInput>; };

export type BatchTaskListMarkerRequestInput = { "items": Array<TaskListMarkerRequestInput>; };

export type BatchUpdateBlockRequestInput = { "blocks": Array<UpdateBlockRequestInput>; };

export type BlockBreadcrumbChildren = { "hasMore": boolean; "items": Array<BlockPath | null> | null; };

export type BlockBreadcrumbChildrenRequestInput = { "excludeTypes"?: Array<string> | null; "id": string; "ids"?: Array<string> | null; "limit"?: number | null; "notebook"?: string | null; "offset"?: number | null; };

export type BlockBreadcrumbRequestInput = { "excludeTypes"?: Array<string> | null; "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockDOMData = { "dom": string; "id": string; };

export type BlockDeleteData = { "createEmptyParagraph": boolean; };

export type BlockFoldData = { "isFolded": boolean; "isRoot": boolean; };

export type BlockIDRequestInput = { "id": string; };

export type BlockIDsRequestInput = { "ids": Array<string>; };

export type BlockInfoData = (FullBlockInfo & { "publishAccessRequired"?: never; }) | (PublishedBlockInfo & { "box"?: never; "path"?: never; "rootChildID"?: never; });

export type BlockInfoRequestInput = { "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockInsertInputInput = { "data": string; "dataType": string; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; };

export type BlockKramdownData = { "id": string; "kramdown": string; };

export type BlockKramdownRequestInput = { "id": string; "ids"?: Array<string> | null; "mode"?: string | null; "notebook"?: string | null; };

export type BlockOperation = { "action": "delete" | "insert" | "update" | "foldHeading" | "unfoldHeading" | "setAttrs" | "moveOutlineHeading" | "appendInsert" | "prependInsert"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": null | string | BlockDeleteData; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; };

export type BlockPath = { "children": Array<BlockPath | null> | null; "hasChildren"?: boolean; "id": string; "name": string; "subType": string; "type": string; };

export type BlockQueryRequestInput = { "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockRelevantData = { "nextID": string; "parentID": string; "previousID": string; };

export type BlockReminderRequestInput = { "id": string; "timed": string; };

export type BlockSiblingData = { "next": string; "parent": string; "previous": string; };

export type BlockStat = { "blockCount": number; "imageCount": number; "linkCount": number; "refCount": number; "runeCount": number; "wordCount": number; };

export type BlockTransaction = { "doOperations": Array<BlockOperation | null> | null; "templateDocTreePlanID"?: string; "timestamp": number; "undoOperations": Array<BlockOperation | null> | null; };

export type BlockTreeInfo = { "id": string; "nextID": string; "nextType": string; "parentID": string; "parentType": string; "previousID": string; "previousType": string; "type": string; };

export type BlocksKramdownRequestInput = { "id"?: string | null; "ids": Array<string>; "mode"?: string | null; "notebook"?: string | null; };

export type BlocksQueryRequestInput = { "id"?: string | null; "ids": Array<string>; "notebook"?: string | null; };

export type BlocksWordCountRequestInput = { "id"?: string | null; "ids": Array<string>; "notebook"?: string | null; "reqId"?: JSONValue | null; };

export type Bookmark = { "blocks": Array<SearchBlock | null> | null; "count": number; "depth": number; "name": string; "type": string; };

export type BootProgressData = { "details": string; "progress": number; };

export type BroadcastChannel = { "count": number; "name": string; };

export type BroadcastChannelData = { "channel": BroadcastChannel | null; };

export type BroadcastChannelRequestInput = { "name": string; };

export type BroadcastChannelsData = { "channels": Array<BroadcastChannel | null>; };

export type BroadcastMessageRequestInput = { "channel": string; "message": string; };

export type BroadcastPublishData = { "results": Array<BroadcastPublishResult | null>; };

export type BroadcastPublishMessage = { "filename": string; "size": number; "type": "string" | "binary"; };

export type BroadcastPublishResult = { "channel": BroadcastChannel; "code": number; "message": BroadcastPublishMessage; "msg": string; };

export type ChangeMasterPasswordRequestInput = { "newPassword": string; "oldPassword": string; };

export type ChangeSortNotebookRequestInput = { "notebooks": Array<string>; };

export type CheckActivationCodeRequestInput = { "data": string; };

export type CheckBlockRefRequestInput = { "deletedIDs"?: Array<string>; "exactIDs"?: Array<string>; "id"?: string | null; "ids"?: Array<string>; "notebook"?: string | null; "paths"?: Array<string>; "scope"?: string; };

export type CheckBlocksExistRequestInput = { "id"?: string | null; "ids": Array<JSONValue>; "notebook"?: string | null; };

export type CheckSnapshotData = { "changed": boolean; };

export type ChildBlock = { "content"?: string; "id": string; "markdown"?: string; "subType"?: string; "type": string; };

export type CleanupRichTextRequestInput = { "batch": string; "groups": Array<string>; };

export type ClipboardFile = { "isDir": boolean; "name": string; "path": string; "size": number; "updated": number; };

export type ClipboardPathRequestInput = { "path": string; };

export type CloseNotebookRequestInput = { "notebook": string; };

export type CloudBackup = { "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type CloudReminderRequestInput = { "content": string; "id": string; "timed": string; };

export type CloudSpaceData = { "backup": CloudBackup | null; "hAssetSize": string; "hExchangeSize": string; "hSize": string; "hTotalSize": string; "hTrafficAPIGet": string; "hTrafficAPIPut": string; "hTrafficDownloadSize": string; "hTrafficUploadSize": string; "sync": CloudSync | null; };

export type CloudSync = { "cloudName": string; "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type ContentWordCountRequestInput = { "content": string; "reqId"?: JSONValue | null; };

export type ContinueImportSYRequestInput = { "notebook": string; "token": string; };

export type CopyFileRequestInput = { "dest": string; "src": string; };

export type CopyFilesRequestInput = { "destDir": string; "srcs": Array<string>; };

export type CopyStdMarkdownRequestInput = { "adjustHeadingLevel"?: boolean | null; "assetsDestSpace2Underscore"?: boolean | null; "fillCSSVar"?: boolean | null; "id": string; "imgTag"?: boolean | null; };

export type CreateEncryptedNotebookRequestInput = { "name": string; "password": string; };

export type CreateNotebookData = { "notebook": Notebook | null; };

export type CreateNotebookRequestInput = { "name": string; };

export type CreateSnapshotData = { "created": boolean; "id": string; };

export type CreateSnapshotRequestInput = { "memo"?: string; };

export type Criterion = { "group": number; "hPath": string; "hasReplace": boolean; "idPath": Array<string> | null; "k": string; "method": number; "name": string; "r": string; "replaceTypes": CriterionReplaceTypes | null; "sort": number; "subTypes": SearchSubTypes; "types": CriterionTypes | null; };

export type CriterionInput = { "group"?: number | null; "hPath"?: string | null; "hasReplace"?: boolean | null; "idPath"?: Array<string> | null; "k"?: string | null; "method"?: number | null; "name"?: string | null; "r"?: string | null; "replaceTypes"?: CriterionReplaceTypesInput | null; "sort"?: number | null; "subTypes"?: SearchSubTypesInput | null; "types"?: CriterionTypesInput | null; };

export type CriterionReplaceTypes = { "aHref": boolean; "aText": boolean; "aTitle": boolean; "blockRef": boolean; "code": boolean; "codeBlock": boolean; "docTitle": boolean; "em": boolean; "fileAnnotationRef": boolean; "htmlBlock": boolean; "imgSrc": boolean; "imgText": boolean; "imgTitle": boolean; "inlineMath": boolean; "inlineMemo": boolean; "kbd": boolean; "mark": boolean; "mathBlock": boolean; "s": boolean; "strong": boolean; "sub": boolean; "sup": boolean; "tag": boolean; "text": boolean; "u": boolean; };

export type CriterionReplaceTypesInput = { "aHref"?: boolean | null; "aText"?: boolean | null; "aTitle"?: boolean | null; "blockRef"?: boolean | null; "code"?: boolean | null; "codeBlock"?: boolean | null; "docTitle"?: boolean | null; "em"?: boolean | null; "fileAnnotationRef"?: boolean | null; "htmlBlock"?: boolean | null; "imgSrc"?: boolean | null; "imgText"?: boolean | null; "imgTitle"?: boolean | null; "inlineMath"?: boolean | null; "inlineMemo"?: boolean | null; "kbd"?: boolean | null; "mark"?: boolean | null; "mathBlock"?: boolean | null; "s"?: boolean | null; "strong"?: boolean | null; "sub"?: boolean | null; "sup"?: boolean | null; "tag"?: boolean | null; "text"?: boolean | null; "u"?: boolean | null; };

export type CriterionTypes = { "audioBlock": boolean; "blockquote": boolean; "callout": boolean; "codeBlock": boolean; "databaseBlock": boolean; "document": boolean; "embedBlock": boolean; "heading": boolean; "htmlBlock": boolean; "iframeBlock": boolean; "list": boolean; "listItem": boolean; "mathBlock": boolean; "paragraph": boolean; "superBlock": boolean; "tabItem": boolean; "table": boolean; "tabs": boolean; "videoBlock": boolean; "widgetBlock": boolean; };

export type CriterionTypesInput = { "audioBlock"?: boolean | null; "blockquote"?: boolean | null; "callout"?: boolean | null; "codeBlock"?: boolean | null; "databaseBlock"?: boolean | null; "document"?: boolean | null; "embedBlock"?: boolean | null; "heading"?: boolean | null; "htmlBlock"?: boolean | null; "iframeBlock"?: boolean | null; "list"?: boolean | null; "listItem"?: boolean | null; "mathBlock"?: boolean | null; "paragraph"?: boolean | null; "superBlock"?: boolean | null; "tabItem"?: boolean | null; "table"?: boolean | null; "tabs"?: boolean | null; "videoBlock"?: boolean | null; "widgetBlock"?: boolean | null; };

export type DOMData = { "dom": string; };

export type DOMTextRequestInput = { "dom": string; };

export type DailyNoteBlockRequestInput = { "data": string; "dataType": string; "notebook": string; };

export type DeleteBlockRequestInput = { "id": string; };

export type DirectoryEntry = { "isDir": boolean; "isSymlink": boolean; "name": string; "updated": number; };

export type DocAttrView = { "id": string; "name": string; };

export type DocHeadingLevelData = { "counts": Array<number>; "title": string; "transaction": BlockTransaction | null; "withSubheadingCounts": Array<number>; };

export type DocHeadingLevelRequestInput = { "id"?: string | null; "notebook"?: string | null; "source"?: number | null; "target"?: number | null; "withSubheadings"?: boolean | null; };

export type DocInfo = { "attrViews": Array<DocAttrView | null> | null; "ial": Record<string, string> | null; "icon": string; "id": string; "name": string; "refCount": number; "refIDs": Array<string> | null; "rootID": string; "subFileCount": number; };

export type DocOrdersRequestInput = { "id": string; };

export type DocsInfoRequestInput = { "av": boolean; "ids": Array<string>; "refCount": boolean; };

export type DownloadInstallPkgRequestInput = { "downloadInstallPkg": boolean; };

export type EditorReadOnlyRequestInput = { "readonly": boolean; };

export type EmbedStat = { "complete": boolean; "cycleCount": number; "depthLimitCount": number; "failedQueryCount": number; "failedResultCount": number; "jsEmbedCount": number; "queryEmbedCount": number; "resultCount": number; "truncatedQueryCount": number; };

export type EmptyRequestInput = Record<string, never>;

export type EncryptedNotebookStatus = { "id": string; "name": string; "state": "Locked" | "Unlocking" | "Unlocked" | "Locking" | "Error"; "unlocked": boolean; };

export type EncryptedNotebookStatusData = { "boxes": Array<EncryptedNotebookStatus>; "count": number; "enabled": boolean; "hasHistoryDependency": boolean; "migrationBoxes": Array<string> | null; "migrationPending": boolean; "state": "Disabled" | "Enabled" | "RecoveryRequired"; };

export type FileAnnotationRefRequestInput = { "id": string; "notebook"?: string | null; };

export type FilePathData = { "path": string; };

export type FilePathRequestInput = { "path": string; };

export type FullBlockInfo = { "box": string; "path": string; "rootChildID": string; "rootID": string; "rootIcon": string; "rootTitle": string; "rootTitleEmpty": boolean; };

export type GetSnippetRequestInput = { "enabled": number; "keyword"?: string | null; "type": string; };

export type GetTagRequestInput = { "app"?: string | null; "ignoreMaxListHint"?: boolean | null; "sort"?: number | null; };

export type GlobalGraphConf = { "d3": GraphD3 | null; "dailyNote": boolean; "minRefs": number; "type": GraphTypeFilter | null; };

export type GlobalGraphRequestInput = { "conf": GraphConfigurationFieldsInput; "k"?: string | null; "reqId"?: JSONValue | null; };

export type GlobalGraphResult = { "box": string; "conf": GlobalGraphConf; "links": Array<GraphLink | null> | null; "nodes": Array<GraphNode | null> | null; "reqId": JSONValue; };

export type GraphArrows = { "to": GraphArrowsTo | null; };

export type GraphArrowsTo = { "enabled": boolean; };

export type GraphConfigurationFieldsInput = { "d3"?: GraphD3Input | null; "dailyNote"?: boolean | null; "minRefs"?: number | null; "type"?: GraphTypeFilterInput | null; };

export type GraphCorrelation = { "reqId": JSONValue; };

export type GraphD3 = { "arrow": boolean; "centerStrength": number; "collideRadius": number; "collideStrength": number; "lineOpacity": number; "linkDistance": number; "linkWidth": number; "nodeSize": number; };

export type GraphD3Input = { "arrow"?: boolean | null; "centerStrength"?: number | null; "collideRadius"?: number | null; "collideStrength"?: number | null; "lineOpacity"?: number | null; "linkDistance"?: number | null; "linkWidth"?: number | null; "nodeSize"?: number | null; };

export type GraphLink = { "arrows": GraphArrows | null; "from": string; "ref": boolean; "to": string; };

export type GraphNode = { "box": string; "defs": number; "id": string; "label": string; "path": string; "refs": number; "size": number; "title"?: string; "type": string; };

export type GraphTypeFilter = { "blockquote": boolean; "callout": boolean; "code": boolean; "heading": boolean; "list": boolean; "listItem": boolean; "math": boolean; "paragraph": boolean; "super": boolean; "table": boolean; "tag": boolean; };

export type GraphTypeFilterInput = { "blockquote"?: boolean | null; "callout"?: boolean | null; "code"?: boolean | null; "heading"?: boolean | null; "list"?: boolean | null; "listItem"?: boolean | null; "math"?: boolean | null; "paragraph"?: boolean | null; "super"?: boolean | null; "table"?: boolean | null; "tag"?: boolean | null; };

export type HTMLClipboardPreflight = { "converted": boolean; "dom"?: string; "normalizedHTML"?: string; "useHTML": boolean; };

export type HTMLClipboardRequestInput = { "dom": string; "mathML"?: string | null; "notebook"?: string | null; "office"?: string | null; "officeMathHTML"?: string | null; "preflight"?: boolean | null; "preparedHTML"?: boolean | null; "preserveSourceFormat"?: boolean | null; "skipBase64Assets"?: boolean | null; "skipInlineSVGAssets"?: boolean | null; "skipLocalAssets"?: boolean | null; "text"?: string | null; "wps"?: string | null; };

export type HTMLData = { "html": string; };

export type HeadingChildrenRequestInput = { "id": string; "removeFoldAttr"?: boolean | null; };

export type HeadingFoldRequestInput = { "id": string; "scope": string; };

export type HeadingLevelRequestInput = { "id"?: string; "ids"?: Array<string>; "level": number; };

export type HeadingNumbersRequestInput = { "id"?: string | null; "notebook"?: string | null; };

export type ImportAutoDocument = { "token"?: string; "type": "document"; };

export type ImportAutoNotebook = { "notebook": Notebook | null; "type": "notebook"; };

export type ImportAutoNotebooks = { "notebooks": Array<Notebook | null> | null; "type": "notebooks"; };

export type ImportDataRequestInput = { "file"?: Blob; };

export type ImportDocumentData = { "type": "document"; };

export type ImportMarkdownRequestInput = { "localPath": string; "notebook": string; "skipRoot"?: boolean | null; "toPath": string; };

export type ImportNotebookCryptoBackupRequestInput = { "file": Blob; "password"?: string; };

export type ImportSYRequestInput = { "file"?: Blob; "notebook"?: string; "toPath"?: string; };

export type ImportTokenRequestInput = { "token": string; };

export type ImportZipMarkdownRequestInput = { "file"?: Blob; "notebook"?: string; "skipRoot"?: string; "toPath"?: string; };

export type ImportedNotebook = { "notebook": Notebook | null; };

export type ImportedNotebooks = { "notebooks": Array<Notebook | null> | null; };

export type InlineStyle = { "dark": InlineStyleTheme | null; "hidden"?: boolean; "id": string; "light": InlineStyleTheme | null; "name": string; };

export type InlineStyleAV = { "colors": Array<AttributeViewCustomColor | null> | null; "order": Array<string> | null; };

export type InlineStyleAVInput = { "colors"?: Array<AttributeViewCustomColorInput | null> | null; "order"?: Array<string> | null; };

export type InlineStyleBuiltin = { "colors": Array<InlineStyleBuiltinColor | null> | null; "hidden": InlineStyleBuiltinHidden | null; "styles": Array<InlineStyleBuiltinStyle | null> | null; };

export type InlineStyleBuiltinColor = { "dark": InlineStyleTheme | null; "index": number; "light": InlineStyleTheme | null; };

export type InlineStyleBuiltinColorInput = { "dark"?: InlineStyleThemeInput | null; "index"?: number | null; "light"?: InlineStyleThemeInput | null; };

export type InlineStyleBuiltinHidden = { "av": Array<number> | null; "backgroundColor": Array<number> | null; "color": Array<number> | null; "style1": Array<string> | null; };

export type InlineStyleBuiltinHiddenInput = { "av"?: Array<number> | null; "backgroundColor"?: Array<number> | null; "color"?: Array<number> | null; "style1"?: Array<string> | null; };

export type InlineStyleBuiltinInput = { "colors"?: Array<InlineStyleBuiltinColorInput | null> | null; "hidden"?: InlineStyleBuiltinHiddenInput | null; "styles"?: Array<InlineStyleBuiltinStyleInput | null> | null; };

export type InlineStyleBuiltinStyle = { "dark": InlineStyleTheme | null; "id": string; "light": InlineStyleTheme | null; };

export type InlineStyleBuiltinStyleInput = { "dark"?: InlineStyleThemeInput | null; "id"?: string | null; "light"?: InlineStyleThemeInput | null; };

export type InlineStyleInput = { "dark"?: InlineStyleThemeInput | null; "hidden"?: boolean | null; "id"?: string | null; "light"?: InlineStyleThemeInput | null; "name"?: string | null; };

export type InlineStyleOrder = { "backgroundColor": Array<string> | null; "color": Array<string> | null; "style1": Array<string> | null; };

export type InlineStyleOrderInput = { "backgroundColor"?: Array<string> | null; "color"?: Array<string> | null; "style1"?: Array<string> | null; };

export type InlineStyleTheme = { "backgroundColor"?: string; "color"?: string; };

export type InlineStyleThemeInput = { "backgroundColor"?: string | null; "color"?: string | null; };

export type InlineStyles = { "av": InlineStyleAV | null; "builtin": InlineStyleBuiltin | null; "order": InlineStyleOrder | null; "styles": Array<InlineStyle | null> | null; "version": number; };

export type InsertBlockRequestInput = { "data": string; "dataType": string; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; };

export type JSONValue = null | boolean | number | string | Array<JSONValue> | { [key: string]: JSONValue };

export type KernelPetal = { "existed": boolean; "incompatible": boolean; "js": string; };

export type ListNotebooksData = { "boxDocEnabled": boolean; "notebooks": Array<Notebook | null> | null; };

export type ListNotebooksRequestInput = { "flashcard"?: boolean | null; };

export type LoadPetalsRequestInput = { "frontend": string; };

export type LocalGraphConf = { "d3": GraphD3 | null; "dailyNote": boolean; "type": GraphTypeFilter | null; };

export type LocalGraphRequestInput = { "conf"?: GraphConfigurationFieldsInput; "id"?: string | null; "k"?: string | null; "notebook"?: string | null; "reqId"?: JSONValue | null; "type"?: string | null; };

export type LocalGraphResult = { "box": string; "conf": LocalGraphConf; "id": string; "links": Array<GraphLink | null> | null; "nodes": Array<GraphNode | null> | null; "reqId": JSONValue; };

export type LockScreenRequestInput = { "lockScreenMode": number; };

export type MarkdownHTMLRequestInput = { "markdown": string; "mode"?: string | null; };

export type MoveBlockRequestInput = { "id": string; "parentID"?: string | null; "previousID"?: string | null; };

export type NetImageAssetsRequestInput = { "id": string; "url"?: string | null; };

export type NetworkData = { "proxy": NetworkProxy | null; };

export type NetworkProxy = { "host": string; "port": string; "scheme": string; };

export type NetworkProxyInput = { "host": string; "port": string; "scheme": string; };

export type NetworkServeRequestInput = { "networkServe": boolean; };

export type NetworkServeTLSRequestInput = { "networkServeTLS": boolean; };

export type Notebook = { "closed": boolean; "dueFlashcardCount": number; "encrypted": boolean; "flashcardCount": number; "icon": string; "id": string; "name": string; "newFlashcardCount": number; "sort": number; "sortMode": number; "state"?: "Locked" | "Unlocking" | "Unlocked" | "Locking" | "Error"; "subFileCount": number; "unlocked": boolean; };

export type NotebookConf = { "boxCrypt": NotebookEncryption | null; "closed": boolean; "dailyNoteSavePath": string; "dailyNoteTemplatePath": string; "docCreateSaveBox": string; "docCreateSavePath": string; "docCreateTemplatePath": string; "encrypted": boolean; "icon": string; "name": string; "refCreateSaveBox": string; "refCreateSavePath": string; "sort": number; "sortMode": number; };

export type NotebookConfData = { "box": string; "conf": NotebookConf | null; "name": string; };

export type NotebookConfPatchInput = { "boxCrypt"?: NotebookEncryptionPatchInput | null; "closed"?: boolean | null; "dailyNoteSavePath"?: string | null; "dailyNoteTemplatePath"?: string | null; "docCreateSaveBox"?: string | null; "docCreateSavePath"?: string | null; "docCreateTemplatePath"?: string | null; "encrypted"?: boolean | null; "icon"?: string | null; "name"?: string | null; "refCreateSaveBox"?: string | null; "refCreateSavePath"?: string | null; "sort"?: number | null; "sortMode"?: number | null; };

export type NotebookCryptoAutoLockRequestInput = { "autoLockMinutes": number; };

export type NotebookCryptoBackupData = { "file": string; };

export type NotebookEncryption = { "createdAt": number; "metadata"?: string; "spec": number; "wrapNonce": string | null; "wrappedDEK": string | null; };

export type NotebookEncryptionPatchInput = { "createdAt"?: number | null; "metadata"?: string | Array<number> | null; "spec"?: number | null; "wrapNonce"?: string | Array<number> | null; "wrappedDEK"?: string | Array<number> | null; };

export type NotebookIDRequestInput = { "notebook": string; };

export type NotebookInfo = { "ctime": number; "docCount": number; "hCtime": string; "hMtime": string; "hSize": string; "id": string; "mtime": number; "name": string; "size": number; };

export type NotebookInfoData = { "boxInfo": NotebookInfo | null; };

export type NotebookPasswordRequestInput = { "password": string; };

export type NotificationData = { "id": string; };

export type NotificationRequestInput = { "msg": string; "timeout"?: number | null; };

export type ObsidianAnalysisRequestInput = { "localPath": string; };

export type ObsidianImportRequestInput = { "notebookName": string; "taskID": string; };

export type ObsidianTaskRequestInput = { "taskID": string; };

export type ObsidianVaultAnalysis = { "ambiguousCount": number; "blockIDCount": number; "blockingErrors": Array<string> | null; "commentCount": number; "embedCount": number; "footnoteCount": number; "importableAssetCount": number; "importableAssetSize": number; "markdownCount": number; "missingCount": number; "nameAdjustmentCount": number; "notebookName": string; "skippedHiddenCount": number; "skippedLinkCount": number; "skippedNestedVaultCount": number; "skippedSpecialCount": number; "syntheticParentCount": number; "unreferencedFileCount": number; "unsupportedCount": number; "vaultName": string; "vaultPath": string; "warnings": Array<string> | null; "wikiLinkCount": number; };

export type ObsidianVaultImportResult = { "convertedEmbedCount": number; "convertedFootnoteCount": number; "convertedLinkCount": number; "failedStage"?: string; "importedAttachmentCount": number; "incomplete": boolean; "markdownCount": number; "nameAdjustmentCount": number; "notebookID": string; "notebookName": string; "preservedCommentCount": number; "preservedUnresolvedCount": number; "skippedPathCount": number; "syntheticParentCount": number; "unreferencedFileCount": number; };

export type ObsidianVaultTask = { "analysis"?: ObsidianVaultAnalysis; "detail"?: string; "error"?: string; "message": string; "progress": number; "result"?: ObsidianVaultImportResult; "state": string; "taskID": string; };

export type OpenNotebookRequestInput = { "app"?: string | null; "notebook": string; };

export type OrderedListStartData = { "found": boolean; "start": number; };

export type OutlineRequestInput = { "id"?: string | null; "notebook"?: string | null; "preview"?: boolean | null; };

export type OutlineStorageRequestInput = { "docID": string; };

export type OutlineStorageSetRequestInput = { "docID": string; "val": { [key: string]: JSONValue }; };

export type PandocData = { "path": string; };

export type PandocRequestInput = { "args": Array<string>; "dir"?: string | null; };

export type Petal = { "css": string; "disabledInPublish": boolean; "disallowInstall": boolean; "displayName": string; "enabled": boolean; "i18n": { [key: string]: JSONValue } | null; "incompatible": boolean; "js": string; "kernel": KernelPetal; "name": string; "userDisabledInPublish": boolean; "version": string; };

export type PinnedDoc = { "childrenSortMode": number | null; "icon": string; "id": string; "name": string; "notebook": string; "path": string; "subFileCount": number; "unavailable": boolean; };

export type PrepareRichTextRequestInput = { "assets": Array<RichClipboardAssetInput>; };

export type PrependBlockRequestInput = { "data": string; "dataType": string; "parentID": string; };

export type PublishedBlockInfo = { "publishAccessRequired": true; "rootID": string; "rootIcon": string; "rootTitle": string; "rootTitleEmpty": boolean; };

export type PutFileRequestInput = { "app"?: string; "file"?: Blob; "isDir"?: string; "modTime"?: string; "path"?: string; };

export type ReadDirectoryRequestInput = { "path": string; };

export type RecentDoc = { "closedAt"?: number; "icon"?: string; "openAt"?: number; "rootID": string; "title"?: string; "viewedAt"?: number; };

export type RecentDocUpdateRequestInput = { "rootID"?: string | null; };

export type RecentDocsRequestInput = { "sortBy"?: string | null; };

export type RecentDocsUpdateRequestInput = { "rootIDs"?: Array<string> | null; };

export type RefDefs = { "defIDs": Array<string> | null; "refID": string; };

export type RefDefsData = { "refDefs": Array<RefDefs>; };

export type RefIDsData = { "originalRefBlockIDs": Record<string, string> | null; "refDefs": Array<RefDefs | null> | null; };

export type RefIDsRequestInput = { "id"?: string | null; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type RefTextQueryRequestInput = { "anchor": string; "notebook"?: string | null; };

export type RefreshBacklinkRequestInput = { "id": string; };

export type RemoveBookmarkRequestInput = { "bookmark": string; };

export type RemoveCriterionRequestInput = { "name": string; };

export type RemoveFileRequestInput = { "app"?: string | null; "path": string; };

export type RemoveShorthandsRequestInput = { "ids": Array<string>; };

export type RemoveTagRequestInput = { "label": string; };

export type RenameBookmarkRequestInput = { "newBookmark": string; "oldBookmark": string; };

export type RenameFileRequestInput = { "newPath": string; "path": string; };

export type RenameNotebookRequestInput = { "name": string; "notebook": string; };

export type RenameTagRequestInput = { "newLabel": string; "oldLabel": string; };

export type RenderSprigRequestInput = { "template": string; };

export type RenderTemplateData = { "content": string; "docTreePlan"?: TemplatePlan; "path": string; };

export type RenderTemplateRequestInput = { "content"?: string; "id": string; "mode"?: string | null; "path": string; "preview"?: boolean | null; };

export type ReorderData = { "changed": boolean; "notebook"?: string; "parentPath"?: string; };

export type ReorderNotebooksRequestInput = { "position"?: string | null; "sourceIDs"?: Array<string> | null; "targetID"?: string | null; };

export type ResetGraphData = { "conf": GlobalGraphConf; };

export type ResetLocalGraphData = { "conf": LocalGraphConf; };

export type RichClipboardAssetInput = { "box"?: string; "index": number; "path": string; };

export type RichClipboardPrepared = { "assets": Array<RichClipboardPreparedAsset> | null; "batch": string; "groups": Array<string> | null; };

export type RichClipboardPreparedAsset = { "index": number; "path": string; };

export type SQLQueryRequestInput = { "mode"?: string | null; "stmt": string; };

export type SaveTemplateRequestInput = { "databaseMode"?: string; "directory"?: string; "id": string; "name": string; "overwrite": boolean; };

export type SearchBlock = { "alias": string; "box": string; "children": Array<SearchBlock | null> | null; "content": string; "count": number; "created": string; "defID": string; "defPath": string; "depth": number; "fcontent": string; "folded": boolean; "hPath": string; "ial": Record<string, string> | null; "id": string; "markdown": string; "memo": string; "name": string; "number"?: string; "parentID": string; "path": string; "refCount": number; "refText": string; "refs": Array<SearchBlock | null> | null; "riffCard": SearchBlockCard | null; "riffCardID": string; "rootID": string; "sort": number; "subType": string; "tag": string; "type": string; "updated": string; };

export type SearchBlockCard = { "due": string; "lapses": number; "lastReview": string; "reps": number; "state": number; };

export type SearchHistoryData = { "histories": Array<string> | null; "pageCount": number; "totalCount": number; };

export type SearchHistoryRequestInput = { "notebook"?: string | null; "op"?: string | null; "page"?: number | null; "query"?: string | null; "type"?: number | null; };

export type SearchPath = { "blocks"?: Array<SearchBlock | null>; "box": string; "children"?: Array<SearchPath | null>; "count": number; "created": string; "depth": number; "folded": boolean; "hPath": string; "id": string; "name": string; "nodeType": string; "number"?: string; "subType": string; "type": string; "updated": string; };

export type SearchSubTypes = { "heading": Record<string, boolean> | null; "list": Record<string, boolean> | null; "listItem": Record<string, boolean> | null; };

export type SearchSubTypesInput = { "heading"?: Record<string, boolean> | null; "list"?: Record<string, boolean> | null; "listItem"?: Record<string, boolean> | null; };

export type SearchTagData = { "k": string; "tags": Array<string>; };

export type SearchTagRequestInput = { "k": string; };

export type SetBlockAttrsRequestInput = { "attrs": Record<string, string | null>; "id": string; };

export type SetCriterionRequestInput = { "criterion": CriterionInput | null; };

export type SetGraphConfRequestInput = { "conf": GraphConfigurationFieldsInput; "type": string; };

export type SetInlineStylesRequestInput = { "app"?: string | null; "av"?: InlineStyleAVInput | null; "builtin"?: InlineStyleBuiltinInput | null; "order"?: InlineStyleOrderInput | null; "styles": Array<InlineStyleInput | null>; "version": number; };

export type SetNotebookConfRequestInput = { "conf"?: NotebookConfPatchInput | null; "notebook": string; };

export type SetNotebookIconRequestInput = { "icon": string; "notebook": string; };

export type SetPetalEnabledRequestInput = { "app"?: string | null; "enabled": boolean; "packageName": string; };

export type SetPetalPublishEnabledRequestInput = { "enabled": boolean; "packageName": string; };

export type SetSnapshotMemoRequestInput = { "id": string; "memo": string; };

export type SetSnippetRequestInput = { "snippets": Array<SnippetInput>; };

export type Shorthand = { "hCreated": string; "oId": string; "shorthandContent": string; "shorthandDesc": string; "shorthandFrom": number; "shorthandMd": string; "shorthandTitle": string; "shorthandURL": string; };

export type ShorthandPage = { "pagination": ShorthandPagination; "shorthands": Array<Shorthand | null>; };

export type ShorthandPagination = { "paginationPageCount": number; "paginationPageNums": Array<number> | null; "paginationRecordCount": number; };

export type ShorthandsData = { "code": number; "data": ShorthandPage; "msg": string; };

export type ShorthandsRequestInput = { "page": number; };

export type Snippet = { "content": string; "disabledInPublish": boolean; "enabled": boolean; "id": string; "name": string; "type": string; };

export type SnippetInput = { "content": string; "disabledInPublish"?: boolean | null; "enabled": boolean; "id": string; "name": string; "type": string; };

export type SnippetsData = { "snippets": Array<Snippet | null>; };

export type StorageKeyRequestInput = { "key": string; };

export type StorageKeysRequestInput = { "keys": Array<string>; };

export type StorageRemoveKeysRequestInput = { "app"?: string | null; "keys": Array<string>; };

export type StorageRemoveRequestInput = { "app"?: string | null; "key": string; };

export type StorageSetKeysRequestInput = { "app"?: string | null; "keyVals": { [key: string]: JSONValue }; };

export type StorageSetRequestInput = { "app"?: string | null; "key": string; "val"?: JSONValue | null; };

export type SwapBlockRefRequestInput = { "defID": string; "includeChildren": boolean; "refID": string; };

export type TagData = { "children": Array<TagData | null> | null; "count": number; "depth": number; "label": string; "name": string; "type": string; };

export type TailChildBlocksRequestInput = { "id": string; "ids"?: Array<string> | null; "n"?: number | null; "notebook"?: string | null; };

export type TaskListMarkerRequestInput = { "id": string; "marker": string; };

export type TemplateDocumentInfo = { "directory": string; "hasDatabase": boolean; "name": string; };

export type TemplateDocumentRequestInput = { "id": string; };

export type TemplateFileEntry = { "isDir": boolean; "isPackage"?: boolean; "path": string; };

export type TemplateFileRequestInput = { "action"?: string; "content"?: string; "path"?: string; "revision"?: string; "target"?: string; };

export type TemplateFileRevision = { "revision": string; };

export type TemplateFileSource = { "content": string; "path"?: string; "revision": string; };

export type TemplatePlan = { "count": number; "id": string; "nodes": Array<TemplatePlanNode | null> | null; };

export type TemplatePlanNode = { "depth": number; "hPath": string; "id": string; "parentID": string; "title": string; };

export type TransferBlockRefRequestInput = { "fromID": string; "refIDs"?: Array<string> | null; "reloadUI"?: boolean | null; "toID": string; };

export type TreeStatData = { "containsEmbed"?: boolean; "embedStat"?: EmbedStat | null; "reqId": JSONValue; "stat": BlockStat | null; "statWithEmbed"?: BlockStat | null; };

export type TreeStatRequestInput = { "id": string; "ids"?: Array<string> | null; "includeEmbed"?: boolean | null; "notebook"?: string | null; "reqId"?: JSONValue | null; };

export type TrimmedIDRequestInput = { "id": string; };

export type UnfoldedParentData = { "parentID": string; };

export type UnlockNotebookRequestInput = { "notebook": string; "password": string; };

export type UnzipRequestInput = { "path": string; "zipPath": string; };

export type UpdateBlockRequestInput = { "data": string; "dataType": string; "id": string; "lockType"?: boolean | null; };

export type UpdateChannelRequestInput = { "updateChannel": string; };

export type UpdatePinnedDocsRequestInput = { "action": string; "after"?: boolean; "ids": Array<string>; "targetID"?: string; };

export type ViewStatePatchRequestInput = { "key": string; "removeKeys"?: Array<string> | null; "values"?: { [key: string]: JSONValue }; };

export type VirtualBlockRefRequestInput = { "keywords": Array<string>; };

export type WPSPresentationData = { "converted": boolean; "dom": string; };

export type WPSPresentationRequestInput = { "data": string; "text"?: string | null; "type": string; };

export type WordCountData = { "reqId": JSONValue; "stat": BlockStat | null; };

export type WorkspaceAVBuiltinColorUpdateInput = { "customized"?: boolean | null; "dark"?: InlineStyleThemeInput | null; "hidden"?: boolean | null; "index"?: number | null; "light"?: InlineStyleThemeInput | null; };

export type WorkspaceAVPaletteRequestInput = { "app"?: string | null; "builtinColors"?: Array<WorkspaceAVBuiltinColorUpdateInput | null> | null; "colors": Array<AttributeViewCustomColorInput | null>; "order": Array<string>; };

export type WorkspaceInfoData = { "siyuanVer": string; "workspaceDir": string; };

export type ZipRequestInput = { "path": string; "zipPath": string; };

export type APILegacyGETPath =
    "/api/ai/mcp/oauth/callback/:flowID" |
    "/api/icon/getDynamicIcon" |
    "/api/network/echo" |
    "/api/network/echo/*path" |
    "/api/network/proxy" |
    "/api/plugin" |
    "/api/plugin/rpc" |
    "/api/plugin/rpc/:name" |
    "/api/system/bootProgressSSE" |
    "/api/system/getBootAppearance" |
    "/api/system/getCaptcha" |
    "/api/system/oidc/callback" |
    "/es/broadcast/subscribe" |
    "/es/network/proxy" |
    "/plugin/private/:name/*path" |
    "/ws/broadcast" |
    "/ws/network/proxy" |
    "/ws/plugin/rpc" |
    "/ws/plugin/rpc/:name";

export interface APIGETRoutes {
    "/api/system/bootProgress": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": BootProgressData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/version": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
}

export type APILegacyPOSTPath =
    "/api/ai/agent/browserCapabilityResult" |
    "/api/ai/agent/chat" |
    "/api/ai/agent/confirm" |
    "/api/ai/agent/getSession" |
    "/api/ai/agent/getSkill" |
    "/api/ai/agent/lsSessions" |
    "/api/ai/agent/lsSkills" |
    "/api/ai/agent/lsUserSkills" |
    "/api/ai/agent/question" |
    "/api/ai/agent/removeSession" |
    "/api/ai/agent/removeSkill" |
    "/api/ai/agent/renameSkill" |
    "/api/ai/agent/saveSession" |
    "/api/ai/agent/saveSkill" |
    "/api/ai/agent/setPermission" |
    "/api/ai/agent/title" |
    "/api/ai/chatGPT" |
    "/api/ai/chatGPTWithAction" |
    "/api/ai/editor/chat" |
    "/api/ai/editor/lsActions" |
    "/api/ai/editor/removeAction" |
    "/api/ai/editor/saveAction" |
    "/api/ai/embeddingStat" |
    "/api/ai/listModels" |
    "/api/ai/lsCapabilities" |
    "/api/ai/mcpEnvironmentVariables" |
    "/api/ai/mcpOAuthAuthorize" |
    "/api/ai/mcpOAuthDisconnect" |
    "/api/ai/mcpStatus" |
    "/api/ai/reindexEmbedding" |
    "/api/ai/retryFailedEmbedding" |
    "/api/ai/testEmbeddingModel" |
    "/api/ai/testModel" |
    "/api/ai/testRerankModel" |
    "/api/asset/fullReindexAssetContent" |
    "/api/asset/getDocAssets" |
    "/api/asset/getDocImageAssets" |
    "/api/asset/getFileAnnotation" |
    "/api/asset/getImageOCRText" |
    "/api/asset/getMissingAssets" |
    "/api/asset/getUnusedAssets" |
    "/api/asset/insertCover" |
    "/api/asset/insertLocalAssets" |
    "/api/asset/ocr" |
    "/api/asset/removeUnusedAsset" |
    "/api/asset/removeUnusedAssets" |
    "/api/asset/renameAsset" |
    "/api/asset/resolveAssetPath" |
    "/api/asset/setFileAnnotation" |
    "/api/asset/setImageOCRText" |
    "/api/asset/statAsset" |
    "/api/asset/upload" |
    "/api/asset/uploadCloud" |
    "/api/asset/uploadCloudByAssetsPaths" |
    "/api/av/addAttributeViewBlocks" |
    "/api/av/addAttributeViewKey" |
    "/api/av/appendAttributeViewDetachedBlocksWithValues" |
    "/api/av/batchReplaceAttributeViewBlocks" |
    "/api/av/batchSetAttributeViewBlockAttrs" |
    "/api/av/changeAttrViewLayout" |
    "/api/av/createAttributeViewItem" |
    "/api/av/createAttributeViewItemDocs" |
    "/api/av/createAttributeViewItemWithMarkdown" |
    "/api/av/duplicateAttributeViewBlock" |
    "/api/av/getAttributeView" |
    "/api/av/getAttributeViewAddingBlockDefaultValues" |
    "/api/av/getAttributeViewBacklinks" |
    "/api/av/getAttributeViewBoundBlockIDsByItemIDs" |
    "/api/av/getAttributeViewFieldViews" |
    "/api/av/getAttributeViewFilterSort" |
    "/api/av/getAttributeViewItemIDsByBoundIDs" |
    "/api/av/getAttributeViewItemStatuses" |
    "/api/av/getAttributeViewKeys" |
    "/api/av/getAttributeViewKeysByAvID" |
    "/api/av/getAttributeViewKeysByID" |
    "/api/av/getAttributeViewPasteRows" |
    "/api/av/getAttributeViewPrimaryKeyValues" |
    "/api/av/getAttributeViewRelationCandidates" |
    "/api/av/getAttributeViewRowSort" |
    "/api/av/getAttributeViewSearchTarget" |
    "/api/av/getCurrentAttrViewImages" |
    "/api/av/getMirrorDatabaseBlocks" |
    "/api/av/getUnusedAttributeViews" |
    "/api/av/removeAttributeViewBlocks" |
    "/api/av/removeAttributeViewKey" |
    "/api/av/removeUnusedAttributeView" |
    "/api/av/removeUnusedAttributeViews" |
    "/api/av/renderAttributeView" |
    "/api/av/renderHistoryAttributeView" |
    "/api/av/renderSnapshotAttributeView" |
    "/api/av/searchAttributeView" |
    "/api/av/searchAttributeViewRelationKey" |
    "/api/av/searchAttributeViewRollupDestKeys" |
    "/api/av/setAttrViewContextFilter" |
    "/api/av/setAttrViewFilters" |
    "/api/av/setAttrViewGroup" |
    "/api/av/setAttrViewSorts" |
    "/api/av/setAttributeViewBlockAttr" |
    "/api/av/setDatabaseBlockView" |
    "/api/av/sortAttributeViewKey" |
    "/api/av/sortAttributeViewViewKey" |
    "/api/bazaar/batchUpdatePackage" |
    "/api/bazaar/getBazaarIcon" |
    "/api/bazaar/getBazaarPackage" |
    "/api/bazaar/getBazaarPackageREADME" |
    "/api/bazaar/getBazaarPackageRating" |
    "/api/bazaar/getBazaarPackageRatings" |
    "/api/bazaar/getBazaarPackageUserRatings" |
    "/api/bazaar/getBazaarPlugin" |
    "/api/bazaar/getBazaarTemplate" |
    "/api/bazaar/getBazaarTheme" |
    "/api/bazaar/getBazaarWidget" |
    "/api/bazaar/getInstalledIcon" |
    "/api/bazaar/getInstalledPackageSize" |
    "/api/bazaar/getInstalledPlugin" |
    "/api/bazaar/getInstalledTemplate" |
    "/api/bazaar/getInstalledTheme" |
    "/api/bazaar/getInstalledWidget" |
    "/api/bazaar/getUpdatedPackage" |
    "/api/bazaar/installBazaarIcon" |
    "/api/bazaar/installBazaarPlugin" |
    "/api/bazaar/installBazaarTemplate" |
    "/api/bazaar/installBazaarTheme" |
    "/api/bazaar/installBazaarWidget" |
    "/api/bazaar/installLocalBazaarPackage" |
    "/api/bazaar/setBazaarPackageRating" |
    "/api/bazaar/uninstallBazaarIcon" |
    "/api/bazaar/uninstallBazaarPlugin" |
    "/api/bazaar/uninstallBazaarTemplate" |
    "/api/bazaar/uninstallBazaarTheme" |
    "/api/bazaar/uninstallBazaarWidget" |
    "/api/bazaar/updateBazaarPackage" |
    "/api/export/copyExportFile" |
    "/api/export/export2Liandi" |
    "/api/export/exportAsFile" |
    "/api/export/exportAsciiDoc" |
    "/api/export/exportAttributeView" |
    "/api/export/exportBrowserHTML" |
    "/api/export/exportCodeBlock" |
    "/api/export/exportData" |
    "/api/export/exportDataInFolder" |
    "/api/export/exportDocx" |
    "/api/export/exportEPUB" |
    "/api/export/exportHTML" |
    "/api/export/exportMd" |
    "/api/export/exportMdContent" |
    "/api/export/exportMdHTML" |
    "/api/export/exportMds" |
    "/api/export/exportMediaWiki" |
    "/api/export/exportNotebookMd" |
    "/api/export/exportNotebookSY" |
    "/api/export/exportNotebooksMd" |
    "/api/export/exportNotebooksSY" |
    "/api/export/exportODT" |
    "/api/export/exportOPML" |
    "/api/export/exportOrgMode" |
    "/api/export/exportPreviewHTML" |
    "/api/export/exportRTF" |
    "/api/export/exportReStructuredText" |
    "/api/export/exportResources" |
    "/api/export/exportSY" |
    "/api/export/exportSYs" |
    "/api/export/exportTempContent" |
    "/api/export/exportTextile" |
    "/api/export/preview" |
    "/api/export/processPDF" |
    "/api/extension/copy" |
    "/api/filetree/authFilePublishAccess" |
    "/api/filetree/changeSort" |
    "/api/filetree/createDailyNote" |
    "/api/filetree/createDoc" |
    "/api/filetree/createDocWithMd" |
    "/api/filetree/doc2Heading" |
    "/api/filetree/duplicateDoc" |
    "/api/filetree/getDoc" |
    "/api/filetree/getDocCreateSavePath" |
    "/api/filetree/getFullHPathByID" |
    "/api/filetree/getHPathByID" |
    "/api/filetree/getHPathByPath" |
    "/api/filetree/getHPathsByPaths" |
    "/api/filetree/getIDsByHPath" |
    "/api/filetree/getPathByID" |
    "/api/filetree/getPublishAccess" |
    "/api/filetree/getRefCreateSavePath" |
    "/api/filetree/getShorthandSavePath" |
    "/api/filetree/heading2Doc" |
    "/api/filetree/li2Doc" |
    "/api/filetree/listDocTree" |
    "/api/filetree/listDocsByPath" |
    "/api/filetree/moveDocs" |
    "/api/filetree/moveDocsByID" |
    "/api/filetree/moveLocalShorthands" |
    "/api/filetree/removeDoc" |
    "/api/filetree/removeDocByID" |
    "/api/filetree/removeDocs" |
    "/api/filetree/removeIndexes" |
    "/api/filetree/renameDoc" |
    "/api/filetree/renameDocByID" |
    "/api/filetree/reorderDocs" |
    "/api/filetree/searchDocs" |
    "/api/filetree/setDocSortMode" |
    "/api/filetree/setPublishAccess" |
    "/api/filetree/setSort" |
    "/api/filetree/upsertIndexes" |
    "/api/history/createAssetHistory" |
    "/api/history/createDocHistory" |
    "/api/history/diffDocVersions" |
    "/api/history/getDocHistoryContent" |
    "/api/history/getHistoryItems" |
    "/api/history/getNotebookHistory" |
    "/api/history/rollbackAssetsHistory" |
    "/api/history/rollbackAttributeViewHistory" |
    "/api/history/rollbackDocHistory" |
    "/api/history/rollbackNotebookHistory" |
    "/api/network/echo" |
    "/api/network/echo/*path" |
    "/api/network/forwardProxy" |
    "/api/network/proxy" |
    "/api/plugin/getLoadedPlugin" |
    "/api/plugin/listLoadedPlugins" |
    "/api/plugin/rpc" |
    "/api/plugin/rpc/:name" |
    "/api/repo/checkoutRepo" |
    "/api/repo/diffRepoSnapshots" |
    "/api/repo/downloadCloudSnapshot" |
    "/api/repo/exportRepoFile" |
    "/api/repo/getCloudRepoSnapshots" |
    "/api/repo/getCloudRepoTagSnapshots" |
    "/api/repo/getRepoDocHistory" |
    "/api/repo/getRepoFile" |
    "/api/repo/getRepoSnapshots" |
    "/api/repo/getRepoTagSnapshots" |
    "/api/repo/importRepoKey" |
    "/api/repo/initRepoKey" |
    "/api/repo/initRepoKeyFromPassphrase" |
    "/api/repo/openRepoSnapshotFile" |
    "/api/repo/purgeCloudRepo" |
    "/api/repo/purgeRepo" |
    "/api/repo/removeCloudRepoTagSnapshot" |
    "/api/repo/removeRepoTagSnapshot" |
    "/api/repo/resetRepo" |
    "/api/repo/rollbackRepoSnapshotFile" |
    "/api/repo/searchRepoFile" |
    "/api/repo/setRepoIndexRetentionDays" |
    "/api/repo/setRetentionIndexesDaily" |
    "/api/repo/tagSnapshot" |
    "/api/repo/uploadCloudSnapshot" |
    "/api/riff/addRiffCards" |
    "/api/riff/batchSetRiffCardsDueTime" |
    "/api/riff/createRiffDeck" |
    "/api/riff/getNotebookRiffCards" |
    "/api/riff/getNotebookRiffDueCards" |
    "/api/riff/getRiffCards" |
    "/api/riff/getRiffCardsByBlockIDs" |
    "/api/riff/getRiffDecks" |
    "/api/riff/getRiffDueCards" |
    "/api/riff/getTreeRiffCards" |
    "/api/riff/getTreeRiffDueCards" |
    "/api/riff/removeRiffCards" |
    "/api/riff/removeRiffDeck" |
    "/api/riff/renameRiffDeck" |
    "/api/riff/resetRiffCards" |
    "/api/riff/reviewRiffCard" |
    "/api/riff/skipReviewRiffCard" |
    "/api/search/findReplace" |
    "/api/search/fullTextSearchAssetContent" |
    "/api/search/fullTextSearchBlock" |
    "/api/search/getAssetContent" |
    "/api/search/getAssetContentByPath" |
    "/api/search/getEmbedBlock" |
    "/api/search/listInvalidBlockRefs" |
    "/api/search/removeTemplate" |
    "/api/search/searchAsset" |
    "/api/search/searchEmbedBlock" |
    "/api/search/searchRefBlock" |
    "/api/search/searchTemplate" |
    "/api/search/searchWidget" |
    "/api/search/semanticSearchBlock" |
    "/api/search/updateEmbedBlock" |
    "/api/setting/getBootAppearances" |
    "/api/setting/getCloudUser" |
    "/api/setting/getPublish" |
    "/api/setting/login2faCloudUser" |
    "/api/setting/logoutCloudUser" |
    "/api/setting/setAI" |
    "/api/setting/setAppearance" |
    "/api/setting/setBazaar" |
    "/api/setting/setBazaarPetalDisabled" |
    "/api/setting/setBootAppearance" |
    "/api/setting/setEditor" |
    "/api/setting/setEmoji" |
    "/api/setting/setEntryVisibility" |
    "/api/setting/setExport" |
    "/api/setting/setFiletree" |
    "/api/setting/setFlashcard" |
    "/api/setting/setIcon" |
    "/api/setting/setKeymap" |
    "/api/setting/setPublish" |
    "/api/setting/setSearch" |
    "/api/setting/setSecrets" |
    "/api/setting/setSnippet" |
    "/api/setting/setTheme" |
    "/api/setting/setVariables" |
    "/api/sync/createCloudSyncDir" |
    "/api/sync/exportSyncProviderS3" |
    "/api/sync/exportSyncProviderWebDAV" |
    "/api/sync/getBootSync" |
    "/api/sync/getSyncInfo" |
    "/api/sync/getSyncLANStatus" |
    "/api/sync/importSyncProviderS3" |
    "/api/sync/importSyncProviderWebDAV" |
    "/api/sync/listCloudSyncDir" |
    "/api/sync/performBootSync" |
    "/api/sync/performSync" |
    "/api/sync/removeCloudSyncDir" |
    "/api/sync/setCloudSyncDir" |
    "/api/sync/setSyncAssetDownloadMode" |
    "/api/sync/setSyncEnable" |
    "/api/sync/setSyncGenerateConflictDoc" |
    "/api/sync/setSyncInterval" |
    "/api/sync/setSyncLAN" |
    "/api/sync/setSyncMode" |
    "/api/sync/setSyncPerception" |
    "/api/sync/setSyncProvider" |
    "/api/sync/setSyncProviderLocal" |
    "/api/sync/setSyncProviderS3" |
    "/api/sync/setSyncProviderWebDAV" |
    "/api/system/addCustomEmoji" |
    "/api/system/checkUpdate" |
    "/api/system/checkWorkspaceDir" |
    "/api/system/createWorkspaceDir" |
    "/api/system/dismissOnboarding" |
    "/api/system/ensureOnboarding" |
    "/api/system/exit" |
    "/api/system/exportConf" |
    "/api/system/exportLog" |
    "/api/system/exportTLSCABundle" |
    "/api/system/exportTLSCACert" |
    "/api/system/getChangelog" |
    "/api/system/getConf" |
    "/api/system/getCustomFonts" |
    "/api/system/getEmojiConf" |
    "/api/system/getMobileWorkspaces" |
    "/api/system/getSysFonts" |
    "/api/system/getWorkspaces" |
    "/api/system/importConf" |
    "/api/system/importCustomFont" |
    "/api/system/importTLSCABundle" |
    "/api/system/loginAuth" |
    "/api/system/logoutAuth" |
    "/api/system/oidc/mobileCallback" |
    "/api/system/oidc/poll" |
    "/api/system/oidc/start" |
    "/api/system/oidc/validate" |
    "/api/system/oidc/validateActivate" |
    "/api/system/oidc/validateCancel" |
    "/api/system/oidc/validatePoll" |
    "/api/system/removeCustomFont" |
    "/api/system/removeWorkspaceDir" |
    "/api/system/removeWorkspaceDirPhysically" |
    "/api/system/setAPIToken" |
    "/api/system/setAccessAuthCode" |
    "/api/system/setAppearanceMode" |
    "/api/system/setOIDC" |
    "/api/system/setUILayout" |
    "/api/system/setWorkspaceDir" |
    "/api/system/uiproc" |
    "/api/transactions" |
    "/api/transactions/clearHistory" |
    "/api/transactions/redo" |
    "/api/transactions/undo" |
    "/api/transactions/undoState" |
    "/plugin/private/:name/*path";

export interface APIPOSTRoutes {
    "/api/account/checkActivationcode": {
        request: CheckActivationCodeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | null; "msg": string; };
        body: "json";
    };
    "/api/account/deactivate": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/account/login": {
        request: AccountLoginRequestInput;
        response: { "code": 0; "data": AccountLoginData | null; "msg": string; } | { "code": -1 | 1 | 10; "data": { "closeTimeout": number; } | null | AccountLoginData | null; "msg": string; };
        body: "json";
    };
    "/api/account/startFreeTrial": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/account/useActivationcode": {
        request: ActivationCodeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/archive/unzip": {
        request: UnzipRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/archive/zip": {
        request: ZipRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/attr/batchGetBlockAttrs": {
        request: BlockIDsRequestInput;
        response: { "code": 0; "data": Record<string, Record<string, string> | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/attr/batchSetBlockAttrs": {
        request: BatchSetBlockAttrsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/attr/getBlockAttrs": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": Record<string, string>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/attr/getBookmarkLabels": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/attr/resetBlockAttrs": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/attr/setBlockAttrs": {
        request: SetBlockAttrsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/av/searchAttributeViewNonRelationKey": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/block/appendBlock": {
        request: AppendBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/appendDailyNoteBlock": {
        request: DailyNoteBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/appendHeadingChildren": {
        request: AppendHeadingChildrenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/batchAppendBlock": {
        request: BatchParentBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/batchInsertBlock": {
        request: BatchInsertBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/batchPrependBlock": {
        request: BatchParentBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/batchUpdateBlock": {
        request: BatchUpdateBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/batchUpdateTaskListItemMarker": {
        request: BatchTaskListMarkerRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/checkBlockExist": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": boolean; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/checkBlockFold": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockFoldData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/checkBlockRef": {
        request: CheckBlockRefRequestInput;
        response: { "code": 0; "data": boolean; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | boolean; "msg": string; };
        body: "json";
    };
    "/api/block/checkBlocksExist": {
        request: CheckBlocksExistRequestInput;
        response: { "code": 0; "data": Record<string, boolean> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/deleteBlock": {
        request: DeleteBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/foldBlock": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockBreadcrumb": {
        request: BlockBreadcrumbRequestInput;
        response: { "code": 0; "data": Array<BlockPath | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockBreadcrumbChildren": {
        request: BlockBreadcrumbChildrenRequestInput;
        response: { "code": 0; "data": BlockBreadcrumbChildren | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockDOM": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockDOMData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockDOMWithEmbed": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockDOMData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockDOMs": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockDOMsWithEmbed": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockDefIDsByRefText": {
        request: RefTextQueryRequestInput;
        response: { "code": 0; "data": RefDefsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockIndex": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": number; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockInfo": {
        request: BlockInfoRequestInput;
        response: { "code": 0; "data": BlockInfoData; "msg": string; } | { "code": -1 | 3; "data": { "closeTimeout": number; } | null | string; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockKramdown": {
        request: BlockKramdownRequestInput;
        response: { "code": 0; "data": BlockKramdownData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockKramdowns": {
        request: BlocksKramdownRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockRelevantIDs": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockRelevantData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockSiblingID": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockSiblingData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlockTreeInfos": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, BlockTreeInfo | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlocksIndexes": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, number> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getBlocksWordCount": {
        request: BlocksWordCountRequestInput;
        response: { "code": 0; "data": WordCountData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getChildBlocks": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": Array<ChildBlock | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getContentWordCount": {
        request: ContentWordCountRequestInput;
        response: { "code": 0; "data": WordCountData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getDOMText": {
        request: DOMTextRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getDocBlocksOrders": {
        request: DocOrdersRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getDocHeadingLevelTransaction": {
        request: DocHeadingLevelRequestInput;
        response: { "code": 0; "data": DocHeadingLevelData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
    };
    "/api/block/getDocInfo": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": DocInfo | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getDocsInfo": {
        request: DocsInfoRequestInput;
        response: { "code": 0; "data": Array<DocInfo | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getHeadingChildrenDOM": {
        request: HeadingChildrenRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getHeadingChildrenIDs": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getHeadingDeleteTransaction": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getHeadingFoldTransaction": {
        request: HeadingFoldRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getHeadingInsertTransaction": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getHeadingLevelTransaction": {
        request: HeadingLevelRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getOrderedListContinueStart": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": OrderedListStartData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getRecentUpdatedBlocks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<SearchBlock | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/block/getRefIDs": {
        request: RefIDsRequestInput;
        response: { "code": 0; "data": RefIDsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getRefIDsByFileAnnotationID": {
        request: FileAnnotationRefRequestInput;
        response: { "code": 0; "data": RefDefsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getRefText": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getTailChildBlocks": {
        request: TailChildBlocksRequestInput;
        response: { "code": 0; "data": Array<ChildBlock | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getTreeStat": {
        request: TreeStatRequestInput;
        response: { "code": 0; "data": TreeStatData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/getUnfoldedParentID": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": UnfoldedParentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/insertBlock": {
        request: InsertBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/moveBlock": {
        request: MoveBlockRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/moveOutlineHeading": {
        request: MoveBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/prependBlock": {
        request: PrependBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/prependDailyNoteBlock": {
        request: DailyNoteBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/setBlockReminder": {
        request: BlockReminderRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/swapBlockRef": {
        request: SwapBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/transferBlockRef": {
        request: TransferBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/unfoldBlock": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/updateBlock": {
        request: UpdateBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/updateTaskListItemMarker": {
        request: TaskListMarkerRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bookmark/getBookmark": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<Bookmark | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/bookmark/removeBookmark": {
        request: RemoveBookmarkRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bookmark/renameBookmark": {
        request: RenameBookmarkRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/broadcast/getChannelInfo": {
        request: BroadcastChannelRequestInput;
        response: { "code": 0; "data": BroadcastChannelData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/broadcast/getChannels": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": BroadcastChannelsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/broadcast/postMessage": {
        request: BroadcastMessageRequestInput;
        response: { "code": 0; "data": BroadcastChannelData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/broadcast/publish": {
        request: Record<string, Array<string | Blob>>;
        response: { "code": 0; "data": BroadcastPublishData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/clipboard/cleanupRichText": {
        request: CleanupRichTextRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/clipboard/prepareRichText": {
        request: PrepareRichTextRequestInput;
        response: { "code": 0; "data": RichClipboardPrepared | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/clipboard/readFilePaths": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<ClipboardFile>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/clipboard/writeFilePath": {
        request: ClipboardPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/cloud/getCloudSpace": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": CloudSpaceData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/cloud/setCloudReminder": {
        request: CloudReminderRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/convert/pandoc": {
        request: PandocRequestInput;
        response: { "code": 0; "data": PandocData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/file/copyFile": {
        request: CopyFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/file/getFile": {
        request: FilePathRequestInput;
        response: Blob | { "code": -1 | -3 | 403 | 404 | 409 | 500 | 503; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        output: "binary";
    };
    "/api/file/getUniqueFilename": {
        request: FilePathRequestInput;
        response: { "code": 0; "data": FilePathData; "msg": string; } | { "code": -1 | -3; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/file/globalCopyFiles": {
        request: CopyFilesRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2 | -3 | 403; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/file/putFile": {
        request: PutFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -3 | 400 | 403 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "form";
    };
    "/api/file/readDir": {
        request: ReadDirectoryRequestInput;
        response: { "code": 0; "data": Array<DirectoryEntry>; "msg": string; } | { "code": -1 | -3 | 403 | 404 | 409 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/file/removeFile": {
        request: RemoveFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -3 | 403 | 404 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/file/renameFile": {
        request: RenameFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -3 | 403 | 404 | 409 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/file/workspaceCopyFiles": {
        request: CopyFilesRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2 | -3 | 403; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/filetree/getPinnedDocs": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<PinnedDoc>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/filetree/updatePinnedDocs": {
        request: UpdatePinnedDocsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/format/autoSpace": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/format/netAssets2LocalAssets": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/format/netImg2LocalAssets": {
        request: NetImageAssetsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/graph/getGraph": {
        request: GlobalGraphRequestInput;
        response: { "code": 0; "data": GlobalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "links"?: never; "nodes"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | GlobalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "links"?: never; "nodes"?: never; }); "msg": string; };
        body: "json";
    };
    "/api/graph/getLocalGraph": {
        request: LocalGraphRequestInput;
        response: { "code": 0; "data": LocalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "id"?: never; "links"?: never; "nodes"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | LocalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "id"?: never; "links"?: never; "nodes"?: never; }); "msg": string; };
        body: "json";
    };
    "/api/graph/resetGraph": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": ResetGraphData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/graph/resetLocalGraph": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": ResetLocalGraphData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/graph/setGraphConf": {
        request: SetGraphConfRequestInput;
        response: { "code": 0; "data": GlobalGraphConf | (LocalGraphConf & { "minRefs"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/clearWorkspaceHistory": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/history/reindexHistory": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/history/searchHistory": {
        request: SearchHistoryRequestInput;
        response: { "code": 0; "data": SearchHistoryData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/import/cancelImportSY": {
        request: ImportTokenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/import/cancelObsidianVaultTask": {
        request: ObsidianTaskRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | ObsidianVaultTask | null; "msg": string; };
        body: "json";
    };
    "/api/import/continueImportSY": {
        request: ContinueImportSYRequestInput;
        response: { "code": 0; "data": ImportDocumentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/import/getObsidianVaultTask": {
        request: ObsidianTaskRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/import/importData": {
        request: ImportDataRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/import/importSY": {
        request: ImportSYRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/import/importSYAuto": {
        request: ImportSYRequestInput;
        response: { "code": 0; "data": (ImportAutoDocument & { "notebook"?: never; "notebooks"?: never; }) | (ImportAutoNotebook & { "notebooks"?: never; "token"?: never; }) | (ImportAutoNotebooks & { "notebook"?: never; "token"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | (ImportAutoDocument & { "notebook"?: never; "notebooks"?: never; }) | (ImportAutoNotebook & { "notebooks"?: never; "token"?: never; }) | (ImportAutoNotebooks & { "notebook"?: never; "token"?: never; }); "msg": string; };
        body: "multipart";
    };
    "/api/import/importSYNotebook": {
        request: ImportDataRequestInput;
        response: { "code": 0; "data": (ImportedNotebook & { "notebooks"?: never; }) | (ImportedNotebooks & { "notebook"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/import/importStdMd": {
        request: ImportMarkdownRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/import/importZipMd": {
        request: ImportZipMarkdownRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/import/startObsidianVaultAnalysis": {
        request: ObsidianAnalysisRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/import/startObsidianVaultImport": {
        request: ObsidianImportRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/inbox/getShorthand": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": Shorthand | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/inbox/getShorthands": {
        request: ShorthandsRequestInput;
        response: { "code": 0; "data": ShorthandsData | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/inbox/removeShorthands": {
        request: RemoveShorthandsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/lute/copyStdMarkdown": {
        request: CopyStdMarkdownRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/lute/html2BlockDOM": {
        request: HTMLClipboardRequestInput;
        response: { "code": 0; "data": string | HTMLClipboardPreflight; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/lute/md2html": {
        request: MarkdownHTMLRequestInput;
        response: { "code": 0; "data": HTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/lute/spinBlockDOM": {
        request: DOMTextRequestInput;
        response: { "code": 0; "data": DOMData; "msg": string; } | { "code": -1 | 413; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/lute/wpsPresentation2BlockDOM": {
        request: WPSPresentationRequestInput;
        response: { "code": 0; "data": WPSPresentationData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | WPSPresentationData; "msg": string; };
        body: "json";
    };
    "/api/notebook/changeMasterPassword": {
        request: ChangeMasterPasswordRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/changeSortNotebook": {
        request: ChangeSortNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/closeNotebook": {
        request: CloseNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/createEncryptedNotebook": {
        request: CreateEncryptedNotebookRequestInput;
        response: { "code": 0; "data": CreateNotebookData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/createNotebook": {
        request: CreateNotebookRequestInput;
        response: { "code": 0; "data": CreateNotebookData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/disableEncryptedNotebooks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/notebook/enableEncryptedNotebooks": {
        request: NotebookPasswordRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/exportNotebookCryptoBackup": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": NotebookCryptoBackupData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/notebook/getEncryptedNotebookStatus": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": EncryptedNotebookStatusData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/notebook/getNotebookConf": {
        request: CloseNotebookRequestInput;
        response: { "code": 0; "data": NotebookConfData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/getNotebookInfo": {
        request: NotebookIDRequestInput;
        response: { "code": 0; "data": NotebookInfoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/importNotebookCryptoBackup": {
        request: ImportNotebookCryptoBackupRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/notebook/lockNotebook": {
        request: NotebookIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/lsNotebooks": {
        request: ListNotebooksRequestInput;
        response: { "code": 0; "data": ListNotebooksData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "legacyOptional";
    };
    "/api/notebook/openNotebook": {
        request: OpenNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/removeNotebook": {
        request: NotebookIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/renameNotebook": {
        request: RenameNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/reorder": {
        request: ReorderNotebooksRequestInput;
        response: { "code": 0; "data": ReorderData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | ReorderData | null; "msg": string; };
        body: "structJSON";
    };
    "/api/notebook/setNotebookConf": {
        request: SetNotebookConfRequestInput;
        response: { "code": 0; "data": NotebookConf | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/setNotebookCryptoAutoLock": {
        request: NotebookCryptoAutoLockRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/setNotebookIcon": {
        request: SetNotebookIconRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/touchEncryptedNotebooks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/notebook/unlockAndOpenNotebook": {
        request: UnlockNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notebook/unlockNotebook": {
        request: UnlockNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notification/pushErrMsg": {
        request: NotificationRequestInput;
        response: { "code": 0; "data": NotificationData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/notification/pushMsg": {
        request: NotificationRequestInput;
        response: { "code": 0; "data": NotificationData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/outline/getDocHeadingNumbers": {
        request: HeadingNumbersRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/outline/getDocOutline": {
        request: OutlineRequestInput;
        response: { "code": 0; "data": Array<SearchPath | null> | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/petal/loadPetals": {
        request: LoadPetalsRequestInput;
        response: { "code": 0; "data": Array<Petal | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/petal/setPetalEnabled": {
        request: SetPetalEnabledRequestInput;
        response: { "code": 0; "data": Petal | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/petal/setPetalPublishEnabled": {
        request: SetPetalPublishEnabledRequestInput;
        response: { "code": 0; "data": Petal | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/query/sql": {
        request: SQLQueryRequestInput;
        response: { "code": 0; "data": Array<Record<string, null | string | number | boolean> | null>; "limit": number; "msg": string; "truncated": boolean; } | ({ "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; } & { "limit"?: never; "truncated"?: never; });
        body: "json";
    };
    "/api/ref/getBacklink2": {
        request: BacklinkListRequestInput;
        response: { "code": 0; "data": BacklinkList | BacklinkRefDefs | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BacklinkList | BacklinkRefDefs | null; "msg": string; };
        body: "json";
    };
    "/api/ref/getBacklinkDoc": {
        request: BacklinkDocumentRequestInput;
        response: { "code": 0; "data": BacklinkContextData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/ref/getBackmentionDoc": {
        request: BackmentionDocumentRequestInput;
        response: { "code": 0; "data": BacklinkContextData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/ref/refreshBacklink": {
        request: RefreshBacklinkRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/checkSnapshot": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": CheckSnapshotData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/repo/createSnapshot": {
        request: CreateSnapshotRequestInput;
        response: { "code": 0; "data": CreateSnapshotData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/setSnapshotMemo": {
        request: SetSnapshotMemoRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/searchTag": {
        request: SearchTagRequestInput;
        response: { "code": 0; "data": SearchTagData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/setting/addVirtualBlockRefExclude": {
        request: VirtualBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/setting/addVirtualBlockRefInclude": {
        request: VirtualBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/setting/getPandocBin": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/setting/refreshVirtualBlockRef": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/setting/setEditorReadOnly": {
        request: EditorReadOnlyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/snippet/getSnippet": {
        request: GetSnippetRequestInput;
        response: { "code": 0; "data": SnippetsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/snippet/removeSnippet": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": Snippet | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/snippet/setSnippet": {
        request: SetSnippetRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sqlite/flushTransaction": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/storage/batchUpdateRecentDocCloseTime": {
        request: RecentDocsUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/getCriteria": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<Criterion | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/storage/getInlineStyles": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": InlineStyles | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/storage/getLocalStorage": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/storage/getLocalStorageVal": {
        request: StorageKeyRequestInput;
        response: { "code": 0; "data": JSONValue; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/getLocalStorageVals": {
        request: StorageKeysRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/getOutlineStorage": {
        request: OutlineStorageRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/getRecentDocs": {
        request: RecentDocsRequestInput;
        response: { "code": 0; "data": Array<RecentDoc | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "legacyOptional";
    };
    "/api/storage/getViewState": {
        request: StorageKeyRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/patchViewState": {
        request: ViewStatePatchRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/removeCriterion": {
        request: RemoveCriterionRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/removeLocalStorageVal": {
        request: StorageRemoveRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/removeLocalStorageVals": {
        request: StorageRemoveKeysRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/removeOutlineStorage": {
        request: OutlineStorageRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/removeViewState": {
        request: StorageKeyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/setCriterion": {
        request: SetCriterionRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/setInlineStyles": {
        request: SetInlineStylesRequestInput;
        response: { "code": 0; "data": InlineStyles | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/setLocalStorage": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/storage/setLocalStorageVal": {
        request: StorageSetRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/setLocalStorageVals": {
        request: StorageSetKeysRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/setOutlineStorage": {
        request: OutlineStorageSetRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/setWorkspaceAVPalette": {
        request: WorkspaceAVPaletteRequestInput;
        response: { "code": 0; "data": InlineStyles | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/updateRecentDocCloseTime": {
        request: RecentDocUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/updateRecentDocOpenTime": {
        request: RecentDocUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/storage/updateRecentDocViewTime": {
        request: RecentDocUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/addMicrosoftDefenderExclusion": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/bootProgress": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": BootProgressData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/clearTempFiles": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/currentTime": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": number; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/getNetwork": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": NetworkData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/getWorkspaceInfo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": WorkspaceInfoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/ignoreAddMicrosoftDefenderExclusion": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/rebuildDataIndex": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/reloadUI": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/setAutoLaunch": {
        request: AutoLaunchRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/setDownloadInstallPkg": {
        request: DownloadInstallPkgRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/setFollowSystemLockScreen": {
        request: LockScreenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/setNetworkProxy": {
        request: NetworkProxyInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/setNetworkServe": {
        request: NetworkServeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/setNetworkServeTLS": {
        request: NetworkServeTLSRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/setUpdateChannel": {
        request: UpdateChannelRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/system/vacuumDataIndex": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/system/version": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/tag/getTag": {
        request: GetTagRequestInput;
        response: { "code": 0; "data": Array<TagData | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/tag/removeTag": {
        request: RemoveTagRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/tag/renameTag": {
        request: RenameTagRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/template/docSaveAsTemplate": {
        request: SaveTemplateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/template/getDocSaveAsTemplateInfo": {
        request: TemplateDocumentRequestInput;
        response: { "code": 0; "data": TemplateDocumentInfo; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/template/manage": {
        request: TemplateFileRequestInput;
        response: { "code": 0; "data": Array<TemplateFileEntry> | TemplateFileSource | TemplateFileRevision | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
    };
    "/api/template/render": {
        request: RenderTemplateRequestInput;
        response: { "code": 0; "data": RenderTemplateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/template/renderSprig": {
        request: RenderSprigRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/ui/reloadAttributeView": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/ui/reloadFiletree": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/ui/reloadIcon": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/ui/reloadProtyle": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/ui/reloadTag": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/ui/reloadTheme": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/ui/reloadUI": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
}

// 传输层合成的错误独立于业务错误；普通回调只接收消息处理后保留的非负错误码。
export interface APITransportError {
    code: -401 | -403 | -404;
    msg: string;
    data: null;
}

export interface APIFetchFailure {
    code: number;
    msg: string;
    data: null;
}

export interface APILegacyResponse {
    code: number;
    msg: string;
    data?: any;
    cmd?: string;
    callback?: string;
    sid?: string;
    context?: any;
}

type APIContract = {request: unknown; response: unknown; body: string};
export interface APIFormData<Request> extends FormData {
    readonly apiRequest: Request;
}
type APIRequestArgs<C extends APIContract> = C["body"] extends "multipart" | "form"
    ? [data: APIFormData<C["request"]>]
    : C["body"] extends "json" | "structJSON"
    ? [data: C["request"]]
    : [data?: C["request"] | null];
type NonNegative<C extends number> = C extends C ? `${C}` extends `-${string}` ? never : C : never;
export type APICallbackResponse<R> = R extends {code: infer C extends number}
    ? NonNegative<C> extends never ? never : R & {code: NonNegative<C>}
    : never;

type APIPostTail<C extends APIContract> = [
    cb?: (response: C extends {output: "binary"} ? JSONValue : APICallbackResponse<C["response"]>) => void,
    headers?: Record<string, string>,
    failCallback?: (response: APIFetchFailure) => void,
    signal?: AbortSignal,
    timeout?: number
];
type LegacyPostArgs<Legacy> = [
    data?: any,
    cb?: (response: Legacy) => void,
    headers?: Record<string, string>,
    failCallback?: (response: Legacy) => void,
    signal?: AbortSignal,
    timeout?: number
];
type APISyncTail = [headers?: Record<string, string>, process?: boolean, signal?: AbortSignal];

// 路径只从首参推导，已知路径不能因请求参数不匹配而选择宽松重载。
export type FetchPost<Legacy = APILegacyResponse> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIPOSTRoutes
        ? [...APIRequestArgs<APIPOSTRoutes[Path]>, ...APIPostTail<APIPOSTRoutes[Path]>]
        : Path extends APILegacyPOSTPath ? LegacyPostArgs<Legacy>
        : string extends Path ? LegacyPostArgs<Legacy> : never
) => Promise<void>;

export type FetchSyncPost<Legacy = APILegacyResponse> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIPOSTRoutes
        ? [...APIRequestArgs<APIPOSTRoutes[Path]>, ...APISyncTail]
        : Path extends APILegacyPOSTPath ? [data?: any, ...tail: APISyncTail]
        : string extends Path ? [data?: any, ...tail: APISyncTail] : never
) => Promise<Path extends keyof APIPOSTRoutes
    ? APIPOSTRoutes[Path] extends {output: "binary"} ? JSONValue : APIPOSTRoutes[Path]["response"] | APITransportError
    : Legacy>;

export type FetchGet<Legacy = APILegacyResponse | string> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIGETRoutes
        ? [cb: (response: APIGETRoutes[Path]["response"]) => void]
        : Path extends keyof APIPOSTRoutes ? never
        : [cb: (response: Legacy) => void]
) => void;
