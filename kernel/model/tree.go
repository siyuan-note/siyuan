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
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/time/rate"
)

func resetTree(tree *parse.Tree, titleSuffix string, removeAvBinding bool) {
	tree.ID = ast.NewNodeID()
	tree.Root.ID = tree.ID

	if "" != titleSuffix {
		if t, parseErr := time.Parse("20060102150405", util.TimeFromID(tree.ID)); nil == parseErr {
			titleSuffix += " " + t.Format("2006-01-02 15:04:05")
		} else {
			titleSuffix = "Duplicated " + time.Now().Format("2006-01-02 15:04:05")
		}
		titleSuffix = "(" + titleSuffix + ")"
		titleSuffix = " " + titleSuffix
	}
	tree.Root.SetIALAttr("id", tree.ID)
	tree.Root.SetIALAttr("title", tree.Root.IALAttr("title")+titleSuffix)
	tree.Root.RemoveIALAttr("scroll")
	p := path.Join(path.Dir(tree.Path), tree.ID) + ".sy"
	tree.Path = p
	tree.HPath = tree.HPath + " " + titleSuffix

	// 收集所有引用
	refIDs := map[string]string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !treenode.IsBlockRef(n) {
			return ast.WalkContinue
		}
		defID, _, _ := treenode.GetBlockRef(n)
		if "" == defID {
			return ast.WalkContinue
		}
		refIDs[defID] = "1"
		return ast.WalkContinue
	})

	// 重置块 ID
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeDocument == n.Type {
			return ast.WalkContinue
		}
		if n.IsBlock() && "" != n.ID {
			newID := ast.NewNodeID()
			if "1" == refIDs[n.ID] {
				// 如果是文档自身的内部引用
				refIDs[n.ID] = newID
			}
			n.ID = newID
			n.SetIALAttr("id", n.ID)
		}
		return ast.WalkContinue
	})

	// 重置内部引用
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !treenode.IsBlockRef(n) {
			return ast.WalkContinue
		}
		defID, _, _ := treenode.GetBlockRef(n)
		if "" == defID {
			return ast.WalkContinue
		}
		if "1" != refIDs[defID] {
			if ast.NodeTextMark == n.Type {
				n.TextMarkBlockRefID = refIDs[defID]
			}
		}
		return ast.WalkContinue
	})

	var attrViewIDs []string
	// 绑定镜像数据库
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeAttributeView == n.Type {
			av.UpsertBlockRel(n.AttributeViewID, n.ID)
			attrViewIDs = append(attrViewIDs, n.AttributeViewID)
		}
		return ast.WalkContinue
	})

	if removeAvBinding {
		// 清空文档绑定的数据库
		tree.Root.RemoveIALAttr(av.NodeAttrNameAvs)
	}
}

func pagedPaths(localPath string, pageSize int) (ret map[int][]string) {
	ret = map[int][]string{}
	page := 1
	filelock.Walk(localPath, func(path string, info fs.FileInfo, err error) error {
		if info.IsDir() {
			if strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		if !strings.HasSuffix(info.Name(), ".sy") {
			return nil
		}

		ret[page] = append(ret[page], path)
		if pageSize <= len(ret[page]) {
			page++
		}
		return nil
	})
	return
}

func loadTree(localPath string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	data, err := filelock.ReadFile(localPath)
	if nil != err {
		logging.LogErrorf("get data [path=%s] failed: %s", localPath, err)
		return
	}

	ret, err = filesys.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if nil != err {
		logging.LogErrorf("parse json to tree [%s] failed: %s", localPath, err)
		return
	}
	return
}

var (
	ErrBoxNotFound   = errors.New("notebook not found")
	ErrBlockNotFound = errors.New("block not found")
	ErrTreeNotFound  = errors.New("tree not found")
	ErrIndexing      = errors.New("indexing")
)

func LoadTreeByBlockIDWithReindex(id string) (ret *parse.Tree, err error) {
	// 仅提供给 getBlockInfo 接口使用

	if "" == id {
		return nil, ErrTreeNotFound
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		if task.ContainIndexTask() {
			err = ErrIndexing
			return
		}

		// 尝试从文件系统加载
		searchTreeInFilesystem(id)
		bt = treenode.GetBlockTree(id)
		if nil == bt {
			return nil, ErrTreeNotFound
		}
	}

	luteEngine := util.NewLute()
	ret, err = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	return
}

func LoadTreeByBlockID(id string) (ret *parse.Tree, err error) {
	if "" == id {
		return nil, ErrTreeNotFound
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		if task.ContainIndexTask() {
			err = ErrIndexing
			return
		}
		return nil, ErrTreeNotFound
	}

	ret, err = loadTreeByBlockTree(bt)
	return
}

func loadTreeByBlockTree(bt *treenode.BlockTree) (ret *parse.Tree, err error) {
	luteEngine := util.NewLute()
	ret, err = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	return
}

var searchTreeLimiter = rate.NewLimiter(rate.Every(3*time.Second), 1)

func searchTreeInFilesystem(rootID string) {
	if !searchTreeLimiter.Allow() {
		return
	}

	msdID := util.PushMsg(Conf.language(45), 7000)
	defer util.PushClearMsg(msdID)

	logging.LogWarnf("searching tree on filesystem [rootID=%s]", rootID)
	var treePath string
	filepath.Walk(util.DataDir, func(path string, info fs.FileInfo, err error) error {
		if info.IsDir() {
			if strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		if !strings.HasSuffix(info.Name(), ".sy") {
			return nil
		}

		baseName := filepath.Base(path)
		if rootID+".sy" != baseName {
			return nil
		}

		treePath = path
		return filepath.SkipAll
	})

	if "" == treePath {
		logging.LogErrorf("tree not found on filesystem [rootID=%s]", rootID)
		return
	}

	boxID := strings.TrimPrefix(treePath, util.DataDir)
	boxID = boxID[1:]
	boxID = boxID[:strings.Index(boxID, string(os.PathSeparator))]
	treePath = strings.TrimPrefix(treePath, util.DataDir)
	treePath = strings.TrimPrefix(treePath, string(os.PathSeparator))
	treePath = strings.TrimPrefix(treePath, boxID)
	treePath = filepath.ToSlash(treePath)
	if nil == Conf.Box(boxID) {
		logging.LogInfof("box [%s] not found", boxID)
		// 如果笔记本不存在或者已经关闭，则不处理 https://github.com/siyuan-note/siyuan/issues/11149
		return
	}

	tree, err := filesys.LoadTree(boxID, treePath, util.NewLute())
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", treePath, err)
		return
	}

	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	logging.LogInfof("reindexed tree by filesystem [rootID=%s]", rootID)
}
