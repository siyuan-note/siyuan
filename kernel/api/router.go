// SiYuan - From thought to insight, with agents
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
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
)

func ServeAPI(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/map/getConf", contractRouteHandlers(apicontract.MapGetConf, getMapConf)...)
	ginServer.Handle("POST", "/api/map/setConf", contractRouteHandlers(apicontract.MapSetConf, setMapConf)...)
	ginServer.Handle("POST", "/api/map/getRuntime", contractRouteHandlers(apicontract.MapGetRuntime, getMapRuntime)...)
	ginServer.Use(boxLeaseMiddleware)
	registerOauthRoutes(ginServer)
	registerMcpRoutes(ginServer)
	registerSystemRoutes(ginServer)
	registerAiRoutes(ginServer)
	registerIconRoutes(ginServer)
	registerStorageRoutes(ginServer)
	registerAccountRoutes(ginServer)
	registerNotebookRoutes(ginServer)
	registerFiletreeRoutes(ginServer)
	registerFormatRoutes(ginServer)
	registerHistoryRoutes(ginServer)
	registerOutlineRoutes(ginServer)
	registerBookmarkRoutes(ginServer)
	registerTagRoutes(ginServer)
	registerLuteRoutes(ginServer)
	registerQueryRoutes(ginServer)
	registerSqliteRoutes(ginServer)
	registerSearchRoutes(ginServer)
	registerBlockRoutes(ginServer)
	registerFileRoutes(ginServer)
	registerRefRoutes(ginServer)
	registerAttrRoutes(ginServer)
	registerCloudRoutes(ginServer)
	registerSyncRoutes(ginServer)
	registerInboxRoutes(ginServer)
	registerExtensionRoutes(ginServer)
	registerClipboardRoutes(ginServer)
	registerAssetRoutes(ginServer)
	registerExportRoutes(ginServer)
	registerImportRoutes(ginServer)
	registerConvertRoutes(ginServer)
	registerTemplateRoutes(ginServer)
	registerTransactionsRoutes(ginServer)
	registerSettingRoutes(ginServer)
	registerGraphRoutes(ginServer)
	registerBazaarRoutes(ginServer)
	registerRepoRoutes(ginServer)
	registerRiffRoutes(ginServer)
	registerNotificationRoutes(ginServer)
	registerSnippetRoutes(ginServer)
	registerAvRoutes(ginServer)
	registerPetalRoutes(ginServer)
	registerPluginRoutes(ginServer)
	registerNetworkRoutes(ginServer)
	registerBroadcastRoutes(ginServer)
	registerArchiveRoutes(ginServer)
	registerUiRoutes(ginServer)
}

func deprecatedResponse(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	msg := fmt.Sprintf("[%s] is deprecated, visit [https://github.com/siyuan-note/siyuan/issues/15727] for details",
		c.Request.RequestURI)
	logging.LogWarn(msg)

	return apicontract.Failure[apicontract.Null](-1, msg)
}

var resetBlockAttrs = contractHandler(apicontract.ResetBlockAttrs, deprecatedResponse)

var searchAttributeViewNonRelationKey = contractHandler(apicontract.SearchAttributeViewNonRelationKey, deprecatedResponse)

var setLocalStorage = contractHandler(apicontract.SetLocalStorage, deprecatedResponse)

var deprecatedReloadUI = contractHandler(apicontract.DeprecatedReloadUI, deprecatedResponse)

// registerOauthRoutes 注册本域的契约路由。
func registerOauthRoutes(ginServer *gin.Engine) {
	ginServer.GET("/.well-known/oauth-protected-resource/mcp", contractRouteHandlers(apicontract.MCPOAuthResource, mcpOAuthResource)...)
	ginServer.GET("/.well-known/oauth-protected-resource", contractRouteHandlers(apicontract.MCPOAuthResourceRoot, mcpOAuthResourceRoot)...)
	ginServer.GET("/.well-known/oauth-authorization-server", contractRouteHandlers(apicontract.MCPOAuthMetadata, mcpOAuthMetadata)...)
	ginServer.GET("/oauth/mcp/authorize", contractRouteHandlers(apicontract.MCPOAuthAuthorize, mcpOAuthServerAuthorize)...)
	ginServer.POST("/oauth/mcp/consent", contractRouteHandlers(apicontract.MCPOAuthConsent, mcpOAuthConsent)...)
	ginServer.POST("/oauth/mcp/token", contractRouteHandlers(apicontract.MCPOAuthToken, mcpOAuthToken)...)
	ginServer.POST("/oauth/mcp/revoke", contractRouteHandlers(apicontract.MCPOAuthRevoke, mcpOAuthRevoke)...)
}

// registerMcpRoutes 注册本域的契约路由。
func registerMcpRoutes(ginServer *gin.Engine) {
	ginServer.POST("/api/mcp/getOAuth", contractRouteHandlers(apicontract.MCPOAuthGet, mcpOAuthGet)...)
	ginServer.POST("/api/mcp/setOAuth", contractRouteHandlers(apicontract.MCPOAuthSet, mcpOAuthSet)...)
	ginServer.POST("/api/mcp/addOAuthClient", contractRouteHandlers(apicontract.MCPOAuthAddClient, mcpOAuthAddClient)...)
	ginServer.POST("/api/mcp/removeOAuthClient", contractRouteHandlers(apicontract.MCPOAuthRemoveClient, mcpOAuthRemoveClient)...)
}

// registerSystemRoutes 注册本域的契约路由。
func registerSystemRoutes(ginServer *gin.Engine) {
	ginServer.Handle("GET", "/api/system/bootProgress", contractRouteHandlers(apicontract.BootProgress, bootProgress)...)
	ginServer.Handle("POST", "/api/system/bootProgress", contractRouteHandlers(apicontract.BootProgress, bootProgress)...)
	ginServer.Handle("GET", "/api/system/bootProgressSSE", contractRouteHandlers(apicontract.SystemBootProgressSSE, bootProgressSSE)...)
	ginServer.Handle("GET", "/api/system/getBootAppearance", contractRouteHandlers(apicontract.SystemGetBootAppearance, getBootAppearance)...)
	ginServer.Handle("GET", "/api/system/version", contractRouteHandlers(apicontract.Version, version)...)
	ginServer.Handle("POST", "/api/system/version", contractRouteHandlers(apicontract.Version, version)...)
	ginServer.Handle("POST", "/api/system/currentTime", contractRouteHandlers(apicontract.CurrentTime, currentTime)...)
	ginServer.Handle("POST", "/api/system/loginAuth", contractRouteHandlers(apicontract.SystemLoginAuth, loginAuth)...)
	ginServer.Handle("POST", "/api/system/logoutAuth", contractRouteHandlers(apicontract.SystemLogoutAuth, logoutAuth)...)
	ginServer.Handle("GET", "/api/system/getCaptcha", contractRouteHandlers(apicontract.SystemGetCaptcha, getCaptcha)...)
	ginServer.Handle("POST", "/api/system/oidc/start", contractRouteHandlers(apicontract.SystemOIDCStart, oidcStart)...)
	ginServer.Handle("GET", "/api/system/oidc/callback", contractRouteHandlers(apicontract.SystemOIDCCallback, oidcCallback)...)
	ginServer.Handle("POST", "/api/system/oidc/mobileCallback", contractRouteHandlers(apicontract.SystemOIDCMobileCallback, oidcMobileCallback)...)
	ginServer.Handle("POST", "/api/system/oidc/poll", contractRouteHandlers(apicontract.SystemOIDCPoll, oidcPoll)...)
	ginServer.Handle("POST", "/api/system/oidc/validatePoll", contractRouteHandlers(apicontract.SystemOIDCValidatePoll, oidcValidatePoll)...)
	ginServer.Handle("POST", "/api/system/getEmojiConf", contractRouteHandlers(apicontract.SystemGetEmojiConf, getEmojiConf)...)
	ginServer.Handle("POST", "/api/system/addCustomEmoji", contractRouteHandlers(apicontract.SystemAddCustomEmoji, addCustomEmoji)...)
	ginServer.Handle("POST", "/api/system/setAPIToken", contractRouteHandlers(apicontract.SystemSetAPIToken, setAPIToken)...)
	ginServer.Handle("POST", "/api/system/setAccessAuthCode", contractRouteHandlers(apicontract.SystemSetAccessAuthCode, setAccessAuthCode)...)
	ginServer.Handle("POST", "/api/system/setOIDC", contractRouteHandlers(apicontract.SystemSetOIDC, setOIDC)...)
	ginServer.Handle("POST", "/api/system/oidc/validate", contractRouteHandlers(apicontract.SystemOIDCValidateStart, oidcValidateStart)...)
	ginServer.Handle("POST", "/api/system/oidc/validateActivate", contractRouteHandlers(apicontract.SystemOIDCValidateActivate, oidcValidateActivate)...)
	ginServer.Handle("POST", "/api/system/oidc/validateCancel", contractRouteHandlers(apicontract.SystemOIDCValidateCancel, oidcValidateCancel)...)
	ginServer.Handle("POST", "/api/system/setFollowSystemLockScreen", contractRouteHandlers(apicontract.SetFollowSystemLockScreen, setFollowSystemLockScreen)...)
	ginServer.Handle("POST", "/api/system/setNetworkServe", contractRouteHandlers(apicontract.SetNetworkServe, setNetworkServe)...)
	ginServer.Handle("POST", "/api/system/setNetworkServeTLS", contractRouteHandlers(apicontract.SetNetworkServeTLS, setNetworkServeTLS)...)
	ginServer.Handle("POST", "/api/system/exportTLSCACert", contractRouteHandlers(apicontract.SystemExportTLSCACert, exportTLSCACert)...)
	ginServer.Handle("POST", "/api/system/exportTLSCABundle", contractRouteHandlers(apicontract.SystemExportTLSCABundle, exportTLSCABundle)...)
	ginServer.Handle("POST", "/api/system/importTLSCABundle", contractRouteHandlers(apicontract.SystemImportTLSCABundle, importTLSCABundle)...)
	ginServer.Handle("POST", "/api/system/setAutoLaunch", contractRouteHandlers(apicontract.SetAutoLaunch, setAutoLaunch)...)
	ginServer.Handle("POST", "/api/system/setDownloadInstallPkg", contractRouteHandlers(apicontract.SetDownloadInstallPkg, setDownloadInstallPkg)...)
	ginServer.Handle("POST", "/api/system/setSettingsWindow", contractRouteHandlers(apicontract.SetSettingsWindow, setSettingsWindow)...)
	ginServer.Handle("POST", "/api/system/setUpdateChannel", contractRouteHandlers(apicontract.SetUpdateChannel, setUpdateChannel)...)
	ginServer.Handle("POST", "/api/system/setNetworkProxy", contractRouteHandlers(apicontract.SetNetworkProxy, setNetworkProxy)...)
	ginServer.Handle("POST", "/api/system/setWorkspaceDir", contractRouteHandlers(apicontract.SystemSetWorkspaceDir, setWorkspaceDir)...)
	ginServer.Handle("POST", "/api/system/getWorkspaces", contractRouteHandlers(apicontract.SystemGetWorkspaces, getWorkspaces)...)
	ginServer.Handle("POST", "/api/system/getMobileWorkspaces", contractRouteHandlers(apicontract.SystemGetMobileWorkspaces, getMobileWorkspaces)...)
	ginServer.Handle("POST", "/api/system/checkWorkspaceDir", contractRouteHandlers(apicontract.SystemCheckWorkspaceDir, checkWorkspaceDir)...)
	ginServer.Handle("POST", "/api/system/createWorkspaceDir", contractRouteHandlers(apicontract.SystemCreateWorkspaceDir, createWorkspaceDir)...)
	ginServer.Handle("POST", "/api/system/removeWorkspaceDir", contractRouteHandlers(apicontract.SystemRemoveWorkspaceDir, removeWorkspaceDir)...)
	ginServer.Handle("POST", "/api/system/removeWorkspaceDirPhysically", contractRouteHandlers(apicontract.SystemRemoveWorkspaceDirPhysically, removeWorkspaceDirPhysically)...)
	ginServer.Handle("POST", "/api/system/setAppearanceMode", contractRouteHandlers(apicontract.SystemSetAppearanceMode, setAppearanceMode)...)
	ginServer.Handle("POST", "/api/system/setUILayout", contractRouteHandlers(apicontract.SystemSetUILayout, setUILayout)...)
	ginServer.Handle("POST", "/api/system/getSysFonts", contractRouteHandlers(apicontract.SystemGetSysFonts, getSysFonts)...)
	ginServer.Handle("POST", "/api/system/getCustomFonts", contractRouteHandlers(apicontract.SystemGetCustomFonts, getCustomFonts)...)
	ginServer.Handle("POST", "/api/system/importCustomFont", contractRouteHandlers(apicontract.SystemImportCustomFont, importCustomFont)...)
	ginServer.Handle("POST", "/api/system/removeCustomFont", contractRouteHandlers(apicontract.SystemRemoveCustomFont, removeCustomFont)...)
	ginServer.Handle("POST", "/api/system/exit", contractRouteHandlers(apicontract.SystemExit, exit)...)
	ginServer.Handle("POST", "/api/system/uiproc", contractRouteHandlers(apicontract.SystemAddUIProcess, addUIProcess)...)
	ginServer.Handle("POST", "/api/system/getConf", contractRouteHandlers(apicontract.SystemGetConf, getConf)...)
	ginServer.Handle("POST", "/api/system/ensureOnboarding", contractRouteHandlers(apicontract.SystemEnsureOnboarding, ensureOnboarding)...)
	ginServer.Handle("POST", "/api/system/dismissOnboarding", contractRouteHandlers(apicontract.SystemDismissOnboarding, dismissOnboarding)...)
	ginServer.Handle("POST", "/api/system/checkUpdate", contractRouteHandlers(apicontract.SystemCheckUpdate, checkUpdate)...)
	ginServer.Handle("POST", "/api/system/exportLog", contractRouteHandlers(apicontract.SystemExportLog, exportLog)...)
	ginServer.Handle("POST", "/api/system/appendKeyboardLog", contractRouteHandlers(apicontract.SystemAppendKeyboardLog, appendKeyboardLog)...)
	ginServer.Handle("POST", "/api/system/getChangelog", contractRouteHandlers(apicontract.SystemGetChangelog, getChangelog)...)
	ginServer.Handle("POST", "/api/system/getNetwork", contractRouteHandlers(apicontract.GetNetwork, getNetwork)...)
	ginServer.Handle("POST", "/api/system/exportConf", contractRouteHandlers(apicontract.SystemExportConf, exportConf)...)
	ginServer.Handle("POST", "/api/system/importConf", contractRouteHandlers(apicontract.SystemImportConf, importConf)...)
	ginServer.Handle("POST", "/api/system/getWorkspaceInfo", contractRouteHandlers(apicontract.GetWorkspaceInfo, getWorkspaceInfo)...)
	ginServer.Handle("POST", "/api/system/getWorkspaceStorage", contractRouteHandlers(apicontract.GetWorkspaceStorage, getWorkspaceStorage)...)
	ginServer.Handle("POST", "/api/system/getRuntimeInfo", contractRouteHandlers(apicontract.GetRuntimeInfo, getRuntimeInfo)...)
	ginServer.Handle("POST", "/api/system/reloadUI", contractRouteHandlers(apicontract.DeprecatedReloadUI, deprecatedReloadUI)...)
	ginServer.Handle("POST", "/api/system/addMicrosoftDefenderExclusion", contractRouteHandlers(apicontract.AddMicrosoftDefenderExclusion, addMicrosoftDefenderExclusion)...)
	ginServer.Handle("POST", "/api/system/ignoreAddMicrosoftDefenderExclusion", contractRouteHandlers(apicontract.IgnoreAddMicrosoftDefenderExclusion, ignoreAddMicrosoftDefenderExclusion)...)
	ginServer.Handle("POST", "/api/system/vacuumDataIndex", contractRouteHandlers(apicontract.VacuumDataIndex, vacuumDataIndex)...)
	ginServer.Handle("POST", "/api/system/clearTempFiles", contractRouteHandlers(apicontract.ClearTempFiles, clearTempFiles)...)
	ginServer.Handle("POST", "/api/system/rebuildDataIndex", contractRouteHandlers(apicontract.RebuildDataIndex, rebuildDataIndex)...)
}

