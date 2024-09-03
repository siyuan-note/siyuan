// SiYuan - Refactor your thinking
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
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/server/proxy"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
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
	for _, k := range keywordsArg.([]interface{}) {
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
	for _, k := range keywordsArg.([]interface{}) {
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

	model.Conf.Bazaar = bazaar
	model.Conf.Save()

	ret.Data = bazaar
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

	if 5 > ai.OpenAI.APITimeout {
		ai.OpenAI.APITimeout = 5
	}
	if 600 < ai.OpenAI.APITimeout {
		ai.OpenAI.APITimeout = 600
	}

	if 0 > ai.OpenAI.APIMaxTokens {
		ai.OpenAI.APIMaxTokens = 0
	}

	if 0 >= ai.OpenAI.APITemperature || 2 < ai.OpenAI.APITemperature {
		ai.OpenAI.APITemperature = 1.0
	}

	if 1 > ai.OpenAI.APIMaxContexts || 64 < ai.OpenAI.APIMaxContexts {
		ai.OpenAI.APIMaxContexts = 7
	}

	model.Conf.AI = ai
	model.Conf.Save()

	ret.Data = ai
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

	if "" == editor.PlantUMLServePath {
		editor.PlantUMLServePath = "https://www.plantuml.com/plantuml/svg/~1"
	}

	if "" == editor.KaTexMacros {
		editor.KaTexMacros = "{}"
	}

	oldVirtualBlockRef := model.Conf.Editor.VirtualBlockRef
	oldVirtualBlockRefInclude := model.Conf.Editor.VirtualBlockRefInclude
	oldVirtualBlockRefExclude := model.Conf.Editor.VirtualBlockRefExclude
	oldReadOnly := model.Conf.Editor.ReadOnly

	model.Conf.Editor = editor
	model.Conf.Save()

	if oldGenerateHistoryInterval != model.Conf.Editor.GenerateHistoryInterval {
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
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	if "" != export.PandocBin {
		if !util.IsValidPandocBin(export.PandocBin) {
			util.PushErrMsg(fmt.Sprintf(model.Conf.Language(117), export.PandocBin), 5000)
			export.PandocBin = util.PandocBinPath
		} else {
			util.PandocBinPath = export.PandocBin
		}
	}

	model.Conf.Export = export
	model.Conf.Save()

	ret.Data = model.Conf.Export
}

func setFiletree(c *gin.Context) {
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

	fileTree := conf.NewFileTree()
	if err = gulu.JSON.UnmarshalJSON(param, fileTree); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	fileTree.RefCreateSavePath = strings.TrimSpace(fileTree.RefCreateSavePath)
	if "" != fileTree.RefCreateSavePath {
		if !strings.HasSuffix(fileTree.RefCreateSavePath, "/") {
			fileTree.RefCreateSavePath += "/"
		}
	}

	fileTree.DocCreateSavePath = strings.TrimSpace(fileTree.DocCreateSavePath)

	if 1 > fileTree.MaxOpenTabCount {
		fileTree.MaxOpenTabCount = 8
	}
	if 32 < fileTree.MaxOpenTabCount {
		fileTree.MaxOpenTabCount = 32
	}
	model.Conf.FileTree = fileTree
	model.Conf.Save()

	util.UseSingleLineSave = model.Conf.FileTree.UseSingleLineSave

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

	if 32 > s.Limit {
		s.Limit = 32
	}

	oldCaseSensitive := model.Conf.Search.CaseSensitive
	oldIndexAssetPath := model.Conf.Search.IndexAssetPath

	oldVirtualRefName := model.Conf.Search.VirtualRefName
	oldVirtualRefAlias := model.Conf.Search.VirtualRefAlias
	oldVirtualRefAnchor := model.Conf.Search.VirtualRefAnchor
	oldVirtualRefDoc := model.Conf.Search.VirtualRefDoc

	model.Conf.Search = s
	model.Conf.Save()

	sql.SetCaseSensitive(s.CaseSensitive)
	sql.SetIndexAssetPath(s.IndexAssetPath)

	if needFullReindex := s.CaseSensitive != oldCaseSensitive || s.IndexAssetPath != oldIndexAssetPath; needFullReindex {
		model.FullReindex()
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

	model.Conf.Appearance = appearance
	model.Conf.Lang = appearance.Lang
	util.Lang = model.Conf.Lang
	model.Conf.Save()
	model.InitAppearance()

	ret.Data = model.Conf.Appearance
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

	model.Conf.Publish = publish
	model.Conf.Save()

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
	model.RefreshUser(token)
	ret.Data = model.Conf.GetUser()
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
	data, err := model.Login2fa(token, code)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = data
}

func setEmoji(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	argEmoji := arg["emoji"].([]interface{})
	var emoji []string
	for _, ae := range argEmoji {
		emoji = append(emoji, ae.(string))
	}

	model.Conf.Editor.Emoji = emoji
}
