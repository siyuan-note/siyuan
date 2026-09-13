// 此文件由内核契约生成，请运行 pnpm run api:generate 更新。

export type AccountLoginData = { "needCaptcha": string | null; "token": string | null; "userName": string | null; };

export type AccountLoginRequestInput = { "captcha": string; "cloudRegion": number; "userName": string; "userPassword": string; };

export type ActivationCodeRequestInput = { "data": string; };

export type AppendBlockRequestInput = { "data": string; "dataType": string; "parentID": string; };

export type AppendHeadingChildrenRequestInput = { "childrenDOM": string; "id": string; };

export type AssetAnnotationData = { "data": string; };

export type AssetCloudUploadRequestInput = { "id": string; "ignorePushMsg"?: boolean | null; };

export type AssetContent = { "content": string; "ext": string; "hSize": string; "id": string; "name": string; "path": string; "size": number; "updated": number; };

export type AssetContentData = { "assetContent": AssetContent | null; };

export type AssetContentRequestInput = { "id": string; "query": string; "queryMethod": number; };

export type AssetDocumentAssetsRequestInput = { "id": string; "retainQueryStr"?: boolean | null; };

export type AssetDocumentRequestInput = { "id": string; };

export type AssetInsertCoverData = { "succFiles": Array<AssetUploadSuccess> | null; "succMap": Record<string, string> | null; };

export type AssetOCRData = { "ocrJSON": Array<Record<string, string> | null> | null; "text": string; };

export type AssetOCRTextRequestInput = { "path"?: string | null; };

export type AssetPathData = { "path": string; };

export type AssetPathRequestInput = { "path": string; };

export type AssetPathsCloudUploadRequestInput = { "ignorePushMsg"?: boolean | null; "paths": Array<string>; };

export type AssetPathsData = { "paths": Array<string> | null; };

export type AssetRenameData = { "newPath": string; };

export type AssetStatData = { "created": number; "downloaded"?: false; "hCreated": string; "hSize": string; "hUpdated": string; "size": number; "updated": number; };

export type AssetTextData = { "text": string; };

export type AssetUnusedItem = { "blockIDs"?: Array<string>; "item": string; "name": string; "path"?: string; };

export type AssetUploadData = { "errFiles": Array<string> | null; "failedFiles": Array<AssetUploadFailure> | null; "succFiles": Array<AssetUploadSuccess> | null; "succMap": Record<string, string> | null; };

export type AssetUploadFailure = { "error": string; "index": number; "name": string; };

export type AssetUploadSuccess = { "index": number; "name": string; "path": string; };

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

export type BatchUpdatePackageRequestInput = { "frontend": string; };

export type BazaarAppearance = { "bodyGradient": BazaarBodyGradient | null; "closeButtonBehavior": number; "codeBlockThemeDark": string; "codeBlockThemeLight": string; "darkThemes": Array<BazaarAppearanceTheme | null> | null; "entryVisibility": BazaarEntryVisibility | null; "globalFontFamilies": Array<BazaarEditorFont | null> | null; "hideStatusBar": boolean; "hideToolbar": boolean; "icon": string; "iconVer": string; "icons": Array<BazaarAppearanceIcon | null> | null; "lang": string; "lightThemes": Array<BazaarAppearanceTheme | null> | null; "mode": number; "modeOS": boolean; "notifications": BazaarNotifications | null; "statusBar": BazaarStatusBar | null; "themeDark": string; "themeJS": boolean; "themeLight": string; "themeVer": string; };

export type BazaarAppearanceIcon = { "label": string; "name": string; };

export type BazaarAppearancePackagesData = { "appearance": BazaarAppearance | null; "packages": Array<BazaarPackage | null> | null; };

export type BazaarAppearanceTheme = { "frontends"?: Array<string>; "label": string; "name": string; };

export type BazaarBodyGradient = { "dark": BazaarBodyGradientColor; "light": BazaarBodyGradientColor; "mode": string; };

export type BazaarBodyGradientColor = { "color": string; "opacity": number; };

export type BazaarEditorFont = { "displayName": string; "family": string; "weight": number; };

export type BazaarEntryVisibility = { "active": string; "profiles": Array<BazaarEntryVisibilityProfile | null> | null; "version": number; };

export type BazaarEntryVisibilityProfile = { "entries": Record<string, boolean> | null; "id": string; "name": string; "orders": Record<string, Array<string> | null> | null; };

export type BazaarFunding = { "custom": Array<string> | null; "github": string; "links"?: Array<BazaarFundingLink>; "openCollective": string; "patreon": string; };

export type BazaarFundingLink = { "label": string; "url": string; };

export type BazaarLocalInstallData = { "minAppVersion"?: string; "packageName": string; "packageType": string; "updated": boolean; };

export type BazaarLocalInstallError = { "minAppVersion": string; "packageName": string; "packageType": string; "reason": "install-failed" | "package-exists" | "package-incompatible"; };

export type BazaarLocalInstallResult = (BazaarLocalInstallData & { "reason"?: never; }) | (BazaarLocalInstallError & { "updated"?: never; });

export type BazaarNotifications = { "browserCompatibility": boolean; "docTreeMaxList": boolean; "formatPainterTip"?: boolean; "selectAllTip"?: boolean; "tagMaxList": boolean; "workspaceNotSSD": boolean; };

export type BazaarPackage = { "alternatives"?: Array<string>; "author": string; "backends": Array<string> | null; "bazaarIncompatible"?: boolean; "bootAppearances"?: Array<string>; "current": boolean; "deprecated"?: boolean; "deprecatedReason"?: Record<string, string>; "description": Record<string, string> | null; "disabledInPublish": boolean; "disallowInstall": boolean; "disallowUpdate": boolean; "displayName": Record<string, string> | null; "downloads": number; "enabled"?: boolean; "frontends": Array<string> | null; "funding": BazaarFunding | null; "hInstallDate": string; "hInstallSize": string; "hSize": string; "hUpdated": string; "hasStorageData"?: boolean; "icon"?: string; "iconURL": string; "installSize": number; "installTime": number; "installed": boolean; "installedIncompatible"?: boolean; "invalidReason"?: "missing-manifest" | "invalid-manifest" | "name-mismatch"; "kernels": Array<string> | null; "keywords": Array<string> | null; "minAppVersion": string; "modes"?: Array<string> | null; "name": string; "openIssues": number; "outdated": boolean; "preferredDeprecatedReason"?: string; "preferredDesc": string; "preferredFunding": string; "preferredName": string; "preferredReadme": string; "preview"?: string; "previewURL": string; "rating"?: BazaarPackageRating; "ratingAvailable": boolean; "readme": Record<string, string> | null; "repoHash": string; "repoRef"?: string; "repoURL": string; "size": number; "stars": number; "updateRequiredMinAppVer"?: string; "updateTime": number; "updated": string; "url": string; "userDisabledInPublish"?: boolean; "version": string; };

export type BazaarPackageDetail = { "available": BazaarPackage | null; "installed": BazaarPackage | null; };

export type BazaarPackageRating = { "average": number; "count": number; "distribution": [number, number, number, number, number]; };

export type BazaarPackageSizeData = { "hInstallSize": string; "installSize": number; };

export type BazaarPackagesData = { "packages": Array<BazaarPackage | null> | null; };

export type BazaarREADMEData = { "html": string; };

export type BazaarRatingData = { "rating"?: BazaarPackageRating; "ratingAvailable": boolean; "userRating": number; };

export type BazaarRatingError = { "errorCode": "bazaarRatingRateLimited" | "bazaarPackagePending"; };

export type BazaarRatingResult = (BazaarRatingData & { "errorCode"?: never; }) | (BazaarRatingError & { "rating"?: never; "ratingAvailable"?: never; "userRating"?: never; });

export type BazaarRatingsData = { "eligiblePackageNames": Array<string> | null; "ratings": Record<string, BazaarPackageRating | null> | null; };

