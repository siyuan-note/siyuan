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

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var historyTicker = time.NewTicker(time.Minute * 10)

func AutoGenerateFileHistory() {
	ChangeHistoryTick(Conf.Editor.GenerateHistoryInterval)
	for {
		<-historyTicker.C
		task.AppendTask(task.HistoryGenerateFile, GenerateFileHistory)
	}
}

func GenerateFileHistory() {
	defer logging.Recover()

	if 1 > Conf.Editor.GenerateHistoryInterval {
		return
	}

	FlushTxQueue()

	// 生成文档历史
	for _, box := range Conf.GetOpenedBoxes() {
		box.generateDocHistory0()
	}

	// 生成资源文件历史
	generateAssetsHistory()

	historyDir := util.HistoryDir
	clearOutdatedHistoryDir(historyDir)

	// 以下部分是老版本的历史数据，不再保留
	for _, box := range Conf.GetBoxes() {
		historyDir = filepath.Join(util.DataDir, box.ID, ".siyuan", "history")
		os.RemoveAll(historyDir)
	}
	historyDir = filepath.Join(util.DataDir, "assets", ".siyuan", "history")
	os.RemoveAll(historyDir)
	historyDir = filepath.Join(util.DataDir, ".siyuan", "history")
	os.RemoveAll(historyDir)
}

func ChangeHistoryTick(minutes int) {
	if 0 >= minutes {
		minutes = 3600
	}
	historyTicker.Reset(time.Minute * time.Duration(minutes))
}

