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
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	bazaarPetalStateMu sync.Mutex
)

var setEditorReadOnly = contractHandler(apicontract.SetEditorReadOnly, func(c *gin.Context, request apicontract.EditorReadOnlyRequest) apicontract.Response[apicontract.Null] {
	model.UpdateEditorConf(func(s *conf.Editor) { s.ReadOnly = request.ReadOnly })
	return apicontract.Success(apicontract.Null{})
})

var setConfSnippet = contractHandler(apicontract.SetConfSnippet, applySnippetSetting)

func applySnippetSetting(c *gin.Context, request apicontract.SetConfSnippetRequest) (ret apicontract.Response[*apicontract.SettingSnpt]) {
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

	issues, applyErr := model.ApplyConfSection("snippet", snippet)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingSnpt](-1, err.Error())
	}

	ret = apicontract.Success(settingSnptPayload(model.Conf.Snippet.Load()))
	return
}

var addVirtualBlockRefExclude = contractHandler(apicontract.AddVirtualBlockRefExclude, func(c *gin.Context, request apicontract.VirtualBlockRefRequest) apicontract.Response[apicontract.Null] {
	model.AddVirtualBlockRefExclude(request.Keywords)
	return apicontract.Success(apicontract.Null{})
})

var addVirtualBlockRefInclude = contractHandler(apicontract.AddVirtualBlockRefInclude, func(c *gin.Context, request apicontract.VirtualBlockRefRequest) apicontract.Response[apicontract.Null] {
	model.AddVirtualBlockRefInclude(request.Keywords)
	return apicontract.Success(apicontract.Null{})
})

var refreshVirtualBlockRef = contractHandler(apicontract.RefreshVirtualBlockRef, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	model.ResetVirtualBlockRefCache()
	return apicontract.Success(apicontract.Null{})
})

var setBazaar = contractHandler(apicontract.SetBazaar, applyBazaarSetting)

func applyBazaarSetting(c *gin.Context, request apicontract.SetBazaarRequest) (ret apicontract.Response[*apicontract.SettingBazaar]) {
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

	issues, applyErr := model.ApplyConfSection("bazaar", bazaar)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingBazaar](-1, err.Error())
	}

	ret = apicontract.Success(settingBazaarPayload(model.Conf.Bazaar.Load()))
	return
}

var setBazaarPetalDisabled = contractHandler(apicontract.SetBazaarPetalDisabled, func(c *gin.Context, request apicontract.SettingPetalDisabledRequest) apicontract.Response[apicontract.SettingPetalDisabledData] {
	petalDisabled := request.PetalDisabled
	bazaarPetalStateMu.Lock()
	defer bazaarPetalStateMu.Unlock()
	changed := model.Conf.Bazaar.Load().PetalDisabled != petalDisabled
	model.UpdateBazaarConf(func(s *conf.Bazaar) { s.PetalDisabled = petalDisabled })
	newPetalsEnabled := model.IsPetalsEnabled()
	payload := model.PluginReloadPayload(newPetalsEnabled, petalDisabled, model.BazaarPetalStateRevision.Load(), changed)
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

var setAI = contractHandler(apicontract.SetAI, applyAISetting)

func applyAISetting(c *gin.Context, request apicontract.SetAIRequest) (ret apicontract.Response[*apicontract.SettingAI]) {
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
	if model.Conf.AI.Load() != nil {
		if ai.Decision == nil {
			ai.Decision = model.Conf.AI.Load().Decision.Clone()
		} else {
			ai.Decision.MergePrevious(model.Conf.AI.Load().Decision)
		}
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
	if model.Conf.AI.Load() != nil && model.Conf.AI.Load().MCP != nil {
		oldServers = append(oldServers, model.Conf.AI.Load().MCP.Servers...)
	}
	if ai.MCP != nil {
		preserveMCPServerIDs(oldServers, ai.MCP.Servers)
	}
	ai = conf.NormalizeAI(ai)
	model.Conf.SetAI(ai)
	mcpserver.RefreshToolExposure()

	// MCP 配置可能变更（开关切换、编辑、增删 server），异步重连让连接立即跟上。
	if model.Conf.AI.Load().MCP != nil {
		newServers := model.Conf.AI.Load().MCP.Servers
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

	ret = apicontract.Success(settingAIPayload(model.Conf.AI.Load()))
	return
}

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

var setSecrets = contractHandler(apicontract.SetSecrets, applySecretsSetting)

func applySecretsSetting(c *gin.Context, request apicontract.SetSecretsRequest) (ret apicontract.Response[*apicontract.SettingSecrets]) {
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

	issues, applyErr := model.ApplyConfSection("secrets", secrets)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingSecrets](-1, err.Error())
	}
	reconnectStdioMCPWithEnvironment()

	ret = apicontract.Success(settingSecretsPayload(model.Conf.Secrets.Load()))
	return
}

var setVariables = contractHandler(apicontract.SetVariables, applyVariablesSetting)

func applyVariablesSetting(c *gin.Context, request apicontract.SetVariablesRequest) (ret apicontract.Response[*apicontract.SettingVariables]) {
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

	issues, applyErr := model.ApplyConfSection("variables", variables)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingVariables](-1, err.Error())
	}
	reconnectStdioMCPWithEnvironment()

	ret = apicontract.Success(settingVariablesPayload(model.Conf.Variables.Load()))
	return
}

