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
	"reflect"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	mcpserver "github.com/siyuan-note/siyuan/kernel/mcp"
	mcpclient "github.com/siyuan-note/siyuan/kernel/mcp/client"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/server/proxy"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	bazaarPetalStateMu       sync.Mutex
	bazaarPetalStateRevision uint64
)

var setEditorReadOnly = contractHandler(apicontract.SetEditorReadOnly, func(c *gin.Context, request apicontract.EditorReadOnlyRequest) apicontract.Response[apicontract.Null] {
	oldReadOnly := model.Conf.Editor.ReadOnly
	model.Conf.Editor.ReadOnly = request.ReadOnly
	model.Conf.Save()
	if oldReadOnly != model.Conf.Editor.ReadOnly {
		util.BroadcastByType("protyle", "readonly", 0, "", model.Conf.Editor.ReadOnly)
		util.BroadcastByType("main", "readonly", 0, "", model.Conf.Editor.ReadOnly)
	}
	return apicontract.Success(apicontract.Null{})
})

var setConfSnippet = contractHandler(apicontract.SetConfSnippet, func(c *gin.Context, request apicontract.SetConfSnippetRequest) (ret apicontract.Response[*apicontract.SettingSnpt]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingSnpt](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingSnpt)(nil))

	param := request.ConfigJSON()
	var err error

	snippet := &conf.Snpt{}
	if err = gulu.JSON.UnmarshalJSON(param, snippet); err != nil {
		ret = apicontract.Failure[*apicontract.SettingSnpt](-1, err.Error())
		return
	}

	model.Conf.Snippet = snippet
	model.Conf.Save()

	ret = apicontract.Success(settingSnptPayload(snippet))
	model.PushReloadSnippet(snippet)
	return
})

var addVirtualBlockRefExclude = contractHandler(apicontract.AddVirtualBlockRefExclude, func(c *gin.Context, request apicontract.VirtualBlockRefRequest) apicontract.Response[apicontract.Null] {
	model.AddVirtualBlockRefExclude(request.Keywords)
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
	return apicontract.Success(apicontract.Null{})
})

var addVirtualBlockRefInclude = contractHandler(apicontract.AddVirtualBlockRefInclude, func(c *gin.Context, request apicontract.VirtualBlockRefRequest) apicontract.Response[apicontract.Null] {
	model.AddVirtualBlockRefInclude(request.Keywords)
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
	return apicontract.Success(apicontract.Null{})
})

var refreshVirtualBlockRef = contractHandler(apicontract.RefreshVirtualBlockRef, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	model.ResetVirtualBlockRefCache()
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
	return apicontract.Success(apicontract.Null{})
})

var setBazaar = contractHandler(apicontract.SetBazaar, func(c *gin.Context, request apicontract.SetBazaarRequest) (ret apicontract.Response[*apicontract.SettingBazaar]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingBazaar](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingBazaar)(nil))

	param := request.ConfigJSON()
	var err error

	bazaar := &conf.Bazaar{}
	if err = gulu.JSON.UnmarshalJSON(param, bazaar); err != nil {
		ret = apicontract.Failure[*apicontract.SettingBazaar](-1, err.Error())
		return
	}

	bazaarPetalStateMu.Lock()
	defer bazaarPetalStateMu.Unlock()

	petalsEnabled := model.IsPetalsEnabled()
	petalDisabled := model.Conf.Bazaar.PetalDisabled
	model.Conf.Bazaar = bazaar
	model.Conf.Save()
	newPetalsEnabled := model.IsPetalsEnabled()
	if petalsEnabled != newPetalsEnabled {
		setKernelPluginsEnabled(newPetalsEnabled)
	}
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
	if petalsEnabled != newPetalsEnabled || petalDisabled != bazaar.PetalDisabled {
		bazaarPetalStateRevision++
		model.PushReloadAllEnabledPlugins(newPetalsEnabled, bazaar.PetalDisabled, bazaarPetalStateRevision, true)
	}

	ret = apicontract.Success(settingBazaarPayload(bazaar))
	return
})

