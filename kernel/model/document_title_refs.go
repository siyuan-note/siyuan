// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type dynamicRefAnchorKey struct {
	boxID string
	id    string
}

type dynamicRefAnchorNode struct {
	projection *ast.Node
	title      bool
	deps       []dynamicRefAnchorKey
	local      string
	text       string
	component  int
	resolved   bool
}

// dynamicRefAnchorResolver 根据源关系计算锚文本，循环分量内部只使用目标的本地文字。
type dynamicRefAnchorResolver struct {
	nodes  map[dynamicRefAnchorKey]*dynamicRefAnchorNode
	keys   map[string]dynamicRefAnchorKey
	lookup func(dynamicRefAnchorKey) (*ast.Node, error)
	err    error
}

func dynamicRefAnchorScope(boxID string) string {
	if IsEncryptedBox(boxID) {
		return boxID
	}
	return ""
}

func newDynamicRefAnchorResolver(updatedNodes map[string]*ast.Node, updatedTrees map[string]*parse.Tree) *dynamicRefAnchorResolver {
	known := map[dynamicRefAnchorKey]*ast.Node{}
	trees := map[string]*parse.Tree{}
	for id, tree := range updatedTrees {
		trees[id] = tree
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.ID != "" {
				known[dynamicRefAnchorKey{dynamicRefAnchorScope(tree.Box), node.ID}] = node
			}
			return ast.WalkContinue
		})
	}
	for id, node := range updatedNodes {
		known[dynamicRefAnchorKey{dynamicRefAnchorScope(updatedNodeBoxID(node, updatedTrees)), id}] = node
	}
	ret := &dynamicRefAnchorResolver{nodes: map[dynamicRefAnchorKey]*dynamicRefAnchorNode{}, keys: map[string]dynamicRefAnchorKey{}}
	ret.lookup = func(key dynamicRefAnchorKey) (*ast.Node, error) {
		if node := known[key]; nil != node {
			return node, nil
		}
		// 空边界只查普通索引，不能通过通用打开入口遍历其他已解锁的加密笔记本。
		bt := treenode.GetBlockTreeInBox(key.id, key.boxID)
		if nil == bt {
			return nil, nil
		}
		tree := trees[bt.RootID]
		if nil == tree {
			var err error
			tree, err = loadTreeByBlockTree(bt)
			if nil != err {
				if errors.Is(err, ErrTreeNotFound) {
					return nil, nil
				}
				return nil, err
			}
			trees[bt.RootID] = tree
		}
		if dynamicRefAnchorScope(tree.Box) != key.boxID {
			return nil, nil
		}
		return treenode.GetNodeInTree(tree, key.id), nil
	}
	return ret
}

func dynamicRefAnchorProjection(node *ast.Node) (*ast.Node, bool, error) {
	if name := node.IALAttr("name"); name != "" {
		ret := &ast.Node{Type: ast.NodeParagraph}
		ret.SetIALAttr("name", name)
		return ret, false, nil
	}
	if node.Type == ast.NodeDocument {
		paragraph, err := treenode.DocumentTitleParagraph(node)
		if paragraph != nil {
			paragraph.Parent = nil
		}
		return paragraph, true, err
	}
	if node.Type == ast.NodeTabItem {
		if title := treenode.TabTitleParagraph(node); nil != title {
			title.Parent = nil
			return title, false, nil
		}
	}
	if node.IsContainerBlock() {
		node = treenode.FirstLeafBlock(node)
	}
	ret := cloneRenderNode(node)
	if nil != ret {
		// 容器的锚文本使用叶子正文，叶子自己的命名不能覆盖容器的命名规则。
		ret.RemoveIALAttr("name")
	}
	return ret, false, nil
}

func dynamicRefAnchorText(node *ast.Node, title bool) string {
	if !title {
		return strings.TrimSpace(getNodeRefText(node))
	}
	text := strings.TrimSpace(treenode.DocumentTitleText(node))
	maxLen := 512
	if Conf != nil && Conf.Editor.Load() != nil {
		maxLen = Conf.Editor.Load().BlockRefDynamicAnchorTextMaxLen
	}
	if maxLen < 1 {
		maxLen = 512
	}
	if utf8.RuneCountInString(text) > maxLen {
		text = string([]rune(text)[:maxLen]) + "..."
	}
	return util.EscapeHTML(text)
}

func (resolver *dynamicRefAnchorResolver) add(key dynamicRefAnchorKey) {
	if resolver.nodes[key] != nil || resolver.err != nil {
		return
	}
	entry := &dynamicRefAnchorNode{component: -1}
	resolver.nodes[key] = entry
	node, err := resolver.lookup(key)
	if err != nil {
		resolver.err = err
		return
	}
	if node == nil {
		entry.local, entry.text, entry.resolved = key.id, key.id, true
		return
	}
	entry.projection, entry.title, err = dynamicRefAnchorProjection(node)
	if err != nil {
		resolver.err = err
		return
	}
	if entry.projection == nil {
		entry.local, entry.text, entry.resolved = key.id, key.id, true
		return
	}
	seen := map[string]bool{}
	ast.Walk(entry.projection, func(inline *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(inline) && inline.TextMarkBlockRefSubtype == "d" &&
			inline.TextMarkBlockRefID != "" && !seen[inline.TextMarkBlockRefID] {
			seen[inline.TextMarkBlockRefID] = true
			entry.deps = append(entry.deps, dynamicRefAnchorKey{key.boxID, inline.TextMarkBlockRefID})
		}
		return ast.WalkContinue
	})
	sort.Slice(entry.deps, func(i, j int) bool { return entry.deps[i].id < entry.deps[j].id })
	local := cloneRenderNode(entry.projection)
	ast.Walk(local, func(inline *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(inline) && inline.TextMarkBlockRefSubtype == "d" {
			inline.TextMarkType, inline.TextMarkTextContent = "text", ""
		}
		return ast.WalkContinue
	})
	entry.local = dynamicRefAnchorText(local, entry.title)
	if entry.local == "" {
		entry.local = key.id
	}
	for _, dependency := range entry.deps {
		resolver.add(dependency)
	}
}

