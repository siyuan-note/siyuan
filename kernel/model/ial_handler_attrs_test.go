// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIsValidAttrNameRejectsHandlerAttr(t *testing.T) {
	for _, name := range []string{"onmouseover", "onclick", "onerror", "on"} {
		if isValidAttrName(name) {
			t.Fatalf("handler attribute name [%s] should be rejected", name)
		}
	}
	for _, name := range []string{"updated", "custom-onload", "data-onclick", "title-img"} {
		if !isValidAttrName(name) {
			t.Fatalf("attribute name [%s] should be accepted", name)
		}
	}
}

func TestFilterHandlerIALAttrs(t *testing.T) {
	ial := map[string]string{
		"id":          "20260101000000-abcdefg",
		"onmouseover": "window.xssFired=true",
		"OnClick":     "window.xssFired=true",
		"custom-foo":  "bar",
	}
	filtered := filterHandlerIALAttrs(ial)
	if 2 != len(filtered) || "20260101000000-abcdefg" != filtered["id"] || "bar" != filtered["custom-foo"] {
		t.Fatalf("unexpected filtered IAL: %v", filtered)
	}
	if 4 != len(ial) {
		t.Fatalf("filtering must not mutate the input: %v", ial)
	}
}

func hasHandlerIAL(root *ast.Node) bool {
	found := false
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		for _, kv := range node.KramdownIAL {
			if 2 <= len(kv) && isHandlerAttrName(kv[0]) {
				found = true
			}
		}
		return ast.WalkContinue
	})
	return found
}

// TestExportPreviewDropsHandlerIAL 覆盖 Markdown 导入文本被预览往返提升为 IAL 属性后，预览 HTML 不再包含事件处理器属性。
func TestExportPreviewDropsHandlerIAL(t *testing.T) {
	const source = "Quarterly figures look fine.\n{: onmouseover=\"window.xssFired=true\"}\n"

	// Markdown 导入不启用 kramdown IAL，属性列表这一行先作为普通文本保存
	stdLute := util.NewStdLute()
	tree := parse.Parse("", []byte(source), stdLute.ParseOptions)
	if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
		t.Fatal("failed to parse the test document")
	}
	if 0 != len(tree.Root.FirstChild.KramdownIAL) {
		t.Fatal("Markdown import should keep the attribute list as plain text")
	}

	luteEngine := util.NewLute()
	previewTree := normalizeExportPreviewTree(tree, luteEngine)
	if !hasHandlerIAL(previewTree.Root) {
		t.Fatal("preview round-trip should promote the attribute list text to IAL")
	}

	unfiltered := luteEngine.ProtylePreview(previewTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	if !strings.Contains(strings.ToLower(unfiltered), "onmouseover") {
		t.Fatalf("test fixture did not reproduce the handler attribute injection: %s", unfiltered)
	}

	filterHandlerIALInTree(previewTree.Root)
	if hasHandlerIAL(previewTree.Root) {
		t.Fatal("handler attributes should be removed from the tree")
	}
	html := luteEngine.ProtylePreview(previewTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	if strings.Contains(strings.ToLower(html), "onmouseover") || strings.Contains(html, "xssFired") {
		t.Fatalf("preview HTML still contains a handler attribute: %s", html)
	}
	if !strings.Contains(html, "Quarterly figures look fine.") {
		t.Fatalf("preview lost the document body: %s", html)
	}
}

// TestExportPreviewDropsInlineHandlerIAL 覆盖内联 IAL（.sy 中的真实属性列表）被预览渲染为元素属性后的过滤。
func TestExportPreviewDropsInlineHandlerIAL(t *testing.T) {
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte("**bold**{: onmouseover=\"window.xssFired=true\"}\n"), luteEngine.ParseOptions)
	unfiltered := luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	if !strings.Contains(strings.ToLower(unfiltered), "onmouseover") {
		t.Fatalf("test fixture did not reproduce the inline handler attribute: %s", unfiltered)
	}

	filterHandlerIALInTree(tree.Root)
	html := luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	if strings.Contains(strings.ToLower(html), "onmouseover") || strings.Contains(html, "xssFired") {
		t.Fatalf("preview HTML still contains an inline handler attribute: %s", html)
	}
	if !strings.Contains(html, "<strong>bold</strong>") {
		t.Fatalf("preview lost the inline markup: %s", html)
	}
}
