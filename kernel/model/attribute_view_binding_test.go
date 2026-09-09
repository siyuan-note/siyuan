package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewBindingBatchPreflight(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, false)
	foreign := treenode.NewTree(fixture.tree.Box, "/"+ast.NewNodeID()+".sy", "/Foreign", "Foreign")
	treenode.UpsertBlockTree(foreign)
	foreign.Box = "20260909120000-encbox0"
	markRuntimeEncryptedBox(foreign.Box)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(foreign.Box) })
	tx := &Transaction{trees: map[string]*parse.Tree{fixture.tree.ID: fixture.tree, foreign.ID: foreign}}
	before, _ := json.Marshal(fixture.attrView)
	// 插入顺序会反转，普通块位于处理顺序的首位，以验证整批预检查。
	srcs := []map[string]any{
		{"id": foreign.ID, "isDetached": false},
		{"id": fixture.tree.ID, "isDetached": false},
	}
	if err := AddAttributeViewBlock(tx, srcs, fixture.attrView.ID, "", "", "", "", true); err == nil {
		t.Fatal("batch accepted a cross-boundary binding")
	}
	if fixture.tree.Root.IALAttr(av.NodeAttrNameAvs) != "" || foreign.Root.IALAttr(av.NodeAttrNameAvs) != "" {
		t.Fatal("failed batch changed document bindings")
	}
	saved, err := av.ParseAttributeView(fixture.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(saved)
	if !bytes.Equal(before, after) {
		t.Fatal("failed batch changed persisted database")
	}

	keyValues := fixture.attrView.GetBlockKeyValues()
	itemID := ast.NewNodeID()
	keyValues.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: keyValues.Key.ID, BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Original"}}}
	if err = av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	before, _ = json.Marshal(fixture.attrView)
	updates := []*AttrViewCellUpdate{
		{KeyID: keyValues.Key.ID, RowID: itemID, Data: map[string]any{"isDetached": false, "block": map[string]any{"id": fixture.tree.ID}}},
		{KeyID: keyValues.Key.ID, RowID: itemID, Data: map[string]any{"block": map[string]any{"id": foreign.ID}}},
	}
	if txErr := tx.doUpdateAttrViewCells(&Operation{AvID: fixture.attrView.ID, CellUpdates: updates}); txErr == nil {
		t.Fatal("cell batch accepted a cross-boundary binding in a partial update")
	}
	if fixture.tree.Root.IALAttr(av.NodeAttrNameAvs) != "" {
		t.Fatal("cell batch wrote an earlier backlink before rejecting the later update")
	}
	saved, err = av.ParseAttributeView(fixture.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	after, _ = json.Marshal(saved)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected cell batch changed the database")
	}
}

func TestAttributeViewBindingRejectsCrossBoundaryWrites(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, false)
	originalBoxID := fixture.tree.Box
	defer func() { fixture.tree.Box = originalBoxID }()
	const encryptedBoxID = "20260909100000-encbox0"
	markRuntimeEncryptedBox(encryptedBoxID)
	av.SetAVBoxID(fixture.attrView.ID, encryptedBoxID)
	t.Cleanup(func() {
		av.SetAVBoxID(fixture.attrView.ID, "")
		forgetRuntimeEncryptedBox(encryptedBoxID)
	})
	itemID := ast.NewNodeID()
	blockValues := fixture.attrView.GetBlockKeyValues()
	blockValues.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: blockValues.Key.ID, BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Original"}}}
	before, _ := json.Marshal(fixture.attrView)

	if _, _, err := replaceAttributeViewBlock0(fixture.attrView, itemID, fixture.tree.Root.ID, false, nil); err == nil {
		t.Fatal("replace accepted a cross-boundary binding")
	}
	if _, err := updateAttributeViewValue(nil, fixture.attrView, blockValues.Key.ID, itemID, map[string]any{
		"isDetached": false, "block": map[string]any{"id": fixture.tree.Root.ID},
	}, false); err == nil {
		t.Fatal("primary-key edit accepted a cross-boundary binding")
	}
	if err := addAttributeViewBlock0(fixture.attrView, 0, fixture.attrView.ID, "", "", "", "", ast.NewNodeID(),
		fixture.tree.Root.ID, "", map[string]any{}, false, true, fixture.tree, nil, &insertAttrViewBlockResult{}); err == nil {
		t.Fatal("insert accepted a cross-boundary binding")
	}
	bindBlockAv0(nil, fixture.attrView.ID, fixture.tree.Root, fixture.tree)
	if fixture.tree.Root.IALAttr(av.NodeAttrNameAvs) != "" {
		t.Fatal("rebind changed a foreign document")
	}
	after, _ := json.Marshal(fixture.attrView)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected operation changed database values")
	}
	av.SetAVBoxID(fixture.attrView.ID, "")
	if err := validateAttributeViewBinding(fixture.attrView.ID, fixture.tree); err != nil {
		t.Fatalf("ordinary binding rejected: %v", err)
	}
	fixture.tree.Box = encryptedBoxID
	if err := validateAttributeViewBinding(fixture.attrView.ID, fixture.tree); err == nil {
		t.Fatal("normal database accepted encrypted block")
	}
	av.SetAVBoxID(fixture.attrView.ID, encryptedBoxID)
	if err := validateAttributeViewBinding(fixture.attrView.ID, fixture.tree); err != nil {
		t.Fatalf("same encrypted notebook rejected: %v", err)
	}
	otherBoxID := ast.NewNodeID()
	markRuntimeEncryptedBox(otherBoxID)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(otherBoxID) })
	fixture.tree.Box = otherBoxID
	if err := validateAttributeViewBinding(fixture.attrView.ID, fixture.tree); err == nil {
		t.Fatal("binding between encrypted notebooks was accepted")
	}
}