func (resolver *dynamicRefAnchorResolver) resolve() error {
	if resolver.err != nil {
		return resolver.err
	}
	index := 0
	indices, low := map[dynamicRefAnchorKey]int{}, map[dynamicRefAnchorKey]int{}
	onStack := map[dynamicRefAnchorKey]bool{}
	var stack []dynamicRefAnchorKey
	component := 0
	var visit func(dynamicRefAnchorKey)
	visit = func(key dynamicRefAnchorKey) {
		index++
		indices[key], low[key] = index, index
		stack = append(stack, key)
		onStack[key] = true
		for _, dependency := range resolver.nodes[key].deps {
			if indices[dependency] == 0 {
				visit(dependency)
				if low[dependency] < low[key] {
					low[key] = low[dependency]
				}
			} else if onStack[dependency] && indices[dependency] < low[key] {
				low[key] = indices[dependency]
			}
		}
		if low[key] == indices[key] {
			for {
				last := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[last] = false
				resolver.nodes[last].component = component
				if last == key {
					break
				}
			}
			component++
		}
	}
	for key := range resolver.nodes {
		if indices[key] == 0 {
			visit(key)
		}
	}
	for key := range resolver.nodes {
		resolver.value(key)
	}
	return nil
}

func (resolver *dynamicRefAnchorResolver) referenceValue(source dynamicRefAnchorKey, targetID string) string {
	target := dynamicRefAnchorKey{source.boxID, targetID}
	entry := resolver.nodes[target]
	if entry == nil {
		return targetID
	}
	if from := resolver.nodes[source]; from != nil && from.component == entry.component {
		return entry.local
	}
	return resolver.value(target)
}

func (resolver *dynamicRefAnchorResolver) value(key dynamicRefAnchorKey) string {
	entry := resolver.nodes[key]
	if entry.resolved {
		return entry.text
	}
	projection := cloneRenderNode(entry.projection)
	ast.Walk(projection, func(inline *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(inline) && inline.TextMarkBlockRefSubtype == "d" {
			inline.TextMarkTextContent = resolver.referenceValue(key, inline.TextMarkBlockRefID)
		}
		return ast.WalkContinue
	})
	entry.text = dynamicRefAnchorText(projection, entry.title)
	if entry.text == "" {
		entry.text = key.id
	}
	entry.resolved = true
	return entry.text
}

func resolveDynamicRefAnchorTexts(updatedNodes map[string]*ast.Node, updatedTrees map[string]*parse.Tree) (*dynamicRefAnchorResolver, error) {
	resolver := newDynamicRefAnchorResolver(updatedNodes, updatedTrees)
	for id, node := range updatedNodes {
		key := dynamicRefAnchorKey{dynamicRefAnchorScope(updatedNodeBoxID(node, updatedTrees)), id}
		resolver.keys[id] = key
		resolver.add(key)
	}
	if err := resolver.resolve(); err != nil {
		return nil, err
	}
	return resolver, nil
}

func (resolver *dynamicRefAnchorResolver) refText(source *ast.Node, targetID string) string {
	target, ok := resolver.keys[targetID]
	if !ok {
		return targetID
	}
	return resolver.referenceValue(dynamicRefAnchorKey{target.boxID, source.ID}, targetID)
}

// refreshDocumentTitleAnchors 在保存前刷新标题内动态锚文本，保留完整源与用户编辑版本。
func refreshDocumentTitleAnchors(root *ast.Node, tree *parse.Tree) (bool, error) {
	if root.DocumentTitle == nil {
		return false, nil
	}
	paragraph, err := treenode.DocumentTitleParagraph(root)
	if err != nil {
		return false, err
	}
	key := dynamicRefAnchorKey{dynamicRefAnchorScope(tree.Box), root.ID}
	resolver := newDynamicRefAnchorResolver(map[string]*ast.Node{root.ID: root}, map[string]*parse.Tree{tree.ID: tree})
	resolver.add(key)
	ast.Walk(paragraph, func(inline *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(inline) && inline.TextMarkBlockRefSubtype == "d" {
			resolver.add(dynamicRefAnchorKey{key.boxID, inline.TextMarkBlockRefID})
		}
		return ast.WalkContinue
	})
	if err = resolver.resolve(); err != nil {
		return false, err
	}
	changed := false
	ast.Walk(paragraph, func(inline *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(inline) && inline.TextMarkBlockRefSubtype == "d" {
			text := resolver.referenceValue(key, inline.TextMarkBlockRefID)
			if text != inline.TextMarkTextContent {
				inline.TextMarkTextContent = text
				changed = true
			}
		}
		return ast.WalkContinue
	})
	if changed {
		err = treenode.SetDocumentTitleParagraph(root, paragraph)
	}
	return changed, err
}

// publishDocumentTitleProjection 只发布已保存的标题投影，不再次登记引用刷新任务。
func publishDocumentTitleProjection(tree *parse.Tree) {
	evt := util.NewCmdResult("rename", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box": tree.Box, "id": tree.Root.ID, "path": tree.Path,
		"title": treenode.ReadDocumentTitle(tree.Root).Text,
		"empty": tree.Root.IALAttr(NodeAttrTitleEmpty) == "true", "refText": getNodeRefText(tree.Root),
	}
	util.PushEvent(evt)
	IncSync()
}
