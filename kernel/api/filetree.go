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
	"os"
	"path"
	"path/filepath"
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

func moveLocalShorthands(c *gin.Context) {
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

	var hPath string
	hPathArg := arg["path"]
	if nil != hPathArg {
		hPath = arg["path"].(string)
		baseName := path.Base(hPath)
		dir := path.Dir(hPath)
		r, _ := regexp.Compile("\r\n|\r|\n|\u2028|\u2029|\t|/")
		baseName = r.ReplaceAllString(baseName, "")
		if 512 < utf8.RuneCountInString(baseName) {
			baseName = gulu.Str.SubStr(baseName, 512)
		}
		hPath = path.Join(dir, baseName)
	}

	// TODO: 改造旧方案，去掉 hPath, parentID，改为使用文档树配置项 闪念速记存放位置，参考创建日记实现
	// https://github.com/siyuan-note/siyuan/issues/14414
	ids, err := model.MoveLocalShorthands(notebook, hPath, parentID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.FlushTxQueue()
	box := model.Conf.Box(notebook)
	for _, id := range ids {
		b, _ := model.GetBlock(id, nil)
		pushCreate(box, b.Path, arg)
	}
}

func listDocTree(c *gin.Context) {
	// Add kernel API `/api/filetree/listDocTree` https://github.com/siyuan-note/siyuan/issues/10482

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
	p = strings.TrimSuffix(p, ".sy")
	var doctree []*DocFile
	root := filepath.Join(util.WorkspaceDir, "data", notebook, p)
	dir, err := os.ReadDir(root)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ids := map[string]bool{}
	for _, entry := range dir {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		if entry.IsDir() {
			if !ast.IsNodeIDPattern(entry.Name()) {
				continue
			}

			parent := &DocFile{ID: entry.Name()}
			ids[parent.ID] = true
			doctree = append(doctree, parent)

			subPath := filepath.Join(root, entry.Name())
			if err = walkDocTree(subPath, parent, ids); err != nil {
				ret.Code = -1
				ret.Msg = err.Error()
				return
			}
		} else {
			id := strings.TrimSuffix(entry.Name(), ".sy")
			if !ast.IsNodeIDPattern(id) {
				continue
			}

			doc := &DocFile{ID: id}
			if !ids[doc.ID] {
				doctree = append(doctree, doc)
			}
			ids[doc.ID] = true
		}
	}

	ret.Data = map[string]interface{}{
		"tree": doctree,
	}
}

type DocFile struct {
	ID       string     `json:"id"`
	Children []*DocFile `json:"children,omitempty"`
}

func walkDocTree(p string, docFile *DocFile, ids map[string]bool) (err error) {
	dir, err := os.ReadDir(p)
	if err != nil {
		return
	}

	for _, entry := range dir {
		if entry.IsDir() {
			if strings.HasPrefix(entry.Name(), ".") {
				continue
			}

			if !ast.IsNodeIDPattern(entry.Name()) {
				continue
			}

			parent := &DocFile{ID: entry.Name()}
			ids[parent.ID] = true
			docFile.Children = append(docFile.Children, parent)

			subPath := filepath.Join(p, entry.Name())
			if err = walkDocTree(subPath, parent, ids); err != nil {
				return
			}
		} else {
			doc := &DocFile{ID: strings.TrimSuffix(entry.Name(), ".sy")}
			if !ids[doc.ID] {
				docFile.Children = append(docFile.Children, doc)
			}
			ids[doc.ID] = true
		}
	}
	return
}

func upsertIndexes(c *gin.Context) {
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
	model.UpsertIndexes(paths)
}

func removeIndexes(c *gin.Context) {
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
	model.RemoveIndexes(paths)
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
	if err != nil {
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
	var targetPath string
	if arg["targetPath"] != nil {
		targetPath = arg["targetPath"].(string)
	}
	var previousPath string
	if arg["previousPath"] != nil {
		previousPath = arg["previousPath"].(string)
	}
	srcRootBlockID, targetPath, err := model.Heading2Doc(srcHeadingID, targetNotebook, targetPath, previousPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	model.FlushTxQueue()

	box := model.Conf.Box(targetNotebook)
	evt := util.NewCmdResult("heading2doc", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"box":            box,
		"path":           targetPath,
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
	var targetPath string
	if arg["targetPath"] != nil {
		targetPath = arg["targetPath"].(string)
	}
	var previousPath string
	if arg["previousPath"] != nil {
		previousPath = arg["previousPath"].(string)
	}
	srcRootBlockID, targetPath, err := model.ListItem2Doc(srcListItemID, targetNotebook, targetPath, previousPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	model.FlushTxQueue()

	box := model.Conf.Box(targetNotebook)
	evt := util.NewCmdResult("li2doc", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"box":            box,
		"path":           targetPath,
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
	if err != nil {
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
	if err != nil {
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
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = hPath
}

func getPathByID(c *gin.Context) {
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

	p, notebook, err := model.GetPathByID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"path":     p,
		"notebook": notebook,
	}
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
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = hPath
}

func getIDsByHPath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	if nil == arg["path"] {
		return
	}
	if nil == arg["notebook"] {
		return
	}

	notebook := arg["notebook"].(string)
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	p := arg["path"].(string)
	ids, err := model.GetIDsByHPath(p, notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = ids
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
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
}

func moveDocsByID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	fromIDsArg := arg["fromIDs"].([]any)
	var fromIDs []string
	for _, fromIDArg := range fromIDsArg {
		fromID := fromIDArg.(string)
		if util.InvalidIDPattern(fromID, ret) {
			return
		}
		fromIDs = append(fromIDs, fromID)
	}
	toID := arg["toID"].(string)
	if util.InvalidIDPattern(toID, ret) {
		return
	}

	var fromPaths []string
	for _, fromID := range fromIDs {
		tree, err := model.LoadTreeByBlockID(fromID)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			ret.Data = map[string]interface{}{"closeTimeout": 7000}
			return
		}
		fromPaths = append(fromPaths, tree.Path)
	}
	fromPaths = gulu.Str.RemoveDuplicatedElem(fromPaths)

	var box *model.Box
	toTree, err := model.LoadTreeByBlockID(toID)
	if err != nil {
		box = model.Conf.Box(toID)
		if nil == box {
			ret.Code = -1
			ret.Msg = "can't found box or tree by id [" + toID + "]"
			ret.Data = map[string]interface{}{"closeTimeout": 7000}
			return
		}
	}

	var toNotebook, toPath string
	if nil != toTree {
		toNotebook = toTree.Box
		toPath = toTree.Path
	} else if nil != box {
		toNotebook = box.ID
		toPath = "/"
	}
	callback := arg["callback"]
	err = model.MoveDocs(fromPaths, toNotebook, toPath, callback)
	if err != nil {
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

func removeDocByID(c *gin.Context) {
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

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	model.RemoveDoc(tree.Box, tree.Path)
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
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	return
}

func renameDocByID(c *gin.Context) {
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
	if util.InvalidIDPattern(id, ret) {
		return
	}

	title := arg["title"].(string)

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	err = model.RenameDoc(tree.Box, tree.Path, title)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func duplicateDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	notebook := tree.Box
	box := model.Conf.Box(notebook)
	model.DuplicateDoc(tree)
	arg["listDocTree"] = true
	pushCreate(box, tree.Path, arg)

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
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	model.FlushTxQueue()
	box := model.Conf.Box(notebook)
	pushCreate(box, p, arg)

	ret.Data = map[string]interface{}{
		"id": tree.Root.ID,
	}
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
	if err != nil {
		if model.ErrBoxNotFound == err {
			ret.Code = 1
		} else {
			ret.Code = -1
		}
		ret.Msg = err.Error()
		return
	}

	model.FlushTxQueue()
	box := model.Conf.Box(notebook)
	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(box.ID, p, luteEngine)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if !existed {
		// 只有创建的情况才推送，已经存在的情况不推送
		// Creating a dailynote existed no longer expands the doc tree https://github.com/siyuan-note/siyuan/issues/9959
		appArg := arg["app"]
		app := ""
		if nil != appArg {
			app = appArg.(string)
		}
		evt := util.NewCmdResult("createdailynote", 0, util.PushModeBroadcast)
		evt.AppId = app
		evt.Data = map[string]interface{}{
			"box":  box,
			"path": p,
		}
		evt.Callback = arg["callback"]
		util.PushEvent(evt)
	}

	ret.Data = map[string]interface{}{
		"id": tree.Root.ID,
	}
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

	tagsArg := arg["tags"]
	var tags string
	if nil != tagsArg {
		tags = tagsArg.(string)
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

	withMath := false
	withMathArg := arg["withMath"]
	if nil != withMathArg {
		withMath = withMathArg.(bool)
	}
	clippingHref := ""
	clippingHrefArg := arg["clippingHref"]
	if nil != clippingHrefArg {
		clippingHref = clippingHrefArg.(string)
	}

	id, err := model.CreateWithMarkdown(tags, notebook, hPath, markdown, parentID, id, withMath, clippingHref)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = id

	model.FlushTxQueue()
	box := model.Conf.Box(notebook)
	b, _ := model.GetBlock(id, nil)
	pushCreate(box, b.Path, arg)
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
	var docCreateSaveBox string
	docCreateSavePathTpl := model.Conf.FileTree.DocCreateSavePath
	if nil != box {
		boxConf := box.GetConf()
		docCreateSaveBox = boxConf.DocCreateSaveBox
		docCreateSavePathTpl = boxConf.DocCreateSavePath
	}
	if "" == docCreateSaveBox && "" == docCreateSavePathTpl {
		docCreateSaveBox = model.Conf.FileTree.DocCreateSaveBox
	}
	if "" != docCreateSaveBox {
		if nil == model.Conf.Box(docCreateSaveBox) {
			// 如果配置的笔记本未打开或者不存在，则使用当前笔记本
			docCreateSaveBox = notebook
		}
	}
	if "" == docCreateSaveBox {
		docCreateSaveBox = notebook
	}
	if "" == docCreateSavePathTpl {
		docCreateSavePathTpl = model.Conf.FileTree.DocCreateSavePath
	}
	docCreateSavePathTpl = strings.TrimSpace(docCreateSavePathTpl)

	if docCreateSaveBox != notebook {
		if "" != docCreateSavePathTpl && !strings.HasPrefix(docCreateSavePathTpl, "/") {
			// 如果配置的笔记本不是当前笔记本，则将相对路径转换为绝对路径
			docCreateSavePathTpl = "/" + docCreateSavePathTpl
		}
	}

	docCreateSavePath, err := model.RenderGoTemplate(docCreateSavePathTpl)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"box":  docCreateSaveBox,
		"path": docCreateSavePath,
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
	var refCreateSaveBox string
	refCreateSavePathTpl := model.Conf.FileTree.RefCreateSavePath
	if nil != box {
		boxConf := box.GetConf()
		refCreateSaveBox = boxConf.RefCreateSaveBox
		refCreateSavePathTpl = boxConf.RefCreateSavePath
	}
	if "" == refCreateSaveBox && "" == refCreateSavePathTpl {
		refCreateSaveBox = model.Conf.FileTree.RefCreateSaveBox
	}
	if "" != refCreateSaveBox {
		if nil == model.Conf.Box(refCreateSaveBox) {
			// 如果配置的笔记本未打开或者不存在，则使用当前笔记本
			refCreateSaveBox = notebook
		}
	}
	if "" == refCreateSaveBox {
		refCreateSaveBox = notebook
	}
	if "" == refCreateSavePathTpl {
		refCreateSavePathTpl = model.Conf.FileTree.RefCreateSavePath
	}

	if refCreateSaveBox != notebook {
		if "" != refCreateSavePathTpl && !strings.HasPrefix(refCreateSavePathTpl, "/") {
			// 如果配置的笔记本不是当前笔记本，则将相对路径转换为绝对路径
			refCreateSavePathTpl = "/" + refCreateSavePathTpl
		}
	}

	refCreateSavePath, err := model.RenderGoTemplate(refCreateSavePathTpl)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"box":  refCreateSaveBox,
		"path": refCreateSavePath,
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

	var excludeIDs []string
	if arg["excludeIDs"] != nil {
		excludeIDsArg := arg["excludeIDs"].([]interface{})
		for _, excludeID := range excludeIDsArg {
			excludeIDs = append(excludeIDs, excludeID.(string))
		}
	}

	k := arg["k"].(string)
	ret.Data = model.SearchDocs(k, flashcard, excludeIDs)
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
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if maxListCount < totals {
		// API `listDocsByPath` add an optional parameter `ignoreMaxListHint` https://github.com/siyuan-note/siyuan/issues/10290
		ignoreMaxListHintArg := arg["ignoreMaxListHint"]
		if nil == ignoreMaxListHintArg || !ignoreMaxListHintArg.(bool) {
			var app string
			if nil != arg["app"] {
				app = arg["app"].(string)
			}
			util.PushMsgWithApp(app, fmt.Sprintf(model.Conf.Language(48), len(files)), 7000)
		}
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
	originalRefBlockIDsArg := arg["originalRefBlockIDs"]
	originalRefBlockIDs := map[string]string{}
	if nil != originalRefBlockIDsArg {
		m := originalRefBlockIDsArg.(map[string]interface{})
		for k, v := range m {
			originalRefBlockIDs[k] = v.(string)
		}
	}
	highlightArg := arg["highlight"]
	highlight := true
	if nil != highlightArg {
		highlight = highlightArg.(bool)
	}

	blockCount, content, parentID, parent2ID, rootID, typ, eof, scroll, boxID, docPath, isBacklinkExpand, keywords, err :=
		model.GetDoc(startID, endID, id, index, query, queryTypes, queryMethod, mode, size, isBacklink, originalRefBlockIDs, highlight)
	if model.ErrBlockNotFound == err {
		ret.Code = 3
		return
	}

	if err != nil {
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
		"keywords":         keywords,
		"reqId":            arg["reqId"],
	}
}

func pushCreate(box *model.Box, p string, arg map[string]interface{}) {
	evt := util.NewCmdResult("create", 0, util.PushModeBroadcast)
	listDocTree := false
	listDocTreeArg := arg["listDocTree"]
	if nil != listDocTreeArg {
		listDocTree = listDocTreeArg.(bool)
	}

	evt.Data = map[string]interface{}{
		"box":         box,
		"path":        p,
		"listDocTree": listDocTree,
	}
	evt.Callback = arg["callback"]
	util.PushEvent(evt)
}
