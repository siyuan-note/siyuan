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
	"path/filepath"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/88250/protyle"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

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

	ret, err = protyle.ParseJSONWithoutFix(luteEngine, data)
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
