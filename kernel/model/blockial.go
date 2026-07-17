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
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func SetCloudReminder(id, content, timed string) (err error) {
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

	content = strings.TrimSpace(content)
	err = SetCloudBlockReminder(id, content, timedMills)
	if err != nil {
		return
	}

	if "0" == timed {
		util.PushMsg(fmt.Sprintf(Conf.Language(109), content), 3000)
	} else {
		util.PushMsg(fmt.Sprintf(Conf.Language(101), time.UnixMilli(timedMills).Format("2006-01-02 15:04")), 5000)
	}

	IncSync()
	return
}

func SetBlockReminder(id, timed string) (err error) {
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
		return fmt.Errorf(Conf.Language(15), id)
	}

	if ast.NodeDocument != node.Type && node.IsContainerBlock() {
		node = treenode.FirstLeafBlock(node)
	}

	content := sql.NodeStaticContent(node, nil, false, false, false)
	content = gulu.Str.SubStr(content, 128)
	content = strings.ReplaceAll(content, editor.Zwsp, "")
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
	cache.PutBlockIALInBox(id, tree.Box, attrs)
	return
}

func BatchSetBlockAttrs(blockAttrs []map[string]any) (err error) {
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
	boxIcons := map[string]string{}
	for _, blockAttr := range blockAttrs {
		id := blockAttr["id"].(string)
		tree := trees[id]
		if nil == tree {
			return fmt.Errorf(Conf.Language(15), id)
		}

		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			return fmt.Errorf(Conf.Language(15), id)
		}

		attrs := blockAttr["attrs"].(map[string]string)
		if IsBoxDoc(tree.Box, tree.ID) {
			attrs[DocHiddenAttr] = "true"
			if icon, ok := attrs["icon"]; ok {
				boxIcons[tree.Box] = filterBoxIcon(icon)
				attrs["icon"] = boxIcons[tree.Box]
			}
		}
		oldAttrs, e := setNodeAttrs0(node, attrs, tree.Box)
		if nil != e {
			return e
		}

		cache.PutBlockIALInBox(node.ID, tree.Box, parse.IAL2Map(node.KramdownIAL))
		pushBlockAttrs(oldAttrs, node)
		nodes = append(nodes, node)
	}

	for _, tree := range trees {
		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			return
		}
	}
	for boxID, icon := range boxIcons {
		box := &Box{ID: boxID}
		boxConf := box.GetConf()
		boxConf.Icon = icon
		if err = box.SaveConf(boxConf); err != nil {
			return
		}
	}
	if 0 < len(boxIcons) {
		ReloadFiletree()
	}

	IncSync()
	// 不做锚文本刷新
	return
}

func SetBlockAttrs(id string, nameValues map[string]string) (err error) {
	if util.ReadOnly {
		return
	}
	if nil == nameValues {
		nameValues = map[string]string{}
	}

	FlushTxQueue()

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return err
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return fmt.Errorf(Conf.Language(15), id)
	}

	if IsBoxDoc(tree.Box, tree.ID) {
		nameValues[DocHiddenAttr] = "true"
		if icon, ok := nameValues["icon"]; ok {
			nameValues["icon"] = filterBoxIcon(icon)
		}
	}
	err = setNodeAttrs(node, tree, nameValues)
	if nil == err && IsBoxDoc(tree.Box, tree.ID) {
		if icon, ok := nameValues["icon"]; ok {
			box := &Box{ID: tree.Box}
			boxConf := box.GetConf()
			boxConf.Icon = icon
			err = box.SaveConf(boxConf)
			if nil == err {
				ReloadFiletree()
			}
		}
	}
	return
}