export type BazaarStatusBar = { "msgDataSyncDisabled": boolean; "msgTaskAssetDatabaseIndexCommitDisabled": boolean; "msgTaskDatabaseIndexCommitDisabled": boolean; "msgTaskHistoryDatabaseIndexCommitDisabled": boolean; "msgTaskHistoryGenerateFileDisabled": boolean; "version": number; };

export type BazaarUpdatedData = { "icons": Array<BazaarPackageDetail | null> | null; "plugins": Array<BazaarPackageDetail | null> | null; "templates": Array<BazaarPackageDetail | null> | null; "themes": Array<BazaarPackageDetail | null> | null; "widgets": Array<BazaarPackageDetail | null> | null; };

export type BazaarUserRatingsData = { "eligiblePackageNames": Array<string> | null; "userRatings": Record<string, number> | null; };

export type BazaarUserRatingsResult = (BazaarUserRatingsData & { "errorCode"?: never; }) | (BazaarRatingError & { "eligiblePackageNames"?: never; "userRatings"?: never; });

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

export type CheckoutRepoRequestInput = { "id": string; "sessionID"?: string | null; };

export type ChildBlock = { "content"?: string; "id": string; "markdown"?: string; "subType"?: string; "type": string; };

export type CleanupRichTextRequestInput = { "batch": string; "groups": Array<string>; };

export type ClipboardFile = { "isDir": boolean; "name": string; "path": string; "size": number; "updated": number; };

export type ClipboardPathRequestInput = { "path": string; };

export type CloseNotebookRequestInput = { "notebook": string; };

export type CloudBackup = { "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type CloudReminderRequestInput = { "content": string; "id": string; "timed": string; };

export type CloudSpaceData = { "backup": CloudBackup | null; "hAssetSize": string; "hExchangeSize": string; "hSize": string; "hTotalSize": string; "hTrafficAPIGet": string; "hTrafficAPIPut": string; "hTrafficDownloadSize": string; "hTrafficUploadSize": string; "sync": CloudSync | null; };

export type CloudSync = { "cloudName": string; "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type CloudSyncDir = { "cloudName": string; "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type CloudSyncDirsData = { "checkedSyncDir": string; "hSize": string; "syncDirs": Array<CloudSyncDir | null> | null; };

export type ContentWordCountRequestInput = { "content": string; "reqId"?: JSONValue | null; };

export type ContinueImportSYRequestInput = { "notebook": string; "token": string; };

export type CopyExportFileRequestInput = { "dest": string; "srcPath": string; };

export type CopyFileRequestInput = { "dest": string; "src": string; };

export type CopyFilesRequestInput = { "destDir": string; "srcs": Array<string>; };

export type CopyStdMarkdownRequestInput = { "adjustHeadingLevel"?: boolean | null; "assetsDestSpace2Underscore"?: boolean | null; "fillCSSVar"?: boolean | null; "id": string; "imgTag"?: boolean | null; };

export type CreateAssetHistoryRequestInput = { "path": string; };

export type CreateDocHistoryRequestInput = { "id": string; };

export type CreateEncryptedNotebookRequestInput = { "name": string; "password": string; };

export type CreateNotebookData = { "notebook": Notebook | null; };

export type CreateNotebookRequestInput = { "name": string; };

export type CreateRiffDeckRequestInput = { "name": string; };

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

export type DiffDocVersionsRequestInput = { "left": DocVersionRefInput; "right": DocVersionRefInput; };

export type DiffRepoSnapshotsRequestInput = { "left": string; "right": string; };

export type DirectoryEntry = { "isDir": boolean; "isSymlink": boolean; "name": string; "updated": number; };

export type DocAttrView = { "id": string; "name": string; };

export type DocHeadingLevelData = { "counts": Array<number>; "title": string; "transaction": BlockTransaction | null; "withSubheadingCounts": Array<number>; };

export type DocHeadingLevelRequestInput = { "id"?: string | null; "notebook"?: string | null; "source"?: number | null; "target"?: number | null; "withSubheadings"?: boolean | null; };

export type DocHistoryContentData = { "content": string; "id": string; "isLargeDoc": boolean; "rootID": string; };

export type DocHistoryContentRequestInput = { "highlight"?: boolean | null; "historyPath": string; "k"?: string | null; };

export type DocInfo = { "attrViews": Array<DocAttrView | null> | null; "ial": Record<string, string> | null; "icon": string; "id": string; "name": string; "refCount": number; "refIDs": Array<string> | null; "rootID": string; "subFileCount": number; };

export type DocOrdersRequestInput = { "id": string; };

export type DocVersionDiffContent = { "content": string; "id": string; "rootID": string; "title": string; };

export type DocVersionDiffResult = { "differences": Array<DocVersionDifference | null> | null; "fallback": boolean; "large": boolean; "left": DocVersionDiffContent | null; "message": string; "right": DocVersionDiffContent | null; "titleModified": boolean; };

export type DocVersionDifference = { "id": string; "statuses": Array<string> | null; };

export type DocVersionRefInput = { "id"?: string | null; "path"?: string | null; "snapshot"?: string | null; "type": string; };

export type DocsInfoRequestInput = { "av": boolean; "ids": Array<string>; "refCount": boolean; };

export type DownloadCloudSnapshotRequestInput = { "id": string; "tag": string; };

export type DownloadInstallPkgRequestInput = { "downloadInstallPkg": boolean; };

export type EditorReadOnlyRequestInput = { "readonly": boolean; };

export type EmbedBlock = { "allowChildOperation": boolean; "block": SearchBlock | null; "blockPaths": Array<BlockPath | null> | null; };

export type EmbedBlocksData = { "blocks": Array<EmbedBlock | null> | null; };

export type EmbedStat = { "complete": boolean; "cycleCount": number; "depthLimitCount": number; "failedQueryCount": number; "failedResultCount": number; "jsEmbedCount": number; "queryEmbedCount": number; "resultCount": number; "truncatedQueryCount": number; };

export type EmptyRequestInput = Record<string, never>;

export type EncryptedNotebookStatus = { "id": string; "name": string; "state": "Locked" | "Unlocking" | "Unlocked" | "Locking" | "Error"; "unlocked": boolean; };

export type EncryptedNotebookStatusData = { "boxes": Array<EncryptedNotebookStatus>; "count": number; "enabled": boolean; "hasHistoryDependency": boolean; "migrationBoxes": Array<string> | null; "migrationPending": boolean; "state": "Disabled" | "Enabled" | "RecoveryRequired"; };

export type ExportAsFileRequestInput = { "file": Blob; "type": string; };

export type ExportAttributeViewRequestInput = { "blockID": string; "id": string; };

export type ExportBrowserHTMLRequestInput = { "folder": string; "html": string; "name": string; };

export type ExportDocumentsMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "ids": Array<string>; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportDocxRequestInput = { "id": string; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; "removeAssets": boolean; "savePath": string; };

export type ExportFileData = { "file": string; };

export type ExportFolderRequestInput = { "folder": string; };

export type ExportHTMLData = { "content": string; "folder"?: string; "id": string; "name": string; };

export type ExportHTMLRequestInput = { "addTitle"?: boolean | null; "customTitle"?: string | null; "id": string; "keepFold"?: boolean | null; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; "pdf": boolean; "savePath"?: string | null; };

export type ExportIDRequestInput = { "id": string; };

export type ExportIDsRequestInput = { "ids": Array<string>; };

export type ExportMarkdownContentData = { "content": string; "hPath": string; };

export type ExportMarkdownContentRequestInput = { "addTitle"?: boolean | null; "adjustHeadingLevel"?: boolean | null; "embedMode"?: number | null; "fillCSSVar"?: boolean | null; "id": string; "imgTag"?: boolean | null; "refMode"?: number | null; "yfm"?: boolean | null; };

export type ExportMarkdownHTMLRequestInput = { "id": string; "savePath"?: string | null; };

export type ExportMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "id": string; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportNameData = { "name": string; };

export type ExportNamedZipData = { "name": string; "zip": string; };

export type ExportNotebookMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "notebook": string; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportNotebooksMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "notebooks"?: Array<string> | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportNotebooksRequestInput = { "notebooks"?: Array<string> | null; };

export type ExportPathData = { "path": string; };

export type ExportPreviewData = { "fillCSSVar": boolean; "html": string; };

export type ExportPreviewHTMLData = { "attrs": Record<string, string> | null; "content": string; "id": string; "name": string; "type": string; };

export type ExportPreviewHTMLRequestInput = { "addTitle"?: boolean | null; "customTitle"?: string | null; "id": string; "image"?: boolean | null; "keepFold"?: boolean | null; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; };

export type ExportRepoFileRequestInput = { "id": string; };

export type ExportResourcesRequestInput = { "name"?: string | null; "paths"?: Array<string> | null; };

export type ExportTempContentRequestInput = { "content": string; "id"?: string | null; };

export type ExportURLData = { "url": string; };

export type ExportZipData = { "zip": string; };

export type FileAnnotationRefRequestInput = { "id": string; "notebook"?: string | null; };

export type FilePathData = { "path": string; };

export type FilePathRequestInput = { "path": string; };

export type FindReplaceRequestInput = { "groupBy"?: number | null; "ids": Array<string>; "k": string; "method"?: number | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "paths"?: Array<string> | null; "query"?: string | null; "r": string; "replaceTypes"?: Record<string, boolean> | null; "subTypes"?: SearchSubtypeFilterInput | null; "types"?: Record<string, boolean> | null; };

export type FullBlockInfo = { "box": string; "path": string; "rootChildID": string; "rootID": string; "rootIcon": string; "rootTitle": string; "rootTitleEmpty": boolean; };

export type FullTextSearchBlockData = { "blocks": Array<SearchBlock | null> | null; "docMode": boolean; "matchedBlockCount": number; "matchedRootCount": number; "pageCount": number; };

export type FullTextSearchBlockRequestInput = { "groupBy"?: number | null; "method"?: number | null; "notebook"?: string | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "paths"?: Array<string> | null; "query"?: string | null; "searchHPath"?: boolean | null; "subTypes"?: SearchSubtypeFilterInput | null; "types"?: Record<string, boolean> | null; };

export type GetBazaarIconRequestInput = { "keyword"?: string | null; };

export type GetBazaarPackageREADMERequestInput = { "packageType": string; "repoHash": string; "repoURL": string; };

export type GetBazaarPackageRatingRequestInput = { "packageName": string; "packageType": string; };

export type GetBazaarPackageRatingsRequestInput = { "packageNames": Array<string>; "packageType": string; };

export type GetBazaarPackageRequestInput = { "frontend"?: string | null; "packageName": string; "packageType": string; };

export type GetBazaarPackageUserRatingsRequestInput = { "packageNames": Array<string>; "packageType": string; };

export type GetBazaarPluginRequestInput = { "frontend": string; "keyword"?: string | null; };

export type GetBazaarTemplateRequestInput = { "keyword"?: string | null; };

export type GetBazaarThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; };

export type GetBazaarWidgetRequestInput = { "keyword"?: string | null; };

export type GetCloudRepoSnapshotsRequestInput = { "page": number; };

export type GetEmbedBlockRequestInput = { "breadcrumb"?: boolean | null; "embedBlockID": string; "headingMode"?: number | null; "includeIDs": Array<string>; "notebook"?: string | null; };

export type GetInstalledIconRequestInput = { "keyword"?: string | null; };

export type GetInstalledPackageSizeRequestInput = { "packageName": string; "packageType": string; };

export type GetInstalledPluginRequestInput = { "frontend": string; "keyword"?: string | null; };

export type GetInstalledTemplateRequestInput = { "keyword"?: string | null; };

export type GetInstalledThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; };

