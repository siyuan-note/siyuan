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
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var moveLocalShorthands = contractHandler(apicontract.MoveLocalShorthands, moveLocalShorthandsContract)

func moveLocalShorthandsContract(c *gin.Context, request apicontract.FileTreeNotebookRequest) apicontract.Response[[]string] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[[]string](ret)
	}

	ids, err := model.MoveLocalShorthands(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]string](ret)
	}

	return apicontract.Success(ids)
}

var listDocTree = contractHandler(apicontract.ListDocTree, listDocTreeContract)

func listDocTreeContract(c *gin.Context, request apicontract.FileTreePathRequest) apicontract.Response[apicontract.FileTreeDocTreeData] {
	// Add kernel API `/api/filetree/listDocTree` https://github.com/siyuan-note/siyuan/issues/10482

	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.FileTreeDocTreeData](ret)
	}

	// 加密笔记本锁定时拒绝直接列举磁盘目录，防止泄漏文档 ID、层级和数量
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.FileTreeDocTreeData](ret)
	}

	if err := request.PathError(); err != nil {
		return apicontract.Failure[apicontract.FileTreeDocTreeData](-1, err.Error())
	}
	p := request.Path
	p = strings.TrimSuffix(p, ".sy")
	// 越界校验：拒绝 ..，确保路径位于 <data>/<notebook>/ 内。
	// 无需 filepath.IsAbs —— notebook 路径全为 notebook 内相对路径，且跨 OS 对 "/" 判定不一致。
	if found := strings.Contains(p, ".."); found {
		ret.Code = -1
		ret.Msg = "path must not contain '..'"
		return contractFailure[apicontract.FileTreeDocTreeData](ret)
	}
	var doctree []*DocFile
	root := filepath.Join(util.WorkspaceDir, "data", notebook, p)
	if !gulu.File.IsSubPath(filepath.Join(util.WorkspaceDir, "data", notebook), root) {
		ret.Code = -1
		ret.Msg = "path escapes notebook directory"
		return contractFailure[apicontract.FileTreeDocTreeData](ret)
	}
	dir, err := os.ReadDir(root)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeDocTreeData](ret)
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
				return contractFailure[apicontract.FileTreeDocTreeData](ret)
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

	return apicontract.Success(apicontract.FileTreeDocTreeData{Tree: fileTreeDocFileContracts(doctree)})
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

var upsertIndexes = contractHandler(apicontract.UpsertIndexes, upsertIndexesContract)

func upsertIndexesContract(c *gin.Context, request apicontract.FileTreePathsRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	pathsArg := request.Paths
	var paths []string
	for _, p := range pathsArg {
		paths = append(paths, p)
	}
	model.UpsertIndexes(paths)
	return contractFailure[apicontract.Null](ret)
}

var removeIndexes = contractHandler(apicontract.RemoveIndexes, removeIndexesContract)

func removeIndexesContract(c *gin.Context, request apicontract.FileTreePathsRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	pathsArg := request.Paths
	var paths []string
	for _, p := range pathsArg {
		paths = append(paths, p)
	}
	model.RemoveIndexes(paths)
	return contractFailure[apicontract.Null](ret)
}

var doc2Heading = contractHandler(apicontract.Doc2Heading, doc2HeadingContract)

func doc2HeadingContract(c *gin.Context, request apicontract.FileTreeDocHeadingRequest) apicontract.Response[apicontract.FileTreeDocHeadingData] {
	ret := gulu.Ret.NewResult()

	srcID := request.SrcID
	targetID := request.TargetID
	after := request.After
	srcTreeBox, srcTreePath, err := model.Doc2Heading(srcID, targetID, after)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.FileTreeDocHeadingData](ret.Code, ret.Msg, 5000)
	}

	return apicontract.Success(apicontract.FileTreeDocHeadingData{SrcTreeBox: srcTreeBox, SrcTreePath: srcTreePath})
}

var heading2Doc = contractHandler(apicontract.Heading2Doc, heading2DocContract)

func heading2DocContract(c *gin.Context, request apicontract.FileTreeHeadingDocRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	srcHeadingID := request.SrcHeadingID
	targetNotebook := request.TargetNotebook

	// 禁止跨加密笔记本移动块：加密笔记本是孤岛
	if bt := treenode.GetBlockTree(srcHeadingID); bt != nil && model.IsEncryptedBox(bt.BoxID) && bt.BoxID != targetNotebook {
		ret.Code = -1
		ret.Msg = model.Conf.Language(391)
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}
	options, err := request.Options()
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	targetPath, previousPath, toTop := options.TargetPath, options.PreviousPath, options.ToTop
	srcRootBlockID, targetPath, err := model.Heading2Doc(srcHeadingID, targetNotebook, targetPath, previousPath, toTop)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	model.FlushTxQueue()

	box := model.Conf.Box(targetNotebook)
	evt := util.NewCmdResult("heading2doc", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":            box,
		"path":           targetPath,
		"srcRootBlockID": srcRootBlockID,
	}
	util.PushEvent(evt)
	return contractFailure[apicontract.Null](ret)
}

var li2Doc = contractHandler(apicontract.Li2Doc, li2DocContract)