func ClearWorkspaceHistory() (err error) {
	historyDir := util.HistoryDir
	if gulu.File.IsDir(historyDir) {
		if err = os.RemoveAll(historyDir); err != nil {
			logging.LogErrorf("remove workspace history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed workspace history dir [%s]", historyDir)
	}

	sql.InitHistoryDatabase(true)

	// 以下部分是老版本的清理逻辑，暂时保留

	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	for _, notebook := range notebooks {
		boxID := notebook.ID
		historyDir := filepath.Join(util.DataDir, boxID, ".siyuan", "history")
		if !gulu.File.IsDir(historyDir) {
			continue
		}

		if err = os.RemoveAll(historyDir); err != nil {
			logging.LogErrorf("remove notebook history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed notebook history dir [%s]", historyDir)
	}

	historyDir = filepath.Join(util.DataDir, ".siyuan", "history")
	if gulu.File.IsDir(historyDir) {
		if err = os.RemoveAll(historyDir); err != nil {
			logging.LogErrorf("remove data history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed data history dir [%s]", historyDir)
	}
	historyDir = filepath.Join(util.DataDir, "assets", ".siyuan", "history")
	if gulu.File.IsDir(historyDir) {
		if err = os.RemoveAll(historyDir); err != nil {
			logging.LogErrorf("remove assets history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed assets history dir [%s]", historyDir)
	}
	return
}

func GetDocHistoryContent(historyPath, keyword string, highlight bool) (id, rootID, content string, isLargeDoc bool, err error) {
	if !util.IsAbsPathInWorkspace(historyPath) {
		msg := "Path [" + historyPath + "] is not in workspace"
		logging.LogErrorf(msg)
		err = errors.New(msg)
		return
	}

	if !gulu.File.IsExist(historyPath) {
		logging.LogWarnf("doc history [%s] not exist", historyPath)
		return
	}

	data, err := filelock.ReadFile(historyPath)
	if err != nil {
		logging.LogErrorf("read file [%s] failed: %s", historyPath, err)
		return
	}
	isLargeDoc = 1024*1024*1 <= len(data)

	luteEngine := NewLute()
	historyTree, err := dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if err != nil {
		logging.LogErrorf("parse tree from file [%s] failed: %s", historyPath, err)
		return
	}
	id = historyTree.Root.ID
	rootID = historyTree.Root.ID

	if !isLargeDoc {
		renderTree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}}
		keyword = strings.Join(strings.Split(keyword, " "), search.TermSep)
		keywords := search.SplitKeyword(keyword)

		var unlinks []*ast.Node
		ast.Walk(historyTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			// 数据历史浏览时忽略内容块折叠状态 https://github.com/siyuan-note/siyuan/issues/5778
			n.RemoveIALAttr("heading-fold")
			n.RemoveIALAttr("fold")

			if highlight && 0 < len(keywords) {
				if markReplaceSpan(n, &unlinks, keywords, search.MarkDataType, luteEngine) {
					return ast.WalkContinue
				}
			}
			return ast.WalkContinue
		})

		for _, unlink := range unlinks {
			unlink.Unlink()
		}

		var appends []*ast.Node
		for n := historyTree.Root.FirstChild; nil != n; n = n.Next {
			appends = append(appends, n)
		}
		for _, n := range appends {
			renderTree.Root.AppendChild(n)
		}

		historyTree = renderTree
	}

	// 禁止文档历史内容可编辑 https://github.com/siyuan-note/siyuan/issues/6580
	luteEngine.RenderOptions.ProtyleContenteditable = false
	if isLargeDoc {
		util.PushMsg(Conf.Language(36), 5000)
		formatRenderer := render.NewFormatRenderer(historyTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		content = gulu.Str.FromBytes(formatRenderer.Render())
	} else {
		content = luteEngine.Tree2BlockDOM(historyTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	}
	return
}

func RollbackDocHistory(boxID, historyPath string) (err error) {
	if !gulu.File.IsExist(historyPath) {
		logging.LogWarnf("doc history [%s] not exist", historyPath)
		return
	}

	FlushTxQueue()

	srcPath := historyPath
	var destPath, parentHPath string
	rootID := util.GetTreeID(historyPath)
	workingDoc := treenode.GetBlockTree(rootID)
	if nil != workingDoc && "d" == workingDoc.Type {
		if err = filelock.Remove(filepath.Join(util.DataDir, boxID, workingDoc.Path)); err != nil {
			return
		}
	}

	destPath, parentHPath, err = getRollbackDockPath(boxID, historyPath, workingDoc)
	if err != nil {
		return
	}

	var avIDs []string
	tree, _ := loadTree(srcPath, util.NewLute())
	if nil != tree {
		historyDir := strings.TrimPrefix(historyPath, util.HistoryDir+string(os.PathSeparator))
		if strings.Contains(historyDir, string(os.PathSeparator)) {
			historyDir = historyDir[:strings.Index(historyDir, string(os.PathSeparator))]
		}
		historyDir = filepath.Join(util.HistoryDir, historyDir)

		avNodes := tree.Root.ChildrenByType(ast.NodeAttributeView)
		for _, avNode := range avNodes {
			srcAvPath := filepath.Join(historyDir, "storage", "av", avNode.AttributeViewID+".json")
			destAvPath := filepath.Join(util.DataDir, "storage", "av", avNode.AttributeViewID+".json")
			if gulu.File.IsExist(destAvPath) {
				if copyErr := filelock.CopyNewtimes(srcAvPath, destAvPath); nil != copyErr {
					logging.LogErrorf("copy av [%s] failed: %s", srcAvPath, copyErr)
				}
			}

			avIDs = append(avIDs, avNode.AttributeViewID)
		}
	}
	avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)

	tree.Box = boxID
	tree.Path = filepath.ToSlash(strings.TrimPrefix(destPath, util.DataDir+string(os.PathSeparator)+boxID))
	tree.HPath = parentHPath + "/" + tree.Root.IALAttr("title")

	// 重置重复的块 ID https://github.com/siyuan-note/siyuan/issues/14358
	if nil != workingDoc {
		treenode.RemoveBlockTreesByRootID(rootID)
	}
	nodes := map[string]*ast.Node{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}

		nodes[n.ID] = n
		return ast.WalkContinue
	})
	var ids []string
	for nodeID, _ := range nodes {
		ids = append(ids, nodeID)
	}
	idMap := treenode.ExistBlockTrees(ids)
	var duplicatedIDs []string
	for nodeID, exist := range idMap {
		if exist {
			duplicatedIDs = append(duplicatedIDs, nodeID)
		}
	}
	for _, nodeID := range duplicatedIDs {
		node := nodes[nodeID]
		treenode.ResetNodeID(node)
		if ast.NodeDocument == node.Type {
			tree.ID = node.ID
			tree.Path = tree.Path[:strings.LastIndex(tree.Path, "/")] + "/" + node.ID + ".sy"
		}
	}

	// 仅重新索引该文档，不进行全量索引
	// Reindex only the current document after rolling back the document https://github.com/siyuan-note/siyuan/issues/12320
	sql.RemoveTreeQueue(rootID)
	if writeErr := indexWriteTreeIndexQueue(tree); nil != writeErr {
		return
	}
	ReloadFiletree()
	ReloadProtyle(rootID)
	util.PushMsg(Conf.Language(102), 3000)

	IncSync()

	// 刷新属性视图
	for _, avID := range avIDs {
		ReloadAttrView(avID)
	}

	go func() {
		sql.FlushQueue()

		tree, _ = LoadTreeByBlockID(rootID)
		if nil == tree {
			return
		}

		ReloadProtyle(rootID)

		// 刷新页签名
		refText := getNodeRefText(tree.Root)
		evt := util.NewCmdResult("rename", 0, util.PushModeBroadcast)
		evt.Data = map[string]interface{}{
			"box":     boxID,
			"id":      tree.Root.ID,
			"path":    tree.Path,
			"title":   tree.Root.IALAttr("title"),
			"refText": refText,
		}
		util.PushEvent(evt)

		// 收集引用的定义块 ID
		refDefIDs := getRefDefIDs(tree.Root)
		// 推送定义节点引用计数
		for _, defID := range refDefIDs {
			task.AppendAsyncTaskWithDelay(task.SetDefRefCount, util.SQLFlushInterval, refreshRefCount, defID)
		}
	}()
	return nil
}

