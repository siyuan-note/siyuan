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
	filtered := FilterHandlerIALAttrs(ial)
	if 2 != len(filtered) || "20260101000000-abcdefg" != filtered["id"] || "bar" != filtered["custom-foo"] {
		t.Fatalf("unexpected filtered IAL: %v", filtered)
	}
	if 4 != len(ial) {
		t.Fatalf("filtering must not mutate the input: %v", ial)
	}
}

// TestBlockAttrsOperationDropsHandlerIAL 覆盖 updateAttrs 推送：历史数据里的处理器属性不能随推送下发给客户端。
func TestBlockAttrsOperationDropsHandlerIAL(t *testing.T) {
	node := &ast.Node{ID: "20260101000000-abcdefg", Type: ast.NodeParagraph}
	node.KramdownIAL = [][]string{
		{"id", node.ID},
		{"bookmark", "x"},
		{"onmouseover", "window.xssFired=true"},
	}
	operation := blockAttrsOperation(map[string]string{"bookmark": "old", "onmouseover": "old"}, node)
	data := operation.Data.(map[string]any)
	newAttrs := data["new"].(map[string]string)
	if _, ok := newAttrs["onmouseover"]; ok {
		t.Fatalf("push payload must not carry handler attributes: %v", newAttrs)
	}
	if "x" != newAttrs["bookmark"] {
		t.Fatalf("push payload lost regular attributes: %v", newAttrs)
	}
	// old 保留处理器属性，客户端据此清理元素上已有的同名属性
	if _, ok := data["old"].(map[string]string)["onmouseover"]; !ok {
		t.Fatal("old attributes should keep handler names so clients remove stale attributes")
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

// TestExportPreviewDropsInlineHandlerIAL 覆盖内联 IAL（.sy 中的真实属性列表）中的事件处理器属性。
// Lute 渲染器已经过滤这类属性，内核在渲染前仍然过滤，覆盖旧版 Lute 与历史数据。
func TestExportPreviewDropsInlineHandlerIAL(t *testing.T) {
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte("**bold**{: onmouseover=\"window.xssFired=true\"}\n"), luteEngine.ParseOptions)
	if !hasHandlerIAL(tree.Root) {
		t.Fatal("test fixture should keep the handler attribute in the tree")
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