var setBazaarPetalDisabled = contractHandler(apicontract.SetBazaarPetalDisabled, func(c *gin.Context, request apicontract.SettingPetalDisabledRequest) apicontract.Response[apicontract.SettingPetalDisabledData] {
	petalDisabled := request.PetalDisabled
	bazaarPetalStateMu.Lock()
	defer bazaarPetalStateMu.Unlock()
	petalsEnabled := model.IsPetalsEnabled()
	changed := model.Conf.Bazaar.PetalDisabled != petalDisabled
	model.Conf.Bazaar.PetalDisabled = petalDisabled
	model.Conf.Save()
	newPetalsEnabled := model.IsPetalsEnabled()
	if petalsEnabled != newPetalsEnabled {
		setKernelPluginsEnabled(newPetalsEnabled)
	}
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
	if changed {
		bazaarPetalStateRevision++
	}
	payload := model.PushReloadAllEnabledPlugins(newPetalsEnabled, petalDisabled, bazaarPetalStateRevision, changed)
	encoded, err := gulu.JSON.MarshalJSON(payload)
	if err != nil {
		return apicontract.Failure[apicontract.SettingPetalDisabledData](-1, err.Error())
	}
	var data apicontract.SettingPetalDisabledData
	if err = gulu.JSON.UnmarshalJSON(encoded, &data); err != nil {
		return apicontract.Failure[apicontract.SettingPetalDisabledData](-1, err.Error())
	}
	return apicontract.Success(data)
})

func setKernelPluginsEnabled(enabled bool) {
	if enabled {
		if model.OnKernelPluginsStart != nil {
			model.OnKernelPluginsStart()
		}
		return
	}
	if model.OnKernelPluginsStop != nil {
		model.OnKernelPluginsStop()
	}
}

var setAI = contractHandler(apicontract.SetAI, func(c *gin.Context, request apicontract.SetAIRequest) (ret apicontract.Response[*apicontract.SettingAI]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingAI](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingAI)(nil))

	param := request.ConfigJSON()
	var err error

	ai := &conf.AI{}
	if err = gulu.JSON.UnmarshalJSON(param, ai); err != nil {
		ret = apicontract.Failure[*apicontract.SettingAI](-1, err.Error())
		return
	}
	if ai.MCP != nil {
		for _, server := range ai.MCP.Servers {
			if err = mcpclient.ValidateMCPServerEnvironment(server); err != nil {
				ret = apicontract.Failure[*apicontract.SettingAI](-1, "invalid MCP server environment: "+err.Error())
				return
			}
		}
	}
	if err = validateAIProviderHeaders(ai); err != nil {
		ret = apicontract.Failure[*apicontract.SettingAI](-1, err.Error())
		return
	}

	var oldServers []conf.MCPServer
	if model.Conf.AI != nil && model.Conf.AI.MCP != nil {
		oldServers = append(oldServers, model.Conf.AI.MCP.Servers...)
	}
	if ai.MCP != nil {
		preserveMCPServerIDs(oldServers, ai.MCP.Servers)
	}
	ai.Normalize()
	ai.ReconcileModelIDs()
	model.Conf.SetAI(ai)
	mcpserver.RefreshToolExposure()

	// MCP 配置可能变更（开关切换、编辑、增删 server），异步重连让连接立即跟上。
	if model.Conf.AI.MCP != nil {
		newServers := model.Conf.AI.MCP.Servers
		oldByID := make(map[string]conf.MCPServer, len(oldServers))
		newByID := make(map[string]conf.MCPServer, len(newServers))
		for _, server := range oldServers {
			oldByID[server.ID] = server
		}
		for _, server := range newServers {
			newByID[server.ID] = server
		}

		var interactiveServerIDs []string
		for _, server := range newServers {
			old, existed := oldByID[server.ID]
			if server.Enabled && server.Type == "http" && (!existed || !reflect.DeepEqual(old, server)) {
				interactiveServerIDs = append(interactiveServerIDs, server.ID)
			}
		}
		for _, server := range oldServers {
			updated, exists := newByID[server.ID]
			if !exists || (server.Type == "http" && (updated.Type != "http" || updated.URL != server.URL)) {
				if revokeErr := mcpclient.DisconnectMCPOAuth(server.ID); revokeErr != nil {
					logging.LogWarnf("mcp oauth: disconnect server [%s] failed: %s", server.Name, revokeErr)
				}
			}
		}
		if !reflect.DeepEqual(oldServers, newServers) {
			mcpclient.ReconnectMCPAsync(newServers, nil, interactiveServerIDs)
		}
	}

	ret = apicontract.Success(settingAIPayload(model.Conf.AI))
	return
})

