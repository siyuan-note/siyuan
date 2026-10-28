// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHoldAttributeViewRequestUsesOrdinaryCarrierContext(t *testing.T) {
	const (
		ordinaryBoxID = "20260904121000-boxnorm"
		documentID    = "20260904121001-docnorm"
		foreignBoxID  = "20260904121002-boxenc0"
		foreignAvID   = "20260904121003-avenc00"
		missingID     = "20260904121004-missing"
	)

	oldDataDir, oldBlockTreeDBPath := util.DataDir, util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = oldDataDir, oldBlockTreeDBPath
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	oldEncryptedBoxIDs := av.AVEncryptedBoxIDs
	av.AVEncryptedBoxIDs = func() []string { return []string{foreignBoxID} }
	t.Cleanup(func() { av.AVEncryptedBoxIDs = oldEncryptedBoxIDs })

	tree := treenode.NewTree(ordinaryBoxID, "/"+documentID+".sy", "/Ordinary", "Ordinary")
	treenode.UpsertBlockTree(tree)
	foreignAvPath := filepath.Join(util.DataDir, foreignBoxID, "storage", "av", foreignAvID+".json")
	if err := os.MkdirAll(filepath.Dir(foreignAvPath), 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.WriteFile(foreignAvPath, []byte("encrypted"), 0644); nil != err {
		t.Fatal(err)
	}
	foreignConfPath := filepath.Join(util.DataDir, foreignBoxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(foreignConfPath), 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.WriteFile(foreignConfPath, []byte(`{"encrypted":true}`), 0644); nil != err {
		t.Fatal(err)
	}
	if !model.IsEncryptedBox(foreignBoxID) {
		t.Fatal("foreign box should be recognized as encrypted")
	}

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	if err := holdAttributeViewRequest(context, documentID, foreignAvID); nil != err {
		t.Fatalf("ordinary carrier should not acquire a foreign encrypted box lease: %v", err)
	}
	if err := holdAttributeViewRequest(context, missingID, foreignAvID); nil == err {
		t.Fatal("missing carrier compatibility fallback should still require the encrypted box lease")
	}
}