// registerAiRoutes 注册本域的契约路由。
func registerAiRoutes(ginServer *gin.Engine) {
	ginServer.Handle("GET", "/api/ai/mcp/oauth/callback/:flowID", contractRouteHandlers(apicontract.AIMCPOAuthCallback, mcpOAuthCallback)...)
	ginServer.Handle("POST", "/api/ai/chatGPT", contractRouteHandlers(apicontract.AIChatGPT, chatGPT)...)
	ginServer.Handle("POST", "/api/ai/ocr", contractRouteHandlers(apicontract.AIOCR, aiOCR)...)
	ginServer.Handle("POST", "/api/ai/chatGPTWithAction", contractRouteHandlers(apicontract.AIChatGPTWithAction, chatGPTWithAction)...)
	ginServer.Handle("POST", "/api/ai/editor/chat", contractRouteHandlers(apicontract.AIEditorChat, aiEditorChat)...)
	ginServer.Handle("POST", "/api/ai/editor/lsActions", contractRouteHandlers(apicontract.AIListEditorActions, lsAIEditorActions)...)
	ginServer.Handle("POST", "/api/ai/editor/saveAction", contractRouteHandlers(apicontract.AISaveEditorAction, saveAIEditorAction)...)
	ginServer.Handle("POST", "/api/ai/editor/removeAction", contractRouteHandlers(apicontract.AIRemoveEditorAction, removeAIEditorAction)...)
	ginServer.Handle("POST", "/api/ai/testModel", contractRouteHandlers(apicontract.AITestModel, testModel)...)
	ginServer.Handle("POST", "/api/ai/testEmbeddingModel", contractRouteHandlers(apicontract.AITestEmbeddingModel, testEmbeddingModel)...)
	ginServer.Handle("POST", "/api/ai/testRerankModel", contractRouteHandlers(apicontract.AITestRerankModel, testRerankModel)...)
	ginServer.Handle("POST", "/api/ai/testDecisionModel", contractRouteHandlers(apicontract.AITestDecisionModel, testDecisionModel)...)
	ginServer.Handle("POST", "/api/ai/listModels", contractRouteHandlers(apicontract.AIListModels, listModels)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/accounts", contractRouteHandlers(apicontract.ChatGPTAccounts, chatGPTAccounts)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/start", contractRouteHandlers(apicontract.ChatGPTStart, chatGPTStart)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/status", contractRouteHandlers(apicontract.ChatGPTStatus, chatGPTStatus)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/cancel", contractRouteHandlers(apicontract.ChatGPTCancel, chatGPTCancel)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/logout", contractRouteHandlers(apicontract.ChatGPTLogout, chatGPTLogout)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/remove", contractRouteHandlers(apicontract.ChatGPTRemove, chatGPTRemove)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/export", contractRouteHandlers(apicontract.ChatGPTExport, chatGPTExport)...)
	ginServer.Handle("POST", "/api/ai/chatgpt/import", contractRouteHandlers(apicontract.ChatGPTImport, chatGPTImport)...)
	ginServer.Handle("POST", "/api/ai/embeddingStat", contractRouteHandlers(apicontract.AIGetEmbeddingStat, embeddingStat)...)
	ginServer.Handle("POST", "/api/ai/mcpStatus", contractRouteHandlers(apicontract.AIGetMCPStatus, mcpStatus)...)
	ginServer.Handle("POST", "/api/ai/mcpEnvironmentVariables", contractRouteHandlers(apicontract.AIGetMCPEnvironment, mcpEnvironmentVariables)...)
	ginServer.Handle("POST", "/api/ai/mcpOAuthAuthorize", contractRouteHandlers(apicontract.AIMCPOAuthAuthorize, mcpOAuthAuthorize)...)
	ginServer.Handle("POST", "/api/ai/mcpOAuthDisconnect", contractRouteHandlers(apicontract.AIMCPOAuthDisconnect, mcpOAuthDisconnect)...)
	ginServer.Handle("POST", "/api/ai/reindexEmbedding", contractRouteHandlers(apicontract.AIReindexEmbedding, reindexEmbedding)...)
	ginServer.Handle("POST", "/api/ai/retryFailedEmbedding", contractRouteHandlers(apicontract.AIRetryFailedEmbedding, retryFailedEmbedding)...)
	ginServer.Handle("POST", "/api/ai/agent/chat", contractRouteHandlers(apicontract.AIAgentChat, agentChat)...)
	ginServer.Handle("POST", "/api/ai/agent/confirm", contractRouteHandlers(apicontract.AIAgentConfirm, agentChatConfirm)...)
	ginServer.Handle("POST", "/api/ai/agent/setPermission", contractRouteHandlers(apicontract.AIAgentSetPermission, setAgentSessionPermission)...)
	ginServer.Handle("POST", "/api/ai/agent/question", contractRouteHandlers(apicontract.AIAgentQuestion, agentChatQuestion)...)
	ginServer.Handle("POST", "/api/ai/agent/browserCapabilityResult", contractRouteHandlers(apicontract.AIAgentBrowserCapabilityResult, agentChatBrowserCapabilityResult)...)
	ginServer.Handle("POST", "/api/ai/lsCapabilities", contractRouteHandlers(apicontract.AIListCapabilities, lsCapabilities)...)
	ginServer.Handle("POST", "/api/ai/agent/title", contractRouteHandlers(apicontract.AIAgentTitle, agentChatTitle)...)
	ginServer.Handle("POST", "/api/ai/agent/lsSessions", contractRouteHandlers(apicontract.AIListSessions, lsSessions)...)
	ginServer.Handle("POST", "/api/ai/agent/getSession", contractRouteHandlers(apicontract.AIGetSession, getSession)...)
	ginServer.Handle("POST", "/api/ai/agent/saveSession", contractRouteHandlers(apicontract.AISaveSession, saveSession)...)
	ginServer.Handle("POST", "/api/ai/agent/removeSession", contractRouteHandlers(apicontract.AIRemoveSession, removeSession)...)
	ginServer.Handle("POST", "/api/ai/agent/lsSkills", contractRouteHandlers(apicontract.AIListSkills, lsSkills)...)
	ginServer.Handle("POST", "/api/ai/agent/getInstructions", contractRouteHandlers(apicontract.AIGetAgentInstructions, getAgentInstructions)...)
	ginServer.Handle("POST", "/api/ai/agent/setInstructions", contractRouteHandlers(apicontract.AISetAgentInstructions, setAgentInstructions)...)
	ginServer.Handle("POST", "/api/ai/agent/manageSkills", contractRouteHandlers(apicontract.AIManageSkills, manageSkills)...)
	ginServer.Handle("POST", "/api/ai/agent/lsUserSkills", contractRouteHandlers(apicontract.AIListUserSkills, lsUserSkills)...)
	ginServer.Handle("POST", "/api/ai/agent/lsBuiltinSkills", contractRouteHandlers(apicontract.AIListBuiltinSkills, lsBuiltinSkills)...)
	ginServer.Handle("POST", "/api/ai/agent/getSkill", contractRouteHandlers(apicontract.AIGetSkill, getSkill)...)
	ginServer.Handle("POST", "/api/ai/agent/saveSkill", contractRouteHandlers(apicontract.AISaveSkill, saveSkill)...)
	ginServer.Handle("POST", "/api/ai/agent/removeSkill", contractRouteHandlers(apicontract.AIRemoveSkill, removeSkill)...)
	ginServer.Handle("POST", "/api/ai/agent/renameSkill", contractRouteHandlers(apicontract.AIRenameSkill, renameSkill)...)
}

// registerIconRoutes 注册本域的契约路由。
func registerIconRoutes(ginServer *gin.Engine) {
	ginServer.Handle("GET", "/api/icon/getDynamicIcon", contractRouteHandlers(apicontract.GetDynamicIcon, getDynamicIcon)...)
}

// registerStorageRoutes 注册本域的契约路由。
func registerStorageRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/storage/getLocalStorage", contractRouteHandlers(apicontract.GetLocalStorage, getLocalStorage)...)
	ginServer.Handle("POST", "/api/storage/getLocalStorageVal", contractRouteHandlers(apicontract.GetLocalStorageVal, getLocalStorageVal)...)
	ginServer.Handle("POST", "/api/storage/getLocalStorageVals", contractRouteHandlers(apicontract.GetLocalStorageVals, getLocalStorageVals)...)
	ginServer.Handle("POST", "/api/storage/setLocalStorage", contractRouteHandlers(apicontract.SetLocalStorage, setLocalStorage)...)
	ginServer.Handle("POST", "/api/storage/setLocalStorageVal", contractRouteHandlers(apicontract.SetLocalStorageVal, setLocalStorageVal)...)
	ginServer.Handle("POST", "/api/storage/setLocalStorageVals", contractRouteHandlers(apicontract.SetLocalStorageVals, setLocalStorageVals)...)
	ginServer.Handle("POST", "/api/storage/removeLocalStorageVal", contractRouteHandlers(apicontract.RemoveLocalStorageVal, removeLocalStorageVal)...)
	ginServer.Handle("POST", "/api/storage/removeLocalStorageVals", contractRouteHandlers(apicontract.RemoveLocalStorageVals, removeLocalStorageVals)...)
	ginServer.Handle("POST", "/api/storage/getInlineStyles", contractRouteHandlers(apicontract.GetInlineStyles, getInlineStyles)...)
	ginServer.Handle("POST", "/api/storage/setInlineStyles", contractRouteHandlers(apicontract.SetInlineStyles, setInlineStyles)...)
	ginServer.Handle("POST", "/api/storage/setWorkspaceAVPalette", contractRouteHandlers(apicontract.SetWorkspaceAVPalette, setWorkspaceAVPalette)...)
	ginServer.Handle("POST", "/api/storage/getCriteria", contractRouteHandlers(apicontract.GetCriteria, getCriteria)...)
	ginServer.Handle("POST", "/api/storage/setCriterion", contractRouteHandlers(apicontract.SetCriterion, setCriterion)...)
	ginServer.Handle("POST", "/api/storage/removeCriterion", contractRouteHandlers(apicontract.RemoveCriterion, removeCriterion)...)
	ginServer.Handle("POST", "/api/storage/getRecentDocs", contractRouteHandlers(apicontract.GetRecentDocs, getRecentDocs)...)
	ginServer.Handle("POST", "/api/storage/updateRecentDocOpenTime", contractRouteHandlers(apicontract.UpdateRecentDocOpenTime, updateRecentDocOpenTime)...)
	ginServer.Handle("POST", "/api/storage/updateRecentDocViewTime", contractRouteHandlers(apicontract.UpdateRecentDocViewTime, updateRecentDocViewTime)...)
	ginServer.Handle("POST", "/api/storage/updateRecentDocCloseTime", contractRouteHandlers(apicontract.UpdateRecentDocCloseTime, updateRecentDocCloseTime)...)
	ginServer.Handle("POST", "/api/storage/batchUpdateRecentDocCloseTime", contractRouteHandlers(apicontract.BatchUpdateRecentDocCloseTime, batchUpdateRecentDocCloseTime)...)
	ginServer.Handle("POST", "/api/storage/getOutlineStorage", contractRouteHandlers(apicontract.GetOutlineStorage, getOutlineStorage)...)
	ginServer.Handle("POST", "/api/storage/setOutlineStorage", contractRouteHandlers(apicontract.SetOutlineStorage, setOutlineStorage)...)
	ginServer.Handle("POST", "/api/storage/removeOutlineStorage", contractRouteHandlers(apicontract.RemoveOutlineStorage, removeOutlineStorage)...)
	ginServer.Handle("POST", "/api/storage/getViewState", contractRouteHandlers(apicontract.GetViewState, getViewState)...)
	ginServer.Handle("POST", "/api/storage/patchViewState", contractRouteHandlers(apicontract.PatchViewState, patchViewState)...)
	ginServer.Handle("POST", "/api/storage/removeViewState", contractRouteHandlers(apicontract.RemoveViewState, removeViewState)...)
}

// registerAccountRoutes 注册本域的契约路由。
func registerAccountRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/account/login", contractRouteHandlers(apicontract.AccountLogin, login)...)
	ginServer.Handle("POST", "/api/account/checkActivationcode", contractRouteHandlers(apicontract.CheckActivationCode, checkActivationcode)...)
	ginServer.Handle("POST", "/api/account/useActivationcode", contractRouteHandlers(apicontract.UseActivationCode, useActivationcode)...)
	ginServer.Handle("POST", "/api/account/deactivate", contractRouteHandlers(apicontract.DeactivateUser, deactivateUser)...)
	ginServer.Handle("POST", "/api/account/startFreeTrial", contractRouteHandlers(apicontract.StartFreeTrial, startFreeTrial)...)
}