func reconnectStdioMCPWithEnvironment() {
	confAISnapshot := model.Conf.LoadAI()

	if confAISnapshot == nil || confAISnapshot.MCP == nil {
		return
	}
	serverIDs := stdioMCPServerIDsWithEnvironment(confAISnapshot.MCP.Servers)
	if len(serverIDs) > 0 {
		mcpclient.ReconnectMCPAsync(confAISnapshot.MCP.Servers, serverIDs, nil)
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

var setFlashcard = contractHandler(apicontract.SetFlashcard, applyFlashcardSetting)

func applyFlashcardSetting(c *gin.Context, request apicontract.SetFlashcardRequest) (ret apicontract.Response[*apicontract.SettingFlashcard]) {
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

	issues, applyErr := model.ApplyConfSection("flashcard", flashcard)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingFlashcard](-1, err.Error())
	}

	ret = apicontract.Success(settingFlashcardPayload(model.Conf.Flashcard.Load()))
	return
}

var setEditor = contractHandler(apicontract.SetEditor, applyEditorSetting)

func applyEditorSetting(c *gin.Context, request apicontract.SetEditorRequest) (ret apicontract.Response[*apicontract.SettingEditor]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingEditor](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingEditor)(nil))

	param := request.ConfigJSON()
	var err error

	editor := conf.NewEditor()
	if err = gulu.JSON.UnmarshalJSON(param, editor); err != nil {
		ret = apicontract.Failure[*apicontract.SettingEditor](-1, err.Error())
		return
	}
	if !request.HasField("fontFamilies") && editor.FontFamily == model.Conf.Editor.Load().FontFamily &&
		editor.FontWeight == model.Conf.Editor.Load().FontWeight {
		editor.FontFamilies = model.Conf.Editor.Load().FontFamilies
	}
	if !request.HasField("codeFontFamilies") {
		editor.CodeFontFamilies = model.Conf.Editor.Load().CodeFontFamilies
	}
	if !request.HasFieldFold("displayImgName") {
		editor.DisplayImgName = model.Conf.Editor.Load().DisplayImgName
	}
	if !request.HasFieldFold("displayImgAlt") {
		editor.DisplayImgAlt = model.Conf.Editor.Load().DisplayImgAlt
	}

	issues, applyErr := model.ApplyConfSection("editor", editor)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingEditor](-1, err.Error())
	}

	ret = apicontract.Success(settingEditorPayload(model.Conf.Editor.Load()))
	return
}

var setExport = contractHandler(apicontract.SetExport, applyExportSetting)

