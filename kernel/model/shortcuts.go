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
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func MoveLocalShorthands(boxID, hPath, parentID string) (retIDs []string, err error) {
	shorthandsDir := filepath.Join(util.ShortcutsPath, "shorthands")
	if !gulu.File.IsDir(shorthandsDir) {
		return
	}

	entries, err := os.ReadDir(shorthandsDir)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", shorthandsDir, err)
		return
	}

	assetsDir := filepath.Join(util.DataDir, "assets")
	for _, entry := range entries {
		if entry.IsDir() && "assets" == entry.Name() {
			assetsEntries, readErr := os.ReadDir(filepath.Join(shorthandsDir, entry.Name()))
			if nil != readErr {
				logging.LogErrorf("read dir [%s] failed: %s", shorthandsDir, readErr)
				continue
			}
			for _, assetEntry := range assetsEntries {
				if assetEntry.IsDir() {
					continue
				}

				p := filepath.Join(shorthandsDir, entry.Name(), assetEntry.Name())
				assetWritePath := filepath.Join(assetsDir, assetEntry.Name())
				if renameErr := os.Rename(p, assetWritePath); nil != renameErr {
					logging.LogErrorf("rename file [%s] to [%s] failed: %s", p, assetWritePath, renameErr)
					continue
				}
			}
		}
	}

	var toRemoves []string
	box := Conf.Box(boxID)

	if "" == hPath { // hPath 为空的话每一个速记对应创建一个文档记录
		for _, entry := range entries {
			if filepath.Ext(entry.Name()) != ".md" {
				continue
			}

			p := filepath.Join(shorthandsDir, entry.Name())
			data, readErr := os.ReadFile(p)
			if nil != readErr {
				logging.LogErrorf("read file [%s] failed: %s", p, readErr)
				continue
			}

			content := string(bytes.TrimSpace(data))
			if "" == content {
				toRemoves = append(toRemoves, p)
				continue
			}

			t := strings.TrimSuffix(entry.Name(), ".md")
			i, parseErr := strconv.ParseInt(t, 10, 64)
			if nil != parseErr {
				logging.LogErrorf("parse [%s] to int failed: %s", t, parseErr)
				continue
			}
			hPath = "/" + time.UnixMilli(i).Format("2006-01-02 15:04:05")
			var retID string
			retID, err = CreateWithMarkdown("", boxID, hPath, content, parentID, "", false, "")
			if nil != err {
				logging.LogErrorf("create doc failed: %s", err)
				return
			}

			retIDs = append(retIDs, retID)
			toRemoves = append(toRemoves, p)
			box.setSortByConf("/", retID)
		}
	} else { // 不为空的话将所有速记合并到指定路径的文档中
		if !strings.HasPrefix(hPath, "/") {
			hPath = "/" + hPath
		}

		buff := bytes.Buffer{}
		for _, entry := range entries {
			if filepath.Ext(entry.Name()) != ".md" {
				continue
			}

			p := filepath.Join(shorthandsDir, entry.Name())
			data, readErr := os.ReadFile(p)
			if nil != readErr {
				logging.LogErrorf("read file [%s] failed: %s", p, readErr)
				continue
			}

			content := string(bytes.TrimSpace(data))
			if "" == content {
				toRemoves = append(toRemoves, p)
				continue
			}

			buff.WriteString(content)
			buff.WriteString("\n\n")
			toRemoves = append(toRemoves, p)
		}

		if 0 < buff.Len() {
			bt := treenode.GetBlockTreeRootByHPath(boxID, hPath)
			if nil == bt {
				var retID string
				retID, err = CreateWithMarkdown("", boxID, hPath, buff.String(), parentID, "", false, "")
				if nil != err {
					logging.LogErrorf("create doc failed: %s", err)
					return
				}
				retIDs = append(retIDs, retID)
			} else {
				var tree *parse.Tree
				tree, err = loadTreeByBlockTree(bt)
				if nil != err {
					logging.LogErrorf("load tree by block tree failed: %s", err)
					return
				}
				var last *ast.Node
				for c := tree.Root.FirstChild; nil != c; c = c.Next {
					last = c
				}

				luteEngine := util.NewStdLute()
				inputTree := parse.Parse("", buff.Bytes(), luteEngine.ParseOptions)

				if nil != inputTree {
					var nodes []*ast.Node
					for c := inputTree.Root.FirstChild; nil != c; c = c.Next {
						nodes = append(nodes, c)
					}
					slices.Reverse(nodes)
					for _, node := range nodes {
						last.InsertAfter(node)
					}
				}

				indexWriteTreeIndexQueue(tree)
			}

		}
	}

	for _, p := range toRemoves {
		if removeErr := os.Remove(p); nil != removeErr {
			logging.LogErrorf("remove file [%s] failed: %s", p, removeErr)
		}
	}
	return
}

func WatchLocalShorthands() {
	shorthandsDir := filepath.Join(util.ShortcutsPath, "shorthands")
	if !gulu.File.IsDir(shorthandsDir) {
		return
	}

	entries, err := os.ReadDir(shorthandsDir)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", shorthandsDir, err)
		return
	}

	shorthandCount := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		if filepath.Ext(entry.Name()) != ".md" {
			continue
		}

		shorthandCount++
	}

	if 1 > shorthandCount {
		return
	}

	util.PushLocalShorthandCount(shorthandCount)
}
