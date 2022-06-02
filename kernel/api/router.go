// SiYuan - Build Your Eternal Digital Garden
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func ServeAPI(ginServer *gin.Engine) {
	// 不需要鉴权

	ginServer.Handle("GET", "/api/system/bootProgress", bootProgress)
	ginServer.Handle("POST", "/api/system/bootProgress", bootProgress)
	ginServer.Handle("GET", "/api/system/version", version)
	ginServer.Handle("POST", "/api/system/version", version)
	ginServer.Handle("POST", "/api/system/currentTime", currentTime)
	ginServer.Handle("POST", "/api/system/uiproc", addUIProcess)
	ginServer.Handle("POST", "/api/system/loginAuth", model.LoginAuth)
	ginServer.Handle("POST", "/api/system/logoutAuth", model.LogoutAuth)

	// 需要鉴权

	ginServer.Handle("POST", "/api/system/getEmojiConf", model.CheckAuth, getEmojiConf)
	ginServer.Handle("POST", "/api/system/setAccessAuthCode", model.CheckAuth, setAccessAuthCode)
	ginServer.Handle("POST", "/api/system/setNetworkServe", model.CheckAuth, setNetworkServe)
	ginServer.Handle("POST", "/api/system/setUploadErrLog", model.CheckAuth, setUploadErrLog)
	ginServer.Handle("POST", "/api/system/setNetworkProxy", model.CheckAuth, setNetworkProxy)
	ginServer.Handle("POST", "/api/system/setWorkspaceDir", model.CheckAuth, setWorkspaceDir)
	ginServer.Handle("POST", "/api/system/listWorkspaceDirs", model.CheckAuth, listWorkspaceDirs)
	ginServer.Handle("POST", "/api/system/setAppearanceMode", model.CheckAuth, setAppearanceMode)
	ginServer.Handle("POST", "/api/system/getSysFonts", model.CheckAuth, getSysFonts)
	ginServer.Handle("POST", "/api/system/setE2EEPasswd", model.CheckAuth, setE2EEPasswd)
	ginServer.Handle("POST", "/api/system/exit", model.CheckAuth, exit)
	ginServer.Handle("POST", "/api/system/setUILayout", model.CheckAuth, setUILayout)
	ginServer.Handle("POST", "/api/system/getConf", model.CheckAuth, getConf)
	ginServer.Handle("POST", "/api/system/checkUpdate", model.CheckAuth, checkUpdate)

	ginServer.Handle("POST", "/api/account/login", model.CheckAuth, login)
	ginServer.Handle("POST", "/api/account/checkActivationcode", model.CheckAuth, checkActivationcode)
	ginServer.Handle("POST", "/api/account/useActivationcode", model.CheckAuth, useActivationcode)
	ginServer.Handle("POST", "/api/account/deactivate", model.CheckAuth, deactivateUser)
	ginServer.Handle("POST", "/api/account/startFreeTrial", model.CheckAuth, startFreeTrial)

	ginServer.Handle("POST", "/api/notebook/lsNotebooks", model.CheckAuth, lsNotebooks)
	ginServer.Handle("POST", "/api/notebook/openNotebook", model.CheckAuth, openNotebook)
	ginServer.Handle("POST", "/api/notebook/closeNotebook", model.CheckAuth, closeNotebook)
	ginServer.Handle("POST", "/api/notebook/getNotebookConf", model.CheckAuth, getNotebookConf)
	ginServer.Handle("POST", "/api/notebook/setNotebookConf", model.CheckAuth, setNotebookConf)
	ginServer.Handle("POST", "/api/notebook/createNotebook", model.CheckAuth, createNotebook)
	ginServer.Handle("POST", "/api/notebook/removeNotebook", model.CheckAuth, removeNotebook)
	ginServer.Handle("POST", "/api/notebook/renameNotebook", model.CheckAuth, renameNotebook)
	ginServer.Handle("POST", "/api/notebook/changeSortNotebook", model.CheckAuth, changeSortNotebook)
	ginServer.Handle("POST", "/api/notebook/setNotebookIcon", model.CheckAuth, setNotebookIcon)

	ginServer.Handle("POST", "/api/filetree/searchDocs", model.CheckAuth, searchDocs)
	ginServer.Handle("POST", "/api/filetree/listDocsByPath", model.CheckAuth, listDocsByPath)
	ginServer.Handle("POST", "/api/filetree/getDoc", model.CheckAuth, getDoc)
	ginServer.Handle("POST", "/api/filetree/getDocNameTemplate", model.CheckAuth, getDocNameTemplate)
	ginServer.Handle("POST", "/api/filetree/changeSort", model.CheckAuth, changeSort)
	ginServer.Handle("POST", "/api/filetree/lockFile", model.CheckAuth, lockFile)
	ginServer.Handle("POST", "/api/filetree/createDocWithMd", model.CheckAuth, model.CheckReadonly, createDocWithMd)
	ginServer.Handle("POST", "/api/filetree/createDailyNote", model.CheckAuth, model.CheckReadonly, createDailyNote)
	ginServer.Handle("POST", "/api/filetree/createDoc", model.CheckAuth, model.CheckReadonly, createDoc)
	ginServer.Handle("POST", "/api/filetree/renameDoc", model.CheckAuth, model.CheckReadonly, renameDoc)
	ginServer.Handle("POST", "/api/filetree/removeDoc", model.CheckAuth, model.CheckReadonly, removeDoc)
	ginServer.Handle("POST", "/api/filetree/moveDoc", model.CheckAuth, model.CheckReadonly, moveDoc)
	ginServer.Handle("POST", "/api/filetree/duplicateDoc", model.CheckAuth, model.CheckReadonly, duplicateDoc)
	ginServer.Handle("POST", "/api/filetree/getHPathByPath", model.CheckAuth, getHPathByPath)
	ginServer.Handle("POST", "/api/filetree/getHPathByID", model.CheckAuth, getHPathByID)
	ginServer.Handle("POST", "/api/filetree/getFullHPathByID", model.CheckAuth, getFullHPathByID)
	ginServer.Handle("POST", "/api/filetree/doc2Heading", model.CheckAuth, model.CheckReadonly, doc2Heading)
	ginServer.Handle("POST", "/api/filetree/heading2Doc", model.CheckAuth, model.CheckReadonly, heading2Doc)
	ginServer.Handle("POST", "/api/filetree/li2Doc", model.CheckAuth, model.CheckReadonly, li2Doc)
	ginServer.Handle("POST", "/api/filetree/refreshFiletree", model.CheckAuth, model.CheckReadonly, refreshFiletree)

	ginServer.Handle("POST", "/api/format/autoSpace", model.CheckAuth, model.CheckReadonly, autoSpace)
	ginServer.Handle("POST", "/api/format/netImg2LocalAssets", model.CheckAuth, model.CheckReadonly, netImg2LocalAssets)

	ginServer.Handle("POST", "/api/history/getNotebookHistory", model.CheckAuth, getNotebookHistory)
	ginServer.Handle("POST", "/api/history/rollbackNotebookHistory", model.CheckAuth, rollbackNotebookHistory)
	ginServer.Handle("POST", "/api/history/getAssetsHistory", model.CheckAuth, getAssetsHistory)
	ginServer.Handle("POST", "/api/history/rollbackAssetsHistory", model.CheckAuth, rollbackAssetsHistory)
	ginServer.Handle("POST", "/api/history/getDocHistory", model.CheckAuth, getDocHistory)
	ginServer.Handle("POST", "/api/history/getDocHistoryContent", model.CheckAuth, getDocHistoryContent)
	ginServer.Handle("POST", "/api/history/rollbackDocHistory", model.CheckAuth, model.CheckReadonly, rollbackDocHistory)
	ginServer.Handle("POST", "/api/history/clearWorkspaceHistory", model.CheckAuth, model.CheckReadonly, clearWorkspaceHistory)

	ginServer.Handle("POST", "/api/outline/getDocOutline", model.CheckAuth, getDocOutline)
	ginServer.Handle("POST", "/api/bookmark/getBookmark", model.CheckAuth, getBookmark)
	ginServer.Handle("POST", "/api/bookmark/renameBookmark", model.CheckAuth, renameBookmark)
	ginServer.Handle("POST", "/api/tag/getTag", model.CheckAuth, getTag)
	ginServer.Handle("POST", "/api/tag/renameTag", model.CheckAuth, renameTag)
	ginServer.Handle("POST", "/api/tag/removeTag", model.CheckAuth, removeTag)

	ginServer.Handle("POST", "/api/lute/spinBlockDOM", model.CheckAuth, spinBlockDOM) // 未测试
	ginServer.Handle("POST", "/api/lute/html2BlockDOM", model.CheckAuth, html2BlockDOM)
	ginServer.Handle("POST", "/api/lute/copyStdMarkdown", model.CheckAuth, copyStdMarkdown)

	ginServer.Handle("POST", "/api/query/sql", model.CheckAuth, SQL)

	ginServer.Handle("POST", "/api/search/searchTag", model.CheckAuth, searchTag)
	ginServer.Handle("POST", "/api/search/searchTemplate", model.CheckAuth, searchTemplate)
	ginServer.Handle("POST", "/api/search/searchWidget", model.CheckAuth, searchWidget)
	ginServer.Handle("POST", "/api/search/searchRefBlock", model.CheckAuth, searchRefBlock)
	ginServer.Handle("POST", "/api/search/searchEmbedBlock", model.CheckAuth, searchEmbedBlock)
	ginServer.Handle("POST", "/api/search/fullTextSearchBlock", model.CheckAuth, fullTextSearchBlock)
	ginServer.Handle("POST", "/api/search/searchAsset", model.CheckAuth, searchAsset)
	ginServer.Handle("POST", "/api/search/findReplace", model.CheckAuth, findReplace)

	ginServer.Handle("POST", "/api/block/getBlockInfo", model.CheckAuth, getBlockInfo)
	ginServer.Handle("POST", "/api/block/getBlockDOM", model.CheckAuth, getBlockDOM)
	ginServer.Handle("POST", "/api/block/getBlockBreadcrumb", model.CheckAuth, getBlockBreadcrumb)
	ginServer.Handle("POST", "/api/block/getRefIDs", model.CheckAuth, getRefIDs)
	ginServer.Handle("POST", "/api/block/getRefIDsByFileAnnotationID", model.CheckAuth, getRefIDsByFileAnnotationID)
	ginServer.Handle("POST", "/api/block/getBlockDefIDsByRefText", model.CheckAuth, getBlockDefIDsByRefText)
	ginServer.Handle("POST", "/api/block/getRefText", model.CheckAuth, getRefText)
	ginServer.Handle("POST", "/api/block/getBlockWordCount", model.CheckAuth, getBlockWordCount)
	ginServer.Handle("POST", "/api/block/getRecentUpdatedBlocks", model.CheckAuth, getRecentUpdatedBlocks)
	ginServer.Handle("POST", "/api/block/getDocInfo", model.CheckAuth, getDocInfo)
	ginServer.Handle("POST", "/api/block/checkBlockExist", model.CheckAuth, checkBlockExist)
	ginServer.Handle("POST", "/api/block/checkBlockFold", model.CheckAuth, checkBlockFold)
	ginServer.Handle("POST", "/api/block/insertBlock", model.CheckAuth, insertBlock)
	ginServer.Handle("POST", "/api/block/prependBlock", model.CheckAuth, prependBlock)
	ginServer.Handle("POST", "/api/block/appendBlock", model.CheckAuth, appendBlock)
	ginServer.Handle("POST", "/api/block/updateBlock", model.CheckAuth, updateBlock)
	ginServer.Handle("POST", "/api/block/deleteBlock", model.CheckAuth, deleteBlock)
	ginServer.Handle("POST", "/api/block/setBlockReminder", model.CheckAuth, setBlockReminder)

	ginServer.Handle("POST", "/api/file/getFile", model.CheckAuth, getFile)
	ginServer.Handle("POST", "/api/file/putFile", model.CheckAuth, putFile)

	ginServer.Handle("POST", "/api/ref/refreshBacklink", model.CheckAuth, refreshBacklink)
	ginServer.Handle("POST", "/api/ref/getBacklink", model.CheckAuth, getBacklink)
	ginServer.Handle("POST", "/api/ref/createBacklink", model.CheckAuth, model.CheckReadonly, createBacklink)

	ginServer.Handle("POST", "/api/attr/getBookmarkLabels", model.CheckAuth, getBookmarkLabels)
	ginServer.Handle("POST", "/api/attr/resetBlockAttrs", model.CheckAuth, model.CheckReadonly, resetBlockAttrs)
	ginServer.Handle("POST", "/api/attr/setBlockAttrs", model.CheckAuth, model.CheckReadonly, setBlockAttrs)
	ginServer.Handle("POST", "/api/attr/getBlockAttrs", model.CheckAuth, getBlockAttrs)

	ginServer.Handle("POST", "/api/cloud/getCloudSpace", model.CheckAuth, getCloudSpace)

	ginServer.Handle("POST", "/api/backup/getLocalBackup", model.CheckAuth, getLocalBackup)
	ginServer.Handle("POST", "/api/backup/createLocalBackup", model.CheckAuth, model.CheckReadonly, createLocalBackup)
	ginServer.Handle("POST", "/api/backup/recoverLocalBackup", model.CheckAuth, model.CheckReadonly, recoverLocalBackup)
	ginServer.Handle("POST", "/api/backup/uploadLocalBackup", model.CheckAuth, model.CheckReadonly, uploadLocalBackup)
	ginServer.Handle("POST", "/api/backup/downloadCloudBackup", model.CheckAuth, model.CheckReadonly, downloadCloudBackup)
	ginServer.Handle("POST", "/api/backup/removeCloudBackup", model.CheckAuth, model.CheckReadonly, removeCloudBackup)

	ginServer.Handle("POST", "/api/sync/setSyncEnable", model.CheckAuth, setSyncEnable)
	ginServer.Handle("POST", "/api/sync/setCloudSyncDir", model.CheckAuth, setCloudSyncDir)
	ginServer.Handle("POST", "/api/sync/createCloudSyncDir", model.CheckAuth, model.CheckReadonly, createCloudSyncDir)
	ginServer.Handle("POST", "/api/sync/removeCloudSyncDir", model.CheckAuth, model.CheckReadonly, removeCloudSyncDir)
	ginServer.Handle("POST", "/api/sync/listCloudSyncDir", model.CheckAuth, listCloudSyncDir)
	ginServer.Handle("POST", "/api/sync/performSync", model.CheckAuth, performSync)
	ginServer.Handle("POST", "/api/sync/performBootSync", model.CheckAuth, performBootSync)
	ginServer.Handle("POST", "/api/sync/getBootSync", model.CheckAuth, getBootSync)
	ginServer.Handle("POST", "/api/sync/getSyncDirection", model.CheckAuth, getSyncDirection)

	ginServer.Handle("POST", "/api/inbox/getShorthands", model.CheckAuth, getShorthands)
	ginServer.Handle("POST", "/api/inbox/removeShorthands", model.CheckAuth, removeShorthands)

	ginServer.Handle("POST", "/api/extension/copy", model.CheckAuth, extensionCopy)

	ginServer.Handle("POST", "/api/clipboard/readFilePaths", model.CheckAuth, readFilePaths)

	ginServer.Handle("POST", "/api/asset/uploadCloud", model.CheckAuth, model.CheckReadonly, uploadCloud)
	ginServer.Handle("POST", "/api/asset/insertLocalAssets", model.CheckAuth, model.CheckReadonly, insertLocalAssets)
	ginServer.Handle("POST", "/api/asset/resolveAssetPath", model.CheckAuth, resolveAssetPath)
	ginServer.Handle("POST", "/api/asset/upload", model.CheckAuth, model.CheckReadonly, model.Upload)
	ginServer.Handle("POST", "/api/asset/setFileAnnotation", model.CheckAuth, model.CheckReadonly, setFileAnnotation)
	ginServer.Handle("POST", "/api/asset/getFileAnnotation", model.CheckAuth, getFileAnnotation)
	ginServer.Handle("POST", "/api/asset/getUnusedAssets", model.CheckAuth, getUnusedAssets)
	ginServer.Handle("POST", "/api/asset/removeUnusedAsset", model.CheckAuth, model.CheckReadonly, removeUnusedAsset)
	ginServer.Handle("POST", "/api/asset/removeUnusedAssets", model.CheckAuth, model.CheckReadonly, removeUnusedAssets)
	ginServer.Handle("POST", "/api/asset/getDocImageAssets", model.CheckAuth, model.CheckReadonly, getDocImageAssets)

	ginServer.Handle("POST", "/api/export/batchExportMd", model.CheckAuth, batchExportMd)
	ginServer.Handle("POST", "/api/export/exportMd", model.CheckAuth, exportMd)
	ginServer.Handle("POST", "/api/export/exportSY", model.CheckAuth, exportSY)
	ginServer.Handle("POST", "/api/export/exportMdContent", model.CheckAuth, exportMdContent)
	ginServer.Handle("POST", "/api/export/exportHTML", model.CheckAuth, exportHTML)
	ginServer.Handle("POST", "/api/export/exportMdHTML", model.CheckAuth, exportMdHTML)
	ginServer.Handle("POST", "/api/export/exportDocx", model.CheckAuth, exportDocx)
	ginServer.Handle("POST", "/api/export/addPDFOutline", model.CheckAuth, addPDFOutline)
	ginServer.Handle("POST", "/api/export/preview", model.CheckAuth, exportPreview)
	ginServer.Handle("POST", "/api/export/exportData", model.CheckAuth, exportData)
	ginServer.Handle("POST", "/api/export/exportDataInFolder", model.CheckAuth, exportDataInFolder)

	ginServer.Handle("POST", "/api/import/importStdMd", model.CheckAuth, model.CheckReadonly, importStdMd)
	ginServer.Handle("POST", "/api/import/importData", model.CheckAuth, model.CheckReadonly, importData)
	ginServer.Handle("POST", "/api/import/importSY", model.CheckAuth, model.CheckReadonly, importSY)

	ginServer.Handle("POST", "/api/template/render", model.CheckAuth, renderTemplate)
	ginServer.Handle("POST", "/api/template/docSaveAsTemplate", model.CheckAuth, docSaveAsTemplate)

	ginServer.Handle("POST", "/api/transactions", model.CheckAuth, model.CheckReadonly, performTransactions)

	ginServer.Handle("POST", "/api/setting/setAccount", model.CheckAuth, setAccount)
	ginServer.Handle("POST", "/api/setting/setEditor", model.CheckAuth, setEditor)
	ginServer.Handle("POST", "/api/setting/setExport", model.CheckAuth, setExport)
	ginServer.Handle("POST", "/api/setting/setFiletree", model.CheckAuth, setFiletree)
	ginServer.Handle("POST", "/api/setting/setSearch", model.CheckAuth, setSearch)
	ginServer.Handle("POST", "/api/setting/setKeymap", model.CheckAuth, setKeymap)
	ginServer.Handle("POST", "/api/setting/setAppearance", model.CheckAuth, setAppearance)
	ginServer.Handle("POST", "/api/setting/getCloudUser", model.CheckAuth, getCloudUser)
	ginServer.Handle("POST", "/api/setting/logoutCloudUser", model.CheckAuth, logoutCloudUser)
	ginServer.Handle("POST", "/api/setting/login2faCloudUser", model.CheckAuth, login2faCloudUser)
	ginServer.Handle("POST", "/api/setting/getCustomCSS", model.CheckAuth, getCustomCSS)
	ginServer.Handle("POST", "/api/setting/setCustomCSS", model.CheckAuth, setCustomCSS)
	ginServer.Handle("POST", "/api/setting/setEmoji", model.CheckAuth, setEmoji)
	ginServer.Handle("POST", "/api/setting/setSearchCaseSensitive", model.CheckAuth, setSearchCaseSensitive)

	ginServer.Handle("POST", "/api/graph/resetGraph", model.CheckAuth, resetGraph)
	ginServer.Handle("POST", "/api/graph/resetLocalGraph", model.CheckAuth, resetLocalGraph)
	ginServer.Handle("POST", "/api/graph/getGraph", model.CheckAuth, getGraph)
	ginServer.Handle("POST", "/api/graph/getLocalGraph", model.CheckAuth, getLocalGraph)

	ginServer.Handle("POST", "/api/bazaar/getBazaarWidget", model.CheckAuth, getBazaarWidget)
	ginServer.Handle("POST", "/api/bazaar/installBazaarWidget", model.CheckAuth, installBazaarWidget)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarWidget", model.CheckAuth, uninstallBazaarWidget)
	ginServer.Handle("POST", "/api/bazaar/getBazaarIcon", model.CheckAuth, getBazaarIcon)
	ginServer.Handle("POST", "/api/bazaar/installBazaarIcon", model.CheckAuth, installBazaarIcon)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarIcon", model.CheckAuth, uninstallBazaarIcon)
	ginServer.Handle("POST", "/api/bazaar/getBazaarTemplate", model.CheckAuth, getBazaarTemplate)
	ginServer.Handle("POST", "/api/bazaar/installBazaarTemplate", model.CheckAuth, installBazaarTemplate)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarTemplate", model.CheckAuth, uninstallBazaarTemplate)
	ginServer.Handle("POST", "/api/bazaar/getBazaarTheme", model.CheckAuth, getBazaarTheme)
	ginServer.Handle("POST", "/api/bazaar/installBazaarTheme", model.CheckAuth, installBazaarTheme)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarTheme", model.CheckAuth, uninstallBazaarTheme)
	ginServer.Handle("POST", "/api/bazaar/getBazaarPackageREAME", model.CheckAuth, getBazaarPackageREAME)
}
