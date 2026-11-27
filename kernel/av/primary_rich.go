// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const PrimaryRichSpec = 15
const PrimaryBlockRichSpec = 16

// inline-ast 读取格式 15 的主键；新编辑源与文本字段共用 Kramdown 片段结构。
type ValuePrimaryRich struct {
	Spec    int    `json:"spec"`
	Format  string `json:"format"`
	Content string `json:"content"`
}

func PrimaryRichFromTitle(title *ast.DocumentTitle) *ValuePrimaryRich {
	if title == nil {
		return nil
	}
	return &ValuePrimaryRich{Spec: title.Spec, Format: "inline-ast", Content: title.Content}
}

func ParsePrimaryRich(source *ValuePrimaryRich) (*parse.Tree, error) {
	if source == nil {
		return nil, nil
	}
	if source.Format == "kramdown" {
		_, tree, err := parseValueTextRichWithImages(&ValueTextRich{Spec: source.Spec, Format: ValueTextRichFormatKramdown, Content: source.Content}, true)
		return tree, err
	}
	if source.Format != "inline-ast" {
		return nil, fmt.Errorf("unsupported primary rich text format [%s]", source.Format)
	}
	paragraph, err := parse.ParseDocumentTitle(&ast.DocumentTitle{Spec: source.Spec, Format: "inline-ast", Content: source.Content})
	if err != nil {
		return nil, err
	}
	tree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, Context: &parse.Context{ParseOption: util.NewLute().ParseOptions}}
	tree.Root.AppendChild(paragraph)
	return tree, nil
}

func NewPrimaryRich(tree *parse.Tree) (*ValuePrimaryRich, error) {
	if err := validateValueTextRichTreeWithImages(tree, true); err != nil {
		return nil, err
	}
	content, _, err := normalizeValueTextRichTreeSourceWithImages(tree, true)
	if err != nil {
		return nil, err
	}
	return &ValuePrimaryRich{Spec: ValueTextRichSpec, Format: "kramdown", Content: content}, nil
}

// RichValueTree 只从已标记的完整源构造片段，普通文字中的 Markdown 字符保持字面含义。
func RichValueTree(value *Value) (*parse.Tree, error) {
	if value == nil {
		return nil, nil
	}
	if value.Text != nil && value.Text.Rich != nil {
		return ParseValueTextRich(value.Text.Rich)
	}
	if value.Block == nil || value.Block.Rich == nil {
		return nil, nil
	}
	return ParsePrimaryRich(value.Block.Rich)
}

func SetRichValueTree(value *Value, tree *parse.Tree) error {
	if value == nil || tree == nil || tree.Root == nil {
		return fmt.Errorf("rich value source is missing")
	}
	if value.Text != nil && (value.Type == KeyTypeText || value.Text.Rich != nil) {
		content, err := RenderValueTextRich(tree)
		if err != nil {
			return err
		}
		text := *value.Text
		text.Rich = &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if err = text.NormalizeRichContent(); err != nil {
			return err
		}
		*value.Text = text
		return nil
	}
	if value.Type != KeyTypeBlock || value.Block == nil {
		return fmt.Errorf("rich value type is unsupported")
	}
	var source *ValuePrimaryRich
	var err error
	if value.Block.Rich != nil && value.Block.Rich.Format == "inline-ast" {
		if tree.Root.FirstChild == nil || tree.Root.FirstChild != tree.Root.LastChild {
			return fmt.Errorf("legacy primary key requires one inline paragraph")
		}
		var title *ast.DocumentTitle
		title, err = render.NewDocumentTitle(tree.Root.FirstChild)
		source = PrimaryRichFromTitle(title)
	} else {
		source, err = NewPrimaryRich(tree)
	}
	if err != nil {
		return err
	}
	block := *value.Block
	block.Rich = source
	if err = block.NormalizeRichContent(); err != nil {
		return err
	}
	*value.Block = block
	return nil
}