// registerNotebookRoutes 注册本域的契约路由。
func registerNotebookRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/notebook/lsNotebooks", contractRouteHandlers(apicontract.ListNotebooks, lsNotebooks)...)
	ginServer.Handle("POST", "/api/notebook/openNotebook", contractRouteHandlers(apicontract.OpenNotebook, openNotebook)...)
	ginServer.Handle("POST", "/api/notebook/closeNotebook", contractRouteHandlers(apicontract.CloseNotebook, closeNotebook)...)
	ginServer.Handle("POST", "/api/notebook/getNotebookConf", contractRouteHandlers(apicontract.GetNotebookConf, getNotebookConf)...)
	ginServer.Handle("POST", "/api/notebook/setNotebookConf", contractRouteHandlers(apicontract.SetNotebookConf, setNotebookConf)...)
	ginServer.Handle("POST", "/api/notebook/createNotebook", contractRouteHandlers(apicontract.CreateNotebook, createNotebook)...)
	ginServer.Handle("POST", "/api/notebook/removeNotebook", contractRouteHandlers(apicontract.RemoveNotebook, removeNotebook)...)
	ginServer.Handle("POST", "/api/notebook/renameNotebook", contractRouteHandlers(apicontract.RenameNotebook, renameNotebook)...)
	ginServer.Handle("POST", "/api/notebook/changeSortNotebook", contractRouteHandlers(apicontract.ChangeSortNotebook, changeSortNotebook)...)
	ginServer.Handle("POST", "/api/notebook/reorder", contractRouteHandlers(apicontract.ReorderNotebooks, reorderNotebooks)...)
	ginServer.Handle("POST", "/api/notebook/setNotebookIcon", contractRouteHandlers(apicontract.SetNotebookIcon, setNotebookIcon)...)
	ginServer.Handle("POST", "/api/notebook/getNotebookInfo", contractRouteHandlers(apicontract.GetNotebookInfo, getNotebookInfo)...)
	ginServer.Handle("POST", "/api/notebook/enableEncryptedNotebooks", contractRouteHandlers(apicontract.EnableEncryptedNotebooks, enableEncryptedNotebooks)...)
	ginServer.Handle("POST", "/api/notebook/disableEncryptedNotebooks", contractRouteHandlers(apicontract.DisableEncryptedNotebooks, disableEncryptedNotebooks)...)
	ginServer.Handle("POST", "/api/notebook/createEncryptedNotebook", contractRouteHandlers(apicontract.CreateEncryptedNotebook, createEncryptedNotebook)...)
	ginServer.Handle("POST", "/api/notebook/unlockNotebook", contractRouteHandlers(apicontract.UnlockNotebook, unlockNotebook)...)
	ginServer.Handle("POST", "/api/notebook/lockNotebook", contractRouteHandlers(apicontract.LockNotebook, lockNotebook)...)
	ginServer.Handle("POST", "/api/notebook/unlockAndOpenNotebook", contractRouteHandlers(apicontract.UnlockAndOpenNotebook, unlockAndOpenNotebook)...)
	ginServer.Handle("POST", "/api/notebook/changeMasterPassword", contractRouteHandlers(apicontract.ChangeMasterPassword, changeMasterPassword)...)
	ginServer.Handle("POST", "/api/notebook/getEncryptedNotebookStatus", contractRouteHandlers(apicontract.GetEncryptedNotebookStatus, getEncryptedNotebookStatus)...)
	ginServer.Handle("POST", "/api/notebook/exportNotebookCryptoBackup", contractRouteHandlers(apicontract.ExportNotebookCryptoBackup, exportNotebookCryptoBackup)...)
	ginServer.Handle("POST", "/api/notebook/importNotebookCryptoBackup", contractRouteHandlers(apicontract.ImportNotebookCryptoBackup, importNotebookCryptoBackup)...)
	ginServer.Handle("POST", "/api/notebook/getNotebookArchiveCandidates", contractRouteHandlers(apicontract.GetNotebookArchiveCandidates, getNotebookArchiveCandidates)...)
	ginServer.Handle("POST", "/api/notebook/prepareNotebookArchive", contractRouteHandlers(apicontract.PrepareNotebookArchive, prepareNotebookArchive)...)
	ginServer.Handle("POST", "/api/notebook/commitNotebookArchive", contractRouteHandlers(apicontract.CommitNotebookArchive, commitNotebookArchive)...)
	ginServer.Handle("POST", "/api/notebook/importNotebookArchive", contractRouteHandlers(apicontract.ImportNotebookArchive, importNotebookArchive)...)
	ginServer.Handle("POST", "/api/notebook/setNotebookCryptoAutoLock", contractRouteHandlers(apicontract.SetNotebookCryptoAutoLock, setNotebookCryptoAutoLock)...)
	ginServer.Handle("POST", "/api/notebook/setEncryptedNotebookFollowSystemLock", contractRouteHandlers(apicontract.SetEncryptedNotebookFollowSystemLock, setEncryptedNotebookFollowSystemLock)...)
	ginServer.Handle("POST", "/api/notebook/lockEncryptedNotebooksOnSystemLock", contractRouteHandlers(apicontract.LockEncryptedNotebooksOnSystemLock, lockEncryptedNotebooksOnSystemLock)...)
	ginServer.Handle("POST", "/api/notebook/touchEncryptedNotebooks", contractRouteHandlers(apicontract.TouchEncryptedNotebooks, touchEncryptedNotebooks)...)
}

// registerFiletreeRoutes 注册本域的契约路由。
func registerFiletreeRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/filetree/searchDocs", contractRouteHandlers(apicontract.SearchDocs, searchDocs)...)
	ginServer.Handle("POST", "/api/filetree/getPinnedDocs", contractRouteHandlers(apicontract.GetPinnedDocs, getPinnedDocs)...)
	ginServer.Handle("POST", "/api/filetree/updatePinnedDocs", contractRouteHandlers(apicontract.UpdatePinnedDocs, updatePinnedDocs)...)
	ginServer.Handle("POST", "/api/filetree/listDocsByPath", contractRouteHandlers(apicontract.ListDocsByPath, listDocsByPath)...)
	ginServer.Handle("POST", "/api/filetree/getDoc", contractRouteHandlers(apicontract.GetDoc, getDoc)...)
	ginServer.Handle("POST", "/api/filetree/getDocCreateSavePath", contractRouteHandlers(apicontract.GetDocCreateSavePath, getDocCreateSavePath)...)
	ginServer.Handle("POST", "/api/filetree/getRefCreateSavePath", contractRouteHandlers(apicontract.GetRefCreateSavePath, getRefCreateSavePath)...)
	ginServer.Handle("POST", "/api/filetree/getShorthandSavePath", contractRouteHandlers(apicontract.GetShorthandSavePath, getShorthandSavePath)...)
	ginServer.Handle("POST", "/api/filetree/changeSort", contractRouteHandlers(apicontract.ChangeSort, changeSort)...)
	ginServer.Handle("POST", "/api/filetree/reorderDocs", contractRouteHandlers(apicontract.ReorderDocs, reorderDocs)...)
	ginServer.Handle("POST", "/api/filetree/setSort", contractRouteHandlers(apicontract.SetSort, setSort)...)
	ginServer.Handle("POST", "/api/filetree/setDocSortMode", contractRouteHandlers(apicontract.SetDocSortMode, setDocSortMode)...)
	ginServer.Handle("POST", "/api/filetree/createDocWithMd", contractRouteHandlers(apicontract.CreateDocWithMd, createDocWithMd)...)
	ginServer.Handle("POST", "/api/filetree/createDailyNote", contractRouteHandlers(apicontract.CreateDailyNote, createDailyNote)...)
	ginServer.Handle("POST", "/api/filetree/getDailyNoteInfo", contractRouteHandlers(apicontract.GetDailyNoteInfo, getDailyNoteInfo)...)
	ginServer.Handle("POST", "/api/filetree/createDoc", contractRouteHandlers(apicontract.CreateDoc, createDoc)...)
	ginServer.Handle("POST", "/api/filetree/renameDoc", contractRouteHandlers(apicontract.RenameDoc, renameDoc)...)
	ginServer.Handle("POST", "/api/filetree/renameDocByID", contractRouteHandlers(apicontract.RenameDocByID, renameDocByID)...)
	ginServer.Handle("POST", "/api/filetree/removeDoc", contractRouteHandlers(apicontract.RemoveDoc, removeDoc)...)
	ginServer.Handle("POST", "/api/filetree/removeDocByID", contractRouteHandlers(apicontract.RemoveDocByID, removeDocByID)...)
	ginServer.Handle("POST", "/api/filetree/removeDocs", contractRouteHandlers(apicontract.RemoveDocs, removeDocs)...)
	ginServer.Handle("POST", "/api/filetree/moveDocs", contractRouteHandlers(apicontract.MoveDocs, moveDocs)...)
	ginServer.Handle("POST", "/api/filetree/moveDocsByID", contractRouteHandlers(apicontract.MoveDocsByID, moveDocsByID)...)
	ginServer.Handle("POST", "/api/filetree/duplicateDoc", contractRouteHandlers(apicontract.DuplicateDoc, duplicateDoc)...)
	ginServer.Handle("POST", "/api/filetree/duplicateDocTree", contractRouteHandlers(apicontract.DuplicateDocTree, duplicateDocTree)...)
	ginServer.Handle("POST", "/api/filetree/getHPathByPath", contractRouteHandlers(apicontract.GetHPathByPath, getHPathByPath)...)
	ginServer.Handle("POST", "/api/filetree/getHPathsByPaths", contractRouteHandlers(apicontract.GetHPathsByPaths, getHPathsByPaths)...)
	ginServer.Handle("POST", "/api/filetree/getHPathByID", contractRouteHandlers(apicontract.GetHPathByID, getHPathByID)...)
	ginServer.Handle("POST", "/api/filetree/getPathByID", contractRouteHandlers(apicontract.GetPathByID, getPathByID)...)
	ginServer.Handle("POST", "/api/filetree/getFullHPathByID", contractRouteHandlers(apicontract.GetFullHPathByID, getFullHPathByID)...)
	ginServer.Handle("POST", "/api/filetree/getIDsByHPath", contractRouteHandlers(apicontract.GetIDsByHPath, getIDsByHPath)...)
	ginServer.Handle("POST", "/api/filetree/doc2Heading", contractRouteHandlers(apicontract.Doc2Heading, doc2Heading)...)
	ginServer.Handle("POST", "/api/filetree/heading2Doc", contractRouteHandlers(apicontract.Heading2Doc, heading2Doc)...)
	ginServer.Handle("POST", "/api/filetree/li2Doc", contractRouteHandlers(apicontract.Li2Doc, li2Doc)...)
	ginServer.Handle("POST", "/api/filetree/upsertIndexes", contractRouteHandlers(apicontract.UpsertIndexes, upsertIndexes)...)
	ginServer.Handle("POST", "/api/filetree/removeIndexes", contractRouteHandlers(apicontract.RemoveIndexes, removeIndexes)...)
	ginServer.Handle("POST", "/api/filetree/listDocTree", contractRouteHandlers(apicontract.ListDocTree, listDocTree)...)
	ginServer.Handle("POST", "/api/filetree/moveLocalShorthands", contractRouteHandlers(apicontract.MoveLocalShorthands, moveLocalShorthands)...)
	ginServer.Handle("POST", "/api/filetree/setPublishAccess", contractRouteHandlers(apicontract.SetPublishAccess, setPublishAccess)...)
	ginServer.Handle("POST", "/api/filetree/getPublishAccess", contractRouteHandlers(apicontract.GetPublishAccess, getPublishAccess)...)
	ginServer.Handle("POST", "/api/filetree/authFilePublishAccess", contractRouteHandlers(apicontract.AuthFilePublishAccess, authFilePublishAccess)...)
}

// registerFormatRoutes 注册本域的契约路由。
func registerFormatRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/format/autoSpace", contractRouteHandlers(apicontract.AutoSpace, autoSpace)...)
	ginServer.Handle("POST", "/api/format/netImg2LocalAssets", contractRouteHandlers(apicontract.NetImg2LocalAssets, netImg2LocalAssets)...)
	ginServer.Handle("POST", "/api/format/netAssets2LocalAssets", contractRouteHandlers(apicontract.NetAssets2LocalAssets, netAssets2LocalAssets)...)
}

// registerHistoryRoutes 注册本域的契约路由。
func registerHistoryRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/history/rollbackAttributeViewHistory", contractRouteHandlers(apicontract.RollbackAttributeViewHistory, rollbackAttributeViewHistory)...)
	ginServer.Handle("POST", "/api/history/getNotebookHistory", contractRouteHandlers(apicontract.GetNotebookHistory, getNotebookHistory)...)
	ginServer.Handle("POST", "/api/history/rollbackNotebookHistory", contractRouteHandlers(apicontract.RollbackNotebookHistory, rollbackNotebookHistory)...)
	ginServer.Handle("POST", "/api/history/rollbackAssetsHistory", contractRouteHandlers(apicontract.RollbackAssetsHistory, rollbackAssetsHistory)...)
	ginServer.Handle("POST", "/api/history/getDocHistoryContent", contractRouteHandlers(apicontract.GetDocHistoryContent, getDocHistoryContent)...)
	ginServer.Handle("POST", "/api/history/getDocHistorySnapshots", contractRouteHandlers(apicontract.GetDocHistorySnapshots, getDocHistorySnapshots)...)
	ginServer.Handle("POST", "/api/history/diffDocVersions", contractRouteHandlers(apicontract.DiffDocVersions, diffDocVersions)...)
	ginServer.Handle("POST", "/api/history/rollbackDocHistory", contractRouteHandlers(apicontract.RollbackDocHistory, rollbackDocHistory)...)
	ginServer.Handle("POST", "/api/history/clearWorkspaceHistory", contractRouteHandlers(apicontract.ClearWorkspaceHistory, clearWorkspaceHistory)...)
	ginServer.Handle("POST", "/api/history/reindexHistory", contractRouteHandlers(apicontract.ReindexHistory, reindexHistory)...)
	ginServer.Handle("POST", "/api/history/searchHistory", contractRouteHandlers(apicontract.SearchHistory, searchHistory)...)
	ginServer.Handle("POST", "/api/history/getHistoryItems", contractRouteHandlers(apicontract.GetHistoryItems, getHistoryItems)...)
	ginServer.Handle("POST", "/api/history/createDocHistory", contractRouteHandlers(apicontract.CreateDocHistory, createDocHistory)...)
	ginServer.Handle("POST", "/api/history/createAssetHistory", contractRouteHandlers(apicontract.CreateAssetHistory, createAssetHistory)...)
}