func li2DocContract(c *gin.Context, request apicontract.FileTreeListItemDocRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	srcListItemID := request.SrcListItemID
	targetNotebook := request.TargetNotebook

	// 禁止跨加密笔记本移动块：加密笔记本是孤岛
	if bt := treenode.GetBlockTree(srcListItemID); bt != nil && model.IsEncryptedBox(bt.BoxID) && bt.BoxID != targetNotebook {
		ret.Code = -1
		ret.Msg = model.Conf.Language(391)
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	options, err := request.Options()
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	targetPath, previousPath, toTop := options.TargetPath, options.PreviousPath, options.ToTop
	srcRootBlockID, targetPath, err := model.ListItem2Doc(srcListItemID, targetNotebook, targetPath, previousPath, toTop)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	model.FlushTxQueue()

	box := model.Conf.Box(targetNotebook)
	evt := util.NewCmdResult("li2doc", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":            box,
		"path":           targetPath,
		"srcRootBlockID": srcRootBlockID,
	}
	util.PushEvent(evt)
	return contractFailure[apicontract.Null](ret)
}

var getHPathByPath = contractHandler(apicontract.GetHPathByPath, getHPathByPathContract)

func getHPathByPathContract(c *gin.Context, request apicontract.FileTreePathRequest) apicontract.Response[string] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[string](ret)
	}

	p := request.Path

	hPath, err := model.GetHPathByPath(notebook, p)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[string](ret)
	}
	if p != "/" && model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		id := util.GetTreeID(p)
		if !model.CheckBlockIdMetadataAccessableByPublishAccessInBox(c, publishAccess, id, notebook) {
			ret.Code = -1
			ret.Msg = model.ErrBlockNotFound.Error()
			return contractFailure[string](ret)
		}
	}
	return apicontract.Success(hPath)
}

var getHPathsByPaths = contractHandler(apicontract.GetHPathsByPaths, getHPathsByPathsContract)

func getHPathsByPathsContract(c *gin.Context, request apicontract.FileTreePathsRequest) apicontract.Response[[]string] {
	ret := gulu.Ret.NewResult()

	pathsArg := request.Paths
	var paths []string
	for _, p := range pathsArg {
		paths = append(paths, p)
	}
	paths = filterFileTreePathsByPublishMetadataAccess(c, paths)
	hPath, err := model.GetHPathsByPaths(paths)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]string](ret)
	}
	return apicontract.Success(hPath)
}

var getHPathByID = contractHandler(apicontract.GetHPathByID, getHPathByIDContract)

func getHPathByIDContract(c *gin.Context, request apicontract.FileTreeIDRequest) apicontract.Response[string] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[string](ret)
	}

	hPath, err := model.GetHPathByID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[string](ret)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdMetadataAccessableByPublishAccess(c, publishAccess, id) {
			ret.Code = -1
			ret.Msg = model.ErrTreeNotFound.Error()
			return contractFailure[string](ret)
		}
	}
	return apicontract.Success(hPath)
}

var getPathByID = contractHandler(apicontract.GetPathByID, getPathByIDContract)

func getPathByIDContract(c *gin.Context, request apicontract.FileTreeTrimIDRequest) apicontract.Response[apicontract.FileTreeDocPathData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.FileTreeDocPathData](ret)
	}

	p, notebook, err := model.GetPathByID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeDocPathData](ret)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdMetadataAccessableByPublishAccessInBox(c, publishAccess, id, notebook) {
			ret.Code = -1
			ret.Msg = model.ErrTreeNotFound.Error()
			return contractFailure[apicontract.FileTreeDocPathData](ret)
		}
	}
	return apicontract.Success(apicontract.FileTreeDocPathData{Path: p, Notebook: notebook})
}

var getFullHPathByID = contractHandler(apicontract.GetFullHPathByID, getFullHPathByIDContract)

func getFullHPathByIDContract(c *gin.Context, request apicontract.FileTreeOptionalIDRequest) apicontract.Response[*string] {
	ret := gulu.Ret.NewResult()

	if request.ID == nil {
		return contractFailure[*string](ret)
	}

	id := *request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[*string](ret)
	}
	hPath, err := model.GetFullHPathByID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[*string](ret)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdMetadataAccessableByPublishAccess(c, publishAccess, id) {
			ret.Code = -1
			ret.Msg = model.ErrTreeNotFound.Error()
			return contractFailure[*string](ret)
		}
	}
	return apicontract.Success(&hPath)
}

var getIDsByHPath = contractHandler(apicontract.GetIDsByHPath, getIDsByHPathContract)

func getIDsByHPathContract(c *gin.Context, request apicontract.FileTreeOptionalPathRequest) apicontract.Response[[]string] {
	ret := gulu.Ret.NewResult()

	if request.Path == nil {
		return contractFailure[[]string](ret)
	}
	if request.Notebook == nil {
		return contractFailure[[]string](ret)
	}

	notebook := *request.Notebook
	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[[]string](ret)
	}

	p := *request.Path
	ids, err := model.GetIDsByHPath(p, notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]string](ret)
	}
	ids = filterFileTreeBlockIDsByPublishDiscoverability(c, ids, notebook)
	return apicontract.Success(ids)
}

