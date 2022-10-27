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

package model

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"os"
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
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var historyTicker = time.NewTicker(time.Minute * 10)

func AutoGenerateDocHistory() {
	ChangeHistoryTick(Conf.Editor.GenerateHistoryInterval)
	for {
		<-historyTicker.C
		generateDocHistory()
	}
}

func generateDocHistory() {
	defer logging.Recover()

	if 1 > Conf.Editor.GenerateHistoryInterval {
		return
	}

	WaitForWritingFiles()
	for _, box := range Conf.GetOpenedBoxes() {
		box.generateDocHistory0()
	}

	historyDir := util.HistoryDir
	clearOutdatedHistoryDir(historyDir)

	// 以下部分是老版本的清理逻辑，暂时保留

	for _, box := range Conf.GetBoxes() {
		historyDir = filepath.Join(util.DataDir, box.ID, ".siyuan", "history")
		clearOutdatedHistoryDir(historyDir)
	}

	historyDir = filepath.Join(util.DataDir, "assets", ".siyuan", "history")
	clearOutdatedHistoryDir(historyDir)

	historyDir = filepath.Join(util.DataDir, ".siyuan", "history")
	clearOutdatedHistoryDir(historyDir)
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
		if err = os.RemoveAll(historyDir); nil != err {
			logging.LogErrorf("remove workspace history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed workspace history dir [%s]", historyDir)
	}

	sql.InitHistoryDatabase(true)

	// 以下部分是老版本的清理逻辑，暂时保留

	notebooks, err := ListNotebooks()
	if nil != err {
		return
	}

	for _, notebook := range notebooks {
		boxID := notebook.ID
		historyDir := filepath.Join(util.DataDir, boxID, ".siyuan", "history")
		if !gulu.File.IsDir(historyDir) {
			continue
		}

		if err = os.RemoveAll(historyDir); nil != err {
			logging.LogErrorf("remove notebook history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed notebook history dir [%s]", historyDir)
	}

	historyDir = filepath.Join(util.DataDir, ".siyuan", "history")
	if gulu.File.IsDir(historyDir) {
		if err = os.RemoveAll(historyDir); nil != err {
			logging.LogErrorf("remove data history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed data history dir [%s]", historyDir)
	}
	historyDir = filepath.Join(util.DataDir, "assets", ".siyuan", "history")
	if gulu.File.IsDir(historyDir) {
		if err = os.RemoveAll(historyDir); nil != err {
			logging.LogErrorf("remove assets history dir [%s] failed: %s", historyDir, err)
			return
		}
		logging.LogInfof("removed assets history dir [%s]", historyDir)
	}
	return
}

func GetDocHistoryContent(historyPath, keyword string) (id, rootID, content string, isLargeDoc bool, err error) {
	if !gulu.File.IsExist(historyPath) {
		return
	}

	data, err := filelock.ReadFile(historyPath)
	if nil != err {
		logging.LogErrorf("read file [%s] failed: %s", historyPath, err)
		return
	}
	isLargeDoc = 1024*1024*1 <= len(data)

	luteEngine := NewLute()
	historyTree, err := parse.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if nil != err {
		logging.LogErrorf("parse tree from file [%s] failed, remove it", historyPath)
		os.RemoveAll(historyPath)
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

			if ast.NodeText == n.Type {
				if 0 < len(keywords) {
					if markReplaceSpan(n, &unlinks, string(n.Tokens), keywords, searchMarkSpanStart, searchMarkSpanEnd, luteEngine) {
						return ast.WalkContinue
					}
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

	if isLargeDoc {
		util.PushMsg(Conf.Language(36), 5000)
		formatRenderer := render.NewFormatRenderer(historyTree, luteEngine.RenderOptions)
		content = gulu.Str.FromBytes(formatRenderer.Render())
	} else {
		content = luteEngine.Tree2BlockDOM(historyTree, luteEngine.RenderOptions)
	}
	return
}

func RollbackDocHistory(boxID, historyPath string) (err error) {
	if !gulu.File.IsExist(historyPath) {
		return
	}

	WaitForWritingFiles()

	srcPath := historyPath
	var destPath string
	baseName := filepath.Base(historyPath)
	id := strings.TrimSuffix(baseName, ".sy")

	workingDoc := treenode.GetBlockTree(id)
	if nil != workingDoc {
		if err = filelock.Remove(filepath.Join(util.DataDir, boxID, workingDoc.Path)); nil != err {
			return
		}
	}

	destPath, err = getRollbackDockPath(boxID, historyPath)
	if nil != err {
		return
	}

	if err = filelock.Copy(srcPath, destPath); nil != err {
		return
	}

	FullReindex()
	IncSync()
	return nil
}

func getRollbackDockPath(boxID, historyPath string) (destPath string, err error) {
	baseName := filepath.Base(historyPath)
	parentID := strings.TrimSuffix(filepath.Base(filepath.Dir(historyPath)), ".sy")
	parentWorkingDoc := treenode.GetBlockTree(parentID)
	if nil != parentWorkingDoc {
		// 父路径如果是文档，则恢复到父路径下
		parentDir := strings.TrimSuffix(parentWorkingDoc.Path, ".sy")
		parentDir = filepath.Join(util.DataDir, boxID, parentDir)
		if err = os.MkdirAll(parentDir, 0755); nil != err {
			return
		}
		destPath = filepath.Join(parentDir, baseName)
	} else {
		// 父路径如果不是文档，则恢复到笔记本根路径下
		destPath = filepath.Join(util.DataDir, boxID, baseName)
	}
	return
}

func RollbackAssetsHistory(historyPath string) (err error) {
	historyPath = filepath.Join(util.WorkspaceDir, historyPath)
	if !gulu.File.IsExist(historyPath) {
		return
	}

	from := historyPath
	to := filepath.Join(util.DataDir, "assets", filepath.Base(historyPath))

	if err = gulu.File.Copy(from, to); nil != err {
		logging.LogErrorf("copy file [%s] to [%s] failed: %s", from, to, err)
		return
	}
	IncSync()
	util.PushMsg(Conf.Language(102), 3000)
	return nil
}

func RollbackNotebookHistory(historyPath string) (err error) {
	if !gulu.File.IsExist(historyPath) {
		return
	}

	from := historyPath
	to := filepath.Join(util.DataDir, filepath.Base(historyPath))

	if err = gulu.File.Copy(from, to); nil != err {
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
	Title string `json:"title"`
	Path  string `json:"path"`
}

func FullTextSearchHistory(query, box, op string, typ, page int) (ret []*History, pageCount, totalCount int) {
	query = gulu.Str.RemoveInvisible(query)
	if "" != query {
		query = stringQuery(query)
	}

	pageSize := 32
	from := (page - 1) * pageSize
	to := page * pageSize

	table := "histories_fts_case_insensitive"
	stmt := "SELECT * FROM " + table + " WHERE "
	if "" != query {
		stmt += table + " MATCH '{title content}:(" + query + ")'"
	} else {
		stmt += "1=1"
	}

	if HistoryTypeDocName == typ {
		stmt = strings.ReplaceAll(stmt, "{title content}", "{title}")
	}

	if HistoryTypeDocName == typ || HistoryTypeDoc == typ {
		if "all" != op {
			stmt += " AND op = '" + op + "'"
		}
		stmt += " AND path LIKE '%/" + box + "/%' AND path LIKE '%.sy'"
	} else if HistoryTypeAsset == typ {
		stmt += " AND path LIKE '%/assets/%'"
	}
	countStmt := strings.ReplaceAll(stmt, "SELECT *", "SELECT COUNT(*) AS total")
	stmt += " ORDER BY created DESC LIMIT " + strconv.Itoa(from) + ", " + strconv.Itoa(to)
	sqlHistories := sql.SelectHistoriesRawStmt(stmt)
	ret = fromSQLHistories(sqlHistories)
	result, err := sql.QueryHistory(countStmt)
	if nil != err {
		return
	}
	if 1 > len(result) {
		return
	}
	totalCount = int(result[0]["total"].(int64))
	pageCount = int(math.Ceil(float64(totalCount) / float64(pageSize)))
	return
}

func GetNotebookHistory() (ret []*History, err error) {
	ret = []*History{}

	historyDir := util.HistoryDir
	if !gulu.File.IsDir(historyDir) {
		return
	}

	historyNotebookConfs, err := filepath.Glob(historyDir + "/*-delete/*/.siyuan/conf.json")
	if nil != err {
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
		if err = json.Unmarshal(data, &c); nil != err {
			logging.LogErrorf("parse notebook conf [%s] failed: %s", historyNotebookConf, err)
			continue
		}

		ret = append(ret, &History{
			HCreated: t,
			Items: []*HistoryItem{{
				Title: c.Name,
				Path:  filepath.Dir(filepath.Dir(historyNotebookConf)),
			}},
		})
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i].HCreated > ret[j].HCreated
	})
	return
}

func (box *Box) generateDocHistory0() {
	files := box.recentModifiedDocs()
	if 1 > len(files) {
		return
	}

	historyDir, err := GetHistoryDir(HistoryOpUpdate)
	if nil != err {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	for _, file := range files {
		historyPath := filepath.Join(historyDir, box.ID, strings.TrimPrefix(file, filepath.Join(util.DataDir, box.ID)))
		if err = os.MkdirAll(filepath.Dir(historyPath), 0755); nil != err {
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
	}

	indexHistoryDir(filepath.Base(historyDir), NewLute())
	return
}

func clearOutdatedHistoryDir(historyDir string) {
	if !gulu.File.IsExist(historyDir) {
		return
	}

	dirs, err := os.ReadDir(historyDir)
	if nil != err {
		logging.LogErrorf("clear history [%s] failed: %s", historyDir, err)
		return
	}

	now := time.Now()
	var removes []string
	for _, dir := range dirs {
		dirInfo, err := dir.Info()
		if nil != err {
			logging.LogErrorf("read history dir [%s] failed: %s", dir.Name(), err)
			continue
		}
		if Conf.Editor.HistoryRetentionDays < int(now.Sub(dirInfo.ModTime()).Hours()/24) {
			removes = append(removes, filepath.Join(historyDir, dir.Name()))
		}
	}
	for _, dir := range removes {
		if err = os.RemoveAll(dir); nil != err {
			logging.LogErrorf("remove history dir [%s] failed: %s", dir, err)
			continue
		}
		//logging.LogInfof("auto removed history dir [%s]", dir)

		// 清理历史库

		tx, txErr := sql.BeginHistoryTx()
		if nil != txErr {
			logging.LogErrorf("begin history tx failed: %s", txErr)
			return
		}

		p := strings.TrimPrefix(dir, util.HistoryDir)
		p = filepath.ToSlash(p[1:])
		if txErr = sql.DeleteHistoriesByPathPrefix(tx, dir); nil != txErr {
			sql.RollbackTx(tx)
			logging.LogErrorf("delete history [%s] failed: %s", dir, txErr)
			return
		}
		if txErr = sql.CommitTx(tx); nil != txErr {
			logging.LogErrorf("commit history tx failed: %s", txErr)
			return
		}
	}
}

var boxLatestHistoryTime = map[string]time.Time{}

func (box *Box) recentModifiedDocs() (ret []string) {
	latestHistoryTime := boxLatestHistoryTime[box.ID]
	filepath.Walk(filepath.Join(util.DataDir, box.ID), func(path string, info fs.FileInfo, err error) error {
		if nil == info {
			return nil
		}
		if isSkipFile(info.Name()) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if info.IsDir() {
			return nil
		}

		if info.ModTime().After(latestHistoryTime) {
			ret = append(ret, filepath.Join(path))
		}
		return nil
	})
	box.UpdateHistoryGenerated()
	return
}

const (
	HistoryOpClean  = "clean"
	HistoryOpUpdate = "update"
	HistoryOpDelete = "delete"
	HistoryOpFormat = "format"
	HistoryOpSync   = "sync"
)

func GetHistoryDir(suffix string) (ret string, err error) {
	ret = filepath.Join(util.HistoryDir, time.Now().Format("2006-01-02-150405")+"-"+suffix)
	if err = os.MkdirAll(ret, 0755); nil != err {
		logging.LogErrorf("make history dir failed: %s", err)
		return
	}
	return
}

func ReindexHistory() (err error) {
	historyDirs, err := os.ReadDir(util.HistoryDir)
	if nil != err {
		logging.LogErrorf("read history dir [%s] failed: %s", util.HistoryDir, err)
		return
	}

	util.PushEndlessProgress(Conf.Language(35))
	defer util.PushClearProgress()

	sql.InitHistoryDatabase(true)
	lutEngine := NewLute()
	for _, historyDir := range historyDirs {
		if !historyDir.IsDir() {
			continue
		}

		name := historyDir.Name()
		indexHistoryDir(name, lutEngine)
		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(40), name))
	}
	return
}

var validOps = []string{HistoryOpClean, HistoryOpUpdate, HistoryOpDelete, HistoryOpFormat, HistoryOpSync}

const (
	HistoryTypeDocName = 0
	HistoryTypeDoc     = 1
	HistoryTypeAsset   = 2
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
	filepath.Walk(entryPath, func(path string, info os.FileInfo, err error) error {
		if strings.HasSuffix(info.Name(), ".sy") {
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
			title = "Untitled"
		}
		content := tree.Root.Content()
		p := strings.TrimPrefix(doc, util.HistoryDir)
		p = filepath.ToSlash(p[1:])
		histories = append(histories, &sql.History{
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
		histories = append(histories, &sql.History{
			Type:    HistoryTypeAsset,
			Op:      op,
			Title:   filepath.Base(asset),
			Path:    p,
			Created: created,
		})
	}

	tx, txErr := sql.BeginHistoryTx()
	if nil != txErr {
		logging.LogErrorf("begin transaction failed: %s", txErr)
		return
	}
	if err := sql.InsertHistories(tx, histories); nil != err {
		logging.LogErrorf("insert histories failed: %s", err)
		sql.RollbackTx(tx)
		return
	}
	if err := sql.CommitTx(tx); nil != err {
		logging.LogErrorf("commit transaction failed: %s", err)
		return
	}
	return
}

func fromSQLHistories(sqlHistories []*sql.History) (ret []*History) {
	if 1 > len(sqlHistories) {
		ret = []*History{}
		return
	}

	var items []*HistoryItem
	var tmpTime int64
	for _, sqlHistory := range sqlHistories {
		unixSec, _ := strconv.ParseInt(sqlHistory.Created, 10, 64)
		if 0 == tmpTime {
			tmpTime = unixSec
		}
		if tmpTime == unixSec {
			item := &HistoryItem{
				Title: sqlHistory.Title,
				Path:  filepath.Join(util.HistoryDir, sqlHistory.Path),
			}
			if HistoryTypeAsset == sqlHistory.Type {
				item.Path = filepath.ToSlash(strings.TrimPrefix(item.Path, util.WorkspaceDir))
			}
			items = append(items, item)
		} else {
			ret = append(ret, &History{
				HCreated: time.Unix(unixSec, 0).Format("2006-01-02 15:04:05"),
				Items:    items,
			})

			item := &HistoryItem{
				Title: sqlHistory.Title,
				Path:  filepath.Join(util.HistoryDir, sqlHistory.Path),
			}
			if HistoryTypeAsset == sqlHistory.Type {
				item.Path = filepath.ToSlash(strings.TrimPrefix(item.Path, util.WorkspaceDir))
			}
			items = []*HistoryItem{}
			items = append(items, item)
		}
	}
	if 0 < len(items) {
		ret = append(ret, &History{
			HCreated: time.Unix(tmpTime, 0).Format("2006-01-02 15:04:05"),
			Items:    items,
		})
	}
	return
}
