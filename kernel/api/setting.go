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
	"net/http"
	"reflect"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
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

func setEditorReadOnly(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	readOnly := arg["readonly"].(bool)

	oldReadOnly := model.Conf.Editor.ReadOnly
	model.Conf.Editor.ReadOnly = readOnly
	model.Conf.Save()

	if oldReadOnly != model.Conf.Editor.ReadOnly {
		util.BroadcastByType("protyle", "readonly", 0, "", model.Conf.Editor.ReadOnly)
		util.BroadcastByType("main", "readonly", 0, "", model.Conf.Editor.ReadOnly)
	}
}

func setConfSnippet(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	snippet := &conf.Snpt{}
	if err = gulu.JSON.UnmarshalJSON(param, snippet); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.Snippet = snippet
	model.Conf.Save()

	ret.Data = snippet
	model.PushReloadSnippet(snippet)
}

func addVirtualBlockRefExclude(c *gin.Context) {
	// Add internal kernel API `/api/setting/addVirtualBlockRefExclude` https://github.com/siyuan-note/siyuan/issues/9909

	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	keywordsArg := arg["keywords"]
	var keywords []string
	for _, k := range keywordsArg.([]any) {
		keywords = append(keywords, k.(string))
	}

	model.AddVirtualBlockRefExclude(keywords)
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
}

func addVirtualBlockRefInclude(c *gin.Context) {
	// Add internal kernel API `/api/setting/addVirtualBlockRefInclude` https://github.com/siyuan-note/siyuan/issues/9909

	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	keywordsArg := arg["keywords"]
	var keywords []string
	for _, k := range keywordsArg.([]any) {
		keywords = append(keywords, k.(string))
	}

	model.AddVirtualBlockRefInclude(keywords)
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
}

func refreshVirtualBlockRef(c *gin.Context) {
	// Add internal kernel API `/api/setting/refreshVirtualBlockRef` https://github.com/siyuan-note/siyuan/issues/9829

	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.ResetVirtualBlockRefCache()
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
}

func setBazaar(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	delete(arg, "app")

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	bazaar := &conf.Bazaar{}
	if err = gulu.JSON.UnmarshalJSON(param, bazaar); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
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

	ret.Data = bazaar
}

func setBazaarPetalDisabled(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	petalDisabled, ok := arg["petalDisabled"].(bool)
	if !ok {
		ret.Code = -1
		ret.Msg = "invalid petalDisabled"
		return
	}

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
	ret.Data = model.PushReloadAllEnabledPlugins(newPetalsEnabled, petalDisabled, bazaarPetalStateRevision, changed)
}

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

func setAI(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ai := &conf.AI{}
	if err = gulu.JSON.UnmarshalJSON(param, ai); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if ai.MCP != nil {
		for _, server := range ai.MCP.Servers {
			if err = mcpclient.ValidateMCPServerEnvironment(server); err != nil {
				ret.Code = -1
				ret.Msg = "invalid MCP server environment: " + err.Error()
				return
			}
		}
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

	ret.Data = model.Conf.AI
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

func setSecrets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	secrets := &conf.Secrets{}
	if err = gulu.JSON.UnmarshalJSON(param, secrets); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.Secrets = secrets
	model.Conf.Save()
	reconnectStdioMCPWithEnvironment()

	ret.Data = model.Conf.Secrets
}

func setVariables(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	variables := &conf.Variables{}
	if err = gulu.JSON.UnmarshalJSON(param, variables); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.Variables = variables
	model.Conf.Save()
	reconnectStdioMCPWithEnvironment()

	ret.Data = model.Conf.Variables
}

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

func setFlashcard(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	flashcard := &conf.Flashcard{}
	if err = gulu.JSON.UnmarshalJSON(param, flashcard); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
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

	ret.Data = flashcard
}

func setAccount(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	account := &conf.Account{}
	if err = gulu.JSON.UnmarshalJSON(param, account); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.Account = account
	model.Conf.Save()

	ret.Data = model.Conf.Account
}

func setEditor(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	oldGenerateHistoryInterval := model.Conf.Editor.GenerateHistoryInterval

	editor := conf.NewEditor()
	if err = gulu.JSON.UnmarshalJSON(param, editor); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if _, ok = arg["fontFamilies"]; !ok && editor.FontFamily == model.Conf.Editor.FontFamily &&
		editor.FontWeight == model.Conf.Editor.FontWeight {
		editor.FontFamilies = model.Conf.Editor.FontFamilies
	}
	if _, ok = arg["codeFontFamilies"]; !ok {
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

	ret.Data = model.Conf.Editor
}

func setExport(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	export := &conf.Export{}
	if err = gulu.JSON.UnmarshalJSON(param, export); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
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

	ret.Data = model.Conf.Export
}

func getPandocBin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	pandocRuntime := util.GetPandocRuntime()
	if !util.IsValidPandocBin(pandocRuntime.BinPath) {
		util.InitPandoc(model.Conf.Export.PandocBin)
		pandocRuntime = util.GetPandocRuntime()
	}
	if !util.IsValidPandocBin(pandocRuntime.BinPath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(115)
		return
	}
	ret.Data = pandocRuntime.BinPath
}

func setFiletree(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	oldSortMode := model.Conf.FileTree.Sort
	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	fileTree := conf.NewFileTree()
	fileTree.BoxDocEnabled = nil
	fileTree.UseSVGDefaultIcon = nil
	if err = gulu.JSON.UnmarshalJSON(param, fileTree); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
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

	ret.Data = model.Conf.FileTree
}

func setSearch(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	s := &conf.Search{}
	if err = gulu.JSON.UnmarshalJSON(param, s); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if s.HanSensitive == nil {
		// 兼容未携带该字段的旧版前端/第三方调用：保持当前值，避免被零值意外关闭并触发重建索引
		s.HanSensitive = model.Conf.Search.HanSensitive
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
	ret.Data = s
}

func setKeymap(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg["data"])
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	keymap := &conf.Keymap{}
	if err = gulu.JSON.UnmarshalJSON(param, keymap); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.Keymap = keymap
	model.Conf.Save()
}

func setAppearance(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	appearance := &conf.Appearance{}
	if err = gulu.JSON.UnmarshalJSON(param, appearance); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if nil == appearance.EntryVisibility {
		appearance.EntryVisibility = model.Conf.Appearance.EntryVisibility
	}
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

	ret.Data = model.Conf.Appearance
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)
}