func filterFileTreePathsByPublishMetadataAccess(c *gin.Context, paths []string) (ret []string) {
	if !model.IsReadOnlyRoleContext(c) {
		return paths
	}

	ids := make([]string, 0, len(paths))
	for _, p := range paths {
		ids = append(ids, util.GetTreeID(p))
	}
	blockTrees := treenode.GetBlockTrees(ids)
	publishAccess := model.GetPublishAccess()
	ret = make([]string, 0, len(paths))
	for i, p := range paths {
		if model.CheckBlockTreeMetadataAccessableByPublishAccess(c, publishAccess, blockTrees[ids[i]]) {
			ret = append(ret, p)
		}
	}
	return
}

func filterFileTreeBlockIDsByPublishDiscoverability(c *gin.Context, ids []string, boxID string) (ret []string) {
	if !model.IsReadOnlyRoleContext(c) {
		return ids
	}

	blockTrees := treenode.GetBlockTreesInBox(ids, boxID)
	publishAccess := model.GetPublishAccess()
	ret = make([]string, 0, len(ids))
	for _, id := range ids {
		if model.CheckBlockTreeDiscoverableByPublishAccess(publishAccess, blockTrees[id]) {
			ret = append(ret, id)
		}
	}
	return
}

var moveDocs = contractHandler(apicontract.MoveDocs, moveDocsContract)

func moveDocsContract(c *gin.Context, request apicontract.FileTreeMoveRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	var fromPaths []string
	fromPathsArg := request.FromPaths
	for _, fromPath := range fromPathsArg {
		fromPaths = append(fromPaths, fromPath)
	}
	toPath := request.ToPath
	toNotebook := request.ToNotebook
	if util.InvalidIDPattern(toNotebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	callback := fileTreeCallback(request.Callback)
	err := model.MoveDocs(fromPaths, toNotebook, toPath, callback)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 7000)
	}
	return contractFailure[apicontract.Null](ret)
}

var moveDocsByID = contractHandler(apicontract.MoveDocsByID, moveDocsByIDContract)

func moveDocsByIDContract(c *gin.Context, request apicontract.FileTreeMoveIDsRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	fromIDsArg := request.FromIDs
	var fromIDs []string
	for _, fromIDArg := range fromIDsArg {
		fromID := fromIDArg
		if util.InvalidIDPattern(fromID, ret) {
			return contractFailure[apicontract.Null](ret)
		}
		fromIDs = append(fromIDs, fromID)
	}
	toID := request.ToID
	if util.InvalidIDPattern(toID, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	var fromPaths []string
	for _, fromID := range fromIDs {
		tree, err := model.LoadTreeByBlockID(fromID)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 7000)
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
			return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 7000)
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
	callback := fileTreeCallback(request.Callback)
	err = model.MoveDocs(fromPaths, toNotebook, toPath, callback)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 7000)
	}
	return contractFailure[apicontract.Null](ret)
}

var removeDoc = contractHandler(apicontract.RemoveDoc, removeDocContract)

func removeDocContract(c *gin.Context, request apicontract.FileTreePathRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	p := request.Path
	if err := model.RemoveDoc(notebook, p); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
	return contractFailure[apicontract.Null](ret)
}

var removeDocByID = contractHandler(apicontract.RemoveDocByID, removeDocByIDContract)

func removeDocByIDContract(c *gin.Context, request apicontract.FileTreeTrimIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	p, notebook, err := model.GetPathByID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 7000)
	}

	if err = model.RemoveDoc(notebook, p); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
	return contractFailure[apicontract.Null](ret)
}

var removeDocs = contractHandler(apicontract.RemoveDocs, removeDocsContract)

func removeDocsContract(c *gin.Context, request apicontract.FileTreePathsRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	pathsArg := request.Paths
	var paths []string
	for _, path := range pathsArg {
		paths = append(paths, path)
	}
	if err := model.RemoveDocs(paths); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
	return contractFailure[apicontract.Null](ret)
}

var renameDoc = contractHandler(apicontract.RenameDoc, renameDocContract)

func renameDocContract(c *gin.Context, request apicontract.FileTreeRenameRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	p := request.Path
	title := request.Title

	err := model.RenameDoc(notebook, p, title)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return contractFailure[apicontract.Null](ret)
}

var renameDocByID = contractHandler(apicontract.RenameDocByID, renameDocByIDContract)

func renameDocByIDContract(c *gin.Context, request apicontract.FileTreeRenameIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if request.ID == nil {
		return contractFailure[apicontract.Null](ret)
	}

	id := *request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	title, decodeErr := request.DocTitle()
	if decodeErr != nil {
		return apicontract.Failure[apicontract.Null](-1, decodeErr.Error())
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 7000)
	}

	err = model.RenameDoc(tree.Box, tree.Path, title)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return contractFailure[apicontract.Null](ret)
}

var duplicateDoc = contractHandler(apicontract.DuplicateDoc, duplicateDocContract)

var duplicateDocTree = contractHandler(apicontract.DuplicateDocTree, duplicateDocTreeContract)

func duplicateDocTreeContract(c *gin.Context, request apicontract.FileTreeIDRequest) apicontract.Response[apicontract.FileTreeDuplicateData] {
	if err := holdEncryptedBlockRequests(c, "", []string{request.ID}, false); err != nil {
		return apicontract.FailureWithTimeout[apicontract.FileTreeDuplicateData](-1, err.Error(), 7000)
	}
	tree, err := model.DuplicateDocTree(request.ID)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.FileTreeDuplicateData](-1, err.Error(), 7000)
	}
	return apicontract.Success(apicontract.FileTreeDuplicateData{ID: tree.ID, Notebook: tree.Box, Path: tree.Path, HPath: tree.HPath})
}