func setNodeAttrs(node *ast.Node, tree *parse.Tree, nameValues map[string]string) (err error) {
	oldAttrs, err := setNodeAttrs0(node, nameValues, tree.Box)
	if err != nil {
		return
	}

	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return
	}

	IncSync()
	cache.PutBlockIALInBox(node.ID, tree.Box, parse.IAL2Map(node.KramdownIAL))

	pushBlockAttrs(oldAttrs, node)

	if ("true" == oldAttrs[DocHiddenAttr]) != ("true" == nameValues[DocHiddenAttr]) {
		ReloadFiletree()
	}

	if attrsAffectRefText(nameValues) {
		go func() {
			sql.FlushQueue()
			refreshDynamicRefText(node, tree)
		}()
	}
	if attrsAffectAvBlock(nameValues) {
		go func() {
			updateAttributeViewBlockText(map[string]*ast.Node{node.ID: node})
		}()
	}
	return
}

// attrsAffectRefText 判断本次属性变更是否可能影响引用处的动态锚文本。
//
// 动态锚文本（ref-d）由定义块的 name（命名）或 title（文档标题）派生而来，
// 仅当这两个属性发生变化时才需要调用 refreshDynamicRefText 去刷新引用方文档；
// 其他属性（如锁定状态、滚动位置、自定义属性等）不影响锚文本，跳过刷新可避免
// 对引用方文档的无意义落盘和历史记录生成（详见 https://github.com/siyuan-note/siyuan/issues/18058）。
//
// 注意：若后续动态锚文本的派生规则扩展到其他属性，需同步在本函数的白名单中补齐。
func attrsAffectRefText(nameValues map[string]string) bool {
	for name := range nameValues {
		switch strings.ToLower(name) {
		case "name", "title":
			return true
		}
	}
	return false
}

// attrsAffectAvBlock 判断本次属性变更是否可能影响数据库（属性视图）主键块的显示。
//
// 数据库主键块的 icon 和 content 由 getNodeAvBlockText 从块的 icon、name、
// custom-sy-av-s-text-<avID> 属性派生，这些属性变更时需调用 updateAttributeViewBlockText
// 同步到 AV JSON，否则数据库视图中显示的图标/内容不会更新。
//
// 该同步原本由 refreshDynamicRefText 顺带完成，但 #18058 的锚文本刷新优化用 attrsAffectRefText
// 门槛拦截了非 name/title 属性的刷新，导致 icon 变更不再触发同步，故此处独立解耦触发
// （详见 https://github.com/siyuan-note/siyuan/issues/18204）。
func attrsAffectAvBlock(nameValues map[string]string) bool {
	for name := range nameValues {
		lowerName := strings.ToLower(name)
		if "icon" == lowerName || "name" == lowerName {
			return true
		}
		if strings.HasPrefix(lowerName, av.NodeAttrViewStaticText) {
			return true
		}
	}
	return false
}

func setNodeAttrsWithTx(tx *Transaction, node *ast.Node, tree *parse.Tree, nameValues map[string]string) (err error) {
	oldAttrs, err := setNodeAttrs0(node, nameValues, tree.Box)
	if err != nil {
		return
	}

	tx.writeTree(tree)

	IncSync()
	cache.PutBlockIALInBox(node.ID, tree.Box, parse.IAL2Map(node.KramdownIAL))
	pushBlockAttrs(oldAttrs, node)
	return
}

