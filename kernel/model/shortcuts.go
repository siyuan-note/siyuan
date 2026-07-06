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
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func MoveLocalShorthands(boxID string) (retIDs []string, err error) {
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

	hPath := Conf.FileTree.ShorthandSavePath
	if "" != hPath {
		var renderErr error
		hPath, renderErr = RenderGoTemplate(hPath)
		if nil != renderErr {
			logging.LogErrorf("render shorthand save path failed: %s", renderErr)
			hPath = ""
		}
	}

	var toRemoves []string

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
			created := time.UnixMilli(i)
			hPath = "/" + created.Format("2006-01-02 15:04:05")
			// 块 ID 用速记输入时刻，而非 kernel 消费时刻
			dom := shorthandDOM(content, created)
			docID := util.NodeIDByTime(created)
			var retID string
			retID, err = createShorthandDocByDOM(boxID, hPath, dom, docID)
			if nil != err {
				logging.LogErrorf("create doc failed: %s", err)
				return
			}

			retIDs = append(retIDs, retID)
			toRemoves = append(toRemoves, p)
		}
	} else { // 不为空的话将所有速记合并到指定路径的文档中
		if !strings.HasPrefix(hPath, "/") {
			hPath = "/" + hPath
		}

		type shorthand struct {
			content string
			created time.Time
		}
		var shorthands []shorthand
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
			var created time.Time
			if nil != parseErr {
				// 文件名不是时间戳时退化为消费时刻，避免丢失速记内容
				created = time.Now()
			} else {
				created = time.UnixMilli(i)
			}
			shorthands = append(shorthands, shorthand{content: content, created: created})
			toRemoves = append(toRemoves, p)
		}

		if 0 < len(shorthands) {
			bt := treenode.GetBlockTreeRootByHPath(boxID, hPath)
			if nil == bt {
				// 目标文档不存在，新建文档：根文档块 ID 取所有速记中最早的输入时刻
				earliest := shorthands[0].created
				for _, s := range shorthands[1:] {
					if s.created.Before(earliest) {
						earliest = s.created
					}
				}
				buff := bytes.Buffer{}
				for _, s := range shorthands {
					buff.WriteString(s.content)
					buff.WriteString("\n\n")
				}
				dom := shorthandDOM(buff.String(), earliest)
				docID := util.NodeIDByTime(earliest)
				var retID string
				retID, err = createShorthandDocByDOM(boxID, hPath, dom, docID)
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

				// 按条独立解析，每条速记的块 ID 用其各自的输入时刻
				luteEngine := util.NewStdLute()
				var nodes []*ast.Node
				for _, s := range shorthands {
					inputTree := parse.Parse("", []byte(s.content), luteEngine.ParseOptions)
					if nil == inputTree {
						continue
					}
					for c := inputTree.Root.FirstChild; nil != c; c = c.Next {
						resetBlockIDsByTime(c, s.created)
						nodes = append(nodes, c)
					}
				}
				slices.Reverse(nodes)
				for _, node := range nodes {
					last.InsertAfter(node)
				}

				if err = indexWriteTreeUpsertQueue(tree); nil != err {
					logging.LogErrorf("upsert shorthand merged tree failed: %s", err)
					return
				}
				util.PushReloadProtyle(tree.ID)
			}
		}
	}

	for _, p := range toRemoves {
		if removeErr := os.Remove(p); nil != removeErr {
			logging.LogErrorf("remove file [%s] failed: %s", p, removeErr)
		}
	}

	FlushTxQueue()
	box := Conf.Box(boxID)
	for _, id := range retIDs {
		b, _ := GetBlock(id, nil)
		PushCreate(box, b.Path, nil)
	}
	return
}

// resetBlockIDsByTime 递归地将节点及其子孙块的 ID 重置为基于指定时间。
// 无论节点原本是否有 ID 都会主动分配，以兼容上游 lute 未开启 KramdownBlockIAL 的解析路径。
// 重赋 ID 后同步更新 IAL 中的 id 和 updated（updated 取 ID 前 14 位，对齐 createDoc 新建块的处理）。
func resetBlockIDsByTime(node *ast.Node, created time.Time) {
	if nil == node {
		return
	}
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || ast.NodeKramdownBlockIAL == n.Type {
			return ast.WalkContinue
		}
		n.ID = util.NodeIDByTime(created)
		n.SetIALAttr("id", n.ID)
		n.SetIALAttr("updated", util.TimeFromID(n.ID))
		return ast.WalkContinue
	})
}

// shorthandDOM 将速记 markdown 解析为 DOM，并把所有块 ID 替换为基于速记输入时刻。
func shorthandDOM(md string, created time.Time) string {
	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	_, tree := luteEngine.Md2BlockDOMTree(md, false)
	if nil == tree {
		return ""
	}
	resetBlockIDsByTime(tree.Root, created)
	return luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
}

// createShorthandDocByDOM 创建速记文档，使用指定的 DOM 和文档块 ID（均基于速记输入时刻）。
// 速记场景无需 tags、父文档、数学公式、剪藏链接等处理，直接基于 DOM 和指定 docID 落盘。
func createShorthandDocByDOM(boxID, hPath, dom, docID string) (retID string, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()

	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	FlushTxQueue()
	retID, err = createDocsByHPath(box.ID, hPath, dom, "", docID, false)
	if nil != err {
		return
	}
	FlushTxQueue()

	bt := treenode.GetBlockTree(retID)
	if nil == bt {
		logging.LogWarnf("get block tree by id [%s] failed after create", retID)
		return
	}
	box.setSortByConf(path.Dir(bt.Path), retID)

	FlushTxQueue()
	PushCreate(box, bt.Path, nil)
	return
}

var consumeShorthandsLock = sync.Mutex{}

func consumeShorthands() {
	if !util.IsMobileContainer() {
		return
	}

	// 消费速记涉及读取临时文件、创建/追加文档、删除临时文件等非原子操作，
	// 启动同步、同步流程、定时任务都可能并发调用，这里串行化避免重复消费或丢失
	consumeShorthandsLock.Lock()
	defer consumeShorthandsLock.Unlock()

	defer logging.Recover()

	shorthandsDir := filepath.Join(util.ShortcutsPath, "shorthands")
	if !gulu.File.IsDir(shorthandsDir) {
		return
	}

	entries, err := os.ReadDir(shorthandsDir)
	if nil != err {
		return
	}

	hasShorthand := false
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".md" {
			hasShorthand = true
			break
		}
	}

	if !hasShorthand {
		return
	}

	var notebookID string
	notebookID = Conf.FileTree.ShorthandSaveBox
	if "" != notebookID && nil == Conf.Box(notebookID) {
		notebookID = ""
	}

	if "" == notebookID {
		boxes := Conf.GetBoxes()
		for _, box := range boxes {
			if !IsUserGuide(box.ID) {
				notebookID = box.ID
				break
			}
		}
	}

	if "" == notebookID {
		logging.LogWarnf("auto consume shorthands failed: no available notebook found")
		return
	}

	if _, err = MoveLocalShorthands(notebookID); nil != err {
		logging.LogErrorf("auto consume shorthands failed: %s", err)
	}
}

func AutoConsumeShorthandsJob() {
	consumeShorthands()
}
