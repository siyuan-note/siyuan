// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/render"
	"github.com/dgraph-io/ristretto"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/net/html"
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
	var suppliedSource *av.ValuePrimaryRich
	if hasRich && strings.TrimSpace(string(payload.Block["rich"])) != "null" {
		if err := json.Unmarshal(payload.Block["rich"], &suppliedSource); err != nil {
			return err
		}
		if _, err := av.ParsePrimaryRich(suppliedSource); err != nil {
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
		if err := validatePrimaryRichBlockDOM(html); err != nil {
			return err
		}
		fragment := util.NewLute().BlockDOM2Tree(strings.ReplaceAll(html, editor.FrontEndCaret, ""))
		if tx != nil && tx.degradeCrossBoundaryBlockRefs(fragment.Root, boxID) != 0 {
			return fmt.Errorf("primary key reference crosses an encrypted notebook boundary")
		}
		source, err := av.NewPrimaryRich(fragment)
		if err != nil {
			return err
		}
		if suppliedSource != nil {
			// 双源按同一 Kramdown 往返比较，原样提交保留旧源格式。
			expected := &av.ValueBlock{Rich: suppliedSource}
			if err = expected.NormalizeRichContent(); err != nil {
				return err
			}
			expectedTree := util.NewLute().BlockDOM2Tree(expected.RichBlockDOM)
			canonical, canonicalErr := av.NewPrimaryRich(expectedTree)
			if canonicalErr != nil || source.Content != canonical.Content {
				return fmt.Errorf("primary key sources disagree")
			}
			source = suppliedSource
		}
		updated.Block.Rich = source
		var blocks []*ast.Node
		for node := fragment.Root.FirstChild; node != nil; node = node.Next {
			if node.Type != ast.NodeKramdownBlockIAL {
				blocks = append(blocks, node)
			}
		}
		if len(blocks) == 0 {
			updated.Block.Rich = nil
			updated.Block.Content = ""
		}
		if len(blocks) == 1 && blocks[0].Type == ast.NodeParagraph {
			if text, plain := treenode.PlainDocumentTitle(blocks[0]); plain && !strings.ContainsAny(text, "\r\n") {
				updated.Block.Rich = nil
				updated.Block.Content = text
			}
		}
	} else if !hasRich && previous != nil && previous.Block != nil && previous.Block.Rich != nil &&
		updated.Block.Content != previous.Block.Content {
		return fmt.Errorf("rich primary keys require a source-aware update; explicitly pass rich null to replace with plain text")
	}
	updated.Block.RichBlockDOM = ""
	if updated.Block.Rich != nil && tx != nil {
		fragment, err := av.ParsePrimaryRich(updated.Block.Rich)
		if err != nil {
			return err
		}
		if tx.degradeCrossBoundaryBlockRefs(fragment.Root, boxID) != 0 {
			return fmt.Errorf("primary key reference crosses an encrypted notebook boundary")
		}
	}
	return updated.Block.NormalizeRichContent()
}

