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
	"math"
	"net/http"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func refreshFiletree(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.FullReindex()
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
	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(targetNotebook, targetPath, luteEngine)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	name := path.Base(targetPath)
	box := model.Conf.Box(targetNotebook)
	files, _, _ := model.ListDocTree(targetNotebook, path.Dir(targetPath), util.SortModeUnassigned, false, false, model.Conf.FileTree.MaxListCount)
	evt := util.NewCmdResult("heading2doc", 0, util.PushModeBroadcast)
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
	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(targetNotebook, targetPath, luteEngine)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	name := path.Base(targetPath)
	box := model.Conf.Box(targetNotebook)
	files, _, _ := model.ListDocTree(targetNotebook, path.Dir(targetPath), util.SortModeUnassigned, false, false, model.Conf.FileTree.MaxListCount)
	evt := util.NewCmdResult("li2doc", 0, util.PushModeBroadcast)
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
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	p := arg["path"].(string)

	hPath, err := model.GetHPathByPath(notebook, p)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = hPath
}

func getHPathsByPaths(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	pathsArg := arg["paths"].([]interface{})
	var paths []string
	for _, p := range pathsArg {
		paths = append(paths, p.(string))
	}
	hPath, err := model.GetHPathsByPaths(paths)
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
	if util.InvalidIDPattern(id, ret) {
		return
	}

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

func moveDocs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var fromPaths []string
	fromPathsArg := arg["fromPaths"].([]interface{})
	for _, fromPath := range fromPathsArg {
		fromPaths = append(fromPaths, fromPath.(string))
	}
	toPath := arg["toPath"].(string)
	toNotebook := arg["toNotebook"].(string)
	if util.InvalidIDPattern(toNotebook, ret) {
		return
	}

	callback := arg["callback"]

	err := model.MoveDocs(fromPaths, toNotebook, toPath, callback)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
}

func removeDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	p := arg["path"].(string)
	model.RemoveDoc(notebook, p)
}

func removeDocs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	pathsArg := arg["paths"].([]interface{})
	var paths []string
	for _, path := range pathsArg {
		paths = append(paths, path.(string))
	}
	model.RemoveDocs(paths)
}

func renameDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

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
	tree, err := model.LoadTreeByID(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	p := tree.Path
	notebook := tree.Box
	box := model.Conf.Box(notebook)
	model.DuplicateDoc(tree)
	pushCreate(box, p, tree.Root.ID, arg)

	ret.Data = map[string]interface{}{
		"id":       tree.Root.ID,
		"notebook": notebook,
		"path":     tree.Path,
		"hPath":    tree.HPath,
	}
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

	tree, err := model.CreateDocByMd(notebook, p, title, md, sorts)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	box := model.Conf.Box(notebook)
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
	p, existed, err := model.CreateDailyNote(notebook)
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
	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(box.ID, p, luteEngine)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	appArg := arg["app"]
	app := ""
	if nil != appArg {
		app = appArg.(string)
	}
	pushMode := util.PushModeBroadcast
	if existed && "" != app {
		pushMode = util.PushModeBroadcastApp
	}
	evt := util.NewCmdResult("createdailynote", 0, pushMode)
	evt.AppId = app

	name := path.Base(p)
	files, _, _ := model.ListDocTree(box.ID, path.Dir(p), util.SortModeUnassigned, false, false, model.Conf.FileTree.MaxListCount)
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
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	var parentID string
	parentIDArg := arg["parentID"]
	if nil != parentIDArg {
		parentID = parentIDArg.(string)
	}

	id := ast.NewNodeID()
	idArg := arg["id"]
	if nil != idArg {
		id = idArg.(string)
	}

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

	id, err := model.CreateWithMarkdown(notebook, hPath, markdown, parentID, id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = id

	box := model.Conf.Box(notebook)
	b, _ := model.GetBlock(id, nil)
	p := b.Path
	pushCreate(box, p, id, arg)
}

func getDocCreateSavePath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	box := model.Conf.Box(notebook)
	docCreateSavePathTpl := model.Conf.FileTree.DocCreateSavePath
	if nil != box {
		docCreateSavePathTpl = box.GetConf().DocCreateSavePath
	}
	if "" == docCreateSavePathTpl {
		docCreateSavePathTpl = model.Conf.FileTree.DocCreateSavePath
	}
	docCreateSavePathTpl = strings.TrimSpace(docCreateSavePathTpl)
	if "../" == docCreateSavePathTpl {
		docCreateSavePathTpl = "../Untitled"
	}
	for strings.HasSuffix(docCreateSavePathTpl, "/") {
		docCreateSavePathTpl = strings.TrimSuffix(docCreateSavePathTpl, "/")
		docCreateSavePathTpl = strings.TrimSpace(docCreateSavePathTpl)
	}

	p, err := model.RenderGoTemplate(docCreateSavePathTpl)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"path": p,
	}
}

