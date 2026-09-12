// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
