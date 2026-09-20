package model

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const listMindmapViewAttr = "custom-sy-list-mindmap"
const legacyMindmapCodeAttr = "custom-sy-mindmap-code"

// legacyMindmapList 从完整 Markdown 原文生成列表，不能仅提取渲染树中的节点文字。
func legacyMindmapList(node *ast.Node, engine *lute.Lute) *ast.Node {
	if !isLegacyMindmap(node) || node.IALAttr(legacyMindmapCodeAttr) == "1" {
		return nil
	}
	code := node.ChildByType(ast.NodeCodeBlockCode)
	if code == nil || strings.TrimSpace(string(code.Tokens)) == "" || node.IALAttr(listMindmapMetadataAttr) != "" {
		return nil
	}
	_, parsed := engine.Md2BlockDOMTree(string(code.Tokens), false)
	blocks := blockChildrenOf(parsed.Root)
	if len(blocks) != 1 || blocks[0].Type != ast.NodeList {
		return nil
	}
	list := blocks[0]
	if list.IALAttr(listMindmapMetadataAttr) != "" {
		return nil
	}
	// 原文中的显式块 ID 不能占用工作空间内已有块的身份。
	ast.Walk(list, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.IsBlock() && n.Type != ast.NodeKramdownBlockIAL {
			n.ID = ast.NewNodeID()
			n.SetIALAttr("id", n.ID)
			n.SetIALAttr("updated", n.ID[:14])
		}
		return ast.WalkContinue
	})
	for _, attr := range node.KramdownIAL {
		list.SetIALAttr(attr[0], node.IALAttr(attr[0]))
	}
	list.ID = node.ID
	list.SetIALAttr("id", node.ID)
	list.SetIALAttr(listMindmapViewAttr, "1")
	if treenode.ValidateBlockReplacement(node, list) != nil {
		return nil
	}
	return list
}

func isLegacyMindmap(node *ast.Node) bool {
	if node.Type != ast.NodeCodeBlock {
		return false
	}
	info := node.ChildByType(ast.NodeCodeBlockFenceInfoMarker)
	return info != nil && string(info.CodeBlockInfo) == "mindmap"
}

// 以普通代码块结构输出原文，保留 mindmap 语言；原节点不变以便生成撤销操作。
func legacyMindmapCodeDOM(node *ast.Node, engine *lute.Lute) string {
	info := node.ChildByType(ast.NodeCodeBlockFenceInfoMarker)
	original := info.CodeBlockInfo
	info.CodeBlockInfo = []byte("text")
	defer func() { info.CodeBlockInfo = original }()
	dom := engine.RenderNodeBlockDOM(node)
	dom = strings.Replace(dom, `contenteditable="false">text</span>`, `contenteditable="false">mindmap</span>`, 1)
	if node.IALAttr(legacyMindmapCodeAttr) != "1" {
		dom = strings.Replace(dom, "<div ", `<div `+legacyMindmapCodeAttr+`="1" `, 1)
	}
	return dom
}

// MigrateLegacyMindmaps 在事务串行区内读取完整文档，迁移后返回调用方当前显示块的权威内容。
func MigrateLegacyMindmaps(id string) (tx *Transaction, visible map[string]string, err error) {
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()
	for _, queued := range takeQueuedTransactions() {
		flushTx(queued)
	}
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return nil, nil, err
	}
	if tree.ID != id || tree.Root.IALAttr("custom-sy-readonly") == "true" {
		return nil, nil, errors.New("mind map migration requires an editable document")
	}
	engine := util.NewLute()
	tx = &Transaction{fromAPI: true}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n.IALAttr("custom-sy-readonly") == "true" {
			return ast.WalkSkipChildren
		}
		if isLegacyMindmap(n) && n.IALAttr(legacyMindmapCodeAttr) != "1" {
			var dom string
			if list := legacyMindmapList(n, engine); list != nil {
				dom = engine.RenderNodeBlockDOM(list)
			} else {
				dom = legacyMindmapCodeDOM(n, engine)
			}
			tx.DoOperations = append(tx.DoOperations, &Operation{Action: "update", ID: n.ID, Data: dom})
			tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "update", ID: n.ID, Data: engine.RenderNodeBlockDOM(n)})
		}
		return ast.WalkContinue
	})
	if len(tx.DoOperations) > 0 {
		if err = saveMindmapMigrationHistory(tree); err != nil {
			return nil, nil, err
		}
		if err = performTxSyncLocked(tx); err != nil {
			return nil, nil, err
		}
		tree, err = LoadTreeByBlockID(id)
		if err != nil {
			return tx, nil, err
		}
	}
	visible = map[string]string{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && (node.Type == ast.NodeList && node.IALAttr(listMindmapViewAttr) == "1" ||
			isLegacyMindmap(node)) {
			visible[node.ID] = engine.RenderNodeBlockDOM(node)
			if isLegacyMindmap(node) && node.IALAttr(legacyMindmapCodeAttr) == "1" {
				visible[node.ID] = legacyMindmapCodeDOM(node, engine)
			}
		}
		return ast.WalkContinue
	})
	return
}

// 迁移前保存已落盘原文；使用格式化历史，避免被同一秒的定时更新历史覆盖。
// 加密文档直接保存密文，任何历史写入错误都阻止本次迁移。
func saveMindmapMigrationHistory(tree *parse.Tree) error {
	historyDir, err := getHistoryDir(HistoryOpFormat)
	if err != nil {
		return err
	}
	source := filepath.Join(util.DataDir, tree.Box, tree.Path)
	data, err := filelock.ReadFile(source)
	if err != nil {
		return err
	}
	target := filepath.Join(historyDir, tree.Box, tree.Path)
	if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	if err = gulu.File.WriteFileSafer(target, data, 0644); err != nil {
		return err
	}
	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	return nil
}