// registerOutlineRoutes 注册本域的契约路由。
func registerOutlineRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/outline/getDocOutline", contractRouteHandlers(apicontract.GetDocOutline, getDocOutline)...)
	ginServer.Handle("POST", "/api/outline/getDocHeadingNumbers", contractRouteHandlers(apicontract.GetDocHeadingNumbers, getDocHeadingNumbers)...)
}

// registerBookmarkRoutes 注册本域的契约路由。
func registerBookmarkRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/bookmark/getBookmark", contractRouteHandlers(apicontract.GetBookmark, getBookmark)...)
	ginServer.Handle("POST", "/api/bookmark/renameBookmark", contractRouteHandlers(apicontract.RenameBookmark, renameBookmark)...)
	ginServer.Handle("POST", "/api/bookmark/removeBookmark", contractRouteHandlers(apicontract.RemoveBookmark, removeBookmark)...)
}

// registerTagRoutes 注册本域的契约路由。
func registerTagRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/tag/getTag", contractRouteHandlers(apicontract.GetTag, getTag)...)
	ginServer.Handle("POST", "/api/tag/renameTag", contractRouteHandlers(apicontract.RenameTag, renameTag)...)
	ginServer.Handle("POST", "/api/tag/removeTag", contractRouteHandlers(apicontract.RemoveTag, removeTag)...)
}

// registerLuteRoutes 注册本域的契约路由。
func registerLuteRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/lute/spinBlockDOM", contractRouteHandlers(apicontract.SpinBlockDOM, spinBlockDOM)...)
	ginServer.Handle("POST", "/api/lute/html2BlockDOM", contractRouteHandlers(apicontract.HTML2BlockDOM, html2BlockDOM)...)
	ginServer.Handle("POST", "/api/lute/wpsPresentation2BlockDOM", contractRouteHandlers(apicontract.WPSPresentation2BlockDOM, wpsPresentation2BlockDOM)...)
	ginServer.Handle("POST", "/api/lute/copyStdMarkdown", contractRouteHandlers(apicontract.CopyStdMarkdown, copyStdMarkdown)...)
	ginServer.Handle("POST", "/api/lute/md2html", contractRouteHandlers(apicontract.Md2HTML, md2HTML)...)
}

// registerQueryRoutes 注册本域的契约路由。
func registerQueryRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/query/sql", contractRouteHandlers(apicontract.QuerySQL, SQL)...)
}

// registerSqliteRoutes 注册本域的契约路由。
func registerSqliteRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/sqlite/flushTransaction", contractRouteHandlers(apicontract.FlushTransaction, flushTransaction)...)
}

// registerSearchRoutes 注册本域的契约路由。
func registerSearchRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/search/searchTag", contractRouteHandlers(apicontract.SearchTag, searchTag)...)
	ginServer.Handle("POST", "/api/search/searchTemplate", contractRouteHandlers(apicontract.SearchTemplate, searchTemplate)...)
	ginServer.Handle("POST", "/api/search/removeTemplate", contractRouteHandlers(apicontract.RemoveSearchTemplate, removeTemplate)...)
	ginServer.Handle("POST", "/api/search/searchWidget", contractRouteHandlers(apicontract.SearchWidget, searchWidget)...)
	ginServer.Handle("POST", "/api/search/searchRefBlock", contractRouteHandlers(apicontract.SearchRefBlock, searchRefBlock)...)
	ginServer.Handle("POST", "/api/search/searchEmbedBlock", contractRouteHandlers(apicontract.SearchEmbedBlock, searchEmbedBlock)...)
	ginServer.Handle("POST", "/api/search/getEmbedBlock", contractRouteHandlers(apicontract.GetEmbedBlock, getEmbedBlock)...)
	ginServer.Handle("POST", "/api/search/updateEmbedBlock", contractRouteHandlers(apicontract.UpdateEmbedBlock, updateEmbedBlock)...)
	ginServer.Handle("POST", "/api/search/fullTextSearchBlock", contractRouteHandlers(apicontract.FullTextSearchBlock, fullTextSearchBlock)...)
	ginServer.Handle("POST", "/api/search/searchAsset", contractRouteHandlers(apicontract.SearchAssetByName, searchAsset)...)
	ginServer.Handle("POST", "/api/search/findReplace", contractRouteHandlers(apicontract.FindReplace, findReplace)...)
	ginServer.Handle("POST", "/api/search/fullTextSearchAssetContent", contractRouteHandlers(apicontract.FullTextSearchAssetContent, fullTextSearchAssetContent)...)
	ginServer.Handle("POST", "/api/search/getAssetContent", contractRouteHandlers(apicontract.GetAssetContent, getAssetContent)...)
	ginServer.Handle("POST", "/api/search/getAssetContentByPath", contractRouteHandlers(apicontract.GetAssetContentByPath, getAssetContentByPath)...)
	ginServer.Handle("POST", "/api/search/listInvalidBlockRefs", contractRouteHandlers(apicontract.ListInvalidBlockRefs, listInvalidBlockRefs)...)
	ginServer.Handle("POST", "/api/search/semanticSearchBlock", contractRouteHandlers(apicontract.SemanticSearchBlock, semanticSearchBlock)...)
}

// registerBlockRoutes 注册本域的契约路由。
func registerBlockRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/block/getBlockInfo", contractRouteHandlers(apicontract.GetBlockInfo, getBlockInfo)...)
	ginServer.Handle("POST", "/api/block/getBlockDOM", contractRouteHandlers(apicontract.GetBlockDOM, getBlockDOM)...)
	ginServer.Handle("POST", "/api/block/getOrderedListContinueStart", contractRouteHandlers(apicontract.GetOrderedListContinueStart, getOrderedListContinueStart)...)
	ginServer.Handle("POST", "/api/block/getBlockDOMs", contractRouteHandlers(apicontract.GetBlockDOMs, getBlockDOMs)...)
	ginServer.Handle("POST", "/api/block/getBlockDOMWithEmbed", contractRouteHandlers(apicontract.GetBlockDOMWithEmbed, getBlockDOMWithEmbed)...)
	ginServer.Handle("POST", "/api/block/getBlockDOMsWithEmbed", contractRouteHandlers(apicontract.GetBlockDOMsWithEmbed, getBlockDOMsWithEmbed)...)
	ginServer.Handle("POST", "/api/block/getBlockKramdown", contractRouteHandlers(apicontract.GetBlockKramdown, getBlockKramdown)...)
	ginServer.Handle("POST", "/api/block/getBlockKramdowns", contractRouteHandlers(apicontract.GetBlockKramdowns, getBlockKramdowns)...)
	ginServer.Handle("POST", "/api/block/getChildBlocks", contractRouteHandlers(apicontract.GetChildBlocks, getChildBlocks)...)
	ginServer.Handle("POST", "/api/block/getTailChildBlocks", contractRouteHandlers(apicontract.GetTailChildBlocks, getTailChildBlocks)...)
	ginServer.Handle("POST", "/api/block/getBlockBreadcrumb", contractRouteHandlers(apicontract.GetBlockBreadcrumb, getBlockBreadcrumb)...)
	ginServer.Handle("POST", "/api/block/getBlockBreadcrumbChildren", contractRouteHandlers(apicontract.GetBlockBreadcrumbChildren, getBlockBreadcrumbChildren)...)
	ginServer.Handle("POST", "/api/block/getBlockIndex", contractRouteHandlers(apicontract.GetBlockIndex, getBlockIndex)...)
	ginServer.Handle("POST", "/api/block/getBlocksIndexes", contractRouteHandlers(apicontract.GetBlocksIndexes, getBlocksIndexes)...)
	ginServer.Handle("POST", "/api/block/getDocBlocksOrders", contractRouteHandlers(apicontract.GetDocBlocksOrders, getDocBlocksOrders)...)
	ginServer.Handle("POST", "/api/block/getRefIDs", contractRouteHandlers(apicontract.GetRefIDs, getRefIDs)...)
	ginServer.Handle("POST", "/api/block/getRefIDsByFileAnnotationID", contractRouteHandlers(apicontract.GetRefIDsByFileAnnotationID, getRefIDsByFileAnnotationID)...)
	ginServer.Handle("POST", "/api/block/getBlockDefIDsByRefText", contractRouteHandlers(apicontract.GetBlockDefIDsByRefText, getBlockDefIDsByRefText)...)
	ginServer.Handle("POST", "/api/block/getRefText", contractRouteHandlers(apicontract.GetRefText, getRefText)...)
	ginServer.Handle("POST", "/api/block/getDOMText", contractRouteHandlers(apicontract.GetDOMText, getDOMText)...)
	ginServer.Handle("POST", "/api/block/getTreeStat", contractRouteHandlers(apicontract.GetTreeStat, getTreeStat)...)
	ginServer.Handle("POST", "/api/block/getBlocksWordCount", contractRouteHandlers(apicontract.GetBlocksWordCount, getBlocksWordCount)...)
	ginServer.Handle("POST", "/api/block/getContentWordCount", contractRouteHandlers(apicontract.GetContentWordCount, getContentWordCount)...)
	ginServer.Handle("POST", "/api/block/getRecentUpdatedBlocks", contractRouteHandlers(apicontract.GetRecentUpdatedBlocks, getRecentUpdatedBlocks)...)
	ginServer.Handle("POST", "/api/block/getDocInfo", contractRouteHandlers(apicontract.GetDocInfo, getDocInfo)...)
	ginServer.Handle("POST", "/api/block/getDocsInfo", contractRouteHandlers(apicontract.GetDocsInfo, getDocsInfo)...)
	ginServer.Handle("POST", "/api/block/checkBlockExist", contractRouteHandlers(apicontract.CheckBlockExist, checkBlockExist)...)
	ginServer.Handle("POST", "/api/block/checkBlocksExist", contractRouteHandlers(apicontract.CheckBlocksExist, checkBlocksExist)...)
	ginServer.Handle("POST", "/api/block/getUnfoldedParentID", contractRouteHandlers(apicontract.GetUnfoldedParentID, getUnfoldedParentID)...)
	ginServer.Handle("POST", "/api/block/checkBlockFold", contractRouteHandlers(apicontract.CheckBlockFold, checkBlockFold)...)
	ginServer.Handle("POST", "/api/block/insertBlock", contractRouteHandlers(apicontract.InsertBlock, insertBlock)...)
	ginServer.Handle("POST", "/api/block/batchInsertBlock", contractRouteHandlers(apicontract.BatchInsertBlock, batchInsertBlock)...)
	ginServer.Handle("POST", "/api/block/prependBlock", contractRouteHandlers(apicontract.PrependBlock, prependBlock)...)
	ginServer.Handle("POST", "/api/block/batchPrependBlock", contractRouteHandlers(apicontract.BatchPrependBlock, batchPrependBlock)...)
	ginServer.Handle("POST", "/api/block/appendBlock", contractRouteHandlers(apicontract.AppendBlock, appendBlock)...)
	ginServer.Handle("POST", "/api/block/batchAppendBlock", contractRouteHandlers(apicontract.BatchAppendBlock, batchAppendBlock)...)
	ginServer.Handle("POST", "/api/block/appendDailyNoteBlock", contractRouteHandlers(apicontract.AppendDailyNoteBlock, appendDailyNoteBlock)...)
	ginServer.Handle("POST", "/api/block/prependDailyNoteBlock", contractRouteHandlers(apicontract.PrependDailyNoteBlock, prependDailyNoteBlock)...)
	ginServer.Handle("POST", "/api/block/updateBlock", contractRouteHandlers(apicontract.UpdateBlock, updateBlock)...)
	ginServer.Handle("POST", "/api/block/migrateLegacyMindmaps", contractRouteHandlers(apicontract.MigrateLegacyMindmaps, migrateLegacyMindmaps)...)
	ginServer.Handle("POST", "/api/block/batchUpdateBlock", contractRouteHandlers(apicontract.BatchUpdateBlock, batchUpdateBlock)...)
	ginServer.Handle("POST", "/api/block/deleteBlock", contractRouteHandlers(apicontract.DeleteBlock, deleteBlock)...)
	ginServer.Handle("POST", "/api/block/moveBlock", contractRouteHandlers(apicontract.MoveBlock, moveBlock)...)
	ginServer.Handle("POST", "/api/block/moveOutlineHeading", contractRouteHandlers(apicontract.MoveOutlineHeading, moveOutlineHeading)...)
	ginServer.Handle("POST", "/api/block/foldBlock", contractRouteHandlers(apicontract.FoldBlock, foldBlock)...)
	ginServer.Handle("POST", "/api/block/unfoldBlock", contractRouteHandlers(apicontract.UnfoldBlock, unfoldBlock)...)
	ginServer.Handle("POST", "/api/block/setBlockReminder", contractRouteHandlers(apicontract.SetBlockReminder, setBlockReminder)...)
	ginServer.Handle("POST", "/api/block/getHeadingLevelTransaction", contractRouteHandlers(apicontract.GetHeadingLevelTransaction, getHeadingLevelTransaction)...)
	ginServer.Handle("POST", "/api/block/getDocHeadingLevelTransaction", contractRouteHandlers(apicontract.GetDocHeadingLevelTransaction, getDocHeadingLevelTransaction)...)
	ginServer.Handle("POST", "/api/block/getHeadingFoldTransaction", contractRouteHandlers(apicontract.GetHeadingFoldTransaction, getHeadingFoldTransaction)...)
	ginServer.Handle("POST", "/api/block/getHeadingDeleteTransaction", contractRouteHandlers(apicontract.GetHeadingDeleteTransaction, getHeadingDeleteTransaction)...)
	ginServer.Handle("POST", "/api/block/getHeadingInsertTransaction", contractRouteHandlers(apicontract.GetHeadingInsertTransaction, getHeadingInsertTransaction)...)
	ginServer.Handle("POST", "/api/block/getHeadingChildrenIDs", contractRouteHandlers(apicontract.GetHeadingChildrenIDs, getHeadingChildrenIDs)...)
	ginServer.Handle("POST", "/api/block/getHeadingChildrenDOM", contractRouteHandlers(apicontract.GetHeadingChildrenDOM, getHeadingChildrenDOM)...)
	ginServer.Handle("POST", "/api/block/swapBlockRef", contractRouteHandlers(apicontract.SwapBlockRef, swapBlockRef)...)
	ginServer.Handle("POST", "/api/block/transferBlockRef", contractRouteHandlers(apicontract.TransferBlockRef, transferBlockRef)...)
	ginServer.Handle("POST", "/api/block/getBlockSiblingID", contractRouteHandlers(apicontract.GetBlockSiblingID, getBlockSiblingID)...)
	ginServer.Handle("POST", "/api/block/getBlockRelevantIDs", contractRouteHandlers(apicontract.GetBlockRelevantIDs, getBlockRelevantIDs)...)
	ginServer.Handle("POST", "/api/block/getBlockTreeInfos", contractRouteHandlers(apicontract.GetBlockTreeInfos, getBlockTreeInfos)...)
	ginServer.Handle("POST", "/api/block/checkBlockRef", contractRouteHandlers(apicontract.CheckBlockRef, checkBlockRef)...)
	ginServer.Handle("POST", "/api/block/appendHeadingChildren", contractRouteHandlers(apicontract.AppendHeadingChildren, appendHeadingChildren)...)
	ginServer.Handle("POST", "/api/block/updateTaskListItemMarker", contractRouteHandlers(apicontract.UpdateTaskListItemMarker, updateTaskListItemMarker)...)
	ginServer.Handle("POST", "/api/block/batchUpdateTaskListItemMarker", contractRouteHandlers(apicontract.BatchUpdateTaskListItemMarker, batchUpdateTaskListItemMarker)...)
}

