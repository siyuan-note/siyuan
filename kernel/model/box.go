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
	"bytes"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/dustin/go-humanize"
	"github.com/facette/natsort"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Box 笔记本。
type Box struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Icon     string `json:"icon"`
	Sort     int    `json:"sort"`
	SortMode int    `json:"sortMode"`
	Closed   bool   `json:"closed"`

	NewFlashcardCount int `json:"newFlashcardCount"`
	DueFlashcardCount int `json:"dueFlashcardCount"`
	FlashcardCount    int `json:"flashcardCount"`

	historyGenerated int64 // 最近一次历史生成时间
}

var statLock = sync.Mutex{}

func StatJob() {
	statLock.Lock()
	defer statLock.Unlock()

	Conf.Stat.TreeCount = treenode.CountTrees()
	Conf.Stat.CTreeCount = treenode.CeilTreeCount(Conf.Stat.TreeCount)
	Conf.Stat.BlockCount = treenode.CountBlocks()
	Conf.Stat.CBlockCount = treenode.CeilBlockCount(Conf.Stat.BlockCount)
	Conf.Stat.DataSize, Conf.Stat.AssetsSize = util.DataSize()
	Conf.Stat.CDataSize = util.CeilSize(Conf.Stat.DataSize)
	Conf.Stat.CAssetsSize = util.CeilSize(Conf.Stat.AssetsSize)
	Conf.Save()

	logging.LogInfof("auto stat [trees=%d, blocks=%d, dataSize=%s, assetsSize=%s]", Conf.Stat.TreeCount, Conf.Stat.BlockCount, humanize.Bytes(uint64(Conf.Stat.DataSize)), humanize.Bytes(uint64(Conf.Stat.AssetsSize)))

	// 桌面端检查磁盘可用空间 https://github.com/siyuan-note/siyuan/issues/6873
	if util.ContainerStd != util.Container {
		return
	}

	if util.NeedWarnDiskUsage(Conf.Stat.DataSize) {
		util.PushMsg(Conf.Language(179), 7000)
	}
}

func ListNotebooks() (ret []*Box, err error) {
	ret = []*Box{}
	dirs, err := os.ReadDir(util.DataDir)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", util.DataDir, err)
		return ret, err
	}
	for _, dir := range dirs {
		if util.IsReservedFilename(dir.Name()) {
			continue
		}

		if !dir.IsDir() {
			continue
		}

		if !ast.IsNodeIDPattern(dir.Name()) {
			continue
		}

		boxConf := conf.NewBoxConf()
		boxDirPath := filepath.Join(util.DataDir, dir.Name())
		boxConfPath := filepath.Join(boxDirPath, ".siyuan", "conf.json")
		if !gulu.File.IsExist(boxConfPath) {
			// Automatically move corrupted notebook folders to the corrupted folder https://github.com/siyuan-note/siyuan/issues/9202
			logging.LogWarnf("found a corrupted box [%s]", boxDirPath)
			to := filepath.Join(util.WorkspaceDir, "corrupted", time.Now().Format("2006-01-02-150405"), dir.Name())
			if copyErr := filelock.Copy(boxDirPath, to); nil != copyErr {
				logging.LogErrorf("copy corrupted notebook dir [%s] failed: %s", boxDirPath, copyErr)
				continue
			}
			if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
				logging.LogErrorf("remove corrupted data file [%s] failed: %s", boxDirPath, removeErr)
				continue
			}
			util.ReloadUI()
			continue
		}

		data, readErr := filelock.ReadFile(boxConfPath)
		if nil != readErr {
			logging.LogErrorf("read box conf [%s] failed: %s", boxConfPath, readErr)
			continue
		}
		if readErr = gulu.JSON.UnmarshalJSON(data, boxConf); nil != readErr {
			logging.LogErrorf("parse box conf [%s] failed: %s", boxConfPath, readErr)
			os.RemoveAll(boxConfPath)
			continue
		}

		id := dir.Name()
		ret = append(ret, &Box{
			ID:       id,
			Name:     boxConf.Name,
			Icon:     boxConf.Icon,
			Sort:     boxConf.Sort,
			SortMode: boxConf.SortMode,
			Closed:   boxConf.Closed,
		})
	}

	switch Conf.FileTree.Sort {
	case util.SortModeNameASC:
		sort.Slice(ret, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmojiInvisible(ret[i].Name), util.RemoveEmojiInvisible(ret[j].Name))
		})
	case util.SortModeNameDESC:
		sort.Slice(ret, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmojiInvisible(ret[j].Name), util.RemoveEmojiInvisible(ret[i].Name))
		})
	case util.SortModeUpdatedASC:
	case util.SortModeUpdatedDESC:
	case util.SortModeAlphanumASC:
		sort.Slice(ret, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmojiInvisible(ret[i].Name), util.RemoveEmojiInvisible(ret[j].Name))
		})
	case util.SortModeAlphanumDESC:
		sort.Slice(ret, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmojiInvisible(ret[j].Name), util.RemoveEmojiInvisible(ret[i].Name))
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

	data, err := filelock.ReadFile(confPath)
	if nil != err {
		logging.LogErrorf("read box conf [%s] failed: %s", confPath, err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, ret); nil != err {
		logging.LogErrorf("parse box conf [%s] failed: %s", confPath, err)
		return
	}
	return
}