func preserveMCPServerIDs(oldServers, newServers []conf.MCPServer) {
	oldIDsByName := make(map[string]string, len(oldServers))
	for _, server := range oldServers {
		oldIDsByName[server.Name] = server.ID
	}
	for i := range newServers {
		if newServers[i].ID == "" {
			newServers[i].ID = oldIDsByName[newServers[i].Name]
		}
	}
}

var setSecrets = contractHandler(apicontract.SetSecrets, func(c *gin.Context, request apicontract.SetSecretsRequest) (ret apicontract.Response[*apicontract.SettingSecrets]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingSecrets](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingSecrets)(nil))

	param := request.ConfigJSON()
	var err error

	secrets := &conf.Secrets{}
	if err = gulu.JSON.UnmarshalJSON(param, secrets); err != nil {
		ret = apicontract.Failure[*apicontract.SettingSecrets](-1, err.Error())
		return
	}

	model.Conf.Secrets = secrets
	model.Conf.Save()
	reconnectStdioMCPWithEnvironment()

	ret = apicontract.Success(settingSecretsPayload(model.Conf.Secrets))
	return
})

var setVariables = contractHandler(apicontract.SetVariables, func(c *gin.Context, request apicontract.SetVariablesRequest) (ret apicontract.Response[*apicontract.SettingVariables]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingVariables](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingVariables)(nil))

	param := request.ConfigJSON()
	var err error

	variables := &conf.Variables{}
	if err = gulu.JSON.UnmarshalJSON(param, variables); err != nil {
		ret = apicontract.Failure[*apicontract.SettingVariables](-1, err.Error())
		return
	}

	model.Conf.Variables = variables
	model.Conf.Save()
	reconnectStdioMCPWithEnvironment()

	ret = apicontract.Success(settingVariablesPayload(model.Conf.Variables))
	return
})

func reconnectStdioMCPWithEnvironment() {
	if model.Conf.AI == nil || model.Conf.AI.MCP == nil {
		return
	}
	serverIDs := stdioMCPServerIDsWithEnvironment(model.Conf.AI.MCP.Servers)
	if len(serverIDs) > 0 {
		mcpclient.ReconnectMCPAsync(model.Conf.AI.MCP.Servers, serverIDs, nil)
	}
}

func stdioMCPServerIDsWithEnvironment(servers []conf.MCPServer) []string {
	var serverIDs []string
	for _, server := range servers {
		if server.Enabled && server.Type == "stdio" && len(server.Env) > 0 {
			serverIDs = append(serverIDs, server.ID)
		}
	}
	return serverIDs
}

var setFlashcard = contractHandler(apicontract.SetFlashcard, func(c *gin.Context, request apicontract.SetFlashcardRequest) (ret apicontract.Response[*apicontract.SettingFlashcard]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingFlashcard](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingFlashcard)(nil))

	param := request.ConfigJSON()
	var err error

	flashcard := &conf.Flashcard{}
	if err = gulu.JSON.UnmarshalJSON(param, flashcard); err != nil {
		ret = apicontract.Failure[*apicontract.SettingFlashcard](-1, err.Error())
		return
	}

	if 0 > flashcard.NewCardLimit {
		flashcard.NewCardLimit = 20
	}

	if 0 > flashcard.ReviewCardLimit {
		flashcard.ReviewCardLimit = 200
	}

	model.Conf.Flashcard = flashcard
	model.Conf.Save()

	ret = apicontract.Success(settingFlashcardPayload(flashcard))
	return
})

