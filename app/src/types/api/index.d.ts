// 此文件由内核契约生成，请运行 pnpm run api:generate 更新。

export type AppendHeadingChildrenRequestInput = { "childrenDOM": string; "id": string; };

export type AutoLaunchRequestInput = { "autoLaunch": number; };

export type BatchSetBlockAttrsRequestInput = { "blockAttrs": Array<SetBlockAttrsRequestInput>; };

export type BlockFoldData = { "isFolded": boolean; "isRoot": boolean; };

export type BlockIDRequestInput = { "id": string; };

export type BlockIDsRequestInput = { "ids": Array<string>; };

export type BlockInfoData = (FullBlockInfo & { "publishAccessRequired"?: never; }) | (PublishedBlockInfo & { "box"?: never; "path"?: never; "rootChildID"?: never; });

export type BlockInfoRequestInput = { "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockQueryRequestInput = { "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockRelevantData = { "nextID": string; "parentID": string; "previousID": string; };

export type BlockSiblingData = { "next": string; "parent": string; "previous": string; };

export type BlocksQueryRequestInput = { "id"?: string | null; "ids": Array<string>; "notebook"?: string | null; };

export type BootProgressData = { "details": string; "progress": number; };

export type CheckSnapshotData = { "changed": boolean; };

export type CreateSnapshotData = { "created": boolean; "id": string; };

export type CreateSnapshotRequestInput = { "memo"?: string; };

export type DOMTextRequestInput = { "dom": string; };

export type DocOrdersRequestInput = { "id": string; };

export type DownloadInstallPkgRequestInput = { "downloadInstallPkg": boolean; };

export type EditorReadOnlyRequestInput = { "readonly": boolean; };

export type EmptyRequestInput = Record<string, never>;

export type FullBlockInfo = { "box": string; "path": string; "rootChildID": string; "rootID": string; "rootIcon": string; "rootTitle": string; "rootTitleEmpty": boolean; };

export type GetTagRequestInput = { "app"?: string | null; "ignoreMaxListHint"?: boolean | null; "sort"?: number | null; };

export type HeadingChildrenRequestInput = { "id": string; "removeFoldAttr"?: boolean | null; };

export type ListNotebooksData = { "boxDocEnabled": boolean; "notebooks": Array<Notebook | null> | null; };

export type ListNotebooksRequestInput = { "flashcard"?: boolean | null; };

export type LockScreenRequestInput = { "lockScreenMode": number; };

export type NetworkData = { "proxy": NetworkProxy | null; };

export type NetworkProxy = { "host": string; "port": string; "scheme": string; };

export type NetworkProxyInput = { "host": string; "port": string; "scheme": string; };

export type NetworkServeRequestInput = { "networkServe": boolean; };

export type NetworkServeTLSRequestInput = { "networkServeTLS": boolean; };

export type Notebook = { "closed": boolean; "dueFlashcardCount": number; "encrypted": boolean; "flashcardCount": number; "icon": string; "id": string; "name": string; "newFlashcardCount": number; "sort": number; "sortMode": number; "state"?: "Locked" | "Unlocking" | "Unlocked" | "Locking" | "Error"; "subFileCount": number; "unlocked": boolean; };

export type PublishedBlockInfo = { "publishAccessRequired": true; "rootID": string; "rootIcon": string; "rootTitle": string; "rootTitleEmpty": boolean; };

export type RemoveBookmarkRequestInput = { "bookmark": string; };

export type RemoveTagRequestInput = { "label": string; };

export type RenameBookmarkRequestInput = { "newBookmark": string; "oldBookmark": string; };

export type RenameTagRequestInput = { "newLabel": string; "oldLabel": string; };

export type SearchHistoryData = { "histories": Array<string> | null; "pageCount": number; "totalCount": number; };

export type SearchHistoryRequestInput = { "notebook"?: string | null; "op"?: string | null; "page"?: number | null; "query"?: string | null; "type"?: number | null; };

export type SearchTagData = { "k": string; "tags": Array<string>; };

export type SearchTagRequestInput = { "k": string; };

export type SetBlockAttrsRequestInput = { "attrs": Record<string, string | null>; "id": string; };

export type SetSnapshotMemoRequestInput = { "id": string; "memo": string; };

export type TagData = { "children": Array<TagData | null> | null; "count": number; "depth": number; "label": string; "name": string; "type": string; };

export type UnfoldedParentData = { "parentID": string; };

export type UpdateChannelRequestInput = { "updateChannel": string; };

export type VirtualBlockRefRequestInput = { "keywords": Array<string>; };

export type WorkspaceInfoData = { "siyuanVer": string; "workspaceDir": string; };

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
    "/api/account/checkActivationcode" |
    "/api/account/deactivate" |
    "/api/account/login" |
    "/api/account/startFreeTrial" |
    "/api/account/useActivationcode" |
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
    "/api/archive/unzip" |
    "/api/archive/zip" |
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
    "/api/attr/resetBlockAttrs" |
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
    "/api/av/searchAttributeViewNonRelationKey" |
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
    "/api/block/appendBlock" |
    "/api/block/appendDailyNoteBlock" |
    "/api/block/batchAppendBlock" |
    "/api/block/batchInsertBlock" |
    "/api/block/batchPrependBlock" |
    "/api/block/batchUpdateBlock" |
    "/api/block/batchUpdateTaskListItemMarker" |
    "/api/block/checkBlockRef" |
    "/api/block/checkBlocksExist" |
    "/api/block/deleteBlock" |
    "/api/block/foldBlock" |
    "/api/block/getBlockBreadcrumb" |
    "/api/block/getBlockBreadcrumbChildren" |
    "/api/block/getBlockDOM" |
    "/api/block/getBlockDOMWithEmbed" |
    "/api/block/getBlockDOMs" |
    "/api/block/getBlockDOMsWithEmbed" |
    "/api/block/getBlockDefIDsByRefText" |
    "/api/block/getBlockKramdown" |
    "/api/block/getBlockKramdowns" |
    "/api/block/getBlockTreeInfos" |
    "/api/block/getBlocksWordCount" |
    "/api/block/getChildBlocks" |
    "/api/block/getContentWordCount" |
    "/api/block/getDocHeadingLevelTransaction" |
    "/api/block/getDocInfo" |
    "/api/block/getDocsInfo" |
    "/api/block/getHeadingDeleteTransaction" |
    "/api/block/getHeadingFoldTransaction" |
    "/api/block/getHeadingInsertTransaction" |
    "/api/block/getHeadingLevelTransaction" |
    "/api/block/getOrderedListContinueStart" |
    "/api/block/getRecentUpdatedBlocks" |
    "/api/block/getRefIDs" |
    "/api/block/getRefIDsByFileAnnotationID" |
    "/api/block/getRefText" |
    "/api/block/getTailChildBlocks" |
    "/api/block/getTreeStat" |
    "/api/block/insertBlock" |
    "/api/block/moveBlock" |
    "/api/block/moveOutlineHeading" |
    "/api/block/prependBlock" |
    "/api/block/prependDailyNoteBlock" |
    "/api/block/setBlockReminder" |
    "/api/block/swapBlockRef" |
    "/api/block/transferBlockRef" |
    "/api/block/unfoldBlock" |
    "/api/block/updateBlock" |
    "/api/block/updateTaskListItemMarker" |
    "/api/bookmark/getBookmark" |
    "/api/broadcast/getChannelInfo" |
    "/api/broadcast/getChannels" |
    "/api/broadcast/postMessage" |
    "/api/broadcast/publish" |
    "/api/clipboard/cleanupRichText" |
    "/api/clipboard/prepareRichText" |
    "/api/clipboard/readFilePaths" |
    "/api/clipboard/writeFilePath" |
    "/api/cloud/getCloudSpace" |
    "/api/cloud/setCloudReminder" |
    "/api/convert/pandoc" |
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
    "/api/file/copyFile" |
    "/api/file/getFile" |
    "/api/file/getUniqueFilename" |
    "/api/file/globalCopyFiles" |
    "/api/file/putFile" |
    "/api/file/readDir" |
    "/api/file/removeFile" |
    "/api/file/renameFile" |
    "/api/file/workspaceCopyFiles" |
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
    "/api/format/autoSpace" |
    "/api/format/netAssets2LocalAssets" |
    "/api/format/netImg2LocalAssets" |
    "/api/graph/getGraph" |
    "/api/graph/getLocalGraph" |
    "/api/graph/resetGraph" |
    "/api/graph/resetLocalGraph" |
    "/api/graph/setGraphConf" |
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
    "/api/import/cancelImportSY" |
    "/api/import/cancelObsidianVaultTask" |
    "/api/import/continueImportSY" |
    "/api/import/getObsidianVaultTask" |
    "/api/import/importData" |
    "/api/import/importSY" |
    "/api/import/importSYAuto" |
    "/api/import/importSYNotebook" |
    "/api/import/importStdMd" |
    "/api/import/importZipMd" |
    "/api/import/startObsidianVaultAnalysis" |
    "/api/import/startObsidianVaultImport" |
    "/api/inbox/getShorthand" |
    "/api/inbox/getShorthands" |
    "/api/inbox/removeShorthands" |
    "/api/lute/copyStdMarkdown" |
    "/api/lute/html2BlockDOM" |
    "/api/lute/md2html" |
    "/api/lute/spinBlockDOM" |
    "/api/lute/wpsPresentation2BlockDOM" |
    "/api/network/echo" |
    "/api/network/echo/*path" |
    "/api/network/forwardProxy" |
    "/api/network/proxy" |
    "/api/notebook/changeMasterPassword" |
    "/api/notebook/changeSortNotebook" |
    "/api/notebook/closeNotebook" |
    "/api/notebook/createEncryptedNotebook" |
    "/api/notebook/createNotebook" |
    "/api/notebook/disableEncryptedNotebooks" |
    "/api/notebook/enableEncryptedNotebooks" |
    "/api/notebook/exportNotebookCryptoBackup" |
    "/api/notebook/getEncryptedNotebookStatus" |
    "/api/notebook/getNotebookConf" |
    "/api/notebook/getNotebookInfo" |
    "/api/notebook/importNotebookCryptoBackup" |
    "/api/notebook/lockNotebook" |
    "/api/notebook/openNotebook" |
    "/api/notebook/removeNotebook" |
    "/api/notebook/renameNotebook" |
    "/api/notebook/reorder" |
    "/api/notebook/setNotebookConf" |
    "/api/notebook/setNotebookCryptoAutoLock" |
    "/api/notebook/setNotebookIcon" |
    "/api/notebook/touchEncryptedNotebooks" |
    "/api/notebook/unlockAndOpenNotebook" |
    "/api/notebook/unlockNotebook" |
    "/api/notification/pushErrMsg" |
    "/api/notification/pushMsg" |
    "/api/outline/getDocHeadingNumbers" |
    "/api/outline/getDocOutline" |
    "/api/petal/loadPetals" |
    "/api/petal/setPetalEnabled" |
    "/api/petal/setPetalPublishEnabled" |
    "/api/plugin/getLoadedPlugin" |
    "/api/plugin/listLoadedPlugins" |
    "/api/plugin/rpc" |
    "/api/plugin/rpc/:name" |
    "/api/query/sql" |
    "/api/ref/getBacklink2" |
    "/api/ref/getBacklinkDoc" |
    "/api/ref/getBackmentionDoc" |
    "/api/ref/refreshBacklink" |
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
    "/api/snippet/getSnippet" |
    "/api/snippet/removeSnippet" |
    "/api/snippet/setSnippet" |
    "/api/sqlite/flushTransaction" |
    "/api/storage/batchUpdateRecentDocCloseTime" |
    "/api/storage/getCriteria" |
    "/api/storage/getInlineStyles" |
    "/api/storage/getLocalStorage" |
    "/api/storage/getLocalStorageVal" |
    "/api/storage/getLocalStorageVals" |
    "/api/storage/getOutlineStorage" |
    "/api/storage/getRecentDocs" |
    "/api/storage/getViewState" |
    "/api/storage/patchViewState" |
    "/api/storage/removeCriterion" |
    "/api/storage/removeLocalStorageVal" |
    "/api/storage/removeLocalStorageVals" |
    "/api/storage/removeOutlineStorage" |
    "/api/storage/removeViewState" |
    "/api/storage/setCriterion" |
    "/api/storage/setInlineStyles" |
    "/api/storage/setLocalStorage" |
    "/api/storage/setLocalStorageVal" |
    "/api/storage/setLocalStorageVals" |
    "/api/storage/setOutlineStorage" |
    "/api/storage/setWorkspaceAVPalette" |
    "/api/storage/updateRecentDocCloseTime" |
    "/api/storage/updateRecentDocOpenTime" |
    "/api/storage/updateRecentDocViewTime" |
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
    "/api/system/reloadUI" |
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
    "/api/template/docSaveAsTemplate" |
    "/api/template/getDocSaveAsTemplateInfo" |
    "/api/template/manage" |
    "/api/template/render" |
    "/api/template/renderSprig" |
    "/api/transactions" |
    "/api/transactions/clearHistory" |
    "/api/transactions/redo" |
    "/api/transactions/undo" |
    "/api/transactions/undoState" |
    "/api/ui/reloadAttributeView" |
    "/api/ui/reloadFiletree" |
    "/api/ui/reloadIcon" |
    "/api/ui/reloadProtyle" |
    "/api/ui/reloadTag" |
    "/api/ui/reloadTheme" |
    "/api/ui/reloadUI" |
    "/plugin/private/:name/*path";

export interface APIPOSTRoutes {
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
    "/api/attr/setBlockAttrs": {
        request: SetBlockAttrsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
    };
    "/api/block/appendHeadingChildren": {
        request: AppendHeadingChildrenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
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
    "/api/block/getBlocksIndexes": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, number> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
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
    "/api/block/getUnfoldedParentID": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": UnfoldedParentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
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
    "/api/notebook/lsNotebooks": {
        request: ListNotebooksRequestInput;
        response: { "code": 0; "data": ListNotebooksData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "legacyOptional";
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
type APIRequestArgs<C extends APIContract> = C["body"] extends "json"
    ? [data: C["request"]]
    : [data?: C["request"] | null];
type NonNegative<C extends number> = C extends C ? `${C}` extends `-${string}` ? never : C : never;
export type APICallbackResponse<R> = R extends {code: infer C extends number}
    ? NonNegative<C> extends never ? never : R & {code: NonNegative<C>}
    : never;

type APIPostTail<C extends APIContract> = [
    cb?: (response: APICallbackResponse<C["response"]>) => void,
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
) => Promise<Path extends keyof APIPOSTRoutes ? APIPOSTRoutes[Path]["response"] | APITransportError : Legacy>;

export type FetchGet<Legacy = APILegacyResponse | string> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIGETRoutes
        ? [cb: (response: APIGETRoutes[Path]["response"]) => void]
        : Path extends keyof APIPOSTRoutes ? never
        : [cb: (response: Legacy) => void]
) => void;