func setNodeAttrs0(node *ast.Node, nameValues map[string]string, boxID string) (oldAttrs map[string]string, err error) {
	// 加密笔记本不支持书签和标签（依赖全局 SQLite 聚合，加密笔记本是孤岛）
	if IsEncryptedBox(boxID) && boxID != "" {
		for name := range nameValues {
			switch strings.ToLower(name) {
			case "bookmark", "tags":
				err = errors.New(Conf.Language(313))
				return
			}
		}
	}
	oldAttrs = parse.IAL2Map(node.KramdownIAL)
	newAttrsUnEsc := parse.IAL2MapUnEsc(node.KramdownIAL)

	for name, value := range nameValues {
		value = util.RemoveInvalidRetainCtrl(value)
		value = strings.TrimSpace(value)
		lowerName := strings.ToLower(name)
		// 转换为小写再验证属性名
		if !isValidAttrName(lowerName) {
			err = errors.New(Conf.Language(25) + " [" + node.ID + "]")
			return
		}
		if lowerName == "data-task" {
			err = errors.New(`setting or removing [data-task] attribute is not allowed via this interface. Please use "/api/block/updateTaskListItemMarker" or "/api/block/batchUpdateTaskListItemMarker" to update the task list item marker`)
			return
		}

		// 处理文档标签 https://github.com/siyuan-note/siyuan/issues/13311
		if lowerName == "tags" {
			var tags []string
			tmp := strings.SplitSeq(value, ",")
			for t := range tmp {
				t = strings.TrimSpace(t)
				if "" != t {
					tags = append(tags, t)
				}
			}
			tags = gulu.Str.RemoveDuplicatedElem(tags)
			if 0 < len(tags) {
				value = strings.Join(tags, ",")
			} else {
				value = ""
			}
		}

		if lowerName == "icon" && "" != value {
			value = normalizeIconValue(value)
		}

		if "" == value {
			// 删除属性
			if name != lowerName {
				if _, exists := newAttrsUnEsc[name]; exists {
					// 仅删除完全匹配的包含大写字母的属性
					delete(newAttrsUnEsc, name)
					continue
				}
			}
			delete(newAttrsUnEsc, lowerName)
		} else {
			// 添加或更新属性
			// 删除大小写完全匹配的属性
			delete(newAttrsUnEsc, name)
			// 保存小写的属性 https://github.com/siyuan-note/siyuan/issues/16447
			newAttrsUnEsc[lowerName] = html.EscapeAttrVal(value)
		}
	}

	node.KramdownIAL = parse.Map2IAL(newAttrsUnEsc)

	if html.EscapeAttrVal(oldAttrs["tags"]) != newAttrsUnEsc["tags"] {
		ReloadTag()
	}
	return
}

// isValidAttrName 验证属性名是否合法
func isValidAttrName(name string) bool {
	n := len(name)
	if n == 0 {
		return false
	}

	// 首字符必须是小写字母
	c := name[0]
	if c < 'a' || c > 'z' {
		return false
	}

	// 后续字符只能是小写字母、数字、连字符
	if c != 'c' {
		return validateChars(name, 1, n)
	}

	// 首字符是 'c'，检查自定义属性 custom- 前缀
	if n >= 7 && name[1] == 'u' && name[2] == 's' && name[3] == 't' && name[4] == 'o' && name[5] == 'm' && name[6] == '-' {
		if n == 7 {
			return false // 不允许只包含前缀
		}

		if c = name[7]; c < 'a' || c > 'z' {
			return false // 首字符必须是小写字母
		}
		return validateChars(name, 7, n)
	}

	// 非自定义属性
	return validateChars(name, 1, n)
}

// validateChars 验证从指定索引开始的字符是否合法（小写字母、数字、连字符）
func validateChars(name string, startIdx, n int) bool {
	for i := startIdx; i < n; i++ {
		c := name[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
}

func normalizeIconValue(value string) string {
	if strings.ContainsAny(value, "./") {
		return value
	}

	allASCII := true
	for _, r := range value {
		if r > 127 {
			allASCII = false
			break
		}
	}
	if allASCII {
		return value
	}

	var parts []string
	for _, r := range value {
		parts = append(parts, strconv.FormatInt(int64(r), 16))
	}
	return strings.Join(parts, "-")
}

func pushBlockAttrs(oldAttrs map[string]string, node *ast.Node) {
	newAttrs := parse.IAL2Map(node.KramdownIAL)
	data := map[string]any{"old": oldAttrs, "new": newAttrs}
	if "" != node.AttributeViewType {
		data["data-av-type"] = node.AttributeViewType
	}
	doOp := &Operation{Action: "updateAttrs", Data: data, ID: node.ID, RootID: treenode.TreeRoot(node).ID}
	evt := util.NewCmdResult("transactions", 0, util.PushModeBroadcast)
	evt.Data = []*Transaction{{
		DoOperations:   []*Operation{doOp},
		UndoOperations: []*Operation{},
	}}
	util.PushEvent(evt)
}