func getRollbackDockPath(boxID, historyPath string, workingDoc *treenode.BlockTree) (destPath, parentHPath string, err error) {
	var parentID string
	baseName := filepath.Base(historyPath)
	var parentWorkingDoc *treenode.BlockTree
	if nil != workingDoc {
		parentID = path.Base(path.Dir(workingDoc.Path))
		parentWorkingDoc = treenode.GetBlockTree(parentID)
	} else {
		parentID = filepath.Base(filepath.Dir(historyPath))
		parentWorkingDoc = treenode.GetBlockTree(parentID)
	}

	if nil != parentWorkingDoc {
		// 父路径如果是文档，则恢复到父路径下
		parentDir := strings.TrimSuffix(parentWorkingDoc.Path, ".sy")
		parentDir = filepath.Join(util.DataDir, boxID, parentDir)
		if err = os.MkdirAll(parentDir, 0755); err != nil {
			return
		}
		destPath = filepath.Join(parentDir, baseName)
		parentHPath = parentWorkingDoc.HPath
	} else {
		// 父路径如果不是文档，则恢复到笔记本根路径下
		destPath = filepath.Join(util.DataDir, boxID, baseName)
	}
	return
}

func RollbackAssetsHistory(historyPath string) (err error) {
	historyPath = filepath.Join(util.WorkspaceDir, historyPath)
	if !gulu.File.IsExist(historyPath) {
		logging.LogWarnf("assets history [%s] not exist", historyPath)
		return
	}

	from := historyPath
	to := filepath.Join(util.DataDir, "assets", filepath.Base(historyPath))

	if err = filelock.CopyNewtimes(from, to); err != nil {
		logging.LogErrorf("copy file [%s] to [%s] failed: %s", from, to, err)
		return
	}
	IncSync()
	util.PushMsg(Conf.Language(102), 3000)
	return nil
}

func RollbackNotebookHistory(historyPath string) (err error) {
	if !gulu.File.IsExist(historyPath) {
		logging.LogWarnf("notebook history [%s] not exist", historyPath)
		return
	}

	from := historyPath
	to := filepath.Join(util.DataDir, filepath.Base(historyPath))

	if err = filelock.CopyNewtimes(from, to); err != nil {
		logging.LogErrorf("copy file [%s] to [%s] failed: %s", from, to, err)
		return
	}

	FullReindex()
	IncSync()
	return nil
}

type History struct {
	HCreated string         `json:"hCreated"`
	Items    []*HistoryItem `json:"items"`
}

