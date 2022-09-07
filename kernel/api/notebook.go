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
	"net/http"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setNotebookIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	boxID := arg["notebook"].(string)
	icon := arg["icon"].(string)
	model.SetBoxIcon(boxID, icon)
}

func changeSortNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["notebooks"].([]interface{})
	var ids []string
	for _, p := range idsArg {
		ids = append(ids, p.(string))
	}
	model.ChangeBoxSort(ids)
}

func renameNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	name := arg["name"].(string)
	err := model.RenameBox(notebook, name)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	evt := util.NewCmdResult("renamenotebook", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"box":  notebook,
		"name": name,
	}
	util.PushEvent(evt)
}

func removeNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	err := model.RemoveBox(notebook)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	evt := util.NewCmdResult("unmount", 0, util.PushModeBroadcast, 0)
	evt.Data = map[string]interface{}{
		"box": notebook,
	}
	evt.Callback = arg["callback"]
	util.PushEvent(evt)
}

func createNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	name := arg["name"].(string)
	id, err := model.CreateBox(name)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	existed, err := model.Mount(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"notebook": model.Conf.Box(id),
	}

	evt := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"box":     model.Conf.Box(id),
		"existed": existed,
	}
	util.PushEvent(evt)
}

func openNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	msgId := util.PushMsg(model.Conf.Language(45), 1000*60*15)
	defer util.PushClearMsg(msgId)
	existed, err := model.Mount(notebook)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"box":     model.Conf.Box(notebook),
		"existed": existed,
	}
	evt.Callback = arg["callback"]
	util.PushEvent(evt)
}

func closeNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	model.Unmount(notebook)
}

func getNotebookConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	box := model.Conf.Box(notebook)
	ret.Data = map[string]interface{}{
		"box":  box.ID,
		"name": box.Name,
		"conf": box.GetConf(),
	}
}

func setNotebookConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	box := model.Conf.Box(notebook)

	param, err := gulu.JSON.MarshalJSON(arg["conf"])
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	boxConf := box.GetConf()
	if err = gulu.JSON.UnmarshalJSON(param, boxConf); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	boxConf.RefCreateSavePath = strings.TrimSpace(boxConf.RefCreateSavePath)
	if "" != boxConf.RefCreateSavePath {
		if !strings.HasSuffix(boxConf.RefCreateSavePath, "/") {
			boxConf.RefCreateSavePath += "/"
		}
	}

	boxConf.DailyNoteSavePath = strings.TrimSpace(boxConf.DailyNoteSavePath)
	if "" != boxConf.DailyNoteSavePath {
		if !strings.HasPrefix(boxConf.DailyNoteSavePath, "/") {
			boxConf.DailyNoteSavePath = "/" + boxConf.DailyNoteSavePath
		}
	}
	if "/" == boxConf.DailyNoteSavePath {
		ret.Code = -1
		ret.Msg = model.Conf.Language(49)
		return
	}

	boxConf.DailyNoteTemplatePath = strings.TrimSpace(boxConf.DailyNoteTemplatePath)
	if "" != boxConf.DailyNoteTemplatePath {
		if !strings.HasSuffix(boxConf.DailyNoteTemplatePath, ".md") {
			boxConf.DailyNoteTemplatePath += ".md"
		}
		if !strings.HasPrefix(boxConf.DailyNoteTemplatePath, "/") {
			boxConf.DailyNoteTemplatePath = "/" + boxConf.DailyNoteTemplatePath
		}
	}

	box.SaveConf(boxConf)
	ret.Data = boxConf
}

func lsNotebooks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	notebooks, err := model.ListNotebooks()
	if nil != err {
		return
	}

	ret.Data = map[string]interface{}{
		"notebooks": notebooks,
	}
}