func TestUpdateBoundBlockAvsAttributeDoesNotWriteOutsideBox(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, false)
	fixture.attrView.ID = ast.NewNodeID()
	util.Langs["en"][382] = "Cannot export database [%s]. Check database bindings and notebook location"
	const encryptedBoxID = "20260909101000-encbox0"
	markRuntimeEncryptedBox(encryptedBoxID)
	setDEKForTest(encryptedBoxID, bytes.Repeat([]byte{0x73}, 32))
	av.SetAVBoxID(fixture.attrView.ID, encryptedBoxID)
	t.Cleanup(func() {
		av.SetAVBoxID(fixture.attrView.ID, "")
		cachedDEKsLock.Lock()
		delete(cachedDEKs, encryptedBoxID)
		cachedDEKsLock.Unlock()
		forgetRuntimeEncryptedBox(encryptedBoxID)
	})
	values := fixture.attrView.GetBlockKeyValues()
	values.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: values.Key.ID, BlockID: ast.NewNodeID(),
		Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: fixture.tree.Root.ID, Content: "External"}}}
	if err := av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(util.DataDir, fixture.tree.Box, fixture.tree.Path)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	updateBoundBlockAvsAttribute([]string{fixture.attrView.ID}, encryptedBoxID)
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("scoped backlink update changed external document: %v", err)
	}

	// 导出严格按普通范围读取，即使加密数据库已解锁也不能越界。
	missingID := ast.NewNodeID()
	exportDir := t.TempDir()
	if err = exportAv(fixture.attrView.ID, "", exportDir, exportDir, nil); !errors.Is(err, av.ErrViewNotFound) {
		t.Fatalf("expected scoped export error: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(exportDir, fixture.attrView.ID+".json")); !os.IsNotExist(statErr) {
		t.Fatalf("cross-boundary export produced a database file: %v", statErr)
	}
	if !strings.Contains(attributeViewExportError(missingID, av.ErrViewNotFound).Error(), missingID) {
		t.Fatal("export diagnostic does not identify the database")
	}
	avPath := filepath.Join(util.DataDir, encryptedBoxID, "storage", "av", fixture.attrView.ID+".json")
	ciphertext, err := os.ReadFile(avPath)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(avPath, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	if err = exportAv(fixture.attrView.ID, encryptedBoxID, exportDir, exportDir, nil); err == nil {
		t.Fatal("export accepted unauthenticated ciphertext")
	}
	preserved, readErr := os.ReadFile(avPath)
	if readErr != nil || !bytes.Equal(preserved, ciphertext) {
		t.Fatalf("failed authentication changed source ciphertext: %v", readErr)
	}
	if _, statErr := os.Stat(filepath.Join(exportDir, fixture.attrView.ID+".json")); !os.IsNotExist(statErr) {
		t.Fatalf("failed authentication produced a database file: %v", statErr)
	}
}