type HistoryItem struct {
	Title    string `json:"title"`
	Path     string `json:"path"`
	Op       string `json:"op"`
	Notebook string `json:"notebook"` // 仅用于文档历史
}

const fileHistoryPageSize = 32

func FullTextSearchHistory(query, box, op string, typ, page int) (ret []string, pageCount, totalCount int) {
	query = util.RemoveInvalid(query)
	if "" != query && HistoryTypeDocID != typ {
		query = stringQuery(query)
	}

	offset := (page - 1) * fileHistoryPageSize

	table := "histories_fts_case_insensitive"
	stmt := "SELECT DISTINCT created FROM " + table + " WHERE "
	stmt += buildSearchHistoryQueryFilter(query, op, box, table, typ)
	countStmt := strings.ReplaceAll(stmt, "SELECT DISTINCT created", "SELECT COUNT(DISTINCT created) AS total")
	stmt += " ORDER BY created DESC LIMIT " + strconv.Itoa(fileHistoryPageSize) + " OFFSET " + strconv.Itoa(offset)
	result, err := sql.QueryHistory(stmt)
	if err != nil {
		return
	}
	for _, row := range result {
		ret = append(ret, row["created"].(string))
	}
	result, err = sql.QueryHistory(countStmt)
	if err != nil {
		return
	}
	if 1 > len(ret) {
		ret = []string{}
	}
	if 1 > len(result) {
		return
	}
	totalCount = int(result[0]["total"].(int64))
	pageCount = int(math.Ceil(float64(totalCount) / float64(fileHistoryPageSize)))
	return
}

func FullTextSearchHistoryItems(created, query, box, op string, typ int) (ret []*HistoryItem) {
	query = util.RemoveInvalid(query)
	if "" != query && HistoryTypeDocID != typ {
		query = stringQuery(query)
	}

	table := "histories_fts_case_insensitive"
	stmt := "SELECT * FROM " + table + " WHERE "
	stmt += buildSearchHistoryQueryFilter(query, op, box, table, typ)

	_, parseErr := strconv.Atoi(created)
	if nil != parseErr {
		ret = []*HistoryItem{}
		return
	}

	stmt += " AND created = '" + created + "' ORDER BY created DESC LIMIT " + fmt.Sprintf("%d", fileHistoryPageSize)
	sqlHistories := sql.SelectHistoriesRawStmt(stmt)
	ret = fromSQLHistories(sqlHistories)
	return
}

func buildSearchHistoryQueryFilter(query, op, box, table string, typ int) (stmt string) {
	if "" != query {
		switch typ {
		case HistoryTypeDocName:
			stmt += table + " MATCH '{title}:(" + query + ")'"
		case HistoryTypeDoc:
			stmt += table + " MATCH '{title content}:(" + query + ")'"
		case HistoryTypeDocID:
			stmt += " id = '" + query + "'"
		case HistoryTypeAsset:
			stmt += table + " MATCH '{title content}:(" + query + ")'"
		}
	} else {
		stmt += "1=1"
	}
	if "all" != op {
		stmt += " AND op = '" + op + "'"
	}

	if "%" != box && !ast.IsNodeIDPattern(box) {
		box = "%"
	}

	if HistoryTypeDocName == typ || HistoryTypeDoc == typ || HistoryTypeDocID == typ {
		if HistoryTypeDocName == typ || HistoryTypeDoc == typ {
			stmt += " AND path LIKE '%/" + box + "/%' AND path LIKE '%.sy'"
		}
	} else if HistoryTypeAsset == typ {
		stmt += " AND path LIKE '%/assets/%'"
	}

	ago := time.Now().Add(-24 * time.Hour * time.Duration(Conf.Editor.HistoryRetentionDays))
	stmt += " AND CAST(created AS INTEGER) > " + fmt.Sprintf("%d", ago.Unix()) + ""
	return
}