var setEditor = contractHandler(apicontract.SetEditor, func(c *gin.Context, request apicontract.SetEditorRequest) (ret apicontract.Response[*apicontract.SettingEditor]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingEditor](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingEditor)(nil))

	param := request.ConfigJSON()
	var err error

	oldGenerateHistoryInterval := model.Conf.Editor.GenerateHistoryInterval

	editor := conf.NewEditor()
	if err = gulu.JSON.UnmarshalJSON(param, editor); err != nil {
		ret = apicontract.Failure[*apicontract.SettingEditor](-1, err.Error())
		return
	}
	if !request.HasField("fontFamilies") && editor.FontFamily == model.Conf.Editor.FontFamily &&
		editor.FontWeight == model.Conf.Editor.FontWeight {
		editor.FontFamilies = model.Conf.Editor.FontFamilies
	}
	if !request.HasField("codeFontFamilies") {
		editor.CodeFontFamilies = model.Conf.Editor.CodeFontFamilies
	}
	editor.NormalizeFontFamilies()

	if "" == editor.PlantUMLServePath {
		editor.PlantUMLServePath = "https://www.plantuml.com/plantuml/svg/~1"
	}

	if "" == editor.KaTexMacros {
		editor.KaTexMacros = "{}"
	}

	if 1 > editor.HistoryRetentionDays {
		editor.HistoryRetentionDays = 30
	}
	if 3650 < editor.HistoryRetentionDays {
		editor.HistoryRetentionDays = 3650
	}

	if nil == editor.FloatWindowDelay {
		editor.FloatWindowDelay = new(620)
	} else {
		*editor.FloatWindowDelay = max(0, min(2000, *editor.FloatWindowDelay))
	}
	editor.CursorSurroundingLines = conf.NormalizeCursorSurroundingLines(editor.CursorSurroundingLines)
	editor.AssetOpen = conf.NormalizeAssetOpen(editor.AssetOpen)

	oldVirtualBlockRef := model.Conf.Editor.VirtualBlockRef
	oldVirtualBlockRefInclude := model.Conf.Editor.VirtualBlockRefInclude
	oldVirtualBlockRefExclude := model.Conf.Editor.VirtualBlockRefExclude
	oldReadOnly := model.Conf.Editor.ReadOnly

	model.Conf.Editor = editor
	model.Conf.Save()

	if oldGenerateHistoryInterval != model.Conf.Editor.GenerateHistoryInterval {
		model.GenerateFileHistory()
		model.ChangeHistoryTick(editor.GenerateHistoryInterval)
	}

	if oldVirtualBlockRef != model.Conf.Editor.VirtualBlockRef ||
		oldVirtualBlockRefInclude != model.Conf.Editor.VirtualBlockRefInclude ||
		oldVirtualBlockRefExclude != model.Conf.Editor.VirtualBlockRefExclude {
		model.ResetVirtualBlockRefCache()
	}

	if oldReadOnly != model.Conf.Editor.ReadOnly {
		util.BroadcastByType("protyle", "readonly", 0, "", model.Conf.Editor.ReadOnly)
		util.BroadcastByType("main", "readonly", 0, "", model.Conf.Editor.ReadOnly)
	}

	util.MarkdownSettings = model.Conf.Editor.Markdown

	ret = apicontract.Success(settingEditorPayload(model.Conf.Editor))
	return
})

var setExport = contractHandler(apicontract.SetExport, func(c *gin.Context, request apicontract.SetExportRequest) (ret apicontract.Response[*apicontract.SettingExport]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.FailureWithTimeout[*apicontract.SettingExport](-1, err.Error(), 5000)
	}
	ret = apicontract.Success((*apicontract.SettingExport)(nil))

	param := request.ConfigJSON()
	var err error

	export := &conf.Export{}
	if err = gulu.JSON.UnmarshalJSON(param, export); err != nil {
		ret = apicontract.FailureWithTimeout[*apicontract.SettingExport](-1, err.Error(), 5000)
		return
	}

	previousPandocBin := model.Conf.Export.PandocBin
	if "" != export.PandocBin {
		if !util.IsValidPandocBin(export.PandocBin) {
			util.PushErrMsg(fmt.Sprintf(model.Conf.Language(117), export.PandocBin), 5000)
			export.PandocBin = previousPandocBin
		}
	}

	model.Conf.Export = export
	model.Conf.Save()
	if previousPandocBin != export.PandocBin {
		util.InitPandoc(export.PandocBin)
	}

	ret = apicontract.Success(settingExportPayload(model.Conf.Export))
	return
})

