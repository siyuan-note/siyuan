// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// newEncryptedImportRefFixture 构造一棵含两个块引的加密笔记本导入文档：
// inPackageRef 指向包内块，externalRef 指向包外块。
func newEncryptedImportRefFixture(t *testing.T, boxID, inPackageRef, externalRef string) (tree *parse.Tree, refs []*ast.Node) {
	t.Helper()

	root := &ast.Node{Type: ast.NodeDocument, ID: ast.NewNodeID()}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: ast.NewNodeID()}
	root.AppendChild(paragraph)
	for _, target := range []string{inPackageRef, externalRef} {
		ref := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref"}
		ref.TextMarkBlockRefID = target
		ref.TextMarkBlockRefSubtype = "s"
		ref.TextMarkTextContent = "anchor"
		paragraph.AppendChild(ref)
		refs = append(refs, ref)
	}
	return &parse.Tree{ID: root.ID, Box: boxID, Root: root}, refs
}

func TestDegradeCrossBoundaryBlockRefsWithAllowed(t *testing.T) {
	const (
		encryptedBoxID = "20260911150000-encbox0"
		inPackageID    = "20260911150001-inpack1"
		externalID     = "20260911150002-outpk01"
	)
	tree, refs := newEncryptedImportRefFixture(t, encryptedBoxID, inPackageID, externalID)

	// 模拟导入时的块 ID 重建：包内块 ID 已知但尚未入库
	allowed := map[string]bool{inPackageID: true}
	if degraded := degradeCrossBoundaryBlockRefsWithAllowed(tree.Root, tree.Box, nil, allowed); 1 != degraded {
		t.Fatalf("expected exactly one degraded reference, got %d", degraded)
	}
	if refs[0].TextMarkBlockRefID != inPackageID || "s" != refs[0].TextMarkBlockRefSubtype {
		t.Fatalf("reference inside the archive must survive, got id=%q subtype=%q",
			refs[0].TextMarkBlockRefID, refs[0].TextMarkBlockRefSubtype)
	}
	if refs[1].TextMarkBlockRefID != "" || "" != refs[1].TextMarkBlockRefSubtype {
		t.Fatalf("reference outside the archive must degrade to plain text, got id=%q", refs[1].TextMarkBlockRefID)
	}
	if "anchor" != refs[1].TextMarkTextContent {
		t.Fatalf("degraded reference must keep its anchor text, got %q", refs[1].TextMarkTextContent)
	}

	// 不放行任何块时，包内引用同样按跨边界处理（回到原有语义）
	tree2, _ := newEncryptedImportRefFixture(t, encryptedBoxID, inPackageID, externalID)
	if degraded := degradeCrossBoundaryBlockRefsWithAllowed(tree2.Root, tree2.Box, nil, nil); 2 != degraded {
		t.Fatalf("without allowed block IDs both references should degrade, got %d", degraded)
	}
}