func applyExportSetting(c *gin.Context, request apicontract.SetExportRequest) (ret apicontract.Response[*apicontract.SettingExport]) {
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

	// 整段旧接口保留废弃导出模式的转换行为
	conf.MigrateExportBlockRefMode(export)
	previousPandocBin := model.Conf.Export.Load().PandocBin
	if "" != export.PandocBin {
		if !util.IsValidPandocBin(export.PandocBin) {
			util.PushErrMsg(fmt.Sprintf(model.Conf.Language(117), export.PandocBin), 5000)
			export.PandocBin = previousPandocBin
		}
	}

	issues, applyErr := model.ApplyConfSection("export", export)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingExport](-1, err.Error())
	}

	ret = apicontract.Success(settingExportPayload(model.Conf.Export.Load()))
	return
}

var getPandocBin = contractHandler(apicontract.GetPandocBin, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[string] {
	pandocRuntime := util.GetPandocRuntime()
	if !util.IsValidPandocBin(pandocRuntime.BinPath) {
		util.InitPandoc(model.Conf.Export.Load().PandocBin)
		pandocRuntime = util.GetPandocRuntime()
	}
	if !util.IsValidPandocBin(pandocRuntime.BinPath) {
		return apicontract.Failure[string](-1, model.Conf.Language(115))
	}
	return apicontract.Success(pandocRuntime.BinPath)
})

var setFiletree = contractHandler(apicontract.SetFiletree, applyFiletreeSetting)

func applyFiletreeSetting(c *gin.Context, request apicontract.SetFiletreeRequest) (ret apicontract.Response[*apicontract.SettingFileTree]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[*apicontract.SettingFileTree](-1, err.Error())
	}
	ret = apicontract.Success((*apicontract.SettingFileTree)(nil))

	param := request.ConfigJSON()
	var err error

	fileTree := conf.NewFileTree()
	// 请求未携带的保存格式和大文件阈值沿用当前配置
	fileTree.UseSingleLineSave = model.Conf.FileTree.Load().UseSingleLineSave
	fileTree.LargeFileWarningSize = model.Conf.FileTree.Load().LargeFileWarningSize
	fileTree.BoxDocEnabled = nil
	fileTree.UseSVGDefaultIcon = nil
	if err = gulu.JSON.UnmarshalJSON(param, fileTree); err != nil {
		ret = apicontract.Failure[*apicontract.SettingFileTree](-1, err.Error())
		return
	}
	if nil == fileTree.BoxDocEnabled {
		if nil != model.Conf.FileTree.Load() && nil != model.Conf.FileTree.Load().BoxDocEnabled {
			fileTree.BoxDocEnabled = model.Conf.FileTree.Load().BoxDocEnabled
		} else {
			fileTree.BoxDocEnabled = new(bool)
		}
	}
	if nil == fileTree.UseSVGDefaultIcon {
		if nil != model.Conf.FileTree.Load() && nil != model.Conf.FileTree.Load().UseSVGDefaultIcon {
			fileTree.UseSVGDefaultIcon = model.Conf.FileTree.Load().UseSVGDefaultIcon
		} else {
			fileTree.UseSVGDefaultIcon = new(bool)
		}
	}

	issues, applyErr := model.ApplyConfSection("fileTree", fileTree)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingFileTree](-1, err.Error())
	}

	ret = apicontract.Success(settingFileTreePayload(model.Conf.FileTree.Load()))
	return
}

var setSearch = contractHandler(apicontract.SetSearch, applySearchSetting)

func applySearchSetting(c *gin.Context, request apicontract.SetSearchRequest) (ret apicontract.Response[*apicontract.SettingSearch]) {
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
		s.HanSensitive = model.Conf.Search.Load().HanSensitive
	}
	if s.CustomBlock == nil {
		s.CustomBlock = new(model.Conf.Search.Load().CustomBlockEnabled())
	}
	if s.Mindmap == nil {
		s.Mindmap = new(model.Conf.Search.Load().MindmapEnabled())
	}
	if s.MindmapItem == nil {
		s.MindmapItem = new(model.Conf.Search.Load().MindmapItemEnabled())
	}

	issues, applyErr := model.ApplyConfSection("search", s)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingSearch](-1, err.Error())
	}

	ret = apicontract.Success(settingSearchPayload(model.Conf.Search.Load()))
	return
}

