package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAVContractPublishRenderDoesNotWrite(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	originalAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = model.SetPublishAccess(originalAccess) })
	second := *fixture.attrView.Views[0]
	second.ID = "20260918190000-second0"
	fixture.attrView.Views = append(fixture.attrView.Views, &second)
	if err := av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, "storage", "av", fixture.attrView.ID+".json")
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var persisted map[string]any
	if err = json.Unmarshal(before, &persisted); err != nil {
		t.Fatal(err)
	}
	// 旧版数据需要在内存中兼容，发布读取不得持久化升级。
	persisted["spec"] = 0
	before, _ = json.Marshal(persisted)
	if err = os.WriteFile(file, before, 0644); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	const path = "/api/av/renderAttributeView"
	block := treenode.GetBlockTree(fixture.databaseID)
	documentPath := filepath.Join(util.DataDir, block.BoxID, block.Path)
	documentBefore, err := os.ReadFile(documentPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, viewID := range []string{fixture.attrView.Views[0].ID, second.ID, fixture.attrView.Views[0].ID} {
		response := callAttributeViewContextFilterAPIWithRole(t, path, map[string]any{
			"id": fixture.attrView.ID, "blockID": fixture.databaseID, "viewID": viewID,
			"createIfNotExist": true, "ignoreRows": true,
		}, renderAttributeView, model.RoleReader)
		requireAPIContract(t, http.MethodPost, path, response)
		var result struct {
			Code int
			Data struct{ ViewID string }
		}
		if err = json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 || result.Data.ViewID != viewID {
			t.Fatalf("read-only view switch failed: %s (%v)", response.Body.String(), err)
		}
		after, readErr := os.ReadFile(file)
		if readErr != nil || !bytes.Equal(before, after) {
			t.Fatalf("publish render persisted changes: %v", readErr)
		}
	}
	documentAfter, err := os.ReadFile(documentPath)
	if err != nil || !bytes.Equal(documentBefore, documentAfter) {
		t.Fatalf("publish switch persisted the carrier view: %v", err)
	}
	if err = model.SetPublishAccess(model.PublishAccess{{ID: block.RootID, Disable: true}}); err != nil {
		t.Fatal(err)
	}
	denied := callAttributeViewContextFilterAPIWithRole(t, path, map[string]any{
		"id": fixture.attrView.ID, "blockID": fixture.databaseID, "viewID": second.ID, "ignoreRows": true,
	}, renderAttributeView, model.RoleReader)
	requireAPIContract(t, http.MethodPost, path, denied)
	var deniedResult struct{ Code int }
	if err = json.Unmarshal(denied.Body.Bytes(), &deniedResult); err != nil || deniedResult.Code == 0 {
		t.Fatalf("publish access was bypassed: %s (%v)", denied.Body.String(), err)
	}
	if err = model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(file); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	response := callAttributeViewContextFilterAPIWithRole(t, path, map[string]any{
		"id": fixture.attrView.ID, "blockID": fixture.databaseID, "createIfNotExist": true, "ignoreRows": true,
	}, renderAttributeView, model.RoleReader)
	requireAPIContract(t, http.MethodPost, path, response)
	if _, err = os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("publish render created a database: %v", err)
	}
}