func duplicateDocContract(c *gin.Context, request apicontract.FileTreeIDRequest) apicontract.Response[apicontract.FileTreeDuplicateData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.FileTreeDuplicateData](ret.Code, ret.Msg, 7000)
	}

	notebook := tree.Box
	model.DuplicateDoc(tree)

	return apicontract.Success(apicontract.FileTreeDuplicateData{ID: tree.Root.ID, Notebook: notebook, Path: tree.Path, HPath: tree.HPath})
}

var createDoc = contractHandler(apicontract.CreateDoc, createDocContract)

func createDocContract(c *gin.Context, request apicontract.FileTreeCreateRequest) apicontract.Response[apicontract.FileTreeCreateData] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	p := request.Path
	title := request.Title
	md := request.MD
	sorts := append([]string(nil), request.Sorts...)
	tree, err := model.CreateDocByMd(notebook, p, title, md, sorts, fileTreeCreateContext(request.FileTreeCreateOptions))
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.FileTreeCreateData](ret.Code, ret.Msg, 7000)
	}

	return apicontract.Success(apicontract.FileTreeCreateData{ID: tree.Root.ID})
}

var createDailyNote = contractHandler(apicontract.CreateDailyNote, createDailyNoteContract)

func createDailyNoteContract(c *gin.Context, request apicontract.FileTreeDailyNoteRequest) apicontract.Response[apicontract.FileTreeCreateData] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	p, existed, err := model.CreateDailyNote(notebook)
	if err != nil {
		if errors.Is(err, model.ErrBoxNotFound) {
			ret.Code = 1
		} else {
			ret.Code = -1
		}
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeCreateData](ret)
	}

	model.FlushTxQueue()
	box := model.Conf.Box(notebook)
	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(box.ID, p, luteEngine)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeCreateData](ret)
	}

	if !existed {
		// 只有创建的情况才推送，已经存在的情况不推送
		// Creating a dailynote existed no longer expands the doc tree https://github.com/siyuan-note/siyuan/issues/9959
		app, decodeErr := request.AppID()
		if decodeErr != nil {
			return apicontract.Failure[apicontract.FileTreeCreateData](-1, decodeErr.Error())
		}
		evt := util.NewCmdResult("createdailynote", 0, util.PushModeBroadcast)
		evt.AppId = app
		evt.Data = map[string]any{
			"box":  box,
			"path": p,
		}
		util.PushEvent(evt)
	}

	return apicontract.Success(apicontract.FileTreeCreateData{ID: tree.Root.ID})
}

var createDocWithMd = contractHandler(apicontract.CreateDocWithMd, createDocWithMdContract)

func createDocWithMdContract(c *gin.Context, request apicontract.FileTreeCreateMarkdownRequest) apicontract.Response[string] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[string](ret)
	}

	tags, parentID := request.Tags, request.ParentID
	id := ast.NewNodeID()
	if request.ID != nil {
		id = *request.ID
	}
	hPath := request.Path
	markdown := request.Markdown

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

	withMath, clippingHref := request.WithMath, request.ClippingHref
	context := fileTreeCreateContext(request.FileTreeCreateOptions)
	context["titleEmpty"] = request.TitleEmpty
	id, err := model.CreateWithMarkdown(tags, notebook, hPath, markdown, parentID, id, withMath, clippingHref, context)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[string](ret)
	}
	return apicontract.Success(id)
}

var getDocCreateSavePath = contractHandler(apicontract.GetDocCreateSavePath, getDocCreateSavePathContract)

func getDocCreateSavePathContract(c *gin.Context, request apicontract.FileTreeNotebookRequest) apicontract.Response[apicontract.FileTreeCreateSavePathData] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	docCreateSaveBox, docCreateSavePathTpl := model.ResolveDocCreateSaveLocation(notebook)
	docCreateTemplatePath := model.Conf.FileTree.DocCreateTemplatePath
	if box := model.Conf.Box(notebook); nil != box {
		boxConf := box.GetConf()
		if "" != boxConf.DocCreateTemplatePath {
			docCreateTemplatePath = boxConf.DocCreateTemplatePath
		}
	}
	docCreateSavePathTpl = strings.TrimSpace(docCreateSavePathTpl)

	if docCreateSaveBox != notebook {
		if "" != docCreateSavePathTpl && !strings.HasPrefix(docCreateSavePathTpl, "/") {
			// 如果配置的笔记本不是当前笔记本，则将相对路径转换为绝对路径
			docCreateSavePathTpl = "/" + docCreateSavePathTpl
		}
	}

	docCreateSavePath, err := model.RenderGoTemplateInBox(docCreateSavePathTpl, docCreateSaveBox)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeCreateSavePathData](ret)
	}

	return apicontract.Success(apicontract.FileTreeCreateSavePathData{FileTreeSavePathData: apicontract.FileTreeSavePathData{Box: docCreateSaveBox, Path: docCreateSavePath}, DocCreateTemplatePath: docCreateTemplatePath})
}

