// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFilterEmbedBlocksByAccess(t *testing.T) {
	const (
		boxID             = "20260725000000-boxid01"
		publicDocID       = "20260725000001-public1"
		hiddenDocID       = "20260725000002-hidden1"
		forbiddenDocID    = "20260725000003-forbid"
		protectedDocID    = "20260725000004-protect"
		protectedPassword = "password"
	)
	blocks := []*sql.Block{
		{ID: publicDocID},
		{ID: hiddenDocID},
		{ID: forbiddenDocID},
		{ID: protectedDocID},
	}

	if filtered := filterEmbedBlocksByAccess(blocks, nil); len(filtered) != len(blocks) {
		t.Fatalf("administrator results should remain unchanged: %+v", filtered)
	}

	blockTrees := map[string]*treenode.BlockTree{
		publicDocID:    {ID: publicDocID, BoxID: boxID, Path: "/" + publicDocID + ".sy"},
		hiddenDocID:    {ID: hiddenDocID, BoxID: boxID, Path: "/" + hiddenDocID + ".sy"},
		forbiddenDocID: {ID: forbiddenDocID, BoxID: boxID, Path: "/" + forbiddenDocID + ".sy"},
		protectedDocID: {ID: protectedDocID, BoxID: boxID, Path: "/" + protectedDocID + ".sy"},
	}
	publishAccess := PublishAccess{
		{ID: hiddenDocID, Visible: false},
		{ID: forbiddenDocID, Disable: true},
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	accessChecker := func(blockID string) bool {
		return checkBlockTreeAccessableByPublishAccess(c, publishAccess, blockTrees[blockID])
	}

	filtered := filterEmbedBlocksByAccess(blocks, accessChecker)
	if 2 != len(filtered) || publicDocID != filtered[0].ID || hiddenDocID != filtered[1].ID {
		t.Fatalf("inaccessible embed results should be removed: %+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = filterEmbedBlocksByAccess(blocks, accessChecker)
	if 3 != len(filtered) || protectedDocID != filtered[2].ID {
		t.Fatalf("authorized protected embed result should be returned: %+v", filtered)
	}
}

func TestNewEmbeddedBlockIncludesSourceRootID(t *testing.T) {
	const (
		blockID = "20260729150000-block01"
		rootID  = "20260729150001-root001"
	)
	def := &ast.Node{
		ID:   blockID,
		Type: ast.NodeParagraph,
		Box:  "20260729150002-box0001",
		Path: "/" + rootID + ".sy",
	}
	blockTree := &treenode.BlockTree{
		RootID: rootID,
		HPath:  "/Source document",
	}

	block := newEmbeddedBlock(def, blockTree, "<div>content</div>", "content")
	if rootID != block.RootID {
		t.Fatalf("embedded block root ID = %q, want %q", block.RootID, rootID)
	}
}
