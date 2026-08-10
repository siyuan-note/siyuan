// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNormalizeHTMLAssetName(t *testing.T) {
	if got, err := normalizeHTMLAssetName(nil); err != nil || got != "component.html" {
		t.Fatalf("default HTML asset name = %q, %v", got, err)
	}
	if got, err := normalizeHTMLAssetName("../Widget.HTM"); err != nil || got != "Widget.HTM" {
		t.Fatalf("normalized HTML asset name = %q, %v", got, err)
	}
	if _, err := normalizeHTMLAssetName("component.xhtml"); err == nil {
		t.Fatal("XHTML asset name must be rejected")
	}
}

func TestHTMLAssetIFrameBlockDOM(t *testing.T) {
	dom, blockID, err := htmlAssetIFrameBlockDOM("assets/component.html?box=box-id")
	if err != nil {
		t.Fatal(err)
	}
	if blockID == "" {
		t.Fatal("IFrame block ID is empty")
	}
	if !strings.Contains(dom, `sandbox="allow-scripts"`) || strings.Contains(dom, "allow-same-origin") {
		t.Fatalf("IFrame sandbox is unsafe: %s", dom)
	}
	if !strings.Contains(dom, "iframe=true") {
		t.Fatalf("IFrame source is missing the render marker: %s", dom)
	}
	tree := util.NewLute().BlockDOM2Tree(dom)
	if tree.Root.FirstChild == nil || tree.Root.FirstChild.Type != ast.NodeIFrame {
		t.Fatalf("created block is not an IFrame: %s", dom)
	}
}
