package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func TestUpdatedNodeBoxIDUsesTreeMetadataForRefCache(t *testing.T) {
	const (
		boxID      = "20260730000000-box0001"
		defBlockID = "20260730000001-def0001"
		refBlockID = "20260730000002-ref0001"
		refRootID  = "20260730000003-root001"
		defRootID  = "20260730000004-root001"
	)

	refRoot := &ast.Node{Type: ast.NodeDocument, ID: refRootID, Box: boxID}
	refBlock := &ast.Node{Type: ast.NodeParagraph, ID: refBlockID}
	refNode := &ast.Node{
		Type:                    ast.NodeTextMark,
		TextMarkType:            "block-ref",
		TextMarkBlockRefID:      defBlockID,
		TextMarkBlockRefSubtype: "d",
		TextMarkTextContent:     "Reference",
	}
	refBlock.AppendChild(refNode)
	refRoot.AppendChild(refBlock)
	sql.CacheRef(&parse.Tree{
		Root: refRoot,
		ID:   refRootID,
		Box:  boxID,
		Path: "/" + refRootID + ".sy",
	}, refNode)

	defRoot := &ast.Node{Type: ast.NodeDocument, ID: defRootID}
	defBlock := &ast.Node{Type: ast.NodeParagraph, ID: defBlockID}
	defRoot.AppendChild(defBlock)
	updatedTrees := map[string]*parse.Tree{
		defRootID: {
			Root: defRoot,
			ID:   defRootID,
			Box:  boxID,
			Path: "/" + defRootID + ".sy",
		},
	}
	resolvedBoxID := updatedNodeBoxID(defBlock, updatedTrees)
	if boxID != resolvedBoxID {
		t.Fatalf("resolved box ID = %q, want %q", resolvedBoxID, boxID)
	}

	refs, _ := getRefsCacheByDefNode(defBlock, resolvedBoxID)
	if 1 != len(refs) || refBlockID != refs[0].BlockID || boxID != refs[0].Box {
		t.Fatalf("unexpected cached refs: %+v", refs)
	}
}