var getPandocBin = contractHandler(apicontract.GetPandocBin, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[string] {
	pandocRuntime := util.GetPandocRuntime()
	if !util.IsValidPandocBin(pandocRuntime.BinPath) {
		util.InitPandoc(model.Conf.Export.PandocBin)
		pandocRuntime = util.GetPandocRuntime()
	}
	if !util.IsValidPandocBin(pandocRuntime.BinPath) {
		return apicontract.Failure[string](-1, model.Conf.Language(115))
	}
	return apicontract.Success(pandocRuntime.BinPath)
})

var setFiletree = contractHandler(apicontract.SetFiletree, func(c *gin.Context, request apicontract.SetFiletreeRequest) (ret apicontract.Response[*apicontract.SettingFileTree]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingFileTree](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingFileTree)(nil))

	oldSortMode := model.Conf.FileTree.Sort
	param := request.ConfigJSON()
	var err error

	fileTree := conf.NewFileTree()
	fileTree.BoxDocEnabled = nil
	fileTree.UseSVGDefaultIcon = nil
	if err = gulu.JSON.UnmarshalJSON(param, fileTree); err != nil {
		ret = apicontract.Failure[*apicontract.SettingFileTree](-1, err.Error())
		return
	}
	if nil == fileTree.BoxDocEnabled {
		if nil != model.Conf.FileTree && nil != model.Conf.FileTree.BoxDocEnabled {
			fileTree.BoxDocEnabled = model.Conf.FileTree.BoxDocEnabled
		} else {
			fileTree.BoxDocEnabled = new(bool)
		}
	}
	if nil == fileTree.UseSVGDefaultIcon {
		if nil != model.Conf.FileTree && nil != model.Conf.FileTree.UseSVGDefaultIcon {
			fileTree.UseSVGDefaultIcon = model.Conf.FileTree.UseSVGDefaultIcon
		} else {
			fileTree.UseSVGDefaultIcon = new(bool)
		}
	}
	oldBoxDocEnabled := model.IsBoxDocEnabled()

	fileTree.DocCreateSavePath = util.TrimSpaceInPath(fileTree.DocCreateSavePath)
	fileTree.DocCreateTemplatePath = util.NormalizeTemplatePath(fileTree.DocCreateTemplatePath)

	fileTree.RefCreateSavePath = util.TrimSpaceInPath(fileTree.RefCreateSavePath)

	fileTree.ShorthandSavePath = util.TrimSpaceInPath(fileTree.ShorthandSavePath)
	if "" != fileTree.ShorthandSavePath {
		if !strings.HasPrefix(fileTree.ShorthandSavePath, "/") {
			fileTree.ShorthandSavePath = "/" + fileTree.ShorthandSavePath
		}
	}

	if 1 > fileTree.MaxOpenTabCount {
		fileTree.MaxOpenTabCount = 8
	}
	if 32 < fileTree.MaxOpenTabCount {
		fileTree.MaxOpenTabCount = 32
	}
	if nil == fileTree.TabStartupMode {
		fileTree.TabStartupMode = new(int)
		if fileTree.CloseTabsOnStart {
			*fileTree.TabStartupMode = 2
		}
	}
	if 0 > *fileTree.TabStartupMode || 2 < *fileTree.TabStartupMode {
		*fileTree.TabStartupMode = 0
	}
	fileTree.CloseTabsOnStart = 2 == *fileTree.TabStartupMode

	if conf.MinFileTreeRecentDocsListCount > fileTree.RecentDocsMaxListCount {
		fileTree.RecentDocsMaxListCount = conf.MinFileTreeRecentDocsListCount
	}
	if conf.MaxFileTreeRecentDocsListCount < fileTree.RecentDocsMaxListCount {
		fileTree.RecentDocsMaxListCount = conf.MaxFileTreeRecentDocsListCount
	}

	model.Conf.FileTree = fileTree
	model.Conf.Save()
	if oldSortMode != fileTree.Sort {
		model.PushDocSortModeChanged("global", "", "", "/", &fileTree.Sort)
	}
	if oldBoxDocEnabled != model.IsBoxDocEnabled() {
		model.RefreshBoxDocFeature()
	}

	util.UseSingleLineSave = model.Conf.FileTree.UseSingleLineSave
	util.LargeFileWarningSize = model.Conf.FileTree.LargeFileWarningSize

	ret = apicontract.Success(settingFileTreePayload(model.Conf.FileTree))
	return
})