func getRefCreateSavePath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	box := model.Conf.Box(notebook)
	refCreateSavePath := model.Conf.FileTree.RefCreateSavePath
	if nil != box {
		refCreateSavePath = box.GetConf().RefCreateSavePath
	}
	if "" == refCreateSavePath {
		refCreateSavePath = model.Conf.FileTree.RefCreateSavePath
	}

	p, err := model.RenderGoTemplate(refCreateSavePath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"path": p,
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

	flashcard := false
	if arg["flashcard"] != nil {
		flashcard = arg["flashcard"].(bool)
	}

	k := arg["k"].(string)
	ret.Data = model.SearchDocsByKeyword(k, flashcard)
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
	sortMode := util.SortModeUnassigned
	if nil != sortParam {
		sortMode = int(sortParam.(float64))
	}
	flashcard := false
	if arg["flashcard"] != nil {
		flashcard = arg["flashcard"].(bool)
	}
	maxListCount := model.Conf.FileTree.MaxListCount
	if arg["maxListCount"] != nil {
		// API `listDocsByPath` add an optional parameter `maxListCount` https://github.com/siyuan-note/siyuan/issues/7993
		maxListCount = int(arg["maxListCount"].(float64))
		if 0 >= maxListCount {
			maxListCount = math.MaxInt
		}
	}
	showHidden := false
	if arg["showHidden"] != nil {
		showHidden = arg["showHidden"].(bool)
	}

	files, totals, err := model.ListDocTree(notebook, p, sortMode, flashcard, showHidden, maxListCount)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if maxListCount < totals {
		util.PushMsg(fmt.Sprintf(model.Conf.Language(48), len(files)), 7000)
	}

	ret.Data = map[string]interface{}{
		"box":   notebook,
		"path":  p,
		"files": files,
	}
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

	var query string
	if queryArg := arg["query"]; nil != queryArg {
		query = queryArg.(string)
	}
	var queryMethod int
	if queryMethodArg := arg["queryMethod"]; nil != queryMethodArg {
		queryMethod = int(queryMethodArg.(float64))
	}
	var queryTypes map[string]bool
	if queryTypesArg := arg["queryTypes"]; nil != queryTypesArg {
		typesArg := queryTypesArg.(map[string]interface{})
		queryTypes = map[string]bool{}
		for t, b := range typesArg {
			queryTypes[t] = b.(bool)
		}
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
	startID := ""
	endID := ""
	startIDArg := arg["startID"]
	endIDArg := arg["endID"]
	if nil != startIDArg && nil != endIDArg {
		startID = startIDArg.(string)
		endID = endIDArg.(string)
		size = model.Conf.Editor.DynamicLoadBlocks
	}
	isBacklinkArg := arg["isBacklink"]
	isBacklink := false
	if nil != isBacklinkArg {
		isBacklink = isBacklinkArg.(bool)
	}

	blockCount, content, parentID, parent2ID, rootID, typ, eof, scroll, boxID, docPath, isBacklinkExpand, err := model.GetDoc(startID, endID, id, index, query, queryTypes, queryMethod, mode, size, isBacklink)
	if model.ErrBlockNotFound == err {
		ret.Code = 3
		return
	}

	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	// 判断是否正在同步中 https://github.com/siyuan-note/siyuan/issues/6290
	isSyncing := model.IsSyncingFile(rootID)

	ret.Data = map[string]interface{}{
		"id":               id,
		"mode":             mode,
		"parentID":         parentID,
		"parent2ID":        parent2ID,
		"rootID":           rootID,
		"type":             typ,
		"content":          content,
		"blockCount":       blockCount,
		"eof":              eof,
		"scroll":           scroll,
		"box":              boxID,
		"path":             docPath,
		"isSyncing":        isSyncing,
		"isBacklinkExpand": isBacklinkExpand,
	}
}

func pushCreate(box *model.Box, p, treeID string, arg map[string]interface{}) {
	evt := util.NewCmdResult("create", 0, util.PushModeBroadcast)
	name := path.Base(p)
	files, _, _ := model.ListDocTree(box.ID, path.Dir(p), util.SortModeUnassigned, false, false, model.Conf.FileTree.MaxListCount)
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
