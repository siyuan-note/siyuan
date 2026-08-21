package model

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFilterBlockAttributeViewKeysRemovesHiddenRows(t *testing.T) {
	const (
		boxID        = "20260821130000-avbox01"
		databaseID   = "20260821130001-avdb01"
		visibleRowID = "20260821130002-avrow01"
		hiddenRowID  = "20260821130003-avrow02"
	)

	oldDataDir, oldBlockTreeDBPath := util.DataDir, util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = oldDataDir, oldBlockTreeDBPath
	})

	for _, id := range []string{databaseID, visibleRowID, hiddenRowID} {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		tree.Root.AppendChild(&ast.Node{ID: id + "-p", Type: ast.NodeParagraph})
		treenode.UpsertBlockTree(tree)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Set(RoleContextKey, RoleReader)

	blockKey := &av.Key{ID: "20260821130004-block", Type: av.KeyTypeBlock, Name: "Name"}
	secretKey := &av.Key{ID: "20260821130005-secret", Type: av.KeyTypeText, Name: "Secret"}
	blockValue := func(rowID string) *av.Value {
		return &av.Value{
			ID:      rowID + "-value",
			KeyID:   blockKey.ID,
			BlockID: rowID,
			Type:    av.KeyTypeBlock,
			Block:   &av.ValueBlock{ID: rowID, Content: rowID},
		}
	}
	secretValue := func(rowID, content string) *av.Value {
		return &av.Value{
			ID:      rowID + "-secret-value",
			KeyID:   secretKey.ID,
			BlockID: rowID,
			Type:    av.KeyTypeText,
			Text:    &av.ValueText{Content: content},
		}
	}

	filtered := FilterBlockAttributeViewKeysByPublishAccess(c, PublishAccess{{ID: hiddenRowID, Visible: false}}, []*BlockAttributeViewKeys{{
		AvID:     "20260821130006-av0001",
		BlockIDs: []string{databaseID},
		KeyValues: []*av.KeyValues{
			{Key: blockKey, Values: []*av.Value{blockValue(visibleRowID), blockValue(hiddenRowID)}},
			{Key: secretKey, Values: []*av.Value{secretValue(visibleRowID, "PUBLIC_ROW"), secretValue(hiddenRowID, "PRIVATE_ROW_CANARY")}},
		},
	}})
	if len(filtered) != 1 {
		t.Fatalf("expected one visible attribute view, got %d", len(filtered))
	}
	for _, keyValues := range filtered[0].KeyValues {
		for _, value := range keyValues.Values {
			if value.BlockID == hiddenRowID {
				t.Fatalf("hidden row value survived publish filtering: key=%s value=%+v", keyValues.Key.ID, value)
			}
		}
	}
}

func TestHiddenAttributeViewRowRequiresVisibilityOrPassword(t *testing.T) {
	const (
		boxID    = "20260821131000-box"
		docID    = "20260821131001-doc"
		password = "publish-password"
	)
	oldDataDir, oldBlockTreeDBPath := util.DataDir, util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = oldDataDir, oldBlockTreeDBPath
	})
	treenode.UpsertBlockTree(treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID))

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	row := &av.Value{BlockID: docID, Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: docID}}
	if checkAttributeViewValueAccessableByPublishAccess(c, PublishAccess{{ID: docID, Visible: false}}, row) {
		t.Fatal("hidden attribute-view row without a password should be filtered")
	}
	protected := PublishAccess{{ID: docID, Visible: false, Password: password}}
	if checkAttributeViewValueAccessableByPublishAccess(c, protected, row) {
		t.Fatal("password-protected hidden attribute-view row should require its publish cookie")
	}
	c.Request.AddCookie(&http.Cookie{Name: "publish-auth-" + docID, Value: util.SHA256Hash([]byte(docID + password))})
	if !checkAttributeViewValueAccessableByPublishAccess(c, protected, row) {
		t.Fatal("authorized password-protected attribute-view row should remain visible")
	}
	if !checkAttributeViewValueAccessableByPublishAccess(c, PublishAccess{}, row) {
		t.Fatal("default-visible attribute-view row should remain visible")
	}
}