var getRefCreateSavePath = contractHandler(apicontract.GetRefCreateSavePath, getRefCreateSavePathContract)

func getRefCreateSavePathContract(c *gin.Context, request apicontract.FileTreeNotebookRequest) apicontract.Response[apicontract.FileTreeSavePathData] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
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

	refCreateSavePath, err := model.RenderGoTemplateInBox(refCreateSavePathTpl, refCreateSaveBox)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeSavePathData](ret)
	}
	return apicontract.Success(apicontract.FileTreeSavePathData{Box: refCreateSaveBox, Path: refCreateSavePath})
}

var getShorthandSavePath = contractHandler(apicontract.GetShorthandSavePath, getShorthandSavePathContract)

func getShorthandSavePathContract(c *gin.Context, request apicontract.FileTreeNotebookRequest) apicontract.Response[apicontract.FileTreeSavePathData] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook

	shorthandSaveBox := model.Conf.FileTree.ShorthandSaveBox
	shorthandSavePathTpl := model.Conf.FileTree.ShorthandSavePath

	if "" == shorthandSaveBox {
		shorthandSaveBox = notebook
	}
	if !model.IsShorthandSaveBoxAvailable(shorthandSaveBox) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(375)
		return contractFailure[apicontract.FileTreeSavePathData](ret)
	}

	if shorthandSaveBox != notebook {
		if "" != shorthandSavePathTpl && !strings.HasPrefix(shorthandSavePathTpl, "/") {
			shorthandSavePathTpl = "/" + shorthandSavePathTpl
		}
	}

	shorthandSavePath, err := model.RenderGoTemplateInBox(shorthandSavePathTpl, shorthandSaveBox)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeSavePathData](ret)
	}
	return apicontract.Success(apicontract.FileTreeSavePathData{Box: shorthandSaveBox, Path: shorthandSavePath})
}

var changeSort = contractHandler(apicontract.ChangeSort, changeSortContract)

func changeSortContract(c *gin.Context, request apicontract.FileTreeChangeSortRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	pathsArg := request.Paths
	var paths []string
	for _, p := range pathsArg {
		paths = append(paths, p)
	}
	model.ChangeFileTreeSort(notebook, paths)
	return contractFailure[apicontract.Null](ret)
}

var reorderDocs = contractHandler(apicontract.ReorderDocs, reorderDocsContract)

func reorderDocsContract(c *gin.Context, request apicontract.FileTreeReorderRequest) apicontract.Response[*apicontract.FileTreeReorderData] {
	ret := gulu.Ret.NewResult()

	if !validateReorderRequest(request.SourceIDs, request.TargetID, request.Position, ret) {
		return contractFailure[*apicontract.FileTreeReorderData](ret)
	}

	if request.RespectSort {
		result, err := model.ReorderDocTree(request.SourceIDs, request.TargetID, request.Position, request.Preview, request.RemoveSorts)
		data := fileTreeRespectSortContract(result)
		if err != nil {
			return apicontract.ReorderDocs.FailureWithData(-1, err.Error(), data)
		}
		return apicontract.Success(data)
	}

	result, err := model.ReorderDocs(request.SourceIDs, request.TargetID, request.Position)
	data := fileTreeReorderContract(result)
	if err != nil {
		return apicontract.ReorderDocs.FailureWithData(-1, err.Error(), data)
	}
	return apicontract.Success(data)
}

func validateReorderRequest(sourceIDs []string, targetID, position string, ret *gulu.Result) bool {
	if 1 > len(sourceIDs) {
		ret.Code = -1
		ret.Msg = "Field [sourceIDs] must not be empty"
		return false
	}
	if util.InvalidIDPattern(targetID, ret) {
		return false
	}
	if "before" != position && "after" != position {
		ret.Code = -1
		ret.Msg = "Field [position] must be [before] or [after]"
		return false
	}
	ids := map[string]struct{}{}
	for i, sourceID := range sourceIDs {
		if util.InvalidIDPattern(sourceID, ret) {
			return false
		}
		if sourceID == targetID {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [targetID] must not be included in [sourceIDs] at index [%d]", i)
			return false
		}
		if _, exists := ids[sourceID]; exists {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [sourceIDs] contains duplicate ID [%s]", sourceID)
			return false
		}
		ids[sourceID] = struct{}{}
	}
	return true
}

type sortRequestItem = apicontract.FileTreeSortItem

var setSort = contractHandler(apicontract.SetSort, setSortContract)

func setSortContract(c *gin.Context, request apicontract.FileTreeSetSortRequest) apicontract.Response[*apicontract.FileTreeSetSortData] {
	ret := gulu.Ret.NewResult()

	if 1 > len(request.NotebookSorts)+len(request.DocSorts) {
		ret.Code = -1
		ret.Msg = "Fields [notebookSorts] and [docSorts] must not both be empty"
		return contractFailure[*apicontract.FileTreeSetSortData](ret)
	}
	notebookSorts, ok := parseSortItems("notebookSorts", request.NotebookSorts, ret)
	if !ok {
		return contractFailure[*apicontract.FileTreeSetSortData](ret)
	}
	docSorts, ok := parseSortItems("docSorts", request.DocSorts, ret)
	if !ok {
		return contractFailure[*apicontract.FileTreeSetSortData](ret)
	}

	result, err := model.SetFileTreeSort(notebookSorts, docSorts)
	data := (*apicontract.FileTreeSetSortData)(result)
	if err != nil {
		return apicontract.SetSort.FailureWithData(-1, err.Error(), data)
	}
	return apicontract.Success(data)
}

