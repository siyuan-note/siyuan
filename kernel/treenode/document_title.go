// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"errors"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
)

const DocumentTitleEmptyAttr = "custom-sy-title-empty"
const RichDocumentTitleSpec = "7"

var ErrRichDocumentTitleWrite = errors.New("rich document titles require a source-aware title operation")

// DocumentTitle 是标题源的只读摘要，不能用它覆盖未来格式的完整源内容。
type DocumentTitle struct {
	Format string `json:"format"`
	Text   string `json:"text"`
	Empty  bool   `json:"empty"`
}

// ReadDocumentTitle 只提取已经通过源格式检查的文档标题，不解释 Markdown 或重复解码属性。
// 空标题标志与实际保存的占位文字分别保留，源文档版本由调用方从根节点读取。
func ReadDocumentTitle(root *ast.Node) DocumentTitle {
	format := "plain"
	if root.DocumentTitle != nil {
		format = "inline-ast"
	}
	return DocumentTitle{
		Format: format,
		Text:   root.IALAttr("title"),
		Empty:  root.IALAttr(DocumentTitleEmptyAttr) == "true",
	}
}

// DocumentTitleParagraph 返回独立行级片段，临时父节点仅用于确定引用与资源所属文档。
func DocumentTitleParagraph(root *ast.Node) (*ast.Node, error) {
	if root == nil || root.Type != ast.NodeDocument {
		return nil, errors.New("document title requires a document root")
	}
	var paragraph *ast.Node
	if root.DocumentTitle != nil {
		var err error
		paragraph, err = parse.ParseDocumentTitle(root.DocumentTitle)
		if err != nil {
			return nil, err
		}
	} else {
		paragraph = &ast.Node{Type: ast.NodeParagraph}
		title := ReadDocumentTitle(root)
		if !title.Empty && title.Text != "" {
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(title.Text)})
		}
	}
	paragraph.ID, paragraph.KramdownIAL = "", nil
	paragraph.Parent = root
	return paragraph, nil
}

// SetDocumentTitleParagraph 先验证完整片段，再一次替换源及派生摘要，不修改正文子块。
func SetDocumentTitleParagraph(root, paragraph *ast.Node) error {
	if root == nil || root.Type != ast.NodeDocument {
		return errors.New("document title requires a document root")
	}
	source, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		return err
	}
	if text, plain := PlainDocumentTitle(paragraph); plain {
		root.DocumentTitle = nil
		root.SetIALAttr("title", text)
		if text == "" {
			root.SetIALAttr(DocumentTitleEmptyAttr, "true")
		} else {
			root.RemoveIALAttr(DocumentTitleEmptyAttr)
		}
		return nil
	}
	root.DocumentTitle = source
	return RefreshDocumentTitle(root)
}

// PlainDocumentTitle 仅折叠可无损还原的普通文字，样式、资源、引用及行内换行继续保存完整源。
func PlainDocumentTitle(paragraph *ast.Node) (string, bool) {
	var text strings.Builder
	for node := paragraph.FirstChild; node != nil; node = node.Next {
		if node.Type != ast.NodeText || len(node.KramdownIAL) != 0 || node.FirstChild != nil {
			return "", false
		}
		text.Write(node.Tokens)
	}
	value := text.String()
	return value, value == DocumentTitleText(paragraph)
}

// RefreshDocumentTitle 只从已验证的完整源刷新摘要，空占位文字不进入源。
func RefreshDocumentTitle(root *ast.Node) error {
	if root.DocumentTitle == nil {
		return nil
	}
	paragraph, err := DocumentTitleParagraph(root)
	if err != nil {
		return err
	}
	root.SetIALAttr("title", DocumentTitleText(paragraph))
	if paragraph.FirstChild == nil {
		root.SetIALAttr(DocumentTitleEmptyAttr, "true")
	} else {
		root.RemoveIALAttr(DocumentTitleEmptyAttr)
	}
	return nil
}

// DocumentTitleText 提取可见文字，保留图片替代文本与公式，不把备注正文或资源地址写入摘要。
func DocumentTitleText(paragraph *ast.Node) string {
	var text strings.Builder
	ast.Walk(paragraph, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		switch node.Type {
		case ast.NodeText, ast.NodeLinkText, ast.NodeBackslashContent, ast.NodeEmojiUnicode,
			ast.NodeEmojiAlias, ast.NodeCodeSpanContent, ast.NodeInlineMathContent:
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
	// BlockDOM 在代码、标签和键盘样式旁使用零宽空格放置光标；摘要不显示它们。
	// 只处理派生文字，完整源及其中的资源地址、用户单词连接符保持不变。
	visible := strings.ReplaceAll(text.String(), "\u200b", "")
	return strings.ReplaceAll(strings.ReplaceAll(visible, "\r", " "), "\n", " ")
}

// DocumentTitleRevision 排除动态锚文本缓存，样式和引用身份变化仍会影响并发写入版本。
func DocumentTitleRevision(root *ast.Node) string {
	if root.DocumentTitle == nil {
		return DocumentRevision(ReadDocumentTitle(root))
	}
	paragraph, err := DocumentTitleParagraph(root)
	if err != nil {
		return DocumentRevision(root.DocumentTitle)
	}
	ast.Walk(paragraph, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(node) && node.TextMarkBlockRefSubtype == "d" {
			node.TextMarkTextContent = ""
		}
		return ast.WalkContinue
	})
	source, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		return DocumentRevision(root.DocumentTitle)
	}
	return DocumentRevision(source)
}

func ValidateDocumentTitle(root *ast.Node) (err error) {
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || node.DocumentTitle == nil {
			return ast.WalkContinue
		}
		if node != root || node.Type != ast.NodeDocument {
			err = errors.New("rich title source belongs to the document root")
		} else {
			_, err = parse.ParseDocumentTitle(node.DocumentTitle)
		}
		if err != nil {
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

// DocumentTitleFromProperties 接受已经解码的根属性，与节点读取使用相同的摘要语义。
func DocumentTitleFromProperties(properties map[string]string) DocumentTitle {
	return DocumentTitle{Format: "plain", Text: properties["title"], Empty: properties[DocumentTitleEmptyAttr] == "true"}
}