// PrimaryRichText 与文档标题一样保留图片替代文字和公式，资源地址不进入筛选、排序及纯文本复制。
func PrimaryRichText(paragraph *ast.Node) string {
	var text strings.Builder
	ast.Walk(paragraph, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		switch node.Type {
		case ast.NodeText, ast.NodeLinkText, ast.NodeBackslashContent, ast.NodeEmojiUnicode, ast.NodeEmojiAlias,
			ast.NodeCodeSpanContent, ast.NodeInlineMathContent:
			text.Write(node.Tokens)
			return ast.WalkSkipChildren
		case ast.NodeHTMLEntity:
			text.WriteString(html.UnescapeString(node.TokensStr()))
		case ast.NodeTextMark:
			if node.IsTextMarkType("inline-math") {
				text.WriteString(html.UnescapeString(node.TextMarkInlineMathContent))
			} else {
				text.WriteString(html.UnescapeString(node.TextMarkTextContent))
			}
		case ast.NodeSoftBreak, ast.NodeHardBreak, ast.NodeBr:
			text.WriteByte(' ')
		}
		return ast.WalkContinue
	})
	return strings.NewReplacer("\u200b", "", "\r", " ", "\n", " ").Replace(text.String())
}

func (value *ValueBlock) NormalizeRichContent() error {
	if value == nil || value.Rich == nil {
		if value != nil {
			value.RichBlockDOM = ""
		}
		return nil
	}
	tree, err := ParsePrimaryRich(value.Rich)
	if err != nil {
		return err
	}
	engine := util.NewLute()
	if value.Rich.Format == "kramdown" {
		value.Content = valueTextRichPlainContent(tree)
		value.RichBlockDOM = engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions)
		return nil
	}
	paragraph := tree.Root.FirstChild
	// 临时载体不参与条目身份，固定标识使同一源的预览序列化稳定；编辑器另行分配自己的载体 ID。
	paragraph.ID = "20000101000000-primary"
	paragraph.SetIALAttr("id", paragraph.ID)
	value.Content = PrimaryRichText(paragraph)
	value.RichBlockDOM = engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions)
	return nil
}

func (database *AttributeView) HasPrimaryRich() bool {
	found := false
	database.VisitPersistedValues(func(value *Value) { found = found || value.Block != nil && value.Block.Rich != nil })
	return found
}

func (database *AttributeView) HasPrimaryBlockRich() bool {
	found := false
	database.VisitPersistedValues(func(value *Value) {
		found = found || value.Block != nil && value.Block.Rich != nil && value.Block.Rich.Format == "kramdown"
	})
	return found
}

func (database *AttributeView) NormalizePrimaryRich() error {
	type update struct {
		target *ValueBlock
		value  ValueBlock
	}
	var updates []update
	var result error
	database.VisitPersistedValues(func(value *Value) {
		if result != nil || value.Block == nil {
			return
		}
		copy := *value.Block
		if result = copy.NormalizeRichContent(); result == nil {
			updates = append(updates, update{value.Block, copy})
		}
	})
	if result != nil {
		return result
	}
	for _, update := range updates {
		*update.target = update.value
	}
	return nil
}

func (database *AttributeView) DiscardPrimaryRichDOM() (changed bool) {
	database.VisitPersistedValues(func(value *Value) {
		if value.Block != nil && value.Block.RichBlockDOM != "" {
			value.Block.RichBlockDOM = ""
			changed = true
		}
	})
	return
}

func (database *AttributeView) suspendPrimaryRichDOM() func() {
	type binding struct {
		value *ValueBlock
		dom   string
	}
	var bindings []binding
	database.VisitPersistedValues(func(value *Value) {
		if value.Block != nil && value.Block.RichBlockDOM != "" {
			bindings = append(bindings, binding{value.Block, value.Block.RichBlockDOM})
			value.Block.RichBlockDOM = ""
		}
	})
	return func() {
		for _, binding := range bindings {
			binding.value.RichBlockDOM = binding.dom
		}
	}
}