// registerFileRoutes 注册本域的契约路由。
func registerFileRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/file/getFile", contractRouteHandlers(apicontract.GetFile, getFile)...)
	ginServer.Handle("POST", "/api/file/putFile", contractRouteHandlers(apicontract.PutFile, putFile)...)
	ginServer.Handle("POST", "/api/file/copyFile", contractRouteHandlers(apicontract.CopyFile, copyFile)...)
	ginServer.Handle("POST", "/api/file/globalCopyFiles", contractRouteHandlers(apicontract.GlobalCopyFiles, globalCopyFiles)...)
	ginServer.Handle("POST", "/api/file/workspaceCopyFiles", contractRouteHandlers(apicontract.WorkspaceCopyFiles, workspaceCopyFiles)...)
	ginServer.Handle("POST", "/api/file/removeFile", contractRouteHandlers(apicontract.RemoveFile, removeFile)...)
	ginServer.Handle("POST", "/api/file/renameFile", contractRouteHandlers(apicontract.RenameFile, renameFile)...)
	ginServer.Handle("POST", "/api/file/readDir", contractRouteHandlers(apicontract.ReadDirectory, readDir)...)
	ginServer.Handle("POST", "/api/file/getUniqueFilename", contractRouteHandlers(apicontract.GetUniqueFilename, getUniqueFilename)...)
}

// registerRefRoutes 注册本域的契约路由。
func registerRefRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/ref/refreshBacklink", contractRouteHandlers(apicontract.RefreshBacklink, refreshBacklink)...)
	ginServer.Handle("POST", "/api/ref/getBacklink2", contractRouteHandlers(apicontract.GetBacklink2, getBacklink2)...)
	ginServer.Handle("POST", "/api/ref/getGlobalBacklinks", contractRouteHandlers(apicontract.GetGlobalBacklinks, getGlobalBacklinks)...)
	ginServer.Handle("POST", "/api/ref/getGlobalBacklinkContexts", contractRouteHandlers(apicontract.GetGlobalBacklinkContexts, getGlobalBacklinkContexts)...)
	ginServer.Handle("POST", "/api/ref/getBacklinkDoc", contractRouteHandlers(apicontract.GetBacklinkDoc, getBacklinkDoc)...)
	ginServer.Handle("POST", "/api/ref/getBackmentionDoc", contractRouteHandlers(apicontract.GetBackmentionDoc, getBackmentionDoc)...)
}

// registerAttrRoutes 注册本域的契约路由。
func registerAttrRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/attr/getBookmarkLabels", contractRouteHandlers(apicontract.GetBookmarkLabels, getBookmarkLabels)...)
	ginServer.Handle("POST", "/api/attr/resetBlockAttrs", contractRouteHandlers(apicontract.ResetBlockAttrs, resetBlockAttrs)...)
	ginServer.Handle("POST", "/api/attr/setBlockAttrs", contractRouteHandlers(apicontract.SetBlockAttrs, setBlockAttrs)...)
	ginServer.Handle("POST", "/api/attr/batchSetBlockAttrs", contractRouteHandlers(apicontract.BatchSetBlockAttrs, batchSetBlockAttrs)...)
	ginServer.Handle("POST", "/api/attr/getBlockAttrs", contractRouteHandlers(apicontract.GetBlockAttrs, getBlockAttrs)...)
	ginServer.Handle("POST", "/api/attr/batchGetBlockAttrs", contractRouteHandlers(apicontract.BatchGetBlockAttrs, batchGetBlockAttrs)...)
}

// registerCloudRoutes 注册本域的契约路由。
func registerCloudRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/cloud/getCloudSpace", contractRouteHandlers(apicontract.GetCloudSpace, getCloudSpace)...)
	ginServer.Handle("POST", "/api/cloud/setCloudReminder", contractRouteHandlers(apicontract.SetCloudReminder, setCloudReminder)...)
}

// registerSyncRoutes 注册本域的契约路由。
func registerSyncRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/sync/setSyncEnable", contractRouteHandlers(apicontract.SetSyncEnable, setSyncEnable)...)
	ginServer.Handle("POST", "/api/sync/setSyncInterval", contractRouteHandlers(apicontract.SetSyncInterval, setSyncInterval)...)
	ginServer.Handle("POST", "/api/sync/setSyncPerception", contractRouteHandlers(apicontract.SetSyncPerception, setSyncPerception)...)
	ginServer.Handle("POST", "/api/sync/setSyncLAN", contractRouteHandlers(apicontract.SetSyncLAN, setSyncLAN)...)
	ginServer.Handle("POST", "/api/sync/getSyncLANStatus", contractRouteHandlers(apicontract.GetSyncLANStatus, getSyncLANStatus)...)
	ginServer.Handle("POST", "/api/sync/setSyncGenerateConflictDoc", contractRouteHandlers(apicontract.SetSyncGenerateConflictDoc, setSyncGenerateConflictDoc)...)
	ginServer.Handle("POST", "/api/sync/setSyncMode", contractRouteHandlers(apicontract.SetSyncMode, setSyncMode)...)
	ginServer.Handle("POST", "/api/sync/setSyncProvider", contractRouteHandlers(apicontract.SetSyncProvider, setSyncProvider)...)
	ginServer.Handle("POST", "/api/sync/setSyncProviderS3", contractRouteHandlers(apicontract.SetSyncProviderS3, setSyncProviderS3)...)
	ginServer.Handle("POST", "/api/sync/setSyncProviderWebDAV", contractRouteHandlers(apicontract.SetSyncProviderWebDAV, setSyncProviderWebDAV)...)
	ginServer.Handle("POST", "/api/sync/setSyncProviderLocal", contractRouteHandlers(apicontract.SetSyncProviderLocal, setSyncProviderLocal)...)
	ginServer.Handle("POST", "/api/sync/setCloudSyncDir", contractRouteHandlers(apicontract.SetCloudSyncDir, setCloudSyncDir)...)
	ginServer.Handle("POST", "/api/sync/setSyncAssetDownloadMode", contractRouteHandlers(apicontract.SetSyncAssetDownloadMode, setSyncAssetDownloadMode)...)
	ginServer.Handle("POST", "/api/sync/createCloudSyncDir", contractRouteHandlers(apicontract.CreateCloudSyncDir, createCloudSyncDir)...)
	ginServer.Handle("POST", "/api/sync/removeCloudSyncDir", contractRouteHandlers(apicontract.RemoveCloudSyncDir, removeCloudSyncDir)...)
	ginServer.Handle("POST", "/api/sync/listCloudSyncDir", contractRouteHandlers(apicontract.ListCloudSyncDir, listCloudSyncDir)...)
	ginServer.Handle("POST", "/api/sync/performSync", contractRouteHandlers(apicontract.PerformSync, performSync)...)
	ginServer.Handle("POST", "/api/sync/performBootSync", contractRouteHandlers(apicontract.PerformBootSync, performBootSync)...)
	ginServer.Handle("POST", "/api/sync/getBootSync", contractRouteHandlers(apicontract.GetBootSync, getBootSync)...)
	ginServer.Handle("POST", "/api/sync/getSyncInfo", contractRouteHandlers(apicontract.GetSyncInfo, getSyncInfo)...)
	ginServer.Handle("POST", "/api/sync/exportSyncProviderS3", contractRouteHandlers(apicontract.ExportSyncProviderS3, exportSyncProviderS3)...)
	ginServer.Handle("POST", "/api/sync/importSyncProviderS3", contractRouteHandlers(apicontract.ImportSyncProviderS3, importSyncProviderS3)...)
	ginServer.Handle("POST", "/api/sync/exportSyncProviderWebDAV", contractRouteHandlers(apicontract.ExportSyncProviderWebDAV, exportSyncProviderWebDAV)...)
	ginServer.Handle("POST", "/api/sync/importSyncProviderWebDAV", contractRouteHandlers(apicontract.ImportSyncProviderWebDAV, importSyncProviderWebDAV)...)
}

// registerInboxRoutes 注册本域的契约路由。
func registerInboxRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/inbox/getShorthands", contractRouteHandlers(apicontract.GetShorthands, getShorthands)...)
	ginServer.Handle("POST", "/api/inbox/getShorthand", contractRouteHandlers(apicontract.GetShorthand, getShorthand)...)
	ginServer.Handle("POST", "/api/inbox/removeShorthands", contractRouteHandlers(apicontract.RemoveShorthands, removeShorthands)...)
}

// registerExtensionRoutes 注册本域的契约路由。
func registerExtensionRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/extension/copy", contractRouteHandlers(apicontract.ExtensionCopy, extensionCopy)...)
}

// registerClipboardRoutes 注册本域的契约路由。
func registerClipboardRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/clipboard/readFilePaths", contractRouteHandlers(apicontract.ReadClipboardFilePaths, readFilePaths)...)
	ginServer.Handle("POST", "/api/clipboard/writeFilePath", contractRouteHandlers(apicontract.WriteClipboardFilePath, writeFilePath)...)
	ginServer.Handle("POST", "/api/clipboard/prepareRichText", contractRouteHandlers(apicontract.PrepareRichText, prepareRichText)...)
	ginServer.Handle("POST", "/api/clipboard/preparePasteAssets", contractRouteHandlers(apicontract.PreparePasteAssets, preparePasteAssets)...)
	ginServer.Handle("POST", "/api/clipboard/cleanupRichText", contractRouteHandlers(apicontract.CleanupRichText, cleanupRichText)...)
}

// registerAssetRoutes 注册本域的契约路由。
func registerAssetRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/asset/uploadCloud", contractRouteHandlers(apicontract.AssetUploadCloud, uploadCloud)...)
	ginServer.Handle("POST", "/api/asset/uploadCloudByAssetsPaths", contractRouteHandlers(apicontract.AssetUploadCloudByAssetsPaths, uploadCloudByAssetsPaths)...)
	ginServer.Handle("POST", "/api/asset/insertLocalAssets", contractRouteHandlers(apicontract.InsertLocalAssets, insertLocalAssets)...)
	ginServer.Handle("POST", "/api/asset/insertCover", contractRouteHandlers(apicontract.InsertCover, insertCover)...)
	ginServer.Handle("POST", "/api/asset/resolveAssetPath", contractRouteHandlers(apicontract.ResolveAssetPath, resolveAssetPath)...)
	ginServer.Handle("POST", "/api/asset/upload", contractRouteHandlers(apicontract.UploadAsset, uploadAsset)...)
	ginServer.Handle("POST", "/api/asset/setFileAnnotation", contractRouteHandlers(apicontract.SetFileAnnotation, setFileAnnotation)...)
	ginServer.Handle("POST", "/api/asset/getFileAnnotation", contractRouteHandlers(apicontract.GetFileAnnotation, getFileAnnotation)...)
	ginServer.Handle("POST", "/api/asset/getUnusedAssets", contractRouteHandlers(apicontract.GetUnusedAssets, getUnusedAssets)...)
	ginServer.Handle("POST", "/api/asset/getMissingAssets", contractRouteHandlers(apicontract.GetMissingAssets, getMissingAssets)...)
	ginServer.Handle("POST", "/api/asset/removeUnusedAsset", contractRouteHandlers(apicontract.RemoveUnusedAsset, removeUnusedAsset)...)
	ginServer.Handle("POST", "/api/asset/removeUnusedAssets", contractRouteHandlers(apicontract.RemoveUnusedAssets, removeUnusedAssets)...)
	ginServer.Handle("POST", "/api/asset/getDocImageAssets", contractRouteHandlers(apicontract.GetDocImageAssets, getDocImageAssets)...)
	ginServer.Handle("POST", "/api/asset/getDocAssets", contractRouteHandlers(apicontract.GetDocAssets, getDocAssets)...)
	ginServer.Handle("POST", "/api/asset/renameAsset", contractRouteHandlers(apicontract.RenameAsset, renameAsset)...)
	ginServer.Handle("POST", "/api/asset/findAssetReferences", contractRouteHandlers(apicontract.FindAssetReferences, findAssetReferences)...)
	ginServer.Handle("POST", "/api/asset/relinkAsset", contractRouteHandlers(apicontract.RelinkAsset, relinkAsset)...)
	ginServer.Handle("POST", "/api/asset/getImageOCRText", contractRouteHandlers(apicontract.GetImageOCRText, getImageOCRText)...)
	ginServer.Handle("POST", "/api/asset/setImageOCRText", contractRouteHandlers(apicontract.SetImageOCRText, setImageOCRText)...)
	ginServer.Handle("POST", "/api/asset/ocr", contractRouteHandlers(apicontract.AssetOCR, ocr)...)
	ginServer.Handle("POST", "/api/asset/getOCRConfig", contractRouteHandlers(apicontract.GetOCRConfig, getOCRConfig)...)
	ginServer.Handle("POST", "/api/asset/setOCRConfig", contractRouteHandlers(apicontract.SetOCRConfig, setOCRConfig)...)
	ginServer.Handle("POST", "/api/asset/importOCRModels", contractRouteHandlers(apicontract.ImportOCRModels, importOCRModels)...)
	ginServer.Handle("POST", "/api/asset/fullReindexAssetContent", contractRouteHandlers(apicontract.FullReindexAssetContent, fullReindexAssetContent)...)
	ginServer.Handle("POST", "/api/asset/statAsset", contractRouteHandlers(apicontract.StatAsset, statAsset)...)
}