var setSearch = contractHandler(apicontract.SetSearch, func(c *gin.Context, request apicontract.SetSearchRequest) (ret apicontract.Response[*apicontract.SettingSearch]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingSearch](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingSearch)(nil))

	param := request.ConfigJSON()
	var err error

	s := &conf.Search{}
	if err = gulu.JSON.UnmarshalJSON(param, s); err != nil {
		ret = apicontract.Failure[*apicontract.SettingSearch](-1, err.Error())
		return
	}

	if s.HanSensitive == nil {
		// 兼容未携带该字段的旧版前端/第三方调用：保持当前值，避免被零值意外关闭并触发重建索引
		s.HanSensitive = model.Conf.Search.HanSensitive
	}
	if s.CustomBlock == nil {
		s.CustomBlock = new(model.Conf.Search.CustomBlockEnabled())
	}

	if 32 > s.Limit {
		s.Limit = 32
	}

	oldCaseSensitive := model.Conf.Search.CaseSensitive
	oldHanSensitive := model.Conf.Search.HanSensitiveVal()
	oldIndexAssetPath := model.Conf.Search.IndexAssetPath

	oldVirtualRefName := model.Conf.Search.VirtualRefName
	oldVirtualRefAlias := model.Conf.Search.VirtualRefAlias
	oldVirtualRefAnchor := model.Conf.Search.VirtualRefAnchor
	oldVirtualRefDoc := model.Conf.Search.VirtualRefDoc

	model.Conf.Search = s
	model.Conf.Save()

	sql.SetCaseSensitive(s.CaseSensitive)
	sql.SetHanSensitive(s.HanSensitiveVal())
	sql.SetIndexAssetPath(s.IndexAssetPath)

	ftsChanged := s.CaseSensitive != oldCaseSensitive || s.HanSensitiveVal() != oldHanSensitive
	if ftsChanged && s.IndexAssetPath == oldIndexAssetPath {
		task.AppendTask(task.DatabaseIndexFTS, model.ReindexFTS)
	} else if ftsChanged || s.IndexAssetPath != oldIndexAssetPath {
		model.FullReindex(false)
	}

	if oldVirtualRefName != s.VirtualRefName ||
		oldVirtualRefAlias != s.VirtualRefAlias ||
		oldVirtualRefAnchor != s.VirtualRefAnchor ||
		oldVirtualRefDoc != s.VirtualRefDoc {
		model.ResetVirtualBlockRefCache()
	}
	ret = apicontract.Success(settingSearchPayload(s))
	return
})

var setKeymap = contractHandler(apicontract.SetKeymap, func(c *gin.Context, request apicontract.SettingKeymapRequest) apicontract.Response[apicontract.Null] {
	param, err := gulu.JSON.MarshalJSON(request.Data)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	keymap := &conf.Keymap{}
	if err = gulu.JSON.UnmarshalJSON(param, keymap); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.Conf.Keymap = keymap
	model.Conf.Save()
	return apicontract.Success(apicontract.Null{})
})

var setAppearance = contractHandler(apicontract.SetAppearance, func(c *gin.Context, request apicontract.SetAppearanceRequest) (ret apicontract.Response[*apicontract.SettingAppearance]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingAppearance](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingAppearance)(nil))

	param := request.ConfigJSON()
	var err error

	appearance := &conf.Appearance{}
	if err = gulu.JSON.UnmarshalJSON(param, appearance); err != nil {
		ret = apicontract.Failure[*apicontract.SettingAppearance](-1, err.Error())
		return
	}

	if nil == appearance.EntryVisibility {
		appearance.EntryVisibility = model.Conf.Appearance.EntryVisibility
	}
	if !request.HasField("bodyGradient") {
		appearance.BodyGradient = model.Conf.Appearance.BodyGradient
	}
	if !request.HasField("globalFontFamilies") {
		appearance.GlobalFontFamilies = model.Conf.Appearance.GlobalFontFamilies
	}
	appearance.NormalizeGlobalFontFamilies()
	appearance.StatusBar = util.NormalizeStatusBar(appearance.StatusBar, util.IsMobileContainer())
	model.Conf.Appearance = appearance
	util.StatusBarCfg = model.Conf.Appearance.StatusBar
	if nil == model.Conf.Appearance.Notifications {
		// 旧配置未迁移，按默认全部启用处理
		model.Conf.Appearance.Notifications = util.NewNotifications()
	}
	util.NotificationsCfg = model.Conf.Appearance.Notifications
	model.Conf.Lang = util.LangToBCP47(appearance.Lang) // 兼容历史下划线值，如 zh_CN → zh-CN
	util.Lang = model.Conf.Lang
	model.Conf.Save()
	model.InitAppearance()
	model.WatchThemes()

	ret = apicontract.Success(settingAppearancePayload(model.Conf.Appearance))
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)
	return
})

