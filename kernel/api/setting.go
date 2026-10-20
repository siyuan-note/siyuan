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

// settingRequest 提供设置接口的配置段原始内容与解析诊断。
type settingRequest interface {
	ConfigError() error
	ConfigJSON() []byte
}

// applySettingSection 解码整段设置并提交，返回提交后的配置段。
// 从构造函数默认值开始解码，JSON null 对非指针字段不生效、对指针和集合字段置空，两者都回落默认值。
func applySettingSection[Request settingRequest, Section, Data any](c *gin.Context, request Request, namespace string,
	defaults func() *Section, load func() *Section, convert func(*Section) Data) apicontract.Response[Data] {
	return applySettingSectionWith(c, request, func(section *Section) ([]model.Issue, error) {
		return model.ApplyConfSection(namespace, section)
	}, defaults, load, convert)
}

// applySettingSectionWith 使用调用方指定的提交规则应用配置段。
func applySettingSectionWith[Request settingRequest, Section, Data any](c *gin.Context, request Request,
	apply func(*Section) ([]model.Issue, error), defaults func() *Section, load func() *Section,
	convert func(*Section) Data) apicontract.Response[Data] {
	if err := request.ConfigError(); err != nil {
		return apicontract.Failure[Data](-1, err.Error())
	}
	section := defaults()
	if err := gulu.JSON.UnmarshalJSON(request.ConfigJSON(), section); err != nil {
		return apicontract.Failure[Data](-1, err.Error())
	}
	issues, err := apply(section)
	recordSettingIssues(c, issues)
	if err != nil {
		return apicontract.Failure[Data](-1, err.Error())
	}
	return apicontract.Success(convert(load()))
}

var setEditorReadOnly = contractHandler(apicontract.SetEditorReadOnly, func(c *gin.Context, request apicontract.EditorReadOnlyRequest) apicontract.Response[apicontract.Null] {
	model.UpdateEditorConf(func(s *conf.Editor) { s.ReadOnly = request.ReadOnly })
	return apicontract.Success(apicontract.Null{})
})

var applySnippetSetting = func(c *gin.Context, request apicontract.SetConfSnippetRequest) apicontract.Response[*apicontract.SettingSnpt] {
	return applySettingSection(c, request, "snippet", conf.NewSnpt, model.Conf.Snippet.Load, settingSnptPayload)
}

var setConfSnippet = contractHandler(apicontract.SetConfSnippet, applySnippetSetting)

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

var applyBazaarSetting = func(c *gin.Context, request apicontract.SetBazaarRequest) apicontract.Response[*apicontract.SettingBazaar] {
	bazaarPetalStateMu.Lock()
	defer bazaarPetalStateMu.Unlock()
	return applySettingSection(c, request, "bazaar", conf.NewBazaar, model.Conf.Bazaar.Load, settingBazaarPayload)
}

var setBazaar = contractHandler(apicontract.SetBazaar, applyBazaarSetting)

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

	ai := conf.NewAI()
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
	if model.Conf.AI.Load() != nil && model.Conf.AI.Load().MCP != nil {
		oldServers = append(oldServers, model.Conf.AI.Load().MCP.Servers...)
	}
	if ai.MCP != nil {
		preserveMCPServerIDs(oldServers, ai.MCP.Servers)
	}
	ai = conf.NormalizeAI(ai)
	if err = model.Conf.SetAI(c.Request.Context(), ai); err != nil {
		return apicontract.Failure[*apicontract.SettingAI](-1, err.Error())
	}
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

var applySecretsSetting = func(c *gin.Context, request apicontract.SetSecretsRequest) apicontract.Response[*apicontract.SettingSecrets] {
	response := applySettingSection(c, request, "secrets", conf.NewSecrets, model.Conf.Secrets.Load, settingSecretsPayload)
	if response.Code() == 0 {
		reconnectStdioMCPWithEnvironment()
	}
	return response
}

var setSecrets = contractHandler(apicontract.SetSecrets, applySecretsSetting)