var setDocSortMode = contractHandler(apicontract.SetDocSortMode, setDocSortModeContract)

func setDocSortModeContract(c *gin.Context, request apicontract.FileTreeSortModeRequest) apicontract.Response[*apicontract.FileTreeSortModeData] {
	ret := gulu.Ret.NewResult()

	if util.InvalidIDPattern(request.ID, ret) {
		return contractFailure[*apicontract.FileTreeSortModeData](ret)
	}
	sortMode, decodeErr := request.Mode()
	if decodeErr != nil {
		return apicontract.Failure[*apicontract.FileTreeSortModeData](-1, decodeErr.Error())
	}
	result, err := model.SetDocSortMode(request.ID, sortMode)
	data := (*apicontract.FileTreeSortModeData)(result)
	if err != nil {
		return apicontract.SetDocSortMode.FailureWithData(-1, err.Error(), data)
	}
	return apicontract.Success(data)
}

func parseSortItems(field string, items []*sortRequestItem, ret *gulu.Result) (retItems []*model.SortItem, ok bool) {
	ids := map[string]struct{}{}
	for i, item := range items {
		if nil == item {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s][%d] must not be null", field, i)
			return
		}
		if util.InvalidIDPattern(item.ID, ret) {
			return
		}
		if nil == item.Sort {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s][%d].sort is required", field, i)
			return
		}
		if _, ok := ids[item.ID]; ok {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s] contains duplicate ID [%s]", field, item.ID)
			return nil, false
		}
		ids[item.ID] = struct{}{}
		retItems = append(retItems, &model.SortItem{ID: item.ID, Sort: *item.Sort})
	}
	return retItems, true
}

var searchDocs = contractHandler(apicontract.SearchDocs, searchDocsContract)

func searchDocsContract(c *gin.Context, request apicontract.FileTreeSearchRequest) apicontract.Response[[]*apicontract.FileTreeSearchDoc] {

	flashcard := request.Flashcard
	excludeIDs := append([]string(nil), request.ExcludeIDs...)
	k := request.K
	docs := model.SearchDocs(k, flashcard, excludeIDs)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		docs = model.FilterSearchDocsByPublishAccess(c, publishAccess, docs)
	}
	return apicontract.Success(fileTreeSearchContracts(docs))
}

var listDocsByPath = contractHandler(apicontract.ListDocsByPath, listDocsByPathContract)

func listDocsByPathContract(c *gin.Context, request apicontract.FileTreeListRequest) apicontract.Response[apicontract.FileTreeListData] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	p := request.Path

	// 越界校验：拒绝 ..，确保路径位于 <data>/<notebook>/ 内
	if strings.Contains(p, "..") {
		ret.Code = -1
		ret.Msg = "path must not contain '..' and must be relative"
		return contractFailure[apicontract.FileTreeListData](ret)
	}

	if isEncryptedNotebookDeniedForPublish(c, notebook) {
		return apicontract.Success(apicontract.FileTreeListData{Box: notebook, Path: p, Files: []*apicontract.FileTreeFile{}, EffectiveSortMode: model.Conf.FileTree.Sort})
	}

	options, decodeErr := request.Options()
	if decodeErr != nil {
		return apicontract.Failure[apicontract.FileTreeListData](-1, decodeErr.Error())
	}
	sortParam := options.Sort
	sortMode := util.SortModeUnassigned
	if nil != sortParam {
		sortMode = int(*sortParam)
	}
	effectiveSortMode := sortMode
	if util.SortModeUnassigned == effectiveSortMode {
		var resolveErr error
		effectiveSortMode, resolveErr = model.ResolveDocTreeSortMode(notebook, p)
		if nil != resolveErr {
			ret.Code = -1
			ret.Msg = resolveErr.Error()
			return contractFailure[apicontract.FileTreeListData](ret)
		}
	}
	flashcard := options.Flashcard
	maxListCount := model.Conf.FileTree.MaxListCount
	if options.MaxListCount != nil {
		// API `listDocsByPath` add an optional parameter `maxListCount` https://github.com/siyuan-note/siyuan/issues/7993
		maxListCount = int(*options.MaxListCount)
		if 0 >= maxListCount {
			maxListCount = math.MaxInt
		}
	}
	showHidden := options.ShowHidden

	files, totals, err := model.ListDocTree(notebook, p, effectiveSortMode, flashcard, showHidden, maxListCount)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeListData](ret)
	}
	// 过滤掉发布不可见的文件
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishInvisible := model.GetInvisiblePublishAccess(publishAccess)
		publishDisable := model.GetDisablePublishAccess(publishAccess)
		tempFiles := []*model.File{}
		for _, file := range files {
			if model.CheckPathAccessableByPublishIgnore(notebook, file.Path, publishInvisible) &&
				model.CheckPathAccessableByPublishIgnore(notebook, file.Path, publishDisable) {
				// 下级文档数同样只统计发布可见的文档，避免读者据此推断被排除文档的数量
				if 0 < file.SubFileCount {
					file.SubFileCount = model.BoxDocSubFileCountForPublishAt(notebook, file.Path, publishAccess)
				}
				tempFiles = append(tempFiles, file)
			}
		}
		files = tempFiles
	}
	if maxListCount < totals {
		// API `listDocsByPath` add an optional parameter `ignoreMaxListHint` https://github.com/siyuan-note/siyuan/issues/10290
		ignoreHint, app, hintErr := request.HintOptions()
		if hintErr != nil {
			return apicontract.Failure[apicontract.FileTreeListData](-1, hintErr.Error())
		}
		if !ignoreHint {
			if nil == util.NotificationsCfg || util.NotificationsCfg.DocTreeMaxList {
				util.PushMsgWithApp(app, fmt.Sprintf(model.Conf.Language(48), len(files)), 7000)
			}
		}
	}

	return apicontract.Success(apicontract.FileTreeListData{Box: notebook, Path: p, Files: fileTreeFileContracts(files), EffectiveSortMode: effectiveSortMode})
}