func (box *Box) SaveConf(conf *conf.BoxConf) {
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan/conf.json")
	newData, err := gulu.JSON.MarshalIndentJSON(conf, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal box conf [%s] failed: %s", confPath, err)
		return
	}

	oldData, err := filelock.ReadFile(confPath)
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
		logging.LogErrorf("save box conf [%s] failed: %s", confPath, err)
	}
	if err := filelock.WriteFile(confPath, data); nil != err {
		logging.LogErrorf("write box conf [%s] failed: %s", confPath, err)
		util.ReportFileSysFatalError(err)
		return
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

	entries, err := os.ReadDir(filepath.Join(util.DataDir, box.ID, p))
	if nil != err {
		return
	}

	for _, f := range entries {
		info, infoErr := f.Info()
		if nil != infoErr {
			logging.LogErrorf("read file info failed: %s", infoErr)
			continue
		}

		name := f.Name()
		if util.IsReservedFilename(name) {
			continue
		}
		if strings.HasSuffix(name, ".tmp") {
			// 移除写入失败时产生的临时文件
			removePath := filepath.Join(util.DataDir, box.ID, p, name)
			if removeErr := os.Remove(removePath); nil != removeErr {
				logging.LogWarnf("remove tmp file [%s] failed: %s", removePath, removeErr)
			}
			continue
		}

		totals += 1
		fi := &FileInfo{}
		fi.name = name
		fi.isdir = f.IsDir()
		fi.size = info.Size()
		fPath := path.Join(p, name)
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
			logging.LogErrorf("stat [%s] failed: %s", absPath, err)
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
		logging.LogErrorf("mkdir [path=%s] in box [%s] failed: %s", path, box.ID, err)
		return errors.New(msg)
	}
	IncSync()
	return nil
}

func (box *Box) MkdirAll(path string) error {
	if err := os.MkdirAll(filepath.Join(util.DataDir, box.ID, path), 0755); nil != err {
		msg := fmt.Sprintf(Conf.Language(6), box.Name, path, err)
		logging.LogErrorf("mkdir all [path=%s] in box [%s] failed: %s", path, box.ID, err)
		return errors.New(msg)
	}
	IncSync()
	return nil
}

func (box *Box) Move(oldPath, newPath string) error {
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	fromPath := filepath.Join(boxLocalPath, oldPath)
	toPath := filepath.Join(boxLocalPath, newPath)

	if err := filelock.Rename(fromPath, toPath); nil != err {
		msg := fmt.Sprintf(Conf.Language(5), box.Name, fromPath, err)
		logging.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, box.Name, err)
		return errors.New(msg)
	}

	if oldDir := path.Dir(oldPath); ast.IsNodeIDPattern(path.Base(oldDir)) {
		fromDir := filepath.Join(boxLocalPath, oldDir)
		if util.IsEmptyDir(fromDir) {
			filelock.Remove(fromDir)
		}
	}
	IncSync()
	return nil
}

