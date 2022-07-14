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
	"bytes"
	"errors"
	"fmt"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/facette/natsort"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Box 笔记本。
type Box struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Icon   string `json:"icon"`
	Sort   int    `json:"sort"`
	Closed bool   `json:"closed"`

	historyGenerated int64 // 最近一次历史生成时间
}

func AutoStat() {
	for range time.Tick(10 * time.Minute) {
		autoStat()
	}
}

func autoStat() {
	Conf.Stat.DocCount = sql.CountAllDoc()
	Conf.Save()
}

func ListNotebooks() (ret []*Box, err error) {
	ret = []*Box{}
	dirs, err := os.ReadDir(util.DataDir)
	if nil != err {
		util.LogErrorf("read dir [%s] failed: %s", util.DataDir, err)
		return ret, err
	}
	for _, dir := range dirs {
		if util.IsReservedFilename(dir.Name()) {
			continue
		}

		if !dir.IsDir() {
			continue
		}

		if !util.IsIDPattern(dir.Name()) {
			continue
		}

		boxConf := conf.NewBoxConf()
		boxConfPath := filepath.Join(util.DataDir, dir.Name(), ".siyuan", "conf.json")
		if !gulu.File.IsExist(boxConfPath) {
			if isUserGuide(dir.Name()) {
				filelock.ReleaseAllFileLocks()
				os.RemoveAll(filepath.Join(util.DataDir, dir.Name()))
				util.LogWarnf("not found user guid box conf [%s], removed it", boxConfPath)
				continue
			}
			util.LogWarnf("not found box conf [%s], recreate it", boxConfPath)
		} else {
			data, readErr := filelock.NoLockFileRead(boxConfPath)
			if nil != readErr {
				util.LogErrorf("read box conf [%s] failed: %s", boxConfPath, readErr)
				continue
			}
			if readErr = gulu.JSON.UnmarshalJSON(data, boxConf); nil != readErr {
				util.LogErrorf("parse box conf [%s] failed: %s", boxConfPath, readErr)
				continue
			}
		}

		id := dir.Name()
		ret = append(ret, &Box{
			ID:     id,
			Name:   boxConf.Name,
			Icon:   boxConf.Icon,
			Sort:   boxConf.Sort,
			Closed: boxConf.Closed,
		})
	}

	switch Conf.FileTree.Sort {
	case util.SortModeNameASC:
		sort.Slice(ret, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmoji(ret[i].Name), util.RemoveEmoji(ret[j].Name))
		})
	case util.SortModeNameDESC:
		sort.Slice(ret, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmoji(ret[j].Name), util.RemoveEmoji(ret[i].Name))
		})
	case util.SortModeUpdatedASC:
	case util.SortModeUpdatedDESC:
	case util.SortModeAlphanumASC:
		sort.Slice(ret, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmoji(ret[i].Name), util.RemoveEmoji(ret[j].Name))
		})
	case util.SortModeAlphanumDESC:
		sort.Slice(ret, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmoji(ret[j].Name), util.RemoveEmoji(ret[i].Name))
		})
	case util.SortModeCustom:
		sort.Slice(ret, func(i, j int) bool { return ret[i].Sort < ret[j].Sort })
	case util.SortModeRefCountASC:
	case util.SortModeRefCountDESC:
	case util.SortModeCreatedASC:
		sort.Slice(ret, func(i, j int) bool { return natsort.Compare(ret[j].ID, ret[i].ID) })
	case util.SortModeCreatedDESC:
		sort.Slice(ret, func(i, j int) bool { return natsort.Compare(ret[j].ID, ret[i].ID) })
	}
	return
}