var getDoc = contractHandler(apicontract.GetDoc, getDocContract)

func getDocContract(c *gin.Context, request apicontract.FileTreeGetDocRequest) apicontract.Response[apicontract.FileTreeGetDocData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.FileTreeGetDocData](ret)
	}
	requestedNotebook := request.Notebook
	if model.IsReadOnlyRoleContext(c) &&
		((requestedNotebook != "" && model.IsEncryptedBoxDeniedByPublishAccess(requestedNotebook)) ||
			model.IsEncryptedPublishRuntimeTarget(id)) {
		ret.Code = 3
		return contractFailure[apicontract.FileTreeGetDocData](ret)
	}
	if err := holdEncryptedBoxRequest(c, requestedNotebook); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeGetDocData](ret)
	}
	options, decodeErr := request.Options()
	if decodeErr != nil {
		return apicontract.Failure[apicontract.FileTreeGetDocData](-1, decodeErr.Error())
	}
	includeDocInfo := options.IncludeDocInfo
	if includeDocInfo && model.IsReadOnlyRoleContext(c) {
		includeDocInfo = isBlockPublishAccessible(c, id, requestedNotebook)
	}
	index, query, queryMethod := int(options.Index), options.Query, int(options.QueryMethod)
	queryTypes, querySubTypes := options.QueryTypes, options.QuerySubTypes.Selected()
	mode, size := int(options.Mode), 102400
	if options.Size != nil {
		size = int(*options.Size)
	}
	startID, endID := "", ""
	if options.StartID != nil && options.EndID != nil {
		startID, endID = *options.StartID, *options.EndID
		size = model.Conf.Editor.DynamicLoadBlocks
	}
	isBacklink := options.IsBacklink
	originalRefBlockIDs := options.OriginalRefBlockIDs
	if originalRefBlockIDs == nil {
		originalRefBlockIDs = map[string]string{}
	}
	highlight := true
	if options.Highlight != nil {
		highlight = *options.Highlight
	}

	var blockCount int
	var content, parentID, parent2ID, rootID, typ string
	var eof, scroll bool
	var boxID, docPath string
	var isBacklinkExpand bool
	var keywords []string
	var headingNumbers map[string]string
	var docInfo *model.BlockInfo
	var err error
	// 加密笔记本的打开文档走 InBox 版（查加密 blocktree + content db）
	if requestedNotebook != "" && model.IsEncryptedBox(requestedNotebook) {
		blockCount, content, parentID, parent2ID, rootID, typ, eof, scroll, boxID, docPath, isBacklinkExpand, keywords, headingNumbers, docInfo, err =
			model.GetDocInBox(startID, endID, id, index, query, queryTypes, querySubTypes, queryMethod, mode, size, isBacklink, originalRefBlockIDs, highlight, includeDocInfo, requestedNotebook)
	} else {
		blockCount, content, parentID, parent2ID, rootID, typ, eof, scroll, boxID, docPath, isBacklinkExpand, keywords, headingNumbers, docInfo, err =
			model.GetDoc(startID, endID, id, index, query, queryTypes, querySubTypes, queryMethod, mode, size, isBacklink, originalRefBlockIDs, highlight, includeDocInfo)
	}
	if errors.Is(err, model.ErrBlockNotFound) {
		ret.Code = 3
		return contractFailure[apicontract.FileTreeGetDocData](ret)
	}

	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return contractFailure[apicontract.FileTreeGetDocData](ret)
	}

	// 判断是否正在同步中 https://github.com/siyuan-note/siyuan/issues/6290
	isSyncing := model.IsSyncingFile(rootID)

	publishAccessRequired := false
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		newContent, publishAccessStatus := model.FilterContentByPublishAccessWithStatus(c, publishAccess, boxID, docPath, content, false)
		publishAccessRequired = publishAccessStatus == model.PublishAccessPasswordRequired
		if newContent != content {
			content = newContent
			headingNumbers = nil
			scroll = false // 避免长页面可通过滚动无限刷出多个锁
		}
		if nil != docInfo {
			if publishAccessRequired {
				docInfo = nil
			} else {
				docInfo = model.FilterBlockInfoByPublishAccess(c, publishAccess, docInfo)
			}
		}
	}

	return apicontract.Success(apicontract.FileTreeGetDocData{
		ID: id, Mode: mode, ParentID: parentID, Parent2ID: parent2ID, RootID: rootID, Type: typ,
		Content: content, BlockCount: blockCount, EOF: eof, Scroll: scroll, Box: boxID, Path: docPath,
		IsSyncing: isSyncing, IsBacklinkExpand: isBacklinkExpand, Keywords: keywords, HeadingNumbers: headingNumbers,
		PublishAccessRequired: publishAccessRequired, ReqID: options.ReqID, DocInfo: docInfoContract(docInfo),
	})
}