func GetNotebookHistory() (ret []*History, err error) {
	ret = []*History{}

	historyDir := util.HistoryDir
	if !gulu.File.IsDir(historyDir) {
		return
	}

	historyNotebookConfs, err := filepath.Glob(historyDir + "/*-delete/*/.siyuan/conf.json")
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", historyDir, err)
		return
	}
	sort.Slice(historyNotebookConfs, func(i, j int) bool {
		iTimeDir := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(historyNotebookConfs[i]))))
		jTimeDir := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(historyNotebookConfs[j]))))
		return iTimeDir > jTimeDir
	})

	for _, historyNotebookConf := range historyNotebookConfs {
		timeDir := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(historyNotebookConf))))
		t := timeDir[:strings.LastIndex(timeDir, "-")]
		if ti, parseErr := time.Parse("2006-01-02-150405", t); nil == parseErr {
			t = ti.Format("2006-01-02 15:04:05")
		}

		var c conf.BoxConf
		data, readErr := os.ReadFile(historyNotebookConf)
		if nil != readErr {
			logging.LogErrorf("read notebook conf [%s] failed: %s", historyNotebookConf, readErr)
			continue
		}
		if err = json.Unmarshal(data, &c); err != nil {
			logging.LogErrorf("parse notebook conf [%s] failed: %s", historyNotebookConf, err)
			continue
		}

		ret = append(ret, &History{
			HCreated: t,
			Items: []*HistoryItem{{
				Title: c.Name,
				Path:  filepath.Dir(filepath.Dir(historyNotebookConf)),
				Op:    HistoryOpDelete,
			}},
		})
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i].HCreated > ret[j].HCreated
	})
	return
}

func generateAssetsHistory() {
	assets := recentModifiedAssets()
	if 1 > len(assets) {
		return
	}

	historyDir, err := GetHistoryDir(HistoryOpUpdate)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	for _, file := range assets {
		historyPath := filepath.Join(historyDir, "assets", strings.TrimPrefix(file, filepath.Join(util.DataDir, "assets")))
		if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
			logging.LogErrorf("generate history failed: %s", err)
			return
		}

		if err = filelock.Copy(file, historyPath); err != nil {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", file, historyPath, err)
			return
		}
	}

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	return
}

func (box *Box) generateDocHistory0() {
	files := box.recentModifiedDocs()
	if 1 > len(files) {
		return
	}

	historyDir, err := GetHistoryDir(HistoryOpUpdate)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	luteEngine := util.NewLute()
	for _, file := range files {
		historyPath := filepath.Join(historyDir, box.ID, strings.TrimPrefix(file, filepath.Join(util.DataDir, box.ID)))
		if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
			logging.LogErrorf("generate history failed: %s", err)
			return
		}

		var data []byte
		if data, err = filelock.ReadFile(file); err != nil {
			logging.LogErrorf("generate history failed: %s", err)
			return
		}

		if err = gulu.File.WriteFileSafer(historyPath, data, 0644); err != nil {
			logging.LogErrorf("generate history failed: %s", err)
			return
		}

		if strings.HasSuffix(file, ".sy") {
			tree, loadErr := loadTree(file, luteEngine)
			if nil != loadErr {
				logging.LogErrorf("load tree [%s] failed: %s", file, loadErr)
			} else {
				generateAvHistory(tree, historyDir)
			}
		}
	}

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	return
}

func clearOutdatedHistoryDir(historyDir string) {
	if !gulu.File.IsExist(historyDir) {
		return
	}

	dirs, err := os.ReadDir(historyDir)
	if err != nil {
		logging.LogErrorf("clear history [%s] failed: %s", historyDir, err)
		return
	}

	now := time.Now()
	ago := now.Add(-24 * time.Hour * time.Duration(Conf.Editor.HistoryRetentionDays)).Unix()
	var removes []string
	for _, dir := range dirs {
		dirInfo, err := dir.Info()
		if err != nil {
			logging.LogErrorf("read history dir [%s] failed: %s", dir.Name(), err)
			continue
		}

		if dirInfo.ModTime().Unix() < ago {
			removes = append(removes, filepath.Join(historyDir, dir.Name()))
			continue
		}

		if dirName := dirInfo.Name(); len(dirName) > len("2006-01-02-150405") {
			if t, parseErr := time.Parse("2006-01-02-150405", dirName[:len("2006-01-02-150405")]); nil == parseErr {
				if nameTime := t.Unix(); 0 != nameTime && nameTime < ago {
					removes = append(removes, filepath.Join(historyDir, dir.Name()))
					continue
				}
			}
		}
	}
	for _, dir := range removes {
		if err = os.RemoveAll(dir); err != nil {
			logging.LogWarnf("remove history dir [%s] failed: %s", dir, err)
			continue
		}
		//logging.LogInfof("auto removed history dir [%s]", dir)
	}

	// 清理历史库
	sql.DeleteOutdatedHistories(ago)
}