func (box *Box) GetConf() (ret *conf.BoxConf) {
	ret = conf.NewBoxConf()

	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan/conf.json")
	if !gulu.File.IsExist(confPath) {
		return
	}

	data, err := filelock.LockFileRead(confPath)
	if nil != err {
		util.LogErrorf("read box conf [%s] failed: %s", confPath, err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, ret); nil != err {
		util.LogErrorf("parse box conf [%s] failed: %s", confPath, err)
		return
	}
	return
}

func (box *Box) SaveConf(conf *conf.BoxConf) {
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan/conf.json")
	newData, err := gulu.JSON.MarshalIndentJSON(conf, "", "  ")
	if nil != err {
		util.LogErrorf("marshal box conf [%s] failed: %s", confPath, err)
		return
	}

	oldData, err := filelock.NoLockFileRead(confPath)
	if nil != err {
		box.saveConf0(newData)
		return
	}

	if bytes.Equal(newData, oldData) {
		return
	}

	box.saveConf0(newData)
}

func (box *Box) saveConf0(data []byte) {
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan/conf.json")
	if err := os.MkdirAll(filepath.Join(util.DataDir, box.ID, ".siyuan"), 0755); nil != err {
		util.LogErrorf("save box conf [%s] failed: %s", confPath, err)
	}
	if err := filelock.LockFileWrite(confPath, data); nil != err {
		util.LogErrorf("save box conf [%s] failed: %s", confPath, err)
	}
}

func (box *Box) Ls(p string) (ret []*FileInfo, totals int, err error) {
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	if strings.HasSuffix(p, ".sy") {
		dir := strings.TrimSuffix(p, ".sy")
		absDir := filepath.Join(boxLocalPath, dir)
		if gulu.File.IsDir(absDir) {
			p = dir
		} else {
			return
		}
	}

	files, err := ioutil.ReadDir(filepath.Join(util.DataDir, box.ID, p))
	if nil != err {
		return
	}

	for _, f := range files {
		if util.IsReservedFilename(f.Name()) {
			continue
		}

		totals += 1
		fi := &FileInfo{}
		fi.name = f.Name()
		fi.isdir = f.IsDir()
		fi.size = f.Size()
		fPath := path.Join(p, f.Name())
		if f.IsDir() {
			fPath += "/"
		}
		fi.path = fPath
		ret = append(ret, fi)
	}
	return
}

func (box *Box) Stat(p string) (ret *FileInfo) {
	absPath := filepath.Join(util.DataDir, box.ID, p)
	info, err := os.Stat(absPath)
	if nil != err {
		if !os.IsNotExist(err) {
			util.LogErrorf("stat [%s] failed: %s", absPath, err)
		}
		return
	}
	ret = &FileInfo{
		path:  p,
		name:  info.Name(),
		size:  info.Size(),
		isdir: info.IsDir(),
	}
	return
}

func (box *Box) Exist(p string) bool {
	return gulu.File.IsExist(filepath.Join(util.DataDir, box.ID, p))
}

func (box *Box) Mkdir(path string) error {
	if err := os.Mkdir(filepath.Join(util.DataDir, box.ID, path), 0755); nil != err {
		msg := fmt.Sprintf(Conf.Language(6), box.Name, path, err)
		util.LogErrorf("mkdir [path=%s] in box [%s] failed: %s", path, box.ID, err)
		return errors.New(msg)
	}
	IncSync()
	return nil
}

func (box *Box) MkdirAll(path string) error {
	if err := os.MkdirAll(filepath.Join(util.DataDir, box.ID, path), 0755); nil != err {
		msg := fmt.Sprintf(Conf.Language(6), box.Name, path, err)
		util.LogErrorf("mkdir all [path=%s] in box [%s] failed: %s", path, box.ID, err)
		return errors.New(msg)
	}
	IncSync()
	return nil
}

func (box *Box) Move(oldPath, newPath string) error {
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	fromPath := filepath.Join(boxLocalPath, oldPath)
	toPath := filepath.Join(boxLocalPath, newPath)
	filelock.ReleaseFileLocks(fromPath)
	if err := os.Rename(fromPath, toPath); nil != err {
		msg := fmt.Sprintf(Conf.Language(5), box.Name, fromPath, err)
		util.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, box.Name, err)
		return errors.New(msg)
	}

	if oldDir := path.Dir(oldPath); util.IsIDPattern(path.Base(oldDir)) {
		fromDir := filepath.Join(boxLocalPath, oldDir)
		if util.IsEmptyDir(fromDir) {
			os.Remove(fromDir)
		}
	}
	IncSync()
	return nil
}

func (box *Box) Remove(path string) error {
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	filePath := filepath.Join(boxLocalPath, path)
	filelock.ReleaseFileLocks(filePath)
	if err := os.RemoveAll(filePath); nil != err {
		msg := fmt.Sprintf(Conf.Language(7), box.Name, path, err)
		util.LogErrorf("remove [path=%s] in box [%s] failed: %s", path, box.ID, err)
		return errors.New(msg)
	}
	IncSync()
	return nil
}

func (box *Box) Unindex() {
	tx, err := sql.BeginTx()
	if nil != err {
		return
	}
	sql.RemoveBoxHash(tx, box.ID)
	sql.DeleteByBoxTx(tx, box.ID)
	sql.CommitTx(tx)
	filelock.ReleaseFileLocks(filepath.Join(util.DataDir, box.ID))
	treenode.RemoveBlockTreesByBoxID(box.ID)
}

func (box *Box) ListFiles(path string) (ret []*FileInfo) {
	fis, _, err := box.Ls(path)
	if nil != err {
		return
	}
	box.listFiles(&fis, &ret)
	return
}

func (box *Box) listFiles(files, ret *[]*FileInfo) {
	for _, file := range *files {
		if file.isdir {
			fis, _, err := box.Ls(file.path)
			if nil == err {
				box.listFiles(&fis, ret)
			}
			*ret = append(*ret, file)
		} else {
			*ret = append(*ret, file)
		}
	}
	return
}

func isSkipFile(filename string) bool {
	return strings.HasPrefix(filename, ".") || "node_modules" == filename || "dist" == filename || "target" == filename
}