var setPublishAccess = contractHandler(apicontract.SetPublishAccess, setPublishAccessContract)

func setPublishAccessContract(c *gin.Context, request apicontract.FileTreeSetPublishRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	publishAccess := model.GetPublishAccess()
	ID := request.ID
	if model.IsEncryptedPublishAccessTarget(ID) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(394)
		return contractFailure[apicontract.Null](ret)
	}
	options, err := request.Options()
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	visible, password, disable := options.Visible, options.Password, options.Disable

	foundIndex := -1
	updated := false
	for i, item := range publishAccess {
		if ID == item.ID {
			foundIndex = i
			break
		}
	}
	if foundIndex >= 0 {
		if visible && len(password) == 0 && !disable {
			publishAccess = append(publishAccess[:foundIndex], publishAccess[foundIndex+1:]...)
		} else {
			publishAccess[foundIndex].Visible = visible
			publishAccess[foundIndex].Password = password
			publishAccess[foundIndex].Disable = disable
		}
		updated = true
	} else {
		if !visible || len(password) != 0 || disable {
			publishAccess = append(publishAccess, &model.PublishAccessItem{
				ID:       ID,
				Visible:  visible,
				Password: password,
				Disable:  disable,
			})
			updated = true
		}
	}

	if updated {
		err := model.SetPublishAccess(publishAccess)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
	}

	model.PurgePublishAccess()
	return contractFailure[apicontract.Null](ret)
}

var getPublishAccess = contractHandler(apicontract.GetPublishAccess, getPublishAccessContract)

func getPublishAccessContract(c *gin.Context, request apicontract.FileTreePublishIDsRequest) apicontract.Response[apicontract.FileTreePublishData] {
	ret := gulu.Ret.NewResult()

	var IDs []string
	for _, ID := range request.IDs {
		id := ID
		if model.IsEncryptedPublishAccessTarget(id) {
			ret.Code = -1
			ret.Msg = model.Conf.Language(394)
			return contractFailure[apicontract.FileTreePublishData](ret)
		}
		IDs = append(IDs, id)
	}

	publishAccess := model.GetPublishAccess()
	maskedPublishAccess := model.PublishAccess{}
	for _, ID := range IDs {
		found := false
		for _, item := range publishAccess {
			if item.ID == ID {
				found = true
				maskedPublishAccess = append(maskedPublishAccess, item)
				break
			}
		}
		if !found {
			maskedPublishAccess = append(maskedPublishAccess, &model.PublishAccessItem{
				ID:       ID,
				Visible:  true,
				Password: "",
				Disable:  false,
			})
		}
	}

	return apicontract.Success(apicontract.FileTreePublishData{PublishAccess: fileTreePublishContracts(maskedPublishAccess)})
}

var authFilePublishAccess = contractHandler(apicontract.AuthFilePublishAccess, authFilePublishAccessContract)

func authFilePublishAccessContract(c *gin.Context, request apicontract.FileTreeAuthPublishRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	ID := request.ID
	if util.InvalidIDPattern(ID, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	password := request.Password

	ret.Code = -1
	ret.Msg = model.Conf.Language(285)
	if model.IsEncryptedPublishRuntimeTarget(ID) {
		return contractFailure[apicontract.Null](ret)
	}

	// 按来源 IP 对发布密码认证进行限流，防止无限次暴力破解密码 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-v362-968x-gp2v
	ip := c.ClientIP()
	if retryAfter := util.AuthThrottleCheck(ip); 0 < retryAfter {
		// 锁定期间持续记录失败，不断延长锁定时间
		util.AuthThrottleFail(ip)
		c.Header("Retry-After", strconv.Itoa(retryAfter))
		ret.Msg = model.Conf.Language(354)
		return apicontract.AuthFilePublishAccess.WithHTTPStatus(contractFailure[apicontract.Null](ret), http.StatusTooManyRequests)
	}

	publishAccess := model.GetPublishAccess()
	for _, item := range publishAccess {
		if item.ID != ID {
			continue
		}
		if item.Disable || item.Password == "" || !util.AuthCodeEquals(item.Password, password) {
			// 恒定时间比较，避免通过响应时间差异猜测密码
			util.AuthThrottleFail(ip)
			return contractFailure[apicontract.Null](ret)
		}
		util.AuthThrottleReset(ip)
		model.SetPublishAuthCookie(c, ID, password)
		ret.Code = 0
		ret.Msg = ""
		return contractFailure[apicontract.Null](ret)
	}

	// 目标 ID 不在发布配置中，同样记录失败以限制尝试次数
	util.AuthThrottleFail(ip)
	return contractFailure[apicontract.Null](ret)
}
