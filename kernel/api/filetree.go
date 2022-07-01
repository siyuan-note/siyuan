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
	"errors"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func refreshFiletree(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.RefreshFileTree()
}

func doc2Heading(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	srcID := arg["srcID"].(string)
	targetID := arg["targetID"].(string)
	after := arg["after"].(bool)
	srcTreeBox, srcTreePath, err := model.Doc2Heading(srcID, targetID, after)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	ret.Data = map[string]interface{}{
		"srcTreeBox":  srcTreeBox,
		"srcTreePath": srcTreePath,
	}
}

func heading2Doc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	srcHeadingID := arg["srcHeadingID"].(string)
	targetNotebook := arg["targetNoteBook"].(string)
	targetPath := arg["targetPath"].(string)
	srcRootBlockID, targetPath, err := model.Heading2Doc(srcHeadingID, targetNotebook, targetPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	model.WaitForWritingFiles()
	tree, err := model.LoadTree(targetNotebook, targetPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	name := path.Base(targetPath)
	box := model.Conf.Box(targetNotebook)
	files, _, _ := model.ListDocTree(targetNotebook, path.Dir(targetPath), model.Conf.FileTree.Sort)
	evt := util.NewCmdResult("heading2doc", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"box":            box,
		"path":           targetPath,
		"files":          files,
		"name":           name,
		"id":             tree.Root.ID,
		"srcRootBlockID": srcRootBlockID,
	}
	evt.Callback = arg["callback"]
	util.PushEvent(evt)
}

func li2Doc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	srcListItemID := arg["srcListItemID"].(string)
	targetNotebook := arg["targetNoteBook"].(string)
	targetPath := arg["targetPath"].(string)
	srcRootBlockID, targetPath, err := model.ListItem2Doc(srcListItemID, targetNotebook, targetPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	model.WaitForWritingFiles()
	tree, err := model.LoadTree(targetNotebook, targetPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	name := path.Base(targetPath)
	box := model.Conf.Box(targetNotebook)
	files, _, _ := model.ListDocTree(targetNotebook, path.Dir(targetPath), model.Conf.FileTree.Sort)
	evt := util.NewCmdResult("li2doc", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"box":            box,
		"path":           targetPath,
		"files":          files,
		"name":           name,
		"id":             tree.Root.ID,
		"srcRootBlockID": srcRootBlockID,
	}
	evt.Callback = arg["callback"]
	util.PushEvent(evt)
}

func getHPathByPath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	p := arg["path"].(string)

	hPath, err := model.GetHPathByPath(notebook, p)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = hPath
}

func getHPathByID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	hPath, err := model.GetHPathByID(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = hPath
}

func getFullHPathByID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	if nil == arg["id"] {
		return
	}

	id := arg["id"].(string)
	hPath, err := model.GetFullHPathByID(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = hPath
}

func moveDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	fromNotebook := arg["fromNotebook"].(string)
	toNotebook := arg["toNotebook"].(string)
	fromPath := arg["fromPath"].(string)
	toPath := arg["toPath"].(string)

	newPath, err := model.MoveDoc(fromNotebook, fromPath, toNotebook, toPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	evt := util.NewCmdResult("moveDoc", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"fromNotebook": fromNotebook,
		"toNotebook":   toNotebook,
		"fromPath":     fromPath,
		"toPath":       toPath,
		"newPath":      newPath,
	}
	util.PushEvent(evt)
}

func removeDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	p := arg["path"].(string)

	err := model.RemoveDoc(notebook, p)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	evt := util.NewCmdResult("remove", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"box":  notebook,
		"path": p,
	}
	util.PushEvent(evt)
}

func renameDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	p := arg["path"].(string)
	title := arg["title"].(string)

	err := model.RenameDoc(notebook, p, title)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	return
}

func duplicateDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	err := model.DuplicateDoc(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	block, _ := model.GetBlock(id)
	p := block.Path
	notebook := block.Box
	box := model.Conf.Box(notebook)
	tree, err := model.LoadTree(box.ID, p)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	pushCreate(box, p, tree.Root.ID, arg)
}

func createDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	p := arg["path"].(string)
	title := arg["title"].(string)
	md := arg["md"].(string)
	sortsArg := arg["sorts"]
	var sorts []string
	if nil != sortsArg {
		for _, sort := range sortsArg.([]interface{}) {
			sorts = append(sorts, sort.(string))
		}
	}

	err := model.CreateDocByMd(notebook, p, title, md, sorts)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	box := model.Conf.Box(notebook)
	tree, err := model.LoadTree(box.ID, p)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	pushCreate(box, p, tree.Root.ID, arg)
}