// registerExportRoutes 注册本域的契约路由。
func registerExportRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/export/exportNotebookMd", contractRouteHandlers(apicontract.ExportNotebookMd, exportNotebookMd)...)
	ginServer.Handle("POST", "/api/export/exportNotebooksMd", contractRouteHandlers(apicontract.ExportNotebooksMd, exportNotebooksMd)...)
	ginServer.Handle("POST", "/api/export/exportMds", contractRouteHandlers(apicontract.ExportMds, exportMds)...)
	ginServer.Handle("POST", "/api/export/exportMd", contractRouteHandlers(apicontract.ExportMd, exportMd)...)
	ginServer.Handle("POST", "/api/export/exportSYs", contractRouteHandlers(apicontract.ExportSYs, exportSYs)...)
	ginServer.Handle("POST", "/api/export/exportSY", contractRouteHandlers(apicontract.ExportSY, exportSY)...)
	ginServer.Handle("POST", "/api/export/exportNotebookSY", contractRouteHandlers(apicontract.ExportNotebookSY, exportNotebookSY)...)
	ginServer.Handle("POST", "/api/export/exportNotebooksSY", contractRouteHandlers(apicontract.ExportNotebooksSY, exportNotebooksSY)...)
	ginServer.Handle("POST", "/api/export/exportMdContent", contractRouteHandlers(apicontract.ExportMdContent, exportMdContent)...)
	ginServer.Handle("POST", "/api/export/exportHTML", contractRouteHandlers(apicontract.ExportHTML, exportHTML)...)
	ginServer.Handle("POST", "/api/export/exportPreviewHTML", contractRouteHandlers(apicontract.ExportPreviewHTML, exportPreviewHTML)...)
	ginServer.Handle("POST", "/api/export/exportMdHTML", contractRouteHandlers(apicontract.ExportMdHTML, exportMdHTML)...)
	ginServer.Handle("POST", "/api/export/exportDocx", contractRouteHandlers(apicontract.ExportDocx, exportDocx)...)
	ginServer.Handle("POST", "/api/export/processPDF", contractRouteHandlers(apicontract.ProcessPDF, processPDF)...)
	ginServer.Handle("POST", "/api/export/preview", contractRouteHandlers(apicontract.ExportPreview, exportPreview)...)
	ginServer.Handle("POST", "/api/export/exportResources", contractRouteHandlers(apicontract.ExportResources, exportResources)...)
	ginServer.Handle("POST", "/api/export/exportAsFile", contractRouteHandlers(apicontract.ExportAsFile, exportAsFile)...)
	ginServer.Handle("POST", "/api/export/exportData", contractRouteHandlers(apicontract.ExportData, exportData)...)
	ginServer.Handle("POST", "/api/export/exportDataInFolder", contractRouteHandlers(apicontract.ExportDataInFolder, exportDataInFolder)...)
	ginServer.Handle("POST", "/api/export/exportTempContent", contractRouteHandlers(apicontract.ExportTempContent, exportTempContent)...)
	ginServer.Handle("POST", "/api/export/exportBrowserHTML", contractRouteHandlers(apicontract.ExportBrowserHTML, exportBrowserHTML)...)
	ginServer.Handle("POST", "/api/export/export2Liandi", contractRouteHandlers(apicontract.Export2Liandi, export2Liandi)...)
	ginServer.Handle("POST", "/api/export/exportReStructuredText", contractRouteHandlers(apicontract.ExportReStructuredText, exportReStructuredText)...)
	ginServer.Handle("POST", "/api/export/exportAsciiDoc", contractRouteHandlers(apicontract.ExportAsciiDoc, exportAsciiDoc)...)
	ginServer.Handle("POST", "/api/export/exportTextile", contractRouteHandlers(apicontract.ExportTextile, exportTextile)...)
	ginServer.Handle("POST", "/api/export/exportOPML", contractRouteHandlers(apicontract.ExportOPML, exportOPML)...)
	ginServer.Handle("POST", "/api/export/exportOrgMode", contractRouteHandlers(apicontract.ExportOrgMode, exportOrgMode)...)
	ginServer.Handle("POST", "/api/export/exportMediaWiki", contractRouteHandlers(apicontract.ExportMediaWiki, exportMediaWiki)...)
	ginServer.Handle("POST", "/api/export/exportODT", contractRouteHandlers(apicontract.ExportODT, exportODT)...)
	ginServer.Handle("POST", "/api/export/exportRTF", contractRouteHandlers(apicontract.ExportRTF, exportRTF)...)
	ginServer.Handle("POST", "/api/export/exportEPUB", contractRouteHandlers(apicontract.ExportEPUB, exportEPUB)...)
	ginServer.Handle("POST", "/api/export/exportAttributeView", contractRouteHandlers(apicontract.ExportAttributeView, exportAttributeView)...)
	ginServer.Handle("POST", "/api/export/exportCodeBlock", contractRouteHandlers(apicontract.ExportCodeBlock, exportCodeBlock)...)
	ginServer.Handle("POST", "/api/export/copyExportFile", contractRouteHandlers(apicontract.CopyExportFile, copyExportFile)...)
}

// registerImportRoutes 注册本域的契约路由。
func registerImportRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/import/importStdMd", contractRouteHandlers(apicontract.ImportStdMd, importStdMd)...)
	ginServer.Handle("POST", "/api/import/importZipMd", contractRouteHandlers(apicontract.ImportZipMd, importZipMd)...)
	ginServer.Handle("POST", "/api/import/importData", contractRouteHandlers(apicontract.ImportData, importData)...)
	ginServer.Handle("POST", "/api/import/importSY", contractRouteHandlers(apicontract.ImportSY, importSY)...)
	ginServer.Handle("POST", "/api/import/importSYNotebook", contractRouteHandlers(apicontract.ImportSYNotebook, importSYNotebook)...)
	ginServer.Handle("POST", "/api/import/importSYAuto", contractRouteHandlers(apicontract.ImportSYAuto, importSYAuto)...)
	ginServer.Handle("POST", "/api/import/continueImportSY", contractRouteHandlers(apicontract.ContinueImportSY, continueImportSY)...)
	ginServer.Handle("POST", "/api/import/cancelImportSY", contractRouteHandlers(apicontract.CancelImportSY, cancelImportSY)...)
	ginServer.Handle("POST", "/api/import/startObsidianVaultAnalysis", contractRouteHandlers(apicontract.StartObsidianVaultAnalysis, startObsidianVaultAnalysis)...)
	ginServer.Handle("POST", "/api/import/getObsidianVaultTask", contractRouteHandlers(apicontract.GetObsidianVaultTask, getObsidianVaultTask)...)
	ginServer.Handle("POST", "/api/import/startObsidianVaultImport", contractRouteHandlers(apicontract.StartObsidianVaultImport, startObsidianVaultImport)...)
	ginServer.Handle("POST", "/api/import/cancelObsidianVaultTask", contractRouteHandlers(apicontract.CancelObsidianVaultTask, cancelObsidianVaultTask)...)
}

// registerConvertRoutes 注册本域的契约路由。
func registerConvertRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/convert/pandoc", contractRouteHandlers(apicontract.Pandoc, pandoc)...)
}

// registerTemplateRoutes 注册本域的契约路由。
func registerTemplateRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/template/render", contractRouteHandlers(apicontract.RenderTemplate, renderTemplate)...)
	ginServer.Handle("POST", "/api/template/manage", contractRouteHandlers(apicontract.ManageTemplateFiles, manageTemplateFiles)...)
	ginServer.Handle("POST", "/api/template/getDocSaveAsTemplateInfo", contractRouteHandlers(apicontract.GetDocSaveAsTemplateInfo, getDocSaveAsTemplateInfo)...)
	ginServer.Handle("POST", "/api/template/docSaveAsTemplate", contractRouteHandlers(apicontract.DocSaveAsTemplate, docSaveAsTemplate)...)
	ginServer.Handle("POST", "/api/template/renderSprig", contractRouteHandlers(apicontract.RenderSprig, renderSprig)...)
}

// registerTransactionsRoutes 注册本域的契约路由。
func registerTransactionsRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/transactions", contractRouteHandlers(apicontract.PerformTransactions, performTransactions)...)
	ginServer.Handle("POST", "/api/transactions/undoState", contractRouteHandlers(apicontract.UndoState, undoState)...)
	ginServer.Handle("POST", "/api/transactions/undo", contractRouteHandlers(apicontract.PerformUndo, performUndo)...)
	ginServer.Handle("POST", "/api/transactions/redo", contractRouteHandlers(apicontract.PerformRedo, performRedo)...)
	ginServer.Handle("POST", "/api/transactions/clearHistory", contractRouteHandlers(apicontract.ClearHistory, clearHistory)...)
}

// registerSettingRoutes 注册本域的契约路由。
func registerSettingRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/setting/patch", contractRouteHandlers(apicontract.PatchSetting, patchSetting)...)
	ginServer.Handle("POST", "/api/setting/resetSettings", contractRouteHandlers(apicontract.ResetSettings, resetSettings)...)
	ginServer.Handle("POST", "/api/setting/confirmSettingsReset", contractRouteHandlers(apicontract.ConfirmSettingsReset, confirmSettingsReset)...)
	ginServer.Handle("POST", "/api/setting/setEditor", contractRouteHandlers(apicontract.SetEditor, setEditor)...)
	ginServer.Handle("POST", "/api/setting/setExport", contractRouteHandlers(apicontract.SetExport, setExport)...)
	ginServer.Handle("POST", "/api/setting/getPandocBin", contractRouteHandlers(apicontract.GetPandocBin, getPandocBin)...)
	ginServer.Handle("POST", "/api/setting/setFiletree", contractRouteHandlers(apicontract.SetFiletree, setFiletree)...)
	ginServer.Handle("POST", "/api/setting/setSearch", contractRouteHandlers(apicontract.SetSearch, setSearch)...)
	ginServer.Handle("POST", "/api/setting/setKeymap", contractRouteHandlers(apicontract.SetKeymap, setKeymap)...)
	ginServer.Handle("POST", "/api/setting/setAppearance", contractRouteHandlers(apicontract.SetAppearance, setAppearance)...)
	ginServer.Handle("POST", "/api/setting/getBootAppearances", contractRouteHandlers(apicontract.GetBootAppearances, getBootAppearances)...)
	ginServer.Handle("POST", "/api/setting/setBootAppearance", contractRouteHandlers(apicontract.SetBootAppearance, setBootAppearance)...)
	ginServer.Handle("POST", "/api/setting/setEntryVisibility", contractRouteHandlers(apicontract.SetEntryVisibility, setEntryVisibility)...)
	ginServer.Handle("POST", "/api/setting/setIcon", contractRouteHandlers(apicontract.SetIcon, setIcon)...)
	ginServer.Handle("POST", "/api/setting/setTheme", contractRouteHandlers(apicontract.SetTheme, setTheme)...)
	ginServer.Handle("POST", "/api/setting/getCloudUser", contractRouteHandlers(apicontract.GetCloudUser, getCloudUser)...)
	ginServer.Handle("POST", "/api/setting/logoutCloudUser", contractRouteHandlers(apicontract.LogoutCloudUser, logoutCloudUser)...)
	ginServer.Handle("POST", "/api/setting/login2faCloudUser", contractRouteHandlers(apicontract.Login2faCloudUser, login2faCloudUser)...)
	ginServer.Handle("POST", "/api/setting/setEmoji", contractRouteHandlers(apicontract.SetEmoji, setEmoji)...)
	ginServer.Handle("POST", "/api/setting/setFlashcard", contractRouteHandlers(apicontract.SetFlashcard, setFlashcard)...)
	ginServer.Handle("POST", "/api/setting/setAI", contractRouteHandlers(apicontract.SetAI, setAI)...)
	ginServer.Handle("POST", "/api/setting/setSecrets", contractRouteHandlers(apicontract.SetSecrets, setSecrets)...)
	ginServer.Handle("POST", "/api/setting/setVariables", contractRouteHandlers(apicontract.SetVariables, setVariables)...)
	ginServer.Handle("POST", "/api/setting/setBazaar", contractRouteHandlers(apicontract.SetBazaar, setBazaar)...)
	ginServer.Handle("POST", "/api/setting/setBazaarPetalDisabled", contractRouteHandlers(apicontract.SetBazaarPetalDisabled, setBazaarPetalDisabled)...)
	ginServer.Handle("POST", "/api/setting/setPublish", contractRouteHandlers(apicontract.SetPublish, setPublish)...)
	ginServer.Handle("POST", "/api/setting/getPublish", contractRouteHandlers(apicontract.GetPublish, getPublish)...)
	ginServer.Handle("POST", "/api/setting/refreshVirtualBlockRef", contractRouteHandlers(apicontract.RefreshVirtualBlockRef, refreshVirtualBlockRef)...)
	ginServer.Handle("POST", "/api/setting/addVirtualBlockRefInclude", contractRouteHandlers(apicontract.AddVirtualBlockRefInclude, addVirtualBlockRefInclude)...)
	ginServer.Handle("POST", "/api/setting/addVirtualBlockRefExclude", contractRouteHandlers(apicontract.AddVirtualBlockRefExclude, addVirtualBlockRefExclude)...)
	ginServer.Handle("POST", "/api/setting/setSnippet", contractRouteHandlers(apicontract.SetConfSnippet, setConfSnippet)...)
	ginServer.Handle("POST", "/api/setting/setEditorReadOnly", contractRouteHandlers(apicontract.SetEditorReadOnly, setEditorReadOnly)...)
}

// registerGraphRoutes 注册本域的契约路由。
func registerGraphRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/graph/resetGraph", contractRouteHandlers(apicontract.ResetGraph, resetGraph)...)
	ginServer.Handle("POST", "/api/graph/resetLocalGraph", contractRouteHandlers(apicontract.ResetLocalGraph, resetLocalGraph)...)
	ginServer.Handle("POST", "/api/graph/setGraphConf", contractRouteHandlers(apicontract.SetGraphConf, setGraphConf)...)
	ginServer.Handle("POST", "/api/graph/getGraph", contractRouteHandlers(apicontract.GetGraph, getGraph)...)
	ginServer.Handle("POST", "/api/graph/getLocalGraph", contractRouteHandlers(apicontract.GetLocalGraph, getLocalGraph)...)
}