func (box *Box) renameSubTrees(tree *parse.Tree) {
	subFiles := box.ListFiles(tree.Path)
	totals := len(subFiles) + 3
	showProgress := 64 < totals
	for i, subFile := range subFiles {
		if !strings.HasSuffix(subFile.path, ".sy") {
			continue
		}

		subTree, err := LoadTree(box.ID, subFile.path) // LoadTree 会重新构造 HPath
		if nil != err {
			continue
		}

		sql.UpsertTreeQueue(subTree)
		if showProgress {
			msg := fmt.Sprintf(Conf.Language(107), subTree.HPath)
			util.PushProgress(util.PushProgressCodeProgressed, i, totals, msg)
		}
	}

	if showProgress {
		util.ClearPushProgress(totals)
	}
}

func moveTree(tree *parse.Tree) {
	treenode.SetBlockTreePath(tree)
	sql.UpsertTreeQueue(tree)

	box := Conf.Box(tree.Box)
	subFiles := box.ListFiles(tree.Path)
	totals := len(subFiles) + 5
	showProgress := 64 < totals

	for i, subFile := range subFiles {
		if !strings.HasSuffix(subFile.path, ".sy") {
			continue
		}

		subTree, err := LoadTree(box.ID, subFile.path)
		if nil != err {
			continue
		}

		treenode.SetBlockTreePath(subTree)
		sql.UpsertTreeQueue(subTree)

		if showProgress {
			msg := fmt.Sprintf(Conf.Language(107), subTree.HPath)
			util.PushProgress(util.PushProgressCodeProgressed, i, totals, msg)
		}
	}

	if showProgress {
		util.ClearPushProgress(totals)
	}
}

func parseKTree(kramdown []byte) (ret *parse.Tree) {
	luteEngine := NewLute()
	ret = parse.Parse("", kramdown, luteEngine.ParseOptions)
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if treenode.IsEmptyBlockIAL(n) {
			// 空段落保留
			p := &ast.Node{Type: ast.NodeParagraph}
			p.KramdownIAL = parse.Tokens2IAL(n.Tokens)
			p.ID = p.IALAttr("id")
			n.InsertBefore(p)
			return ast.WalkContinue
		}

		id := n.IALAttr("id")
		if "" == id {
			n.SetIALAttr("id", n.ID)
		}

		if "" == n.IALAttr("id") && (ast.NodeParagraph == n.Type || ast.NodeList == n.Type || ast.NodeListItem == n.Type || ast.NodeBlockquote == n.Type ||
			ast.NodeMathBlock == n.Type || ast.NodeCodeBlock == n.Type || ast.NodeHeading == n.Type || ast.NodeTable == n.Type || ast.NodeThematicBreak == n.Type ||
			ast.NodeYamlFrontMatter == n.Type || ast.NodeBlockQueryEmbed == n.Type || ast.NodeSuperBlock == n.Type ||
			ast.NodeHTMLBlock == n.Type || ast.NodeIFrame == n.Type || ast.NodeWidget == n.Type || ast.NodeAudio == n.Type || ast.NodeVideo == n.Type) {
			n.ID = ast.NewNodeID()
			n.KramdownIAL = [][]string{{"id", n.ID}}
			n.InsertAfter(&ast.Node{Type: ast.NodeKramdownBlockIAL, Tokens: []byte("{: id=\"" + n.ID + "\"}")})
			n.SetIALAttr("updated", util.TimeFromID(n.ID))
		}
		if "" == n.ID && 0 < len(n.KramdownIAL) && ast.NodeDocument != n.Type {
			n.ID = n.IALAttr("id")
		}
		return ast.WalkContinue
	})
	ret.Root.KramdownIAL = parse.Tokens2IAL(ret.Root.LastChild.Tokens)
	return
}

func RefreshFileTree() {
	WaitForWritingFiles()

	if err := sql.InitDatabase(true); nil != err {
		util.PushErrMsg(Conf.Language(85), 5000)
		return
	}

	util.PushEndlessProgress(Conf.Language(35))
	openedBoxes := Conf.GetOpenedBoxes()
	for _, openedBox := range openedBoxes {
		openedBox.Index(true)
	}
	IndexRefs()
	// 缓存根一级的文档树展开
	for _, openedBox := range openedBoxes {
		ListDocTree(openedBox.ID, "/", Conf.FileTree.Sort)
	}
	treenode.SaveBlockTree()
	util.PushEndlessProgress(Conf.Language(58))
	go func() {
		time.Sleep(1 * time.Second)
		util.ReloadUI()
	}()
}

func ChangeBoxSort(boxIDs []string) {
	for i, boxID := range boxIDs {
		box := &Box{ID: boxID}
		boxConf := box.GetConf()
		boxConf.Sort = i + 1
		box.SaveConf(boxConf)
	}
}

func SetBoxIcon(boxID, icon string) {
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.Icon = icon
	box.SaveConf(boxConf)
}

func (box *Box) UpdateHistoryGenerated() {
	boxLatestHistoryTime[box.ID] = time.Now()
}

func LockFileByBlockID(id string) (locked bool, filePath string) {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}
	p := filepath.Join(util.DataDir, bt.BoxID, bt.Path)

	if !gulu.File.IsExist(p) {
		return true, ""
	}
	return nil == filelock.LockFile(p), p
}
