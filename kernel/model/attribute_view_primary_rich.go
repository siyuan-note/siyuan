// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func prepareAttributeViewPrimaryRich(tx *Transaction, updated, previous *av.Value, data []byte, boxID string) error {
	if updated.Block == nil {
		return fmt.Errorf("primary key value is missing")
	}
	var payload struct {
		Block map[string]json.RawMessage `json:"block"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	dom, hasDOM := payload.Block["richBlockDOM"]
	hasDOM = hasDOM && strings.TrimSpace(string(dom)) != "null"
	_, hasRich := payload.Block["rich"]
	var suppliedSource *ast.DocumentTitle
	if hasRich && strings.TrimSpace(string(payload.Block["rich"])) != "null" {
		var err error
		if suppliedSource, err = ast.ParseDocumentTitleJSON(payload.Block["rich"]); err != nil {
			return err
		}
		if _, err = parse.ParseDocumentTitle(suppliedSource); err != nil {
			return err
		}
	}
	if hasDOM {
		var html string
		if err := json.Unmarshal(dom, &html); err != nil {
			return err
		}
		if len(html) > 4*1024*1024 {
			return fmt.Errorf("primary key content is too large")
		}
		fragment := util.NewLute().BlockDOM2Tree(strings.ReplaceAll(html, editor.FrontEndCaret, ""))
		var paragraph *ast.Node
		for node := fragment.Root.FirstChild; node != nil; node = node.Next {
			if node.Type == ast.NodeKramdownBlockIAL {
				continue
			}
			if node.Type != ast.NodeParagraph || paragraph != nil {
				return fmt.Errorf("primary keys support inline elements only")
			}
			paragraph = node
		}
		if paragraph == nil {
			return fmt.Errorf("primary key paragraph is missing")
		}
		if tx != nil && tx.degradeCrossBoundaryBlockRefs(paragraph, boxID) != 0 {
			return fmt.Errorf("primary key reference crosses an encrypted notebook boundary")
		}
		source, err := render.NewDocumentTitle(paragraph)
		if err != nil {
			return err
		}
		if suppliedSource != nil {
			// BlockDOM 会合并嵌套的行级样式，按同一渲染往返比较，接受响应原样提交并保留原始源。
			expected := &av.ValueBlock{Rich: suppliedSource}
			if err = expected.NormalizeRichContent(); err != nil {
				return err
			}
			expectedTree := util.NewLute().BlockDOM2Tree(expected.RichBlockDOM)
			canonical, canonicalErr := render.NewDocumentTitle(expectedTree.Root.FirstChild)
			if canonicalErr != nil || source.Content != canonical.Content {
				return fmt.Errorf("primary key sources disagree")
			}
			source = suppliedSource
		}
		updated.Block.Rich = source
		updated.Block.Content = treenode.DocumentTitleText(paragraph)
		if text, plain := treenode.PlainDocumentTitle(paragraph); plain {
			updated.Block.Rich = nil
			updated.Block.Content = text
		}
	} else if !hasRich && previous != nil && previous.Block != nil && previous.Block.Rich != nil &&
		updated.Block.Content != previous.Block.Content {
		return fmt.Errorf("rich primary keys require a source-aware update; explicitly pass rich null to replace with plain text")
	}
	updated.Block.RichBlockDOM = ""
	if updated.Block.Rich != nil && tx != nil {
		paragraph, err := parse.ParseDocumentTitle(updated.Block.Rich)
		if err != nil {
			return err
		}
		if tx.degradeCrossBoundaryBlockRefs(paragraph, boxID) != 0 {
			return fmt.Errorf("primary key reference crosses an encrypted notebook boundary")
		}
	}
	return updated.Block.NormalizeRichContent()
}

// 动态主键复制来源的合法行级源，静态锚文本以数据库保存的源为准，不反向改写来源块。
func refreshAttributeViewPrimarySource(value *av.Value, node *ast.Node, avID string) bool {
	if value == nil || value.Block == nil || value.IsDetached || node == nil {
		return false
	}
	before := *value.Block
	icon, content := getNodeAvBlockText(node, avID)
	content = util.UnescapeHTML(content)
	subtype := getNodeAvBlockRefSubtype(node, avID)
	if value.Block.RefSubtype == av.BlockRefSubtypeStatic && value.Block.Rich != nil &&
		node.IALAttr(av.NodeAttrViewStaticText+"-"+avID) == util.EscapeHTML(value.Block.Content) {
		subtype = av.BlockRefSubtypeStatic
	}
	value.Block.Icon = icon
	if subtype == av.BlockRefSubtypeStatic {
		if value.Block.Rich == nil || value.Block.Content != content && node.IALAttr(av.NodeAttrViewStaticText+"-"+avID) != "" {
			value.Block.Rich = nil
			value.Block.Content = content
		}
	} else {
		value.Block.Content = content
		value.Block.Rich = attributeViewNodePrimaryRich(node)
	}
	value.Block.RefSubtype = subtype
	_ = value.Block.NormalizeRichContent()
	return before.Icon != value.Block.Icon || before.Content != value.Block.Content || before.RefSubtype != value.Block.RefSubtype ||
		!reflect.DeepEqual(before.Rich, value.Block.Rich)
}

// 同一文档中的绑定条目共用一次认证读取和遍历，避免逐行重复解析整个文档。
func refreshAttributeViewPrimarySources(database *av.AttributeView) (changed bool) {
	primary := database.GetBlockKeyValues()
	if primary == nil {
		return
	}
	rows := map[string][]*av.Value{}
	var ids []string
	for _, value := range primary.Values {
		if value == nil || value.Block == nil || value.IsDetached || !ast.IsNodeIDPattern(value.Block.ID) {
			continue
		}
		if rows[value.Block.ID] == nil {
			ids = append(ids, value.Block.ID)
		}
		rows[value.Block.ID] = append(rows[value.Block.ID], value)
	}
	_, boxID := database.StoragePath()
	documents := map[string]*treenode.BlockTree{}
	for start := 0; start < len(ids); start += 512 {
		for _, block := range treenode.GetBlockTreesInBox(ids[start:min(start+512, len(ids))], boxID) {
			if boxID != "" && block.BoxID != boxID || boxID == "" && IsEncryptedBox(block.BoxID) {
				continue
			}
			documents[block.BoxID+"\x00"+block.Path] = block
		}
	}
	for _, block := range documents {
		tree, err := loadTreeByBlockTree(block)
		if err != nil || tree == nil {
			continue
		}
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				for _, value := range rows[node.ID] {
					changed = refreshAttributeViewPrimarySource(value, node, database.ID) || changed
				}
			}
			return ast.WalkContinue
		})
	}
	return
}

func attributeViewNodePrimaryRich(node *ast.Node) *ast.DocumentTitle {
	if node == nil || strings.TrimSpace(node.IALAttr("name")) != "" {
		return nil
	}
	var paragraph *ast.Node
	if node.Type == ast.NodeDocument {
		if node.DocumentTitle == nil {
			return nil
		}
		copy := *node.DocumentTitle
		return &copy
	}
	if node.Type != ast.NodeParagraph && node.Type != ast.NodeHeading {
		return nil
	}
	copy := *node
	copy.Type, copy.ID, copy.KramdownIAL, copy.Parent = ast.NodeParagraph, "", nil, nil
	paragraph = &copy
	if _, plain := treenode.PlainDocumentTitle(paragraph); plain {
		return nil
	}
	source, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		return nil
	}
	return source
}
