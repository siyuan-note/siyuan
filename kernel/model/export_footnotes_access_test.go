// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func collectExportedBlockRefIDs(root *ast.Node) (ret []string) {
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if treenode.IsBlockRef(n) {
			id, _, _ := treenode.GetBlockRef(n)
			ret = append(ret, id)
		}
		return ast.WalkContinue
	})
	return
}

func exportFootnotesWithChecker(t *testing.T, source *parse.Tree, checker EmbedBlockAccessChecker) *parse.Tree {
	t.Helper()
	exported, err := exportTree(prepareExportTree(getExportBlockTree(source.ID)), treeExportOptions{
		Config: conf.Export{
			BlockRefMode:          4,
			BlockEmbedMode:        0,
			FileAnnotationRefMode: 0,
			TagOpenMarker:         "#",
			TagCloseMarker:        "#",
			AddTitle:              false,
			InlineMemo:            false,
		},
		WYSIWYG:          true,
		RichTableCells:   true,
		AddDocAnchorSpan: true,
		AccessCheckers:   []EmbedBlockAccessChecker{checker},
	})
	if err != nil {
		t.Fatal(err)
	}
	return exported
}

// TestExportFootnotesRespectAccessChecker 验证读者导出时不可访问的块引用不会进入脚注定义。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-qwg4-fj37-jjqq
func TestExportFootnotesRespectAccessChecker(t *testing.T) {
	const sourceBox = "20261105000000-box0001"
	const targetBox = "20261105000001-box0002"
	setupExportRelatedTest(t, sourceBox, targetBox)
	Conf.Editor.Store(conf.NewEditor())

	source := newFootnoteTestDoc(t, sourceBox, "source")
	publicTarget := newFootnoteTestDoc(t, targetBox, "PUBLIC_BODY_SENTINEL")
	protectedTarget := newFootnoteTestDoc(t, targetBox, "PROTECTED_BODY_SENTINEL")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(publicTarget.Root.FirstChild.ID))
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(protectedTarget.Root.FirstChild.ID))
	for _, tree := range []*parse.Tree{source, publicTarget, protectedTarget} {
		writeExportRelatedTestTree(t, tree)
	}

	exported := exportFootnotesWithChecker(t, source, func(id string) bool {
		return id != protectedTarget.Root.FirstChild.ID
	})

	defs := exported.Root.ChildrenByType(ast.NodeFootnotesDef)
	if 1 != len(defs) {
		t.Fatalf("footnote defs = %d, want 1", len(defs))
	}
	if !strings.Contains(defs[0].Text(), "PUBLIC_BODY_SENTINEL") {
		t.Fatalf("public footnote lost body: %s", defs[0].Text())
	}
	if strings.Contains(defs[0].Text(), "PROTECTED_BODY_SENTINEL") {
		t.Fatalf("protected footnote leaked body: %s", defs[0].Text())
	}
	for _, id := range collectExportedBlockRefIDs(exported.Root) {
		if id == protectedTarget.Root.FirstChild.ID {
			t.Fatal("protected block reference remains in exported tree")
		}
	}
}

// TestExportFootnotesSkipDeniedNestedRefs 验证脚注定义内部引用的受保护目标同样被跳过。
func TestExportFootnotesSkipDeniedNestedRefs(t *testing.T) {
	const sourceBox = "20261105000002-box0001"
	const targetBox = "20261105000003-box0002"
	setupExportRelatedTest(t, sourceBox, targetBox)
	Conf.Editor.Store(conf.NewEditor())

	source := newFootnoteTestDoc(t, sourceBox, "source")
	allowed := newFootnoteTestDoc(t, targetBox, "ALLOWED_BODY_SENTINEL")
	denied := newFootnoteTestDoc(t, targetBox, "DENIED_BODY_SENTINEL")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(allowed.Root.FirstChild.ID))
	allowed.Root.FirstChild.AppendChild(newFootnoteTestRef(denied.Root.FirstChild.ID))
	for _, tree := range []*parse.Tree{source, allowed, denied} {
		writeExportRelatedTestTree(t, tree)
	}

	exported := exportFootnotesWithChecker(t, source, func(id string) bool {
		return id != denied.Root.FirstChild.ID
	})

	defs := exported.Root.ChildrenByType(ast.NodeFootnotesDef)
	if 1 != len(defs) {
		t.Fatalf("footnote defs = %d, want 1", len(defs))
	}
	if !strings.Contains(defs[0].Text(), "ALLOWED_BODY_SENTINEL") {
		t.Fatalf("allowed footnote lost body: %s", defs[0].Text())
	}
	if strings.Contains(defs[0].Text(), "DENIED_BODY_SENTINEL") {
		t.Fatalf("nested protected footnote leaked body: %s", defs[0].Text())
	}
	for _, id := range collectExportedBlockRefIDs(exported.Root) {
		if id == denied.Root.FirstChild.ID {
			t.Fatal("nested protected block reference remains in exported tree")
		}
	}
}

// TestExportFootnotesOmitDeniedRefs 验证只引用不可访问目标时不生成脚注和块引用。
func TestExportFootnotesOmitDeniedRefs(t *testing.T) {
	const sourceBox = "20261105000004-box0001"
	const targetBox = "20261105000005-box0002"
	setupExportRelatedTest(t, sourceBox, targetBox)
	Conf.Editor.Store(conf.NewEditor())

	source := newFootnoteTestDoc(t, sourceBox, "source")
	denied := newFootnoteTestDoc(t, targetBox, "DENIED_BODY_SENTINEL")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(denied.Root.FirstChild.ID))
	for _, tree := range []*parse.Tree{source, denied} {
		writeExportRelatedTestTree(t, tree)
	}

	exported := exportFootnotesWithChecker(t, source, func(string) bool { return false })

	if defs := exported.Root.ChildrenByType(ast.NodeFootnotesDef); 0 != len(defs) {
		t.Fatalf("footnote defs = %d, want 0", len(defs))
	}
	if ids := collectExportedBlockRefIDs(exported.Root); 0 != len(ids) {
		t.Fatalf("block references remain: %v", ids)
	}
}