func createDailyNote(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	p, err := model.CreateDailyNote(notebook)
	if nil != err {
		if model.ErrBoxNotFound == err {
			ret.Code = 1
		} else {
			ret.Code = -1
		}
		ret.Msg = err.Error()
		return
	}

	box := model.Conf.Box(notebook)
	model.WaitForWritingFiles()
	tree, err := model.LoadTree(box.ID, p)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	evt := util.NewCmdResult("createdailynote", 0, util.PushModeBroadcast, util.PushModeNone)
	name := path.Base(p)
	files, _, _ := model.ListDocTree(box.ID, path.Dir(p), model.Conf.FileTree.Sort)
	evt.Data = map[string]interface{}{
		"box":   box,
		"path":  p,
		"files": files,
		"name":  name,
		"id":    tree.Root.ID,
	}
	evt.Callback = arg["callback"]
	util.PushEvent(evt)
}

func createDocWithMd(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	hPath := arg["path"].(string)
	markdown := arg["markdown"].(string)

	baseName := path.Base(hPath)
	dir := path.Dir(hPath)
	r, _ := regexp.Compile("\r\n|\r|\n|\u2028|\u2029|\t|/")
	baseName = r.ReplaceAllString(baseName, "")
	if 512 < utf8.RuneCountInString(baseName) {
		baseName = gulu.Str.SubStr(baseName, 512)
	}
	hPath = path.Join(dir, baseName)
	if !strings.HasPrefix(hPath, "/") {
		hPath = "/" + hPath
	}

	id, err := model.CreateWithMarkdown(notebook, hPath, markdown)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = id

	box := model.Conf.Box(notebook)
	b, _ := model.GetBlock(id)
	p := b.Path
	pushCreate(box, p, id, arg)
}

func lockFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	locked, filePath := model.LockFileByBlockID(id)
	if !locked {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(75), filePath)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
	}
}

func getDocNameTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	box := model.Conf.Box(notebook)
	nameTemplate := model.Conf.FileTree.CreateDocNameTemplate
	if nil != box {
		nameTemplate = box.GetConf().CreateDocNameTemplate
	}
	if "" == nameTemplate {
		nameTemplate = model.Conf.FileTree.CreateDocNameTemplate
	}

	name, err := model.RenderCreateDocNameTemplate(nameTemplate)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"name": name,
	}
}

func changeSort(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	pathsArg := arg["paths"].([]interface{})
	var paths []string
	for _, p := range pathsArg {
		paths = append(paths, p.(string))
	}
	model.ChangeFileTreeSort(notebook, paths)
}

func searchDocs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	k := arg["k"].(string)
	ret.Data = model.SearchDocsByKeyword(k)
}

func listDocsByPath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	p := arg["path"].(string)
	sortParam := arg["sort"]
	sortMode := model.Conf.FileTree.Sort
	if nil != sortParam {
		sortMode = int(sortParam.(float64))
	}
	files, totals, err := model.ListDocTree(notebook, p, sortMode)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if model.Conf.FileTree.MaxListCount < totals {
		util.PushMsg(fmt.Sprintf(model.Conf.Language(48), len(files)), 7000)
	}

	ret.Data = map[string]interface{}{
		"box":   notebook,
		"path":  p,
		"files": files,
	}

	// 持久化文档面板排序
	model.Conf.FileTree.Sort = sortMode
	model.Conf.Save()
}

func getDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	idx := arg["index"]
	index := 0
	if nil != idx {
		index = int(idx.(float64))
	}
	k := arg["k"]
	var keyword string
	if nil != k {
		keyword = k.(string)
	}
	m := arg["mode"] // 0: 仅当前 ID，1：向上 2：向下，3：上下都加载，4：加载末尾
	mode := 0
	if nil != m {
		mode = int(m.(float64))
	}
	s := arg["size"]
	size := 102400 // 默认最大加载块数
	if nil != s {
		size = int(s.(float64))
	}

	blockCount, content, parentID, parent2ID, rootID, typ, eof, boxID, docPath, err := model.GetDoc(id, index, keyword, mode, size)
	if errors.Is(err, filelock.ErrUnableLockFile) {
		ret.Code = 2
		ret.Data = id
		return
	}
	if model.ErrBlockNotFound == err {
		ret.Code = 3
		return
	}

	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"id":         id,
		"mode":       mode,
		"parentID":   parentID,
		"parent2ID":  parent2ID,
		"rootID":     rootID,
		"type":       typ,
		"content":    content,
		"blockCount": blockCount,
		"eof":        eof,
		"box":        boxID,
		"path":       docPath,
	}
}

func pushCreate(box *model.Box, p, treeID string, arg map[string]interface{}) {
	evt := util.NewCmdResult("create", 0, util.PushModeBroadcast, util.PushModeNone)
	name := path.Base(p)
	files, _, _ := model.ListDocTree(box.ID, path.Dir(p), model.Conf.FileTree.Sort)
	evt.Data = map[string]interface{}{
		"box":   box,
		"path":  p,
		"files": files,
		"name":  name,
		"id":    treeID,
	}
	evt.Callback = arg["callback"]
	util.PushEvent(evt)
}