var getBootAppearances = contractHandler(apicontract.GetBootAppearances, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.SettingBootAppearancesData] {
	appearances := model.GetBootAppearances()
	selection := model.GetBootAppearanceSelection()
	current := apicontract.SettingBootAppearanceCurrent{}
	if !util.SafeMode {
		for _, appearance := range appearances {
			if appearance.Provider == selection.Provider && appearance.Appearance == selection.Appearance {
				current.Provider, current.Appearance = selection.Provider, selection.Appearance
				break
			}
		}
	}
	var items []*apicontract.SettingBootAppearance
	if appearances != nil {
		items = make([]*apicontract.SettingBootAppearance, len(appearances))
		for i, item := range appearances {
			items[i] = settingBootAppearancePayload(item)
		}
	}
	return apicontract.Success(apicontract.SettingBootAppearancesData{Appearances: items, Current: current})
})

var setBootAppearance = contractHandler(apicontract.SetBootAppearance, func(c *gin.Context, request apicontract.SettingBootAppearanceRequest) apicontract.Response[*apicontract.SettingBootAppearanceSelection] {
	selection, err := model.SetBootAppearance(request.Provider, request.Appearance)
	if err != nil {
		return apicontract.Failure[*apicontract.SettingBootAppearanceSelection](-1, err.Error())
	}
	return apicontract.Success(settingBootAppearanceSelectionPayload(&selection))
})

var setEntryVisibility = contractHandler(apicontract.SetEntryVisibility, func(c *gin.Context, request apicontract.SetEntryVisibilityRequest) (ret apicontract.Response[*apicontract.SettingEntryVisibility]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingEntryVisibility](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingEntryVisibility)(nil))

	param := request.ConfigJSON()
	var err error
	entryVisibility := &conf.EntryVisibility{}
	if err = gulu.JSON.UnmarshalJSON(param, entryVisibility); err != nil {
		ret = apicontract.Failure[*apicontract.SettingEntryVisibility](-1, err.Error())
		return
	}
	entryVisibility = conf.NormalizeEntryVisibility(entryVisibility, conf.EntryVisibilityProfileFull)
	model.Conf.Appearance.EntryVisibility = entryVisibility
	model.Conf.Save()
	ret = apicontract.Success(settingEntryVisibilityPayload(entryVisibility))
	util.BroadcastByType("main", "setEntryVisibility", 0, "", entryVisibility)
	return
})

var setIcon = contractHandler(apicontract.SetIcon, func(c *gin.Context, request apicontract.SettingIconRequest) apicontract.Response[apicontract.Null] {
	if err := model.SetIcon(request.Icon); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.InitAppearance()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)
	return apicontract.Success(apicontract.Null{})
})

var setTheme = contractHandler(apicontract.SetTheme, func(c *gin.Context, request apicontract.SettingThemeRequest) apicontract.Response[apicontract.Null] {
	modes := make([]int, 0, 2)
	for _, value := range request.Modes {
		modes = append(modes, int(value))
	}
	if err := model.SetTheme(request.Theme, modes, request.AppearanceMode); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.InitAppearance()
	model.WatchThemes()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)
	return apicontract.Success(apicontract.Null{})
})