var boxLatestHistoryTime = map[string]time.Time{}

func (box *Box) recentModifiedDocs() (ret []string) {
	latestHistoryTime := boxLatestHistoryTime[box.ID]
	filelock.Walk(filepath.Join(util.DataDir, box.ID), func(path string, d fs.DirEntry, err error) error {
		if nil != err || nil == d {
			return nil
		}
		if isSkipFile(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if d.IsDir() {
			return nil
		}

		info, err := d.Info()
		if nil != err {
			return err
		}

		if info.ModTime().After(latestHistoryTime) {
			ret = append(ret, path)
		}
		return nil
	})
	box.UpdateHistoryGenerated()
	return
}

var assetsLatestHistoryTime = time.Now().Unix()

func recentModifiedAssets() (ret []string) {
	assets := cache.GetAssets()
	for _, asset := range assets {
		if asset.Updated > assetsLatestHistoryTime {
			absPath := filepath.Join(util.DataDir, asset.Path)
			if filelock.IsHidden(absPath) {
				continue
			}
			ret = append(ret, absPath)
		}
	}
	assetsLatestHistoryTime = time.Now().Unix()
	return
}

const (
	HistoryOpClean   = "clean"
	HistoryOpUpdate  = "update"
	HistoryOpDelete  = "delete"
	HistoryOpFormat  = "format"
	HistoryOpSync    = "sync"
	HistoryOpReplace = "replace"
	HistoryOpOutline = "outline"
)

func generateOpTypeHistory(tree *parse.Tree, opType string) {
	historyDir, err := GetHistoryDir(opType)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	historyPath := filepath.Join(historyDir, tree.Box, tree.Path)
	if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
		logging.LogErrorf("generate history failed: %s", err)
		return
	}

	var data []byte
	if data, err = filelock.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path)); err != nil {
		logging.LogErrorf("generate history failed: %s", err)
		return
	}

	if err = gulu.File.WriteFileSafer(historyPath, data, 0644); err != nil {
		logging.LogErrorf("generate history failed: %s", err)
		return
	}

	generateAvHistory(tree, historyDir)

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
}

func generateAvHistory(tree *parse.Tree, historyDir string) {
	avNodes := tree.Root.ChildrenByType(ast.NodeAttributeView)
	for _, avNode := range avNodes {
		srcAvPath := filepath.Join(util.DataDir, "storage", "av", avNode.AttributeViewID+".json")
		destAvPath := filepath.Join(historyDir, "storage", "av", avNode.AttributeViewID+".json")
		if copyErr := filelock.Copy(srcAvPath, destAvPath); nil != copyErr {
			logging.LogErrorf("copy av [%s] failed: %s", srcAvPath, copyErr)
		}
	}
}

func GetHistoryDir(suffix string) (ret string, err error) {
	return getHistoryDir(suffix, time.Now())
}

func getHistoryDir(suffix string, t time.Time) (ret string, err error) {
	ret = filepath.Join(util.HistoryDir, t.Format("2006-01-02-150405")+"-"+suffix)
	if err = os.MkdirAll(ret, 0755); err != nil {
		logging.LogErrorf("make history dir failed: %s", err)
		return
	}
	return
}

func ReindexHistory() {
	task.AppendTask(task.HistoryDatabaseIndexFull, fullReindexHistory)
	return
}

func fullReindexHistory() {
	historyDirs, err := os.ReadDir(util.HistoryDir)
	if err != nil {
		logging.LogErrorf("read history dir [%s] failed: %s", util.HistoryDir, err)
		return
	}

	util.PushMsg(Conf.Language(192), 7*1000)
	sql.InitHistoryDatabase(true)
	lutEngine := util.NewLute()
	for _, historyDir := range historyDirs {
		if !historyDir.IsDir() {
			continue
		}

		name := historyDir.Name()
		indexHistoryDir(name, lutEngine)
	}
	return
}