func getBootAppearances(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	appearances := model.GetBootAppearances()
	selection := model.GetBootAppearanceSelection()
	current := map[string]string{"provider": "", "appearance": ""}
	if !util.SafeMode {
		for _, appearance := range appearances {
			if appearance.Provider == selection.Provider && appearance.Appearance == selection.Appearance {
				current["provider"] = selection.Provider
				current["appearance"] = selection.Appearance
				break
			}
		}
	}
	ret.Data = map[string]any{
		"appearances": appearances,
		"current":     current,
	}
}

func setBootAppearance(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var provider, appearance string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("provider", &provider, false, false),
		util.BindJsonArg("appearance", &appearance, false, false),
	) {
		return
	}
	selection, err := model.SetBootAppearance(provider, appearance)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = selection
}

func setEntryVisibility(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	entryVisibility := &conf.EntryVisibility{}
	if err = gulu.JSON.UnmarshalJSON(param, entryVisibility); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	entryVisibility = conf.NormalizeEntryVisibility(entryVisibility, conf.EntryVisibilityProfileFull)
	model.Conf.Appearance.EntryVisibility = entryVisibility
	model.Conf.Save()
	ret.Data = entryVisibility
	util.BroadcastByType("main", "setEntryVisibility", 0, "", entryVisibility)
}

func setIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var icon string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("icon", &icon, true, true),
	) {
		return
	}

	if err := model.SetIcon(icon); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.InitAppearance()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)
}

func setTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var theme, appearanceMode string
	var modesRaw []any
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("theme", &theme, false, false),
		util.BindJsonArg("modes", &modesRaw, false, false),
		util.BindJsonArg("appearanceMode", &appearanceMode, false, false),
	) {
		return
	}

	theme, appearanceMode = strings.TrimSpace(theme), strings.TrimSpace(appearanceMode)
	modes := make([]int, 0, 2)
	if theme != "" {
		for _, m := range modesRaw {
			mf, ok := m.(float64)
			if !ok {
				break
			}
			mi := int(mf)
			if mi != 0 && mi != 1 {
				break
			}
			modes = append(modes, mi)
		}
		if len(modes) == 0 {
			ret.Code = -1
			ret.Msg = "[modes] is required ([0] for light, [1] for dark, [0,1] for both)"
			return
		}
	}
	// 没有 theme 时静默忽略 modes

	if err := model.SetTheme(theme, modes, appearanceMode); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.InitAppearance()
	model.WatchThemes()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)
}

func setPublish(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	publish := &conf.Publish{}
	if err = gulu.JSON.UnmarshalJSON(param, publish); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
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
				ret.Code = -1
				ret.Msg = model.Conf.Language(361)
				return
			}
			if usernames[account.Username] {
				ret.Code = -1
				ret.Msg = model.Conf.Language(362)
				return
			}
			usernames[account.Username] = true
			if 8 > len(account.Password) {
				ret.Code = -1
				ret.Msg = model.Conf.Language(363)
				return
			}
		}
	}

	model.Conf.Publish = publish
	model.Conf.Save()

	port, err := proxy.InitPublishService()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"port":    port,
		"publish": model.Conf.Publish,
	}

	util.BroadcastByType("main", "setPublish", 0, "", model.Conf.Publish)
}

func getPublish(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if port, err := proxy.InitPublishService(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	} else {
		ret.Data = map[string]any{
			"port":    port,
			"publish": model.Conf.Publish,
		}
	}
}

func getCloudUser(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if !model.IsAdminRoleContext(c) {
		return
	}

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	t := arg["token"]
	var token string
	if nil != t {
		token = t.(string)
	}
	user, err := model.RefreshUser(token)
	ret.Data = user
	if nil == err {
		return
	}
	if model.IsInvalidUserRefresh(err) {
		ret.Code = 255
		ret.Msg = model.Conf.Language(19)
		ret.Data = nil
		return
	}
	ret.Code = 1
	ret.Msg = model.Conf.Language(18)
}

func logoutCloudUser(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.LogoutUser()
}

func login2faCloudUser(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	token := arg["token"].(string)
	code := arg["code"].(string)
	loginResult := model.Login2fa(token, code)
	ret.Code = loginResult.Code
	ret.Msg = loginResult.Msg
	ret.Data = loginResult.Data
}

func setEmoji(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	argEmoji := arg["emoji"].([]any)
	emoji := make([]string, 0, len(argEmoji))
	for _, ae := range argEmoji {
		emoji = append(emoji, ae.(string))
	}

	model.Conf.Editor.Emoji = util.FilterRecentIconValues(emoji)
}
