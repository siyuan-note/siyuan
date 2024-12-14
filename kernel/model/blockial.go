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
	"fmt"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func SetBlockReminder(id string, timed string) (err error) {
	if !IsSubscriber() {
		if "ios" == util.Container {
			return errors.New(Conf.Language(122))
		}
		return errors.New(Conf.Language(29))
	}

	var timedMills int64
	if "0" != timed {
		t, e := dateparse.ParseIn(timed, time.Now().Location())
		if nil != e {
			return e
		}
		timedMills = t.UnixMilli()
	}

	FlushTxQueue()

	attrs := sql.GetBlockAttrs(id)
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return errors.New(fmt.Sprintf(Conf.Language(15), id))
	}

	if ast.NodeDocument != node.Type && node.IsContainerBlock() {
		node = treenode.FirstLeafBlock(node)
	}
	content := sql.NodeStaticContent(node, nil, false, false, false)
	content = gulu.Str.SubStr(content, 128)
	err = SetCloudBlockReminder(id, content, timedMills)
	if err != nil {
		return
	}

	attrName := "custom-reminder-wechat"
	if "0" == timed {
		delete(attrs, attrName)
		old := node.IALAttr(attrName)
		oldTimedMills, e := dateparse.ParseIn(old, time.Now().Location())
		if nil == e {
			util.PushMsg(fmt.Sprintf(Conf.Language(109), oldTimedMills.Format("2006-01-02 15:04")), 3000)
		}
		node.RemoveIALAttr(attrName)
	} else {
		attrs[attrName] = timed
		node.SetIALAttr(attrName, timed)
		util.PushMsg(fmt.Sprintf(Conf.Language(101), time.UnixMilli(timedMills).Format("2006-01-02 15:04")), 5000)
	}
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return
	}
	IncSync()
	cache.PutBlockIAL(id, attrs)
	return
}

func BatchSetBlockAttrs(blockAttrs []map[string]interface{}) (err error) {
	if util.ReadOnly {
		return
	}

	FlushTxQueue()

	var blockIDs []string
	for _, blockAttr := range blockAttrs {
		blockIDs = append(blockIDs, blockAttr["id"].(string))
	}

	trees := filesys.LoadTrees(blockIDs)
	var nodes []*ast.Node
	for _, blockAttr := range blockAttrs {
		id := blockAttr["id"].(string)
		tree := trees[id]
		if nil == tree {
			return errors.New(fmt.Sprintf(Conf.Language(15), id))
		}

		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			return errors.New(fmt.Sprintf(Conf.Language(15), id))
		}

		attrs := blockAttr["attrs"].(map[string]string)
		oldAttrs, e := setNodeAttrs0(node, attrs)
		if nil != e {
			return e
		}

		cache.PutBlockIAL(node.ID, parse.IAL2Map(node.KramdownIAL))
		pushBroadcastAttrTransactions(oldAttrs, node)
		nodes = append(nodes, node)
	}

	for _, tree := range trees {
		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			return
		}
	}

	IncSync()
	// 不做锚文本刷新
	return
}

func SetBlockAttrs(id string, nameValues map[string]string) (err error) {
	if util.ReadOnly {
		return
	}

	FlushTxQueue()

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return err
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return errors.New(fmt.Sprintf(Conf.Language(15), id))
	}

	err = setNodeAttrs(node, tree, nameValues)
	return
}

func setNodeAttrs(node *ast.Node, tree *parse.Tree, nameValues map[string]string) (err error) {
	oldAttrs, err := setNodeAttrs0(node, nameValues)
	if err != nil {
		return
	}

	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return
	}

	IncSync()
	cache.PutBlockIAL(node.ID, parse.IAL2Map(node.KramdownIAL))

	pushBroadcastAttrTransactions(oldAttrs, node)

	go func() {
		sql.FlushQueue()
		refreshDynamicRefText(node, tree)
	}()
	return
}

func setNodeAttrsWithTx(tx *Transaction, node *ast.Node, tree *parse.Tree, nameValues map[string]string) (err error) {
	oldAttrs, err := setNodeAttrs0(node, nameValues)
	if err != nil {
		return
	}

	if err = tx.writeTree(tree); err != nil {
		return
	}

	IncSync()
	cache.PutBlockIAL(node.ID, parse.IAL2Map(node.KramdownIAL))
	pushBroadcastAttrTransactions(oldAttrs, node)
	return
}

func setNodeAttrs0(node *ast.Node, nameValues map[string]string) (oldAttrs map[string]string, err error) {
	oldAttrs = parse.IAL2Map(node.KramdownIAL)

	for name := range nameValues {
		for i := 0; i < len(name); i++ {
			if !lex.IsASCIILetterNumHyphen(name[i]) {
				err = errors.New(fmt.Sprintf(Conf.Language(25), node.ID))
				return
			}
		}
	}

	if tag, ok := nameValues["tags"]; ok {
		var tags []string
		tmp := strings.Split(tag, ",")
		for _, t := range tmp {
			t = util.RemoveInvalid(t)
			t = strings.TrimSpace(t)
			if "" != t {
				tags = append(tags, t)
			}
		}
		tags = gulu.Str.RemoveDuplicatedElem(tags)
		if 0 < len(tags) {
			nameValues["tags"] = strings.Join(tags, ",")
		}
	}

	for name, value := range nameValues {
		value = util.RemoveInvalid(value)
		value = strings.TrimSpace(value)
		value = strings.TrimSuffix(value, ",")
		if "" == value {
			node.RemoveIALAttr(name)
		} else {
			node.SetIALAttr(name, value)
		}
	}
	return
}

func pushBroadcastAttrTransactions(oldAttrs map[string]string, node *ast.Node) {
	newAttrs := parse.IAL2Map(node.KramdownIAL)
	doOp := &Operation{Action: "updateAttrs", Data: map[string]interface{}{"old": oldAttrs, "new": newAttrs}, ID: node.ID}
	evt := util.NewCmdResult("transactions", 0, util.PushModeBroadcast)
	evt.Data = []*Transaction{{
		DoOperations:   []*Operation{doOp},
		UndoOperations: []*Operation{},
	}}
	util.PushEvent(evt)
}

func ResetBlockAttrs(id string, nameValues map[string]string) (err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return err
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return errors.New(fmt.Sprintf(Conf.Language(15), id))
	}

	for name := range nameValues {
		for i := 0; i < len(name); i++ {
			if !lex.IsASCIILetterNumHyphen(name[i]) {
				return errors.New(fmt.Sprintf(Conf.Language(25), id))
			}
		}
	}

	node.ClearIALAttrs()
	for name, value := range nameValues {
		if "" != value {
			node.SetIALAttr(name, value)
		}
	}

	if ast.NodeDocument == node.Type {
		// 修改命名文档块后引用动态锚文本未跟随 https://github.com/siyuan-note/siyuan/issues/6398
		// 使用重命名文档队列来刷新引用锚文本
		updateRefTextRenameDoc(tree)
	}

	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return
	}
	IncSync()
	cache.RemoveBlockIAL(id)
	return
}