var setKeymap = contractHandler(apicontract.SetKeymap, applyKeymapSetting)

func applyKeymapSetting(c *gin.Context, request apicontract.SettingKeymapRequest) apicontract.Response[apicontract.Null] {
	param, err := gulu.JSON.MarshalJSON(request.Data)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	keymap := &conf.Keymap{}
	if err = gulu.JSON.UnmarshalJSON(param, keymap); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	issues, applyErr := model.ApplyConfSection("keymap", keymap)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
}

var setAppearance = contractHandler(apicontract.SetAppearance, applyAppearanceSetting)

func applyAppearanceSetting(c *gin.Context, request apicontract.SetAppearanceRequest) (ret apicontract.Response[*apicontract.SettingAppearance]) {
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
		appearance.EntryVisibility = model.Conf.Appearance.Load().EntryVisibility
	}
	if !request.HasField("bodyGradient") {
		appearance.BodyGradient = model.Conf.Appearance.Load().BodyGradient
	}
	if !request.HasField("globalFontFamilies") {
		appearance.GlobalFontFamilies = model.Conf.Appearance.Load().GlobalFontFamilies
	}
	issues, applyErr := model.ApplyAppearanceSetting(appearance)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[*apicontract.SettingAppearance](-1, err.Error())
	}

	ret = apicontract.Success(settingAppearancePayload(model.Conf.Appearance.Load()))
	return
}

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
	entryVisibility = model.UpdateAppearanceConf(func(appearance *conf.Appearance) {
		appearance.EntryVisibility = entryVisibility
	}).EntryVisibility
	ret = apicontract.Success(settingEntryVisibilityPayload(entryVisibility))
	util.BroadcastByType("main", "setEntryVisibility", 0, "", entryVisibility)
	return
})

var setIcon = contractHandler(apicontract.SetIcon, func(c *gin.Context, request apicontract.SettingIconRequest) apicontract.Response[apicontract.Null] {
	if err := model.SetIcon(request.Icon); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.InitAppearance()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance.Load())
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
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance.Load())
	return apicontract.Success(apicontract.Null{})
})

var setPublish = contractHandler(apicontract.SetPublish, applyPublishSetting)

func applyPublishSetting(c *gin.Context, request apicontract.SetPublishRequest) (ret apicontract.Response[apicontract.SettingPublishData]) {
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
		publish.Auth = model.Conf.Publish.Load().Auth
	}
	issues, applyErr := model.ApplyConfSection("publish", publish)
	recordSettingIssues(c, issues)
	err = applyErr
	if err != nil {
		return apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
	}

	port, err := proxy.InitPublishService()
	if err != nil {
		ret = apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
		return
	}

	ret = apicontract.Success(apicontract.SettingPublishData{Port: port, Publish: settingPublishPayload(model.Conf.Publish.Load())})

	util.BroadcastByType("main", "setPublish", 0, "", model.Conf.Publish.Load())
	return
}

var getPublish = contractHandler(apicontract.GetPublish, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.SettingPublishData] {
	port, err := proxy.InitPublishService()
	if err != nil {
		return apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
	}
	return apicontract.Success(apicontract.SettingPublishData{Port: port, Publish: settingPublishPayload(model.Conf.Publish.Load())})
})

var getCloudUser = contractHandler(apicontract.GetCloudUser, func(c *gin.Context, request apicontract.SettingCloudUserRequest) apicontract.Response[*apicontract.SettingUser] {
	user, err := model.GetCloudUser(request.Token, request.Cached)
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
	model.UpdateEditorConf(func(s *conf.Editor) { s.Emoji = util.FilterRecentIconValues(request.Emoji) })
	return apicontract.Success(apicontract.Null{})
})
