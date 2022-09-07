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
	"errors"
	"io/fs"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func resetTree(tree *parse.Tree, titleSuffix string) {
	tree.ID = ast.NewNodeID()
	tree.Root.ID = tree.ID
	if t, parseErr := time.Parse("20060102150405", util.TimeFromID(tree.ID)); nil == parseErr {
		titleSuffix += " " + t.Format("2006-01-02 15:04:05")
	} else {
		titleSuffix = "Duplicated " + time.Now().Format("2006-01-02 15:04:05")
	}
	titleSuffix = "(" + titleSuffix + ")"
	tree.Root.SetIALAttr("id", tree.ID)
	tree.Root.SetIALAttr("title", tree.Root.IALAttr("title")+" "+titleSuffix)
	p := path.Join(path.Dir(tree.Path), tree.ID) + ".sy"
	tree.Path = p
	tree.HPath = tree.HPath + " " + titleSuffix

	// 收集所有引用
	refIDs := map[string]string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeBlockRefID != n.Type {
			return ast.WalkContinue
		}
		refIDs[n.TokensStr()] = "1"
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
		if !entering || ast.NodeBlockRefID != n.Type {
			return ast.WalkContinue
		}
		if "1" != refIDs[n.TokensStr()] {
			n.Tokens = []byte(refIDs[n.TokensStr()])
		}
		return ast.WalkContinue
	})
}

func pagedPaths(localPath string, pageSize int) (ret map[int][]string) {
	ret = map[int][]string{}
	page := 1
	filepath.Walk(localPath, func(path string, info fs.FileInfo, err error) error {
		if info.IsDir() && strings.HasPrefix(info.Name(), ".") {
			return filepath.SkipDir
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
	data, err := filelock.NoLockFileRead(localPath)
	if nil != err {
		logging.LogErrorf("get data [path=%s] failed: %s", localPath, err)
		return
	}

	ret, err = parse.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if nil != err {
		logging.LogErrorf("parse json to tree [%s] failed: %s", localPath, err)
		return
	}
	return
}

var ErrBoxNotFound = errors.New("notebook not found")
var ErrBlockNotFound = errors.New("block not found")
var ErrTreeNotFound = errors.New("tree not found")

func loadTreeByBlockID(id string) (ret *parse.Tree, err error) {
	if "" == id {
		return nil, ErrTreeNotFound
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return nil, ErrBlockNotFound
	}
	ret, err = LoadTree(bt.BoxID, bt.Path)
	if nil != err {
		return
	}
	return
}

func LoadTree(boxID, p string) (*parse.Tree, error) {
	luteEngine := NewLute()
	tree, err := filesys.LoadTree(boxID, p, luteEngine)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", boxID+p, err)
		return nil, err
	}
	return tree, nil
}