export type GetInstalledWidgetRequestInput = { "keyword"?: string | null; };

export type GetRepoDocHistoryRequestInput = { "id": string; "page": number; };

export type GetRepoFileRequestInput = { "id": string; };

export type GetRepoSnapshotsRequestInput = { "page": number; };

export type GetSnippetRequestInput = { "enabled": number; "keyword"?: string | null; "type": string; };

export type GetTagRequestInput = { "app"?: string | null; "ignoreMaxListHint"?: boolean | null; "sort"?: number | null; };

export type GetUpdatedPackageRequestInput = { "frontend": string; };

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

export type History = { "hCreated": string; "items": Array<HistoryItem | null> | null; };

export type HistoryItem = { "id": string; "notebook": string; "op": string; "path": string; "title": string; };

export type HistoryItemsData = { "items": Array<HistoryItem | null> | null; };

export type HistoryItemsRequestInput = { "created": string; "notebook"?: string | null; "op"?: string | null; "query"?: string | null; "type"?: number | null; };

export type HistoryPathRequestInput = { "historyPath": string; };

export type ImportAutoDocument = { "token"?: string; "type": "document"; };

export type ImportAutoNotebook = { "notebook": Notebook | null; "type": "notebook"; };

export type ImportAutoNotebooks = { "notebooks": Array<Notebook | null> | null; "type": "notebooks"; };

export type ImportDataRequestInput = { "file"?: Blob; };

export type ImportDocumentData = { "type": "document"; };

export type ImportMarkdownRequestInput = { "localPath": string; "notebook": string; "skipRoot"?: boolean | null; "toPath": string; };

export type ImportNotebookCryptoBackupRequestInput = { "file": Blob; "password"?: string; };

export type ImportRepoKeyRequestInput = { "key": string; };

export type ImportSYRequestInput = { "file"?: Blob; "notebook"?: string; "toPath"?: string; };

export type ImportTokenRequestInput = { "token": string; };

export type ImportZipMarkdownRequestInput = { "file"?: Blob; "notebook"?: string; "skipRoot"?: string; "toPath"?: string; };

export type ImportedNotebook = { "notebook": Notebook | null; };

export type ImportedNotebooks = { "notebooks": Array<Notebook | null> | null; };

export type InitRepoKeyFromPassphraseRequestInput = { "pass": string; };

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

export type InsertCoverRequestInput = { "id": string; "name": string; };

export type InsertLocalAssetsRequestInput = { "assetPaths": Array<string>; "fromHTMLPaste"?: boolean | null; "id"?: string | null; "isUpload"?: boolean | null; };

