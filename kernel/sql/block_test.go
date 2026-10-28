// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestNodeStaticContentDecodesTextMarkContent(t *testing.T) {
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{
		Type:                    ast.NodeTextMark,
		TextMarkType:            "block-ref",
		TextMarkTextContent:     "123foo&amp;bar",
		TextMarkBlockRefID:      "20260714120000-abcdefg",
		TextMarkBlockRefSubtype: "s",
	})

	content := nodeStaticContent(paragraph, nil, true, false, true, true)
	if "123foo&bar" != content {
		t.Fatalf("unexpected static content: %q", content)
	}

	content = NodeStaticContent(paragraph, nil, true, false, true)
	if "123foo&bar" != content {
		t.Fatalf("unexpected generic static content: %q", content)
	}
}

func TestNodeStaticContentCustomBlockUsesRawTokens(t *testing.T) {
	const content = "((20260830000000-ref0001 \"reference\"))\n![image](assets/chart.png)\nA&amp;B"
	node := &ast.Node{Type: ast.NodeCustomBlock, Tokens: []byte(content)}
	node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("parsed child must be ignored")})

	if actual := NodeStaticContent(node, nil, true, true, true); content != actual {
		t.Fatalf("expected raw custom block content %q, got %q", content, actual)
	}
	if actual := NodeStaticContent(node, []string{ast.NodeCustomBlock.String()}, true, true, true); "" != actual {
		t.Fatalf("expected excluded custom block content to be empty, got %q", actual)
	}
}

func TestCustomBlockIndexingKeepsPayloadOpaque(t *testing.T) {
	const (
		rootID  = "20260830000000-root001"
		blockID = "20260830000000-custom1"
		refID   = "20260830000000-ref0001"
		content = "((20260830000000-ref0001 \"reference\"))\n![image](assets/chart.png)"
	)
	root := &ast.Node{Type: ast.NodeDocument, ID: rootID}
	root.SetIALAttr("id", rootID)
	root.SetIALAttr("title", "Document")
	customBlock := &ast.Node{Type: ast.NodeCustomBlock, ID: blockID, CustomBlockInfo: "example-plugin/chart", Tokens: []byte(content)}
	customBlock.SetIALAttr("id", blockID)
	customBlock.SetIALAttr("updated", blockID[:14])
	root.AppendChild(customBlock)

	customBlock.AppendChild(&ast.Node{
		Type:                    ast.NodeTextMark,
		TextMarkType:            "block-ref",
		TextMarkTextContent:     "reference",
		TextMarkBlockRefID:      refID,
		TextMarkBlockRefSubtype: "s",
	})
	image := &ast.Node{Type: ast.NodeImage}
	image.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte("image")})
	image.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/chart.png")})
	customBlock.AppendChild(image)

	tree := &parse.Tree{Root: root, ID: rootID, Box: "20260830000000-box001", Path: "/" + rootID + ".sy", HPath: "/Document"}
	blocks, spans, assets, _ := fromTree(root, tree)
	var indexed *Block
	for _, block := range blocks {
		if blockID == block.ID {
			indexed = block
			break
		}
	}
	if nil == indexed {
		t.Fatal("custom block was not indexed")
	}
	if "custom" != indexed.Type || content != indexed.Content {
		t.Fatalf("unexpected indexed custom block: type=%q, content=%q", indexed.Type, indexed.Content)
	}
	if 0 != len(spans) || 0 != len(assets) {
		t.Fatalf("custom block payload produced spans or assets: spans=%d, assets=%d", len(spans), len(assets))
	}

	refs, fileAnnotationRefs := refsFromTree(tree)
	if 0 != len(refs) || 0 != len(fileAnnotationRefs) {
		t.Fatalf("custom block payload produced references: refs=%d, fileAnnotationRefs=%d", len(refs), len(fileAnnotationRefs))
	}
}