func (box *Box) Remove(path string) error {
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	filePath := filepath.Join(boxLocalPath, path)
	if err := filelock.Remove(filePath); nil != err {
		msg := fmt.Sprintf(Conf.Language(7), box.Name, path, err)
		logging.LogErrorf("remove [path=%s] in box [%s] failed: %s", path, box.ID, err)
		return errors.New(msg)
	}
	IncSync()
	return nil
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

func moveTree(tree *parse.Tree) {
	treenode.SetBlockTreePath(tree)

	if hidden := tree.Root.IALAttr("custom-hidden"); "true" == hidden {
		tree.Root.RemoveIALAttr("custom-hidden")
		filesys.WriteTree(tree)
	}
	sql.UpsertTreeQueue(tree)

	box := Conf.Box(tree.Box)
	box.renameSubTrees(tree)
}

func (box *Box) renameSubTrees(tree *parse.Tree) {
	subFiles := box.ListFiles(tree.Path)
	box.moveTrees0(subFiles)
}

func (box *Box) moveTrees0(files []*FileInfo) {
	luteEngine := util.NewLute()
	for _, subFile := range files {
		if !strings.HasSuffix(subFile.path, ".sy") {
			continue
		}

		subTree, err := filesys.LoadTree(box.ID, subFile.path, luteEngine) // LoadTree 会重新构造 HPath
		if nil != err {
			continue
		}

		treenode.SetBlockTreePath(subTree)
		sql.RenameSubTreeQueue(subTree)
		msg := fmt.Sprintf(Conf.Language(107), html.EscapeString(subTree.HPath))
		util.PushStatusBar(msg)
	}
}

func parseKTree(kramdown []byte) (ret *parse.Tree) {
	luteEngine := NewLute()
	ret = parse.Parse("", kramdown, luteEngine.ParseOptions)
	genTreeID(ret)
	return
}

func genTreeID(tree *parse.Tree) {
	if nil == tree.Root.FirstChild {
		tree.Root.AppendChild(treenode.NewParagraph())
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if n.IsEmptyBlockIAL() {
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

		if ast.NodeHTMLBlock == n.Type {
			tokens := bytes.TrimSpace(n.Tokens)
			if !bytes.HasPrefix(tokens, []byte("<div>")) {
				tokens = []byte("<div>\n" + string(tokens))
			}
			if !bytes.HasSuffix(tokens, []byte("</div>")) {
				tokens = append(tokens, []byte("\n</div>")...)
			}
			n.Tokens = tokens
			return ast.WalkContinue
		}

		if ast.NodeInlineHTML == n.Type {
			n.Type = ast.NodeText
			return ast.WalkContinue
		}

		if ast.NodeParagraph == n.Type && nil != n.FirstChild && ast.NodeTaskListItemMarker == n.FirstChild.Type {
			// 踢掉任务列表的第一个子节点左侧空格
			n.FirstChild.Next.Tokens = bytes.TrimLeft(n.FirstChild.Next.Tokens, " ")
			// 调整 li.p.tlim 为 li.tlim.p
			n.InsertBefore(n.FirstChild)
		}

		return ast.WalkContinue
	})
	tree.Root.KramdownIAL = parse.Tokens2IAL(tree.Root.LastChild.Tokens)
	return
}

func FullReindex() {
	task.AppendTask(task.DatabaseIndexFull, fullReindex)
	task.AppendTask(task.DatabaseIndexRef, IndexRefs)
	task.AppendTask(task.ReloadUI, util.ReloadUI)

	// TODO ReindexAssetContent()
}

func fullReindex() {
	util.PushMsg(Conf.Language(35), 7*1000)
	WaitForWritingFiles()

	if err := sql.InitDatabase(true); nil != err {
		os.Exit(logging.ExitCodeReadOnlyDatabase)
		return
	}
	treenode.InitBlockTree(true)

	openedBoxes := Conf.GetOpenedBoxes()
	for _, openedBox := range openedBoxes {
		index(openedBox.ID)
	}
	treenode.SaveBlockTree(true)
	LoadFlashcards()
	debug.FreeOSMemory()
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

func getBoxesByPaths(paths []string) (ret map[string]*Box) {
	ret = map[string]*Box{}
	for _, p := range paths {
		id := strings.TrimSuffix(path.Base(p), ".sy")
		bt := treenode.GetBlockTree(id)
		if nil != bt {
			ret[p] = Conf.Box(bt.BoxID)
		}
	}
	return
}