var applyVariablesSetting = func(c *gin.Context, request apicontract.SetVariablesRequest) apicontract.Response[*apicontract.SettingVariables] {
	response := applySettingSection(c, request, "variables", conf.NewVariables, model.Conf.Variables.Load, settingVariablesPayload)
	if response.Code() == 0 {
		reconnectStdioMCPWithEnvironment()
	}
	return response
}

var setVariables = contractHandler(apicontract.SetVariables, applyVariablesSetting)

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

var applyFlashcardSetting = func(c *gin.Context, request apicontract.SetFlashcardRequest) apicontract.Response[*apicontract.SettingFlashcard] {
	return applySettingSection(c, request, "flashcard", conf.NewFlashcard, model.Conf.Flashcard.Load, settingFlashcardPayload)
}

var setFlashcard = contractHandler(apicontract.SetFlashcard, applyFlashcardSetting)

var applyEditorSetting = func(c *gin.Context, request apicontract.SetEditorRequest) apicontract.Response[*apicontract.SettingEditor] {
	return applySettingSection(c, request, "editor", conf.NewEditor, model.Conf.Editor.Load, settingEditorPayload)
}

var setEditor = contractHandler(apicontract.SetEditor, applyEditorSetting)

var setExport = contractHandler(apicontract.SetExport, applyExportSetting)

func applyExportSetting(c *gin.Context, request apicontract.SetExportRequest) (ret apicontract.Response[*apicontract.SettingExport]) {
	if err := request.ConfigError(); err != nil {
		return apicontract.FailureWithTimeout[*apicontract.SettingExport](-1, err.Error(), 5000)
	}
	ret = apicontract.Success((*apicontract.SettingExport)(nil))

	param := request.ConfigJSON()
	var err error

	export := conf.NewExport()
	if err = gulu.JSON.UnmarshalJSON(param, export); err != nil {
		ret = apicontract.FailureWithTimeout[*apicontract.SettingExport](-1, err.Error(), 5000)
		return
	}

	conf.MigrateExportBlockRefMode(export)
	// 只校验本次实际改动的 Pandoc 路径，避免沿用已有路径时重复提示
	previousPandocBin := model.Conf.Export.Load().PandocBin
	if "" != export.PandocBin && export.PandocBin != previousPandocBin && !util.IsValidPandocBin(export.PandocBin) {
		util.PushErrMsg(fmt.Sprintf(model.Conf.Language(117), export.PandocBin), 5000)
		export.PandocBin = previousPandocBin
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

var applyFiletreeSetting = func(c *gin.Context, request apicontract.SetFiletreeRequest) apicontract.Response[*apicontract.SettingFileTree] {
	return applySettingSection(c, request, "fileTree", conf.NewFileTree, model.Conf.FileTree.Load, settingFileTreePayload)
}

var setFiletree = contractHandler(apicontract.SetFiletree, applyFiletreeSetting)

var applySearchSetting = func(c *gin.Context, request apicontract.SetSearchRequest) apicontract.Response[*apicontract.SettingSearch] {
	return applySettingSection(c, request, "search", conf.NewSearch, model.Conf.Search.Load, settingSearchPayload)
}

var setSearch = contractHandler(apicontract.SetSearch, applySearchSetting)

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

var applyAppearanceSetting = func(c *gin.Context, request apicontract.SetAppearanceRequest) apicontract.Response[*apicontract.SettingAppearance] {
	return applySettingSectionWith(c, request, model.ApplyAppearanceSetting,
		func() *conf.Appearance { return conf.NewAppearanceForContainer(util.IsMobileContainer()) },
		model.Conf.Appearance.Load, settingAppearancePayload)
}

var setAppearance = contractHandler(apicontract.SetAppearance, applyAppearanceSetting)

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

	publish := conf.NewPublish()
	if err = gulu.JSON.UnmarshalJSON(param, publish); err != nil {
		ret = apicontract.Failure[apicontract.SettingPublishData](-1, err.Error())
		return
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