// registerBazaarRoutes 注册本域的契约路由。
func registerBazaarRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/bazaar/getBazaarPlugin", contractRouteHandlers(apicontract.GetBazaarPlugin, getBazaarPlugin)...)
	ginServer.Handle("POST", "/api/bazaar/getInstalledPlugin", contractRouteHandlers(apicontract.GetInstalledPlugin, getInstalledPlugin)...)
	ginServer.Handle("POST", "/api/bazaar/installBazaarPlugin", contractRouteHandlers(apicontract.InstallBazaarPlugin, installBazaarPlugin)...)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarPlugin", contractRouteHandlers(apicontract.UninstallBazaarPlugin, uninstallBazaarPlugin)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarWidget", contractRouteHandlers(apicontract.GetBazaarWidget, getBazaarWidget)...)
	ginServer.Handle("POST", "/api/bazaar/getInstalledWidget", contractRouteHandlers(apicontract.GetInstalledWidget, getInstalledWidget)...)
	ginServer.Handle("POST", "/api/bazaar/installBazaarWidget", contractRouteHandlers(apicontract.InstallBazaarWidget, installBazaarWidget)...)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarWidget", contractRouteHandlers(apicontract.UninstallBazaarWidget, uninstallBazaarWidget)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarIcon", contractRouteHandlers(apicontract.GetBazaarIcon, getBazaarIcon)...)
	ginServer.Handle("POST", "/api/bazaar/getInstalledIcon", contractRouteHandlers(apicontract.GetInstalledIcon, getInstalledIcon)...)
	ginServer.Handle("POST", "/api/bazaar/installBazaarIcon", contractRouteHandlers(apicontract.InstallBazaarIcon, installBazaarIcon)...)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarIcon", contractRouteHandlers(apicontract.UninstallBazaarIcon, uninstallBazaarIcon)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarTemplate", contractRouteHandlers(apicontract.GetBazaarTemplate, getBazaarTemplate)...)
	ginServer.Handle("POST", "/api/bazaar/getInstalledTemplate", contractRouteHandlers(apicontract.GetInstalledTemplate, getInstalledTemplate)...)
	ginServer.Handle("POST", "/api/bazaar/installBazaarTemplate", contractRouteHandlers(apicontract.InstallBazaarTemplate, installBazaarTemplate)...)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarTemplate", contractRouteHandlers(apicontract.UninstallBazaarTemplate, uninstallBazaarTemplate)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarTheme", contractRouteHandlers(apicontract.GetBazaarTheme, getBazaarTheme)...)
	ginServer.Handle("POST", "/api/bazaar/getInstalledTheme", contractRouteHandlers(apicontract.GetInstalledTheme, getInstalledTheme)...)
	ginServer.Handle("POST", "/api/bazaar/installBazaarTheme", contractRouteHandlers(apicontract.InstallBazaarTheme, installBazaarTheme)...)
	ginServer.Handle("POST", "/api/bazaar/uninstallBazaarTheme", contractRouteHandlers(apicontract.UninstallBazaarTheme, uninstallBazaarTheme)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarPackageREADME", contractRouteHandlers(apicontract.GetBazaarPackageREADME, getBazaarPackageREADME)...)
	ginServer.Handle("POST", "/api/bazaar/getInstalledPackageSize", contractRouteHandlers(apicontract.GetInstalledPackageSize, getInstalledPackageSize)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarPackage", contractRouteHandlers(apicontract.GetBazaarPackage, getBazaarPackage)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarPackageRatings", contractRouteHandlers(apicontract.GetBazaarPackageRatings, getBazaarPackageRatings)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarPackageUserRatings", contractRouteHandlers(apicontract.GetBazaarPackageUserRatings, getBazaarPackageUserRatings)...)
	ginServer.Handle("POST", "/api/bazaar/getBazaarPackageRating", contractRouteHandlers(apicontract.GetBazaarPackageRating, getBazaarPackageRating)...)
	ginServer.Handle("POST", "/api/bazaar/setBazaarPackageRating", contractRouteHandlers(apicontract.SetBazaarPackageRating, setBazaarPackageRating)...)
	ginServer.Handle("POST", "/api/bazaar/getUpdatedPackage", contractRouteHandlers(apicontract.GetUpdatedPackage, getUpdatedPackage)...)
	ginServer.Handle("POST", "/api/bazaar/updateBazaarPackage", contractRouteHandlers(apicontract.UpdateBazaarPackage, updateBazaarPackage)...)
	ginServer.Handle("POST", "/api/bazaar/batchUpdatePackage", contractRouteHandlers(apicontract.BatchUpdatePackage, batchUpdatePackage)...)
	ginServer.Handle("POST", "/api/bazaar/installLocalBazaarPackage", contractRouteHandlers(apicontract.InstallLocalBazaarPackage, installLocalBazaarPackage)...)
}

// registerRepoRoutes 注册本域的契约路由。
func registerRepoRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/repo/initRepoKey", contractRouteHandlers(apicontract.InitRepoKey, initRepoKey)...)
	ginServer.Handle("POST", "/api/repo/initRepoKeyFromPassphrase", contractRouteHandlers(apicontract.InitRepoKeyFromPassphrase, initRepoKeyFromPassphrase)...)
	ginServer.Handle("POST", "/api/repo/resetRepo", contractRouteHandlers(apicontract.ResetRepo, resetRepo)...)
	ginServer.Handle("POST", "/api/repo/purgeRepo", contractRouteHandlers(apicontract.PurgeRepo, purgeRepo)...)
	ginServer.Handle("POST", "/api/repo/purgeCloudRepo", contractRouteHandlers(apicontract.PurgeCloudRepo, purgeCloudRepo)...)
	ginServer.Handle("POST", "/api/repo/importRepoKey", contractRouteHandlers(apicontract.ImportRepoKey, importRepoKey)...)
	ginServer.Handle("POST", "/api/repo/createSnapshot", contractRouteHandlers(apicontract.CreateSnapshot, createSnapshot)...)
	ginServer.Handle("POST", "/api/repo/checkSnapshot", contractRouteHandlers(apicontract.CheckSnapshot, checkSnapshot)...)
	ginServer.Handle("POST", "/api/repo/setSnapshotMemo", contractRouteHandlers(apicontract.SetSnapshotMemo, setSnapshotMemo)...)
	ginServer.Handle("POST", "/api/repo/tagSnapshot", contractRouteHandlers(apicontract.TagSnapshot, tagSnapshot)...)
	ginServer.Handle("POST", "/api/repo/checkoutRepo", contractRouteHandlers(apicontract.CheckoutRepo, checkoutRepo)...)
	ginServer.Handle("POST", "/api/repo/getRepoSnapshots", contractRouteHandlers(apicontract.GetRepoSnapshots, getRepoSnapshots)...)
	ginServer.Handle("POST", "/api/repo/searchRepoFile", contractRouteHandlers(apicontract.SearchRepoFile, searchRepoFile)...)
	ginServer.Handle("POST", "/api/repo/getRepoDocHistory", contractRouteHandlers(apicontract.GetRepoDocHistory, getRepoDocHistory)...)
	ginServer.Handle("POST", "/api/repo/getRepoTagSnapshots", contractRouteHandlers(apicontract.GetRepoTagSnapshots, getRepoTagSnapshots)...)
	ginServer.Handle("POST", "/api/repo/removeRepoTagSnapshot", contractRouteHandlers(apicontract.RemoveRepoTagSnapshot, removeRepoTagSnapshot)...)
	ginServer.Handle("POST", "/api/repo/getCloudRepoTagSnapshots", contractRouteHandlers(apicontract.GetCloudRepoTagSnapshots, getCloudRepoTagSnapshots)...)
	ginServer.Handle("POST", "/api/repo/getCloudRepoSnapshots", contractRouteHandlers(apicontract.GetCloudRepoSnapshots, getCloudRepoSnapshots)...)
	ginServer.Handle("POST", "/api/repo/removeCloudRepoTagSnapshot", contractRouteHandlers(apicontract.RemoveCloudRepoTagSnapshot, removeCloudRepoTagSnapshot)...)
	ginServer.Handle("POST", "/api/repo/uploadCloudSnapshot", contractRouteHandlers(apicontract.UploadCloudSnapshot, uploadCloudSnapshot)...)
	ginServer.Handle("POST", "/api/repo/downloadCloudSnapshot", contractRouteHandlers(apicontract.DownloadCloudSnapshot, downloadCloudSnapshot)...)
	ginServer.Handle("POST", "/api/repo/diffRepoSnapshots", contractRouteHandlers(apicontract.DiffRepoSnapshots, diffRepoSnapshots)...)
	ginServer.Handle("POST", "/api/repo/openRepoSnapshotFile", contractRouteHandlers(apicontract.OpenRepoSnapshotFile, openRepoSnapshotFile)...)
	ginServer.Handle("POST", "/api/repo/rollbackRepoSnapshotFile", contractRouteHandlers(apicontract.RollbackRepoSnapshotFile, rollbackRepoSnapshotFile)...)
	ginServer.Handle("POST", "/api/repo/exportRepoFile", contractRouteHandlers(apicontract.ExportRepoFile, exportRepoFile)...)
	ginServer.Handle("POST", "/api/repo/getRepoFile", contractRouteHandlers(apicontract.GetRepoFile, getRepoFile)...)
	ginServer.Handle("POST", "/api/repo/setRepoIndexRetentionDays", contractRouteHandlers(apicontract.SetRepoIndexRetentionDays, setRepoIndexRetentionDays)...)
	ginServer.Handle("POST", "/api/repo/setRetentionIndexesDaily", contractRouteHandlers(apicontract.SetRetentionIndexesDaily, setRetentionIndexesDaily)...)
}

// registerRiffRoutes 注册本域的契约路由。
func registerRiffRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/riff/createRiffDeck", contractRouteHandlers(apicontract.CreateRiffDeck, createRiffDeck)...)
	ginServer.Handle("POST", "/api/riff/renameRiffDeck", contractRouteHandlers(apicontract.RenameRiffDeck, renameRiffDeck)...)
	ginServer.Handle("POST", "/api/riff/removeRiffDeck", contractRouteHandlers(apicontract.RemoveRiffDeck, removeRiffDeck)...)
	ginServer.Handle("POST", "/api/riff/getRiffDecks", contractRouteHandlers(apicontract.GetRiffDecks, getRiffDecks)...)
	ginServer.Handle("POST", "/api/riff/addRiffCards", contractRouteHandlers(apicontract.AddRiffCards, addRiffCards)...)
	ginServer.Handle("POST", "/api/riff/removeRiffCards", contractRouteHandlers(apicontract.RemoveRiffCards, removeRiffCards)...)
	ginServer.Handle("POST", "/api/riff/getRiffDueCards", contractRouteHandlers(apicontract.GetRiffDueCards, getRiffDueCards)...)
	ginServer.Handle("POST", "/api/riff/getTreeRiffDueCards", contractRouteHandlers(apicontract.GetTreeRiffDueCards, getTreeRiffDueCards)...)
	ginServer.Handle("POST", "/api/riff/getNotebookRiffDueCards", contractRouteHandlers(apicontract.GetNotebookRiffDueCards, getNotebookRiffDueCards)...)
	ginServer.Handle("POST", "/api/riff/reviewRiffCard", contractRouteHandlers(apicontract.ReviewRiffCard, reviewRiffCard)...)
	ginServer.Handle("POST", "/api/riff/skipReviewRiffCard", contractRouteHandlers(apicontract.SkipReviewRiffCard, skipReviewRiffCard)...)
	ginServer.Handle("POST", "/api/riff/getRiffCards", contractRouteHandlers(apicontract.GetRiffCards, getRiffCards)...)
	ginServer.Handle("POST", "/api/riff/getTreeRiffCards", contractRouteHandlers(apicontract.GetTreeRiffCards, getTreeRiffCards)...)
	ginServer.Handle("POST", "/api/riff/getNotebookRiffCards", contractRouteHandlers(apicontract.GetNotebookRiffCards, getNotebookRiffCards)...)
	ginServer.Handle("POST", "/api/riff/resetRiffCards", contractRouteHandlers(apicontract.ResetRiffCards, resetRiffCards)...)
	ginServer.Handle("POST", "/api/riff/batchSetRiffCardsDueTime", contractRouteHandlers(apicontract.BatchSetRiffCardsDueTime, batchSetRiffCardsDueTime)...)
	ginServer.Handle("POST", "/api/riff/getRiffCardsByBlockIDs", contractRouteHandlers(apicontract.GetRiffCardsByBlockIDs, getRiffCardsByBlockIDs)...)
}

// registerNotificationRoutes 注册本域的契约路由。
func registerNotificationRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/notification/pushMsg", contractRouteHandlers(apicontract.PushMsg, pushMsg)...)
	ginServer.Handle("POST", "/api/notification/pushErrMsg", contractRouteHandlers(apicontract.PushErrMsg, pushErrMsg)...)
}

// registerSnippetRoutes 注册本域的契约路由。
func registerSnippetRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/snippet/getSnippet", contractRouteHandlers(apicontract.GetSnippet, getSnippet)...)
	ginServer.Handle("POST", "/api/snippet/setSnippet", contractRouteHandlers(apicontract.SetSnippet, setSnippet)...)
	ginServer.Handle("POST", "/api/snippet/removeSnippet", contractRouteHandlers(apicontract.RemoveSnippet, removeSnippet)...)
}