// 转换器可能丢弃空的未知块，先检查声明的块类型，避免把非法输入当作清空。
func validatePrimaryRichBlockDOM(blockDOM string) error {
	tokens := html.NewTokenizer(strings.NewReader(blockDOM))
	for {
		switch tokens.Next() {
		case html.ErrorToken:
			if tokens.Err() == io.EOF {
				return nil
			}
			return tokens.Err()
		case html.StartTagToken, html.SelfClosingTagToken:
			for _, attr := range tokens.Token().Attr {
				if attr.Key != "data-type" || !strings.HasPrefix(attr.Val, "Node") {
					continue
				}
				switch attr.Val {
				case "NodeParagraph", "NodeHeading", "NodeList", "NodeListItem", "NodeBlockquote", "NodeCodeBlock", "NodeMathBlock":
				default:
					return fmt.Errorf("unsupported primary key block [%s]", attr.Val)
				}
			}
		}
	}
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
	staticText := node.IALAttr(av.NodeAttrViewStaticText + "-" + avID)
	// 静态锚文本写入时会裁剪首尾空白，富文本换行的纯文本投影仍保留这些空白。
	trimmedContent := strings.TrimSpace(value.Block.Content)
	if value.Block.RefSubtype == av.BlockRefSubtypeStatic && value.Block.Rich != nil &&
		(staticText == util.EscapeHTML(value.Block.Content) || staticText == util.EscapeHTML(trimmedContent)) {
		subtype = av.BlockRefSubtypeStatic
	}
	value.Block.Icon = icon
	if subtype == av.BlockRefSubtypeStatic {
		if value.Block.Rich == nil || value.Block.Content != content && trimmedContent != content && staticText != "" {
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
	type documentSources struct {
		block    *treenode.BlockTree
		rootOnly bool
	}
	documents := map[string]documentSources{}
	for start := 0; start < len(ids); start += 512 {
		for _, block := range treenode.GetBlockTreesInBox(ids[start:min(start+512, len(ids))], boxID) {
			if boxID != "" && block.BoxID != boxID || boxID == "" && IsEncryptedBox(block.BoxID) {
				continue
			}
			key := block.BoxID + "\x00" + block.Path
			if doc, found := documents[key]; !found || block.ID != block.RootID && doc.rootOnly {
				documents[key] = documentSources{block, block.ID == block.RootID}
			}
		}
	}
	for _, doc := range documents {
		if doc.rootOnly && boxID == "" {
			if root := loadAttributeViewDocumentPrimarySource(doc.block); root != nil {
				for _, value := range rows[root.ID] {
					changed = refreshAttributeViewPrimarySource(value, root, database.ID) || changed
				}
			}
			continue
		}
		tree, err := loadTreeByBlockTree(doc.block)
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

type attributeViewDocumentPrimarySource struct {
	version uint64
	root    *ast.Node
}

var attributeViewDocumentPrimaryCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 16384,
	MaxCost:     4 * 1024 * 1024,
	BufferItems: 64,
})

func loadAttributeViewDocumentPrimarySource(block *treenode.BlockTree) *ast.Node {
	key := util.DataDir + "\x00" + block.BoxID + "\x00" + block.Path
	var previous attributeViewDocumentPrimarySource
	if entry, ok := attributeViewDocumentPrimaryCache.Get(key); ok {
		previous = entry.(attributeViewDocumentPrimarySource)
	}
	tree, needFix, version, err := filesys.LoadTreeWithSourceVersion(block.BoxID, block.Path, util.NewLute(), previous.version)
	if err != nil {
		return nil
	}
	if tree == nil {
		return previous.root
	}
	if needFix {
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	root := tree.Root
	if version == 0 || root.Type != ast.NodeDocument || root.ID != block.RootID {
		return root
	}
	// 空标题的锚文本可能取自正文图片，必须保留完整文档参与计算。
	if root.IALAttr("name") == "" && strings.TrimSpace(util.UnescapeHTML(root.IALAttr("title"))) == "" {
		return root
	}
	// 主键依赖文档根属性和标题源；正文块及跨文档派生结果不进入缓存。
	snapshot := &ast.Node{Type: ast.NodeDocument, ID: strings.Clone(root.ID)}
	cost := int64(len(key) + len(root.ID) + 1024)
	for _, attr := range root.KramdownIAL {
		name, value := attr[0], attr[1]
		if name == "title" || name == "name" || name == "icon" || strings.HasPrefix(name, av.NodeAttrViewStaticText+"-") {
			snapshot.SetIALAttr(strings.Clone(name), strings.Clone(value))
			cost += int64(len(name) + len(value) + 64)
		}
	}
	if root.DocumentTitle != nil {
		title := *root.DocumentTitle
		title.Format, title.Content = strings.Clone(title.Format), strings.Clone(title.Content)
		snapshot.DocumentTitle = &title
		cost += int64(len(title.Content))
	}
	attributeViewDocumentPrimaryCache.Set(key, attributeViewDocumentPrimarySource{version, snapshot}, cost)
	return root
}

func attributeViewNodePrimaryRich(node *ast.Node) *av.ValuePrimaryRich {
	if node == nil || strings.TrimSpace(node.IALAttr("name")) != "" {
		return nil
	}
	var paragraph *ast.Node
	if node.Type == ast.NodeDocument {
		if node.DocumentTitle == nil {
			return nil
		}
		return av.PrimaryRichFromTitle(node.DocumentTitle)
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
	return av.PrimaryRichFromTitle(source)
}