var validOps = []string{HistoryOpClean, HistoryOpUpdate, HistoryOpDelete, HistoryOpFormat, HistoryOpSync, HistoryOpReplace, HistoryOpOutline}

const (
	HistoryTypeDocName = 0 // Search docs by doc name
	HistoryTypeDoc     = 1 // Search docs by doc name and content
	HistoryTypeAsset   = 2 // Search assets
	HistoryTypeDocID   = 3 // Search docs by doc id
)

func indexHistoryDir(name string, luteEngine *lute.Lute) {
	defer logging.Recover()

	op := name[strings.LastIndex(name, "-")+1:]
	if !gulu.Str.Contains(op, validOps) {
		logging.LogWarnf("invalid history op [%s]", op)
		return
	}
	t := name[:strings.LastIndex(name, "-")]
	tt, parseErr := time.ParseInLocation("2006-01-02-150405", t, time.Local)
	if nil != parseErr {
		logging.LogWarnf("parse history dir time [%s] failed: %s", t, parseErr)
		return
	}
	created := fmt.Sprintf("%d", tt.Unix())

	entryPath := filepath.Join(util.HistoryDir, name)
	var docs, assets []string
	filelock.Walk(entryPath, func(path string, d fs.DirEntry, err error) error {
		if strings.HasSuffix(d.Name(), ".sy") {
			docs = append(docs, path)
		} else if strings.Contains(path, "assets"+string(os.PathSeparator)) {
			assets = append(assets, path)
		}
		return nil
	})

	var histories []*sql.History
	for _, doc := range docs {
		tree, loadErr := loadTree(doc, luteEngine)
		if nil != loadErr {
			logging.LogErrorf("load tree [%s] failed: %s", doc, loadErr)
			continue
		}

		title := tree.Root.IALAttr("title")
		if "" == title {
			title = Conf.language(16)
		}
		content := tree.Root.Content()
		p := strings.TrimPrefix(doc, util.HistoryDir)
		p = filepath.ToSlash(p[1:])
		histories = append(histories, &sql.History{
			ID:      tree.Root.ID,
			Type:    HistoryTypeDoc,
			Op:      op,
			Title:   title,
			Content: content,
			Path:    p,
			Created: created,
		})
	}

	for _, asset := range assets {
		p := strings.TrimPrefix(asset, util.HistoryDir)
		p = filepath.ToSlash(p[1:])
		_, id := util.LastID(p)
		if !ast.IsNodeIDPattern(id) {
			id = ""
		}
		histories = append(histories, &sql.History{
			ID:      id,
			Type:    HistoryTypeAsset,
			Op:      op,
			Title:   filepath.Base(asset),
			Path:    p,
			Created: created,
		})
	}

	sql.IndexHistoriesQueue(histories)
	return
}

func fromSQLHistories(sqlHistories []*sql.History) (ret []*HistoryItem) {
	if 1 > len(sqlHistories) {
		ret = []*HistoryItem{}
		return
	}

	for _, sqlHistory := range sqlHistories {
		item := &HistoryItem{
			Title: sqlHistory.Title,
			Path:  filepath.Join(util.HistoryDir, sqlHistory.Path),
			Op:    sqlHistory.Op,
		}
		if HistoryTypeAsset == sqlHistory.Type {
			item.Path = filepath.ToSlash(strings.TrimPrefix(item.Path, util.WorkspaceDir))
		} else {
			parts := strings.Split(sqlHistory.Path, "/")
			if 2 <= len(parts) {
				item.Notebook = parts[1]
			} else {
				logging.LogWarnf("invalid doc history path [%s]", item.Path)
			}
		}
		ret = append(ret, item)
	}
	return
}

func init() {
	subscribeSQLHistoryEvents()
}

func subscribeSQLHistoryEvents() {
	eventbus.Subscribe(util.EvtSQLHistoryRebuild, func() {
		ReindexHistory()
	})
}