var setPublish = contractHandler(apicontract.SetPublish, func(c *gin.Context, request apicontract.SetPublishRequest) (ret apicontract.Response[apicontract.SettingPublishData]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
	}
	ret = apicontract.Success(apicontract.SettingPublishData{})

	param := request.ConfigJSON()
	var err error

	publish := &conf.Publish{}
	if err = gulu.JSON.UnmarshalJSON(param, publish); err != nil {
		ret = apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
		return
	}

	if nil == publish.Auth {
		// 请求体缺省 auth（如 null）时保留现有认证配置，避免把 null 写入 conf.json 导致下次启动崩溃
		// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rp9f-c2fj-h648
		if nil != model.Conf.Publish.Auth {
			publish.Auth = model.Conf.Publish.Auth
		} else {
			publish.Auth = conf.NewPublish().Auth
		}
	}

	// 认证启用时校验发布服务账户：用户名非空且不重复、密码至少 8 位，
	// 防止弱密码或无密码账户被暴力破解 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-phg7-xcr4-q5wg
	if publish.Auth.Enable {
		usernames := map[string]bool{}
		for _, account := range publish.Auth.Accounts {
			if nil == account || "" == account.Username {
				ret = apicontract.Failure[apicontract.SettingPublishData](-1, model.Conf.Language(361))
				return
			}
			if usernames[account.Username] {
				ret = apicontract.Failure[apicontract.SettingPublishData](-1, model.Conf.Language(362))
				return
			}
			usernames[account.Username] = true
			if 8 > len(account.Password) {
				ret = apicontract.Failure[apicontract.SettingPublishData](-1, model.Conf.Language(363))
				return
			}
		}
	}

	model.Conf.Publish = publish
	model.Conf.Save()

	port, err := proxy.InitPublishService()
	if err != nil {
		ret = apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
		return
	}

	ret = apicontract.Success(apicontract.SettingPublishData{Port: port, Publish: settingPublishPayload(model.Conf.Publish)})

	util.BroadcastByType("main", "setPublish", 0, "", model.Conf.Publish)
	return
})

var getPublish = contractHandler(apicontract.GetPublish, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.SettingPublishData] {
	port, err := proxy.InitPublishService()
	if err != nil {
		return apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
	}
	return apicontract.Success(apicontract.SettingPublishData{Port: port, Publish: settingPublishPayload(model.Conf.Publish)})
})

var getCloudUser = contractHandler(apicontract.GetCloudUser, func(c *gin.Context, request apicontract.SettingCloudUserRequest) apicontract.Response[*apicontract.SettingUser] {
	user, err := model.RefreshUser(request.Token)
	data := settingUserPayload(user)
	if err == nil {
		return apicontract.Success(data)
	}
	if model.IsInvalidUserRefresh(err) {
		return apicontract.GetCloudUser.FailureWithData(255, model.Conf.Language(19), nil)
	}
	if model.IsCloudAssetSourceChange(err) {
		return apicontract.GetCloudUser.FailureWithData(1, err.Error(), data)
	}
	return apicontract.GetCloudUser.FailureWithData(1, model.Conf.Language(18), data)
}, func(c *gin.Context) *apicontract.Response[*apicontract.SettingUser] {
	if model.IsAdminRoleContext(c) {
		return nil
	}
	ret := apicontract.Success((*apicontract.SettingUser)(nil))
	return &ret
})

var logoutCloudUser = contractHandler(apicontract.LogoutCloudUser, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	model.LogoutUser()
	return apicontract.Success(apicontract.Null{})
})

var login2faCloudUser = contractHandler(apicontract.Login2faCloudUser, func(c *gin.Context, request apicontract.SettingLogin2faRequest) apicontract.Response[apicontract.Login2faEnvelope] {
	result := model.Login2fa(request.Token, request.Code)
	encoded, err := gulu.JSON.MarshalJSON(result)
	if err != nil {
		return apicontract.Failure[apicontract.Login2faEnvelope](-1, err.Error())
	}
	var envelope apicontract.Login2faEnvelope
	if err = gulu.JSON.UnmarshalJSON(encoded, &envelope); err != nil {
		return apicontract.Failure[apicontract.Login2faEnvelope](-1, err.Error())
	}
	return apicontract.SuccessDirectJSON(envelope)
})

var setEmoji = contractHandler(apicontract.SetEmoji, func(c *gin.Context, request apicontract.SettingEmojiRequest) apicontract.Response[apicontract.Null] {
	model.Conf.Editor.Emoji = util.FilterRecentIconValues(request.Emoji)
	return apicontract.Success(apicontract.Null{})
})