export type InstallBazaarIconRequestInput = { "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarPluginRequestInput = { "frontend": string; "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarTemplateRequestInput = { "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; "mode"?: number; "modeOS"?: boolean; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarWidgetRequestInput = { "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallLocalBazaarPackageRequestInput = { "file"?: Blob; "frontend"?: string; "overwrite"?: string; };

export type JSONValue = null | boolean | number | string | Array<JSONValue> | { [key: string]: JSONValue };

export type KernelPetal = { "existed": boolean; "incompatible": boolean; "js": string; };

export type ListNotebooksData = { "boxDocEnabled": boolean; "notebooks": Array<Notebook | null> | null; };

export type ListNotebooksRequestInput = { "flashcard"?: boolean | null; };

export type LoadPetalsRequestInput = { "frontend": string; };

export type LoadedPlugin = { "methods": Array<PluginRPCMethod | null> | null; "name": string; "state": string; "stateCode": number; };

export type LoadedPluginRequestInput = { "name": string; };

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

export type NotebookHistoryData = { "histories": Array<History | null> | null; };

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

export type OpenRepoSnapshotFileRequestInput = { "id": string; };

export type OrderedListStartData = { "found": boolean; "start": number; };

export type OutlineRequestInput = { "id"?: string | null; "notebook"?: string | null; "preview"?: boolean | null; };

export type OutlineStorageRequestInput = { "docID": string; };

export type OutlineStorageSetRequestInput = { "docID": string; "val": { [key: string]: JSONValue }; };

export type PandocData = { "path": string; };

export type PandocRequestInput = { "args": Array<string>; "dir"?: string | null; };

export type PerformSyncRequestInput = { "mobileSwitch"?: boolean | null; "upload"?: boolean; };

export type Petal = { "css": string; "disabledInPublish": boolean; "disallowInstall": boolean; "displayName": string; "enabled": boolean; "i18n": { [key: string]: JSONValue } | null; "incompatible": boolean; "js": string; "kernel": KernelPetal; "name": string; "userDisabledInPublish": boolean; "version": string; };

export type PinnedDoc = { "childrenSortMode": number | null; "icon": string; "id": string; "name": string; "notebook": string; "path": string; "subFileCount": number; "unavailable": boolean; };

export type PluginRPCError = { "code": number; "data"?: JSONValue; "message": string; };

export type PluginRPCFailure = { "error": PluginRPCError | null; "id": string | number | null; "jsonrpc": "2.0"; };

export type PluginRPCMethod = { "descriptions": Array<string> | null; "name": string; };

export type PluginRPCNotification = { "jsonrpc": "2.0"; "method": string; "params"?: JSONValue; };

export type PluginRPCRequestFieldsInput = { "id"?: string | number | null; "jsonrpc": "2.0"; "method": string; "params"?: Array<JSONValue> | { [key: string]: JSONValue } | null; };

export type PluginRPCSuccess = { "id": string | number | null; "jsonrpc": "2.0"; "result": JSONValue; };

export type PrepareRichTextRequestInput = { "assets": Array<RichClipboardAssetInput>; };

export type PrependBlockRequestInput = { "data": string; "dataType": string; "parentID": string; };

export type ProcessPDFRequestInput = { "id": string; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; "path": string; "removeAssets": boolean; "watermark": boolean; };

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

export type RemoveCloudRepoTagSnapshotRequestInput = { "tag": string; };

export type RemoveCriterionRequestInput = { "name": string; };

export type RemoveFileRequestInput = { "app"?: string | null; "path": string; };

export type RemoveRepoTagSnapshotRequestInput = { "tag": string; };

export type RemoveShorthandsRequestInput = { "ids": Array<string>; };

export type RemoveTagRequestInput = { "label": string; };

export type RenameAssetRequestInput = { "newName": string; "oldPath": string; };

export type RenameBookmarkRequestInput = { "newBookmark": string; "oldBookmark": string; };

export type RenameFileRequestInput = { "newPath": string; "path": string; };

export type RenameNotebookRequestInput = { "name": string; "notebook": string; };

export type RenameRiffDeckRequestInput = { "deckID": string; "name": string; };

export type RenameTagRequestInput = { "newLabel": string; "oldLabel": string; };

export type RenderSprigRequestInput = { "template": string; };

export type RenderTemplateData = { "content": string; "docTreePlan"?: TemplatePlan; "path": string; };

export type RenderTemplateRequestInput = { "content"?: string; "id": string; "mode"?: string | null; "path": string; "preview"?: boolean | null; };

export type ReorderData = { "changed": boolean; "notebook"?: string; "parentPath"?: string; };

export type ReorderNotebooksRequestInput = { "position"?: string | null; "sourceIDs"?: Array<string> | null; "targetID"?: string | null; };

export type RepoCloudSnapshotsData = { "pageCount": number; "snapshots": Array<RepoLog | null> | null; "totalCount": number; };

export type RepoCloudTagsData = { "snapshots": Array<RepoLog | null> | null; };

export type RepoDiffData = { "addsLeft": Array<RepoDiffFile | null> | null; "left": RepoDiffIndex | null; "removesRight": Array<RepoDiffFile | null> | null; "right": RepoDiffIndex | null; "updatesLeft": Array<RepoDiffFile | null> | null; "updatesRight": Array<RepoDiffFile | null> | null; };

export type RepoDiffFile = { "fileID": string; "hPath"?: string; "hSize": string; "indexID": string; "path": string; "title": string; "updated": number; };

export type RepoDiffIndex = { "created": number; "id": string; };

export type RepoDocHistory = { "fileID": string; "hSize": string; "indexID": string; "title": string; "updated": number; };

export type RepoDocHistoryData = { "files": Array<RepoDocHistory | null> | null; "pageCount": number; "totalCount": number; };

export type RepoExportData = { "path": string; };

export type RepoFile = { "chunks": Array<string> | null; "id": string; "path": string; "size": number; "updated": number; };

export type RepoKeyData = { "key": string; };

export type RepoLog = { "count": number; "created": number; "files": Array<RepoFile | null> | null; "hCreated": string; "hSize": string; "hTagUpdated": string; "id": string; "memo": string; "size": number; "systemID": string; "systemName": string; "systemOS": string; "tag": string; };

export type RepoOpenFileData = { "content": string; "displayInText": boolean; "title": string; "updated": number; };

export type RepoSearchData = { "files": Array<RepoDiffFile | null> | null; "pageCount": number; "totalCount": number; };

export type RepoSnapshot = { "count": number; "created": number; "files": Array<RepoFile | null> | null; "hCreated": string; "hSize": string; "hTagUpdated": string; "id": string; "memo": string; "requiresDownload": boolean; "size": number; "systemID": string; "systemName": string; "systemOS": string; "tag": string; "typesCount": Array<RepoTypeCount | null> | null; };

export type RepoSnapshotsData = { "pageCount": number; "snapshots": Array<RepoSnapshot | null> | null; "totalCount": number; };

export type RepoTagsData = { "snapshots": Array<RepoSnapshot | null> | null; };

export type RepoTypeCount = { "count": number; "type": string; };

export type ResetGraphData = { "conf": GlobalGraphConf; };

export type ResetLocalGraphData = { "conf": LocalGraphConf; };

export type ResetRiffCardsRequestInput = { "blockIDs"?: Array<string> | null; "deckID": string; "id": string; "type": string; };

export type ReviewRiffCardRequestInput = { "cardID": string; "deckID": string; "rating": number; "reviewedCards"?: Array<RiffReviewedCardInput> | null; };

export type RichClipboardAssetInput = { "box"?: string; "index": number; "path": string; };

export type RichClipboardPrepared = { "assets": Array<RichClipboardPreparedAsset> | null; "batch": string; "groups": Array<string> | null; };

export type RichClipboardPreparedAsset = { "index": number; "path": string; };

export type RiffBlockIDsRequestInput = { "blockIDs": Array<string>; };

export type RiffBlocksData = { "blocks": Array<SearchBlock | null> | null; };

export type RiffCardDueInput = { "due": string; "id": string; };

export type RiffCardRequestInput = { "cardID": string; "deckID": string; };

export type RiffCardsData = { "blocks": Array<SearchBlock | null> | null; "pageCount": number; "total": number; };

export type RiffCardsRequestInput = { "id": string; "page": number; "pageSize"?: number | null; };

export type RiffDeck = { "created": string; "id": string; "name": string; "size": number; "updated": string; };

export type RiffDeckCardsRequestInput = { "blockIDs": Array<string>; "deckID": string; };

export type RiffDeckRequestInput = { "deckID": string; };

export type RiffDueCard = { "blockID": string; "cardID": string; "deckID": string; "lapses": number; "lastReview": number; "nextDues": Record<string, string> | null; "reps": number; "state": number; };

export type RiffDueCardsData = { "cards": Array<RiffDueCard | null> | null; "unreviewedCount": number; "unreviewedNewCardCount": number; "unreviewedOldCardCount": number; };

export type RiffDueCardsRequestInput = { "deckID": string; "reviewedCards"?: Array<RiffReviewedCardInput> | null; };

export type RiffNotebookDueCardsRequestInput = { "notebook": string; "reviewedCards"?: Array<RiffReviewedCardInput> | null; };

export type RiffReviewedCardInput = { "cardID": string; };

export type RiffTreeDueCardsRequestInput = { "reviewedCards"?: Array<RiffReviewedCardInput> | null; "rootID": string; };

export type RollbackRepoSnapshotFileRequestInput = { "id": string; };

export type SQLQueryRequestInput = { "mode"?: string | null; "stmt": string; };

export type SaveTemplateRequestInput = { "databaseMode"?: string; "directory"?: string; "id": string; "name": string; "overwrite": boolean; };

export type SearchAsset = { "hName": string; "path": string; "updated": number; };

export type SearchAssetContentData = { "assetContents": Array<AssetContent | null> | null; "matchedAssetCount": number; "pageCount": number; };

export type SearchAssetContentRequestInput = { "method"?: number | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "query"?: string | null; "types"?: Record<string, boolean> | null; };

export type SearchAssetRequestInput = { "exts"?: Array<string> | null; "k": string; };

export type SearchBlock = { "alias": string; "box": string; "children": Array<SearchBlock | null> | null; "content": string; "count": number; "created": string; "defID": string; "defPath": string; "depth": number; "fcontent": string; "folded": boolean; "hPath": string; "ial": Record<string, string> | null; "id": string; "markdown": string; "memo": string; "name": string; "number"?: string; "parentID": string; "path": string; "refCount": number; "refText": string; "refs": Array<SearchBlock | null> | null; "riffCard": SearchBlockCard | null; "riffCardID": string; "rootID": string; "sort": number; "subType": string; "tag": string; "type": string; "updated": string; };

export type SearchBlockCard = { "due": string; "lapses": number; "lastReview": string; "reps": number; "state": number; };

export type SearchBlockRequestInput = { "groupBy"?: number | null; "method"?: number | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "paths"?: Array<string> | null; "query"?: string | null; "subTypes"?: SearchSubtypeFilterInput | null; "types"?: Record<string, boolean> | null; };

export type SearchBlocksData = { "blocks": Array<SearchBlock | null> | null; "matchedBlockCount": number; "matchedRootCount": number; "pageCount": number; };

export type SearchEmbedBlockRequestInput = { "breadcrumb"?: boolean | null; "embedBlockID": string; "excludeIDs": Array<string | null>; "headingMode"?: number | null; "notebook"?: string | null; "stmt": string; };

export type SearchHeadingFilterInput = { "h1"?: boolean | null; "h2"?: boolean | null; "h3"?: boolean | null; "h4"?: boolean | null; "h5"?: boolean | null; "h6"?: boolean | null; };

export type SearchHistoryData = { "histories": Array<string> | null; "pageCount": number; "totalCount": number; };

export type SearchHistoryRequestInput = { "notebook"?: string | null; "op"?: string | null; "page"?: number | null; "query"?: string | null; "type"?: number | null; };

export type SearchKeywordRequestInput = { "k": string; };

export type SearchListFilterInput = { "o"?: boolean | null; "t"?: boolean | null; "u"?: boolean | null; };

export type SearchPageRequestInput = { "page"?: number | null; "pageSize"?: number | null; };

export type SearchPath = { "blocks"?: Array<SearchBlock | null>; "box": string; "children"?: Array<SearchPath | null>; "count": number; "created": string; "depth": number; "folded": boolean; "hPath": string; "id": string; "name": string; "nodeType": string; "number"?: string; "subType": string; "type": string; "updated": string; };

export type SearchPathRequestInput = { "path": string; };

export type SearchRefBlockRequestInput = { "beforeLen"?: number; "id"?: string | null; "isDatabase"?: boolean | null; "isSquareBrackets"?: boolean | null; "k"?: string; "notebook"?: string | null; "reqId"?: JSONValue | null; "rootID"?: string; };

export type SearchRefCorrelation = { "reqId": JSONValue; };

export type SearchRefResult = { "blocks": Array<SearchBlock | null> | null; "k": string; "newDoc": boolean; "reqId": JSONValue; };

export type SearchRepoFileRequestInput = { "keyword": string; "page": number; };

export type SearchSubTypes = { "heading": Record<string, boolean> | null; "list": Record<string, boolean> | null; "listItem": Record<string, boolean> | null; };

export type SearchSubTypesInput = { "heading"?: Record<string, boolean> | null; "list"?: Record<string, boolean> | null; "listItem"?: Record<string, boolean> | null; };

export type SearchSubtypeFilterInput = { "heading"?: SearchHeadingFilterInput | null; "list"?: SearchListFilterInput | null; "listItem"?: SearchListFilterInput | null; };

export type SearchTagData = { "k": string; "tags": Array<string>; };

export type SearchTagRequestInput = { "k": string; };

export type SearchTemplateData = { "k": string; "templates": Array<SearchTemplateResult | null> | null; };

export type SearchTemplateResult = { "content": string; "path": string; "relativePath": string; };

export type SearchWidgetData = { "k": string; "widgets": Array<SearchWidgetResult | null> | null; };

export type SearchWidgetResult = { "content": string; "name": string; };

export type SetAssetAnnotationRequestInput = { "data": string; "path": string; };

export type SetAssetOCRTextRequestInput = { "path": string; "text": string; };

export type SetBazaarPackageRatingRequestInput = { "packageName": string; "packageType": string; "rating": number; };

export type SetBlockAttrsRequestInput = { "attrs": Record<string, string | null>; "id": string; };

export type SetCriterionRequestInput = { "criterion": CriterionInput | null; };

export type SetGraphConfRequestInput = { "conf": GraphConfigurationFieldsInput; "type": string; };

export type SetInlineStylesRequestInput = { "app"?: string | null; "av"?: InlineStyleAVInput | null; "builtin"?: InlineStyleBuiltinInput | null; "order"?: InlineStyleOrderInput | null; "styles": Array<InlineStyleInput | null>; "version": number; };

export type SetNotebookConfRequestInput = { "conf"?: NotebookConfPatchInput | null; "notebook": string; };

export type SetNotebookIconRequestInput = { "icon": string; "notebook": string; };

export type SetPetalEnabledRequestInput = { "app"?: string | null; "enabled": boolean; "packageName": string; };

export type SetPetalPublishEnabledRequestInput = { "enabled": boolean; "packageName": string; };

export type SetRepoIndexRetentionDaysRequestInput = { "days": number; };

export type SetRetentionIndexesDailyRequestInput = { "indexes": number; };

export type SetRiffCardsDueRequestInput = { "cardDues": Array<RiffCardDueInput>; };

export type SetSnapshotMemoRequestInput = { "id": string; "memo": string; };

export type SetSnippetRequestInput = { "snippets": Array<SnippetInput>; };

export type SetSyncLocalRequestInput = { "local": SyncLocalInput; };

export type SetSyncS3RequestInput = { "s3": SyncS3Input; };

export type SetSyncWebDAVRequestInput = { "webdav": SyncWebDAVInput; };

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

export type SyncAssetDownloadModeData = { "assetDownloadMode": number; };

export type SyncEnabledRequestInput = { "enabled": boolean; };

export type SyncInfoData = { "kernel": string; "kernels": Array<SyncOnlineKernel | null> | null; "stat": string; "synced": number; };

export type SyncIntervalRequestInput = { "interval": number; };

export type SyncLANRequestInput = { "enabled": boolean; "maxConcurrentReqs"?: number | null; };

export type SyncLANStatus = { "active": boolean; "connectedPeers": number; "discoveredPeers": number; "enabled": boolean; "maxConcurrentReqs": number; };

export type SyncLocal = { "concurrentReqs": number; "endpoint": string; "timeout": number; };

export type SyncLocalData = { "local": SyncLocal | null; };

export type SyncLocalInput = { "concurrentReqs"?: number | null; "endpoint"?: string | null; "timeout"?: number | null; };

export type SyncModeRequestInput = { "mode": number; };

export type SyncNameRequestInput = { "name": string; };

export type SyncOnlineKernel = { "hostname": string; "id": string; "os": string; "ver": string; };

export type SyncProviderExportData = { "name": string; "zip": string; };

export type SyncProviderImportRequestInput = { "file"?: Blob; };

export type SyncProviderRequestInput = { "provider": number; };

export type SyncS3 = { "accessKey": string; "bucket": string; "concurrentReqs": number; "endpoint": string; "pathStyle": boolean; "region": string; "secretKey": string; "skipTlsVerify": boolean; "timeout": number; };

export type SyncS3Data = { "s3": SyncS3 | null; };

export type SyncS3Input = { "accessKey"?: string | null; "bucket"?: string | null; "concurrentReqs"?: number | null; "endpoint"?: string | null; "pathStyle"?: boolean | null; "region"?: string | null; "secretKey"?: string | null; "skipTlsVerify"?: boolean | null; "timeout"?: number | null; };

export type SyncWebDAV = { "concurrentReqs": number; "endpoint": string; "password": string; "skipTlsVerify": boolean; "timeout": number; "username": string; };

export type SyncWebDAVData = { "webdav": SyncWebDAV | null; };

export type SyncWebDAVInput = { "concurrentReqs"?: number | null; "endpoint"?: string | null; "password"?: string | null; "skipTlsVerify"?: boolean | null; "timeout"?: number | null; "username"?: string | null; };

export type TagData = { "children": Array<TagData | null> | null; "count": number; "depth": number; "label": string; "name": string; "type": string; };

export type TagSnapshotRequestInput = { "id": string; "name": string; };

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

export type UninstallBazaarIconRequestInput = { "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarPluginRequestInput = { "frontend"?: string | null; "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarTemplateRequestInput = { "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarWidgetRequestInput = { "keyword"?: string | null; "packageName": string; };

export type UnlockNotebookRequestInput = { "notebook": string; "password": string; };

export type UnzipRequestInput = { "path": string; "zipPath": string; };

export type UpdateBazaarPackageRequestInput = { "frontend": string; "keyword"?: string | null; "packageName": string; "packageType": string; };

export type UpdateBlockRequestInput = { "data": string; "dataType": string; "id": string; "lockType"?: boolean | null; };

export type UpdateChannelRequestInput = { "updateChannel": string; };

export type UpdateEmbedBlockRequestInput = { "content": string; "id": string; };

export type UpdatePinnedDocsRequestInput = { "action": string; "after"?: boolean; "ids": Array<string>; "targetID"?: string; };

export type UploadAssetRequestInput = { "assetsDirPath"?: string; "file[]"?: Array<Blob>; "id"?: string; };

export type UploadCloudSnapshotRequestInput = { "id": string; "tag": string; };

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
    "/api/system/bootProgressSSE" |
    "/api/system/getBootAppearance" |
    "/api/system/getCaptcha" |
    "/api/system/oidc/callback" |
    "/es/broadcast/subscribe" |
    "/es/network/proxy" |
    "/plugin/private/:name/*path" |
    "/ws/broadcast" |
    "/ws/network/proxy";

export interface APIGETRoutes {
    "/api/plugin": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<LoadedPlugin | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/plugin/rpc": {
        request: LoadedPluginRequestInput;
        response: { "code": 0; "data": LoadedPlugin | null; "msg": string; } | { "code": -1 | 1 | 2 | 3 | 4; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/plugin/rpc/:name": {
        request: LoadedPluginRequestInput;
        response: { "code": 0; "data": LoadedPlugin | null; "msg": string; } | { "code": -1 | 1 | 2 | 3 | 4; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
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
    "/ws/plugin/rpc": {
        request: EmptyRequestInput;
        response: (PluginRPCFailure & { "code"?: never; "data"?: never; "msg"?: never; }) | ({ "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; } & { "error"?: never; "id"?: never; "jsonrpc"?: never; });
        body: "none";
        output: "websocket";
        websocket: { incoming: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>]; outgoing: (PluginRPCSuccess & { "error"?: never; "method"?: never; "params"?: never; }) | (PluginRPCFailure & { "method"?: never; "params"?: never; "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | (PluginRPCNotification & { "error"?: never; "id"?: never; "result"?: never; }); failureStatus: 404; };
    };
    "/ws/plugin/rpc/:name": {
        request: EmptyRequestInput;
        response: (PluginRPCFailure & { "code"?: never; "data"?: never; "msg"?: never; }) | ({ "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; } & { "error"?: never; "id"?: never; "jsonrpc"?: never; });
        body: "none";
        output: "websocket";
        websocket: { incoming: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>]; outgoing: (PluginRPCSuccess & { "error"?: never; "method"?: never; "params"?: never; }) | (PluginRPCFailure & { "method"?: never; "params"?: never; "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | (PluginRPCNotification & { "error"?: never; "id"?: never; "result"?: never; }); failureStatus: 404; };
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
    "/api/network/echo" |
    "/api/network/echo/*path" |
    "/api/network/forwardProxy" |
    "/api/network/proxy" |
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
    "/api/asset/fullReindexAssetContent": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/asset/getDocAssets": {
        request: AssetDocumentAssetsRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/getDocImageAssets": {
        request: AssetDocumentRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/getFileAnnotation": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetAnnotationData; "msg": string; } | { "code": -1 | 1 | 403; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/getImageOCRText": {
        request: AssetOCRTextRequestInput;
        response: { "code": 0; "data": AssetTextData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/getMissingAssets": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AssetUnusedItem | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/asset/getUnusedAssets": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AssetUnusedItem | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/asset/insertCover": {
        request: InsertCoverRequestInput;
        response: { "code": 0; "data": AssetInsertCoverData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/insertLocalAssets": {
        request: InsertLocalAssetsRequestInput;
        response: { "code": 0; "data": AssetUploadData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "errFiles"?: never; "failedFiles"?: never; "succFiles"?: never; "succMap"?: never; }) | null | (AssetUploadData & { "closeTimeout"?: never; }); "msg": string; };
        body: "json";
    };
    "/api/asset/ocr": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetOCRData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/removeUnusedAsset": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetPathData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/removeUnusedAssets": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AssetPathsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/asset/renameAsset": {
        request: RenameAssetRequestInput;
        response: { "code": 0; "data": AssetRenameData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/resolveAssetPath": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/setFileAnnotation": {
        request: SetAssetAnnotationRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/setImageOCRText": {
        request: SetAssetOCRTextRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/statAsset": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetStatData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/upload": {
        request: UploadAssetRequestInput;
        response: { "code": 0; "data": AssetUploadData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/asset/uploadCloud": {
        request: AssetCloudUploadRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/asset/uploadCloudByAssetsPaths": {
        request: AssetPathsCloudUploadRequestInput;
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
    "/api/bazaar/batchUpdatePackage": {
        request: BatchUpdatePackageRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarIcon": {
        request: GetBazaarIconRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarPackage": {
        request: GetBazaarPackageRequestInput;
        response: { "code": 0; "data": BazaarPackageDetail; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarPackageREADME": {
        request: GetBazaarPackageREADMERequestInput;
        response: { "code": 0; "data": BazaarREADMEData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarPackageRating": {
        request: GetBazaarPackageRatingRequestInput;
        response: { "code": 0; "data": BazaarRatingResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarRatingResult; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarPackageRatings": {
        request: GetBazaarPackageRatingsRequestInput;
        response: { "code": 0; "data": BazaarRatingsData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarPackageUserRatings": {
        request: GetBazaarPackageUserRatingsRequestInput;
        response: { "code": 0; "data": BazaarUserRatingsResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarUserRatingsResult; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarPlugin": {
        request: GetBazaarPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarTemplate": {
        request: GetBazaarTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarTheme": {
        request: GetBazaarThemeRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getBazaarWidget": {
        request: GetBazaarWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getInstalledIcon": {
        request: GetInstalledIconRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getInstalledPackageSize": {
        request: GetInstalledPackageSizeRequestInput;
        response: { "code": 0; "data": BazaarPackageSizeData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getInstalledPlugin": {
        request: GetInstalledPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getInstalledTemplate": {
        request: GetInstalledTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getInstalledTheme": {
        request: GetInstalledThemeRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getInstalledWidget": {
        request: GetInstalledWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/getUpdatedPackage": {
        request: GetUpdatedPackageRequestInput;
        response: { "code": 0; "data": BazaarUpdatedData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/installBazaarIcon": {
        request: InstallBazaarIconRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/installBazaarPlugin": {
        request: InstallBazaarPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/installBazaarTemplate": {
        request: InstallBazaarTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/installBazaarTheme": {
        request: InstallBazaarThemeRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/installBazaarWidget": {
        request: InstallBazaarWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/installLocalBazaarPackage": {
        request: InstallLocalBazaarPackageRequestInput;
        response: { "code": 0; "data": BazaarLocalInstallResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarLocalInstallResult; "msg": string; };
        body: "multipart";
    };
    "/api/bazaar/setBazaarPackageRating": {
        request: SetBazaarPackageRatingRequestInput;
        response: { "code": 0; "data": BazaarRatingResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarRatingResult; "msg": string; };
        body: "json";
    };
    "/api/bazaar/uninstallBazaarIcon": {
        request: UninstallBazaarIconRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/uninstallBazaarPlugin": {
        request: UninstallBazaarPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/uninstallBazaarTemplate": {
        request: UninstallBazaarTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/uninstallBazaarTheme": {
        request: UninstallBazaarThemeRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/uninstallBazaarWidget": {
        request: UninstallBazaarWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/bazaar/updateBazaarPackage": {
        request: UpdateBazaarPackageRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
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
    "/api/export/copyExportFile": {
        request: CopyExportFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/export2Liandi": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportAsFile": {
        request: ExportAsFileRequestInput;
        response: { "code": 0; "data": ExportFileData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
    };
    "/api/export/exportAsciiDoc": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportAttributeView": {
        request: ExportAttributeViewRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportBrowserHTML": {
        request: ExportBrowserHTMLRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportCodeBlock": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportPathData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportData": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/export/exportDataInFolder": {
        request: ExportFolderRequestInput;
        response: { "code": 0; "data": ExportNameData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportDocx": {
        request: ExportDocxRequestInput;
        response: { "code": 0; "data": ExportPathData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportEPUB": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportHTML": {
        request: ExportHTMLRequestInput;
        response: { "code": 0; "data": ExportHTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportMd": {
        request: ExportMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportMdContent": {
        request: ExportMarkdownContentRequestInput;
        response: { "code": 0; "data": ExportMarkdownContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportMdHTML": {
        request: ExportMarkdownHTMLRequestInput;
        response: { "code": 0; "data": ExportHTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportMds": {
        request: ExportDocumentsMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportMediaWiki": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportNotebookMd": {
        request: ExportNotebookMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportNotebookSY": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportNotebooksMd": {
        request: ExportNotebooksMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportNotebooksSY": {
        request: ExportNotebooksRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportODT": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportOPML": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportOrgMode": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportPreviewHTML": {
        request: ExportPreviewHTMLRequestInput;
        response: { "code": 0; "data": ExportPreviewHTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportRTF": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportReStructuredText": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportResources": {
        request: ExportResourcesRequestInput;
        response: { "code": 0; "data": ExportPathData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | string; "msg": string; };
        body: "json";
    };
    "/api/export/exportSY": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportSYs": {
        request: ExportIDsRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportTempContent": {
        request: ExportTempContentRequestInput;
        response: { "code": 0; "data": ExportURLData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/exportTextile": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/preview": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportPreviewData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/export/processPDF": {
        request: ProcessPDFRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
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
    "/api/history/createAssetHistory": {
        request: CreateAssetHistoryRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/createDocHistory": {
        request: CreateDocHistoryRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/diffDocVersions": {
        request: DiffDocVersionsRequestInput;
        response: { "code": 0; "data": DocVersionDiffResult | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/getDocHistoryContent": {
        request: DocHistoryContentRequestInput;
        response: { "code": 0; "data": DocHistoryContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/getHistoryItems": {
        request: HistoryItemsRequestInput;
        response: { "code": 0; "data": HistoryItemsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/getNotebookHistory": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": NotebookHistoryData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/history/reindexHistory": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/history/rollbackAssetsHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/rollbackAttributeViewHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/rollbackDocHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/history/rollbackNotebookHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
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
        response: { "code": 0; "data": WPSPresentationData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "converted"?: never; "dom"?: never; }) | null | (WPSPresentationData & { "closeTimeout"?: never; }); "msg": string; };
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
    "/api/plugin/getLoadedPlugin": {
        request: LoadedPluginRequestInput;
        response: { "code": 0; "data": LoadedPlugin | null; "msg": string; } | { "code": -1 | 1 | 2 | 3 | 4; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/plugin/listLoadedPlugins": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<LoadedPlugin | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/plugin/rpc": {
        request: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>];
        response: (PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        output: "directJSON";
        noContent: true;
    };
    "/api/plugin/rpc/:name": {
        request: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>];
        response: (PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        output: "directJSON";
        noContent: true;
    };
    "/api/query/sql": {
        request: SQLQueryRequestInput;
        response: { "code": 0; "data": Array<Record<string, null | string | number | boolean> | null>; "limit": number; "msg": string; "truncated": boolean; } | ({ "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; } & { "limit"?: never; "truncated"?: never; });
        body: "json";
    };
    "/api/ref/getBacklink2": {
        request: BacklinkListRequestInput;
        response: { "code": 0; "data": (BacklinkList & { "refDefs"?: never; }) | (BacklinkRefDefs & { "backlinks"?: never; "backmentions"?: never; "box"?: never; "k"?: never; "linkRefsCount"?: never; "mentionsCount"?: never; "mk"?: never; "revision"?: never; "unchanged"?: never; }) | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | (BacklinkList & { "refDefs"?: never; }) | (BacklinkRefDefs & { "backlinks"?: never; "backmentions"?: never; "box"?: never; "k"?: never; "linkRefsCount"?: never; "mentionsCount"?: never; "mk"?: never; "revision"?: never; "unchanged"?: never; }) | null; "msg": string; };
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
    "/api/repo/checkoutRepo": {
        request: CheckoutRepoRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/createSnapshot": {
        request: CreateSnapshotRequestInput;
        response: { "code": 0; "data": CreateSnapshotData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/diffRepoSnapshots": {
        request: DiffRepoSnapshotsRequestInput;
        response: { "code": 0; "data": RepoDiffData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/downloadCloudSnapshot": {
        request: DownloadCloudSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/exportRepoFile": {
        request: ExportRepoFileRequestInput;
        response: { "code": 0; "data": RepoExportData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/getCloudRepoSnapshots": {
        request: GetCloudRepoSnapshotsRequestInput;
        response: { "code": 0; "data": RepoCloudSnapshotsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/getCloudRepoTagSnapshots": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": RepoCloudTagsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/repo/getRepoDocHistory": {
        request: GetRepoDocHistoryRequestInput;
        response: { "code": 0; "data": RepoDocHistoryData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/getRepoFile": {
        request: GetRepoFileRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        output: "binary";
    };
    "/api/repo/getRepoSnapshots": {
        request: GetRepoSnapshotsRequestInput;
        response: { "code": 0; "data": RepoSnapshotsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/getRepoTagSnapshots": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": RepoTagsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/repo/importRepoKey": {
        request: ImportRepoKeyRequestInput;
        response: { "code": 0; "data": RepoKeyData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/initRepoKey": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": RepoKeyData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/repo/initRepoKeyFromPassphrase": {
        request: InitRepoKeyFromPassphraseRequestInput;
        response: { "code": 0; "data": RepoKeyData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/openRepoSnapshotFile": {
        request: OpenRepoSnapshotFileRequestInput;
        response: { "code": 0; "data": RepoOpenFileData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/purgeCloudRepo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/repo/purgeRepo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/repo/removeCloudRepoTagSnapshot": {
        request: RemoveCloudRepoTagSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/removeRepoTagSnapshot": {
        request: RemoveRepoTagSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/resetRepo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/repo/rollbackRepoSnapshotFile": {
        request: RollbackRepoSnapshotFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/searchRepoFile": {
        request: SearchRepoFileRequestInput;
        response: { "code": 0; "data": RepoSearchData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/setRepoIndexRetentionDays": {
        request: SetRepoIndexRetentionDaysRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/setRetentionIndexesDaily": {
        request: SetRetentionIndexesDailyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/setSnapshotMemo": {
        request: SetSnapshotMemoRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/tagSnapshot": {
        request: TagSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/repo/uploadCloudSnapshot": {
        request: UploadCloudSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/addRiffCards": {
        request: RiffDeckCardsRequestInput;
        response: { "code": 0; "data": RiffDeck | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/batchSetRiffCardsDueTime": {
        request: SetRiffCardsDueRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/createRiffDeck": {
        request: CreateRiffDeckRequestInput;
        response: { "code": 0; "data": RiffDeck | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/getNotebookRiffCards": {
        request: RiffCardsRequestInput;
        response: { "code": 0; "data": RiffCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/getNotebookRiffDueCards": {
        request: RiffNotebookDueCardsRequestInput;
        response: { "code": 0; "data": RiffDueCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/getRiffCards": {
        request: RiffCardsRequestInput;
        response: { "code": 0; "data": RiffCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/getRiffCardsByBlockIDs": {
        request: RiffBlockIDsRequestInput;
        response: { "code": 0; "data": RiffBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/getRiffDecks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<RiffDeck | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/riff/getRiffDueCards": {
        request: RiffDueCardsRequestInput;
        response: { "code": 0; "data": RiffDueCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/getTreeRiffCards": {
        request: RiffCardsRequestInput;
        response: { "code": 0; "data": RiffCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/getTreeRiffDueCards": {
        request: RiffTreeDueCardsRequestInput;
        response: { "code": 0; "data": RiffDueCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/removeRiffCards": {
        request: RiffDeckCardsRequestInput;
        response: { "code": 0; "data": RiffDeck | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/removeRiffDeck": {
        request: RiffDeckRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/renameRiffDeck": {
        request: RenameRiffDeckRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/resetRiffCards": {
        request: ResetRiffCardsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/reviewRiffCard": {
        request: ReviewRiffCardRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/riff/skipReviewRiffCard": {
        request: RiffCardRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/findReplace": {
        request: FindReplaceRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/fullTextSearchAssetContent": {
        request: SearchAssetContentRequestInput;
        response: { "code": 0; "data": SearchAssetContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/fullTextSearchBlock": {
        request: FullTextSearchBlockRequestInput;
        response: { "code": 0; "data": FullTextSearchBlockData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/getAssetContent": {
        request: AssetContentRequestInput;
        response: { "code": 0; "data": AssetContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/getAssetContentByPath": {
        request: SearchPathRequestInput;
        response: { "code": 0; "data": AssetContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/getEmbedBlock": {
        request: GetEmbedBlockRequestInput;
        response: { "code": 0; "data": EmbedBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/listInvalidBlockRefs": {
        request: SearchPageRequestInput;
        response: { "code": 0; "data": SearchBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/removeTemplate": {
        request: SearchPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/searchAsset": {
        request: SearchAssetRequestInput;
        response: { "code": 0; "data": Array<SearchAsset | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/searchEmbedBlock": {
        request: SearchEmbedBlockRequestInput;
        response: { "code": 0; "data": EmbedBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/searchRefBlock": {
        request: SearchRefBlockRequestInput;
        response: { "code": 0; "data": SearchRefResult | (SearchRefCorrelation & { "blocks"?: never; "k"?: never; "newDoc"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | SearchRefResult | (SearchRefCorrelation & { "blocks"?: never; "k"?: never; "newDoc"?: never; }); "msg": string; };
        body: "json";
    };
    "/api/search/searchTag": {
        request: SearchTagRequestInput;
        response: { "code": 0; "data": SearchTagData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/searchTemplate": {
        request: SearchKeywordRequestInput;
        response: { "code": 0; "data": SearchTemplateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/searchWidget": {
        request: SearchKeywordRequestInput;
        response: { "code": 0; "data": SearchWidgetData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/semanticSearchBlock": {
        request: SearchBlockRequestInput;
        response: { "code": 0; "data": SearchBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/search/updateEmbedBlock": {
        request: UpdateEmbedBlockRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
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
    "/api/sync/createCloudSyncDir": {
        request: SyncNameRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/exportSyncProviderS3": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncProviderExportData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/sync/exportSyncProviderWebDAV": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncProviderExportData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/sync/getBootSync": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/sync/getSyncInfo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncInfoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/sync/getSyncLANStatus": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncLANStatus; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/sync/importSyncProviderS3": {
        request: SyncProviderImportRequestInput;
        response: { "code": 0; "data": SyncS3Data; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "s3"?: never; }) | null | (SyncS3Data & { "closeTimeout"?: never; }); "msg": string; };
        body: "multipart";
    };
    "/api/sync/importSyncProviderWebDAV": {
        request: SyncProviderImportRequestInput;
        response: { "code": 0; "data": SyncWebDAVData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "webdav"?: never; }) | null | (SyncWebDAVData & { "closeTimeout"?: never; }); "msg": string; };
        body: "multipart";
    };
    "/api/sync/listCloudSyncDir": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": CloudSyncDirsData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/sync/performBootSync": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
    };
    "/api/sync/performSync": {
        request: PerformSyncRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/removeCloudSyncDir": {
        request: SyncNameRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setCloudSyncDir": {
        request: SyncNameRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncAssetDownloadMode": {
        request: SyncModeRequestInput;
        response: { "code": 0; "data": SyncAssetDownloadModeData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncEnable": {
        request: SyncEnabledRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncGenerateConflictDoc": {
        request: SyncEnabledRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncInterval": {
        request: SyncIntervalRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncLAN": {
        request: SyncLANRequestInput;
        response: { "code": 0; "data": SyncLANStatus; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncMode": {
        request: SyncModeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncPerception": {
        request: SyncEnabledRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncProvider": {
        request: SyncProviderRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncProviderLocal": {
        request: SetSyncLocalRequestInput;
        response: { "code": 0; "data": SyncLocalData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncProviderS3": {
        request: SetSyncS3RequestInput;
        response: { "code": 0; "data": SyncS3Data; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/sync/setSyncProviderWebDAV": {
        request: SetSyncWebDAVRequestInput;
        response: { "code": 0; "data": SyncWebDAVData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
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
        response: { "code": 0; "data": Array<TemplateFileEntry> | TemplateFileSource | (TemplateFileRevision & { "content"?: never; "path"?: never; }) | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
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

type APIDirectCallbackResponse<R> = R extends {code: number} ? APICallbackResponse<R> : R;

type APIPostTail<C extends APIContract> = [
    cb?: (response: C extends {output: "binary"} ? JSONValue : C extends {output: "directJSON"} ? APIDirectCallbackResponse<C["response"]> | (C extends {noContent: true} ? "" : never) : APICallbackResponse<C["response"]>) => void,
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
        ? [cb: (response: APIGETRoutes[Path]["response"] | (APIGETRoutes[Path] extends {output: "websocket"} ? string : never)) => void]
        : Path extends keyof APIPOSTRoutes ? never
        : [cb: (response: Legacy) => void]
) => void;