// registerAvRoutes 注册本域的契约路由。
func registerAvRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/av/renderAttributeView", contractRouteHandlers(apicontract.RenderAttributeView, renderAttributeView)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewCalendarUndated", contractRouteHandlers(apicontract.GetAttributeViewCalendarUndated, getAttributeViewCalendarUndated)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewItemStatuses", contractRouteHandlers(apicontract.GetAttributeViewItemStatuses, getAttributeViewItemStatuses)...)
	ginServer.Handle("POST", "/api/av/renderHistoryAttributeView", contractRouteHandlers(apicontract.RenderHistoryAttributeView, renderHistoryAttributeView)...)
	ginServer.Handle("POST", "/api/av/renderSnapshotAttributeView", contractRouteHandlers(apicontract.RenderSnapshotAttributeView, renderSnapshotAttributeView)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewKeys", contractRouteHandlers(apicontract.GetAttributeViewKeys, getAttributeViewKeys)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewSearchTarget", contractRouteHandlers(apicontract.GetAttributeViewSearchTarget, getAttributeViewSearchTarget)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewFieldViews", contractRouteHandlers(apicontract.GetAttributeViewFieldViews, getAttributeViewFieldViews)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewBacklinks", contractRouteHandlers(apicontract.GetAttributeViewBacklinks, getAttributeViewBacklinks)...)
	ginServer.Handle("POST", "/api/av/setAttributeViewBlockAttr", contractRouteHandlers(apicontract.SetAttributeViewBlockAttr, setAttributeViewBlockAttr)...)
	ginServer.Handle("POST", "/api/av/batchSetAttributeViewBlockAttrs", contractRouteHandlers(apicontract.BatchSetAttributeViewBlockAttrs, batchSetAttributeViewBlockAttrs)...)
	ginServer.Handle("POST", "/api/av/searchAttributeView", contractRouteHandlers(apicontract.SearchAttributeView, searchAttributeView)...)
	ginServer.Handle("POST", "/api/av/getAttributeView", contractRouteHandlers(apicontract.GetAttributeView, getAttributeView)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewPasteRows", contractRouteHandlers(apicontract.GetAttributeViewPasteRows, getAttributeViewPasteRows)...)
	ginServer.Handle("POST", "/api/av/searchAttributeViewRelationKey", contractRouteHandlers(apicontract.SearchAttributeViewRelationKey, searchAttributeViewRelationKey)...)
	ginServer.Handle("POST", "/api/av/searchAttributeViewNonRelationKey", contractRouteHandlers(apicontract.SearchAttributeViewNonRelationKey, searchAttributeViewNonRelationKey)...)
	ginServer.Handle("POST", "/api/av/searchAttributeViewRollupDestKeys", contractRouteHandlers(apicontract.SearchAttributeViewRollupDestKeys, searchAttributeViewRollupDestKeys)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewFilterSort", contractRouteHandlers(apicontract.GetAttributeViewFilterSort, getAttributeViewFilterSort)...)
	ginServer.Handle("POST", "/api/av/setAttrViewFilters", contractRouteHandlers(apicontract.SetAttrViewFilters, setAttrViewFilters)...)
	ginServer.Handle("POST", "/api/av/setAttrViewContextFilter", contractRouteHandlers(apicontract.SetAttrViewContextFilter, setAttrViewContextFilter)...)
	ginServer.Handle("POST", "/api/av/setAttrViewSorts", contractRouteHandlers(apicontract.SetAttrViewSorts, setAttrViewSorts)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewRowSort", contractRouteHandlers(apicontract.GetAttributeViewRowSort, getAttributeViewRowSort)...)
	ginServer.Handle("POST", "/api/av/addAttributeViewKey", contractRouteHandlers(apicontract.AddAttributeViewKey, addAttributeViewKey)...)
	ginServer.Handle("POST", "/api/av/removeAttributeViewKey", contractRouteHandlers(apicontract.RemoveAttributeViewKey, removeAttributeViewKey)...)
	ginServer.Handle("POST", "/api/av/sortAttributeViewViewKey", contractRouteHandlers(apicontract.SortAttributeViewViewKey, sortAttributeViewViewKey)...)
	ginServer.Handle("POST", "/api/av/sortAttributeViewKey", contractRouteHandlers(apicontract.SortAttributeViewKey, sortAttributeViewKey)...)
	ginServer.Handle("POST", "/api/av/addAttributeViewBlocks", contractRouteHandlers(apicontract.AddAttributeViewBlocks, addAttributeViewBlocks)...)
	ginServer.Handle("POST", "/api/av/removeAttributeViewBlocks", contractRouteHandlers(apicontract.RemoveAttributeViewBlocks, removeAttributeViewBlocks)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewPrimaryKeyValues", contractRouteHandlers(apicontract.GetAttributeViewPrimaryKeyValues, getAttributeViewPrimaryKeyValues)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewRelationCandidates", contractRouteHandlers(apicontract.GetAttributeViewRelationCandidates, getAttributeViewRelationCandidates)...)
	ginServer.Handle("POST", "/api/av/setDatabaseBlockView", contractRouteHandlers(apicontract.SetDatabaseBlockView, setDatabaseBlockView)...)
	ginServer.Handle("POST", "/api/av/getMirrorDatabaseBlocks", contractRouteHandlers(apicontract.GetMirrorDatabaseBlocks, getMirrorDatabaseBlocks)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewKeysByAvID", contractRouteHandlers(apicontract.GetAttributeViewKeysByAvID, getAttributeViewKeysByAvID)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewKeysByID", contractRouteHandlers(apicontract.GetAttributeViewKeysByID, getAttributeViewKeysByID)...)
	ginServer.Handle("POST", "/api/av/duplicateAttributeViewBlock", contractRouteHandlers(apicontract.DuplicateAttributeViewBlock, duplicateAttributeViewBlock)...)
	ginServer.Handle("POST", "/api/av/appendAttributeViewDetachedBlocksWithValues", contractRouteHandlers(apicontract.AppendAttributeViewDetachedBlocksWithValues, appendAttributeViewDetachedBlocksWithValues)...)
	ginServer.Handle("POST", "/api/av/getCurrentAttrViewImages", contractRouteHandlers(apicontract.GetCurrentAttrViewImages, getCurrentAttrViewImages)...)
	ginServer.Handle("POST", "/api/av/changeAttrViewLayout", contractRouteHandlers(apicontract.ChangeAttrViewLayout, changeAttrViewLayout)...)
	ginServer.Handle("POST", "/api/av/setAttrViewGroup", contractRouteHandlers(apicontract.SetAttrViewGroup, setAttrViewGroup)...)
	ginServer.Handle("POST", "/api/av/batchReplaceAttributeViewBlocks", contractRouteHandlers(apicontract.BatchReplaceAttributeViewBlocks, batchReplaceAttributeViewBlocks)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewAddingBlockDefaultValues", contractRouteHandlers(apicontract.GetAttributeViewAddingBlockDefaultValues, getAttributeViewAddingBlockDefaultValues)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewBoundBlockIDsByItemIDs", contractRouteHandlers(apicontract.GetAttributeViewBoundBlockIDsByItemIDs, getAttributeViewBoundBlockIDsByItemIDs)...)
	ginServer.Handle("POST", "/api/av/getAttributeViewItemIDsByBoundIDs", contractRouteHandlers(apicontract.GetAttributeViewItemIDsByBoundIDs, getAttributeViewItemIDsByBoundIDs)...)
	ginServer.Handle("POST", "/api/av/getUnusedAttributeViews", contractRouteHandlers(apicontract.GetUnusedAttributeViews, getUnusedAttributeViews)...)
	ginServer.Handle("POST", "/api/av/createAttributeViewItem", contractRouteHandlers(apicontract.CreateAttributeViewItem, createAttributeViewItem)...)
	ginServer.Handle("POST", "/api/av/createAttributeViewRelationItem", contractRouteHandlers(apicontract.CreateAttributeViewRelationItem, createAttributeViewRelationItem)...)
	ginServer.Handle("POST", "/api/av/createAttributeViewItemWithMarkdown", contractRouteHandlers(apicontract.CreateAttributeViewItemWithMarkdown, createAttributeViewItemWithMarkdown)...)
	ginServer.Handle("POST", "/api/av/createAttributeViewItemDocs", contractRouteHandlers(apicontract.CreateAttributeViewItemDocs, createAttributeViewItemDocs)...)
	ginServer.Handle("POST", "/api/av/removeUnusedAttributeViews", contractRouteHandlers(apicontract.RemoveUnusedAttributeViews, removeUnusedAttributeViews)...)
	ginServer.Handle("POST", "/api/av/removeUnusedAttributeView", contractRouteHandlers(apicontract.RemoveUnusedAttributeView, removeUnusedAttributeView)...)
}

// registerPetalRoutes 注册本域的契约路由。
func registerPetalRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/petal/loadPetals", contractRouteHandlers(apicontract.LoadPetals, loadPetals)...)
	ginServer.Handle("POST", "/api/petal/setPetalEnabled", contractRouteHandlers(apicontract.SetPetalEnabled, setPetalEnabled)...)
	ginServer.Handle("POST", "/api/petal/setPetalPublishEnabled", contractRouteHandlers(apicontract.SetPetalPublishEnabled, setPetalPublishEnabled)...)
	ginServer.Handle("POST", "/api/petal/getPluginPublishInfo", contractRouteHandlers(apicontract.GetPluginPublishInfo, getPluginPublishInfo)...)
	ginServer.Handle("POST", "/api/petal/setPluginPublishDataGrant", contractRouteHandlers(apicontract.SetPluginPublishDataGrant, setPluginPublishDataGrant)...)
	ginServer.Handle("POST", "/api/petal/savePluginPublishData", contractRouteHandlers(apicontract.SavePluginPublishData, savePluginPublishData)...)
	ginServer.Handle("POST", "/api/petal/loadPluginPublishData", contractRouteHandlers(apicontract.LoadPluginPublishData, loadPluginPublishData)...)
}

// registerPluginRoutes 注册本域的契约路由。
func registerPluginRoutes(ginServer *gin.Engine) {
	ginServer.Handle("GET", "/api/plugin/rpc", contractRouteHandlers(apicontract.GetLoadedPluginRPC, getLoadedPluginRPC)...)
	ginServer.Handle("GET", "/api/plugin/rpc/:name", contractRouteHandlers(apicontract.GetLoadedPluginRPCByName, getLoadedPluginRPCByName)...)
	ginServer.Handle("GET", "/api/plugin", contractRouteHandlers(apicontract.ListLoadedPluginsGET, listLoadedPluginsGET)...)
	ginServer.Handle("POST", "/api/plugin/getLoadedPlugin", contractRouteHandlers(apicontract.GetLoadedPlugin, getLoadedPlugin)...)
	ginServer.Handle("POST", "/api/plugin/listLoadedPlugins", contractRouteHandlers(apicontract.ListLoadedPlugins, listLoadedPlugins)...)
	ginServer.Handle("POST", "/api/plugin/rpc", contractRouteHandlers(apicontract.PluginRPCHTTP, pluginJsonRpcHttp)...)
	ginServer.Handle("POST", "/api/plugin/rpc/:name", contractRouteHandlers(apicontract.PluginRPCHTTPByName, pluginJsonRpcHttpByName)...)
	ginServer.Handle("GET", "/ws/plugin/rpc", contractRouteHandlers(apicontract.PluginRPCWebSocket, pluginJsonRpcWebSocket)...)
	ginServer.Handle("GET", "/ws/plugin/rpc/:name", contractRouteHandlers(apicontract.PluginRPCWebSocketByName, pluginJsonRpcWebSocketByName)...)
	ginServer.Any("/plugin/private/:name/*path", contractRouteHandlers(apicontract.PluginPrivateService, pluginPrivateWebServer)...)
}

// registerNetworkRoutes 注册本域的契约路由。
func registerNetworkRoutes(ginServer *gin.Engine) {
	ginServer.Any("/api/network/echo", contractRouteHandlers(apicontract.NetworkEcho, echo)...)
	ginServer.Any("/api/network/echo/*path", contractRouteHandlers(apicontract.NetworkEchoPath, echoPath)...)
	ginServer.Handle("POST", "/api/network/forwardProxy", contractRouteHandlers(apicontract.NetworkForwardProxy, forwardProxy)...)
	ginServer.Any("/api/network/proxy", contractRouteHandlers(apicontract.NetworkHTTPProxy, httpProxy)...)
	ginServer.Handle("GET", "/ws/network/proxy", contractRouteHandlers(apicontract.NetworkWebSocketProxy, wsProxy)...)
	ginServer.Handle("GET", "/es/network/proxy", contractRouteHandlers(apicontract.NetworkEventSourceProxy, esProxy)...)
}

// registerBroadcastRoutes 注册本域的契约路由。
func registerBroadcastRoutes(ginServer *gin.Engine) {
	ginServer.Handle("GET", "/ws/broadcast", contractRouteHandlers(apicontract.BroadcastWebSocket, broadcast)...)
	ginServer.Handle("GET", "/es/broadcast/subscribe", contractRouteHandlers(apicontract.BroadcastSubscribe, broadcastSubscribe)...)
	ginServer.Handle("POST", "/api/broadcast/publish", contractRouteHandlers(apicontract.BroadcastPublish, broadcastPublish)...)
	ginServer.Handle("POST", "/api/broadcast/postMessage", contractRouteHandlers(apicontract.PostBroadcastMessage, postMessage)...)
	ginServer.Handle("POST", "/api/broadcast/getChannels", contractRouteHandlers(apicontract.GetBroadcastChannels, getChannels)...)
	ginServer.Handle("POST", "/api/broadcast/getChannelInfo", contractRouteHandlers(apicontract.GetBroadcastChannelInfo, getChannelInfo)...)
}

// registerArchiveRoutes 注册本域的契约路由。
func registerArchiveRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/archive/zip", contractRouteHandlers(apicontract.Zip, zip)...)
	ginServer.Handle("POST", "/api/archive/unzip", contractRouteHandlers(apicontract.Unzip, unzip)...)
}

// registerUiRoutes 注册本域的契约路由。
func registerUiRoutes(ginServer *gin.Engine) {
	ginServer.Handle("POST", "/api/ui/reloadUI", contractRouteHandlers(apicontract.ReloadUI, reloadUI)...)
	ginServer.Handle("POST", "/api/ui/reloadIcon", contractRouteHandlers(apicontract.ReloadIcon, reloadIcon)...)
	ginServer.Handle("POST", "/api/ui/reloadTheme", contractRouteHandlers(apicontract.ReloadTheme, reloadTheme)...)
	ginServer.Handle("POST", "/api/ui/reloadAttributeView", contractRouteHandlers(apicontract.ReloadAttributeView, reloadAttributeView)...)
	ginServer.Handle("POST", "/api/ui/reloadProtyle", contractRouteHandlers(apicontract.ReloadProtyle, reloadProtyle)...)
	ginServer.Handle("POST", "/api/ui/reloadFiletree", contractRouteHandlers(apicontract.ReloadFiletree, reloadFiletree)...)
	ginServer.Handle("POST", "/api/ui/reloadTag", contractRouteHandlers(apicontract.ReloadTag, reloadTag)...)
}
