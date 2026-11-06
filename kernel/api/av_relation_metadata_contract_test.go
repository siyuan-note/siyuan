// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func callRelationMetadata(t *testing.T, endpoint string, payload map[string]any, role model.Role) (*httptest.ResponseRecorder, int) {
	t.Helper()
	handlers := map[string]gin.HandlerFunc{"getAttributeView": getAttributeView, "getAttributeViewKeys": getAttributeViewKeys,
		"getAttributeViewBacklinks": getAttributeViewBacklinks, "getAttributeViewPrimaryKeyValues": getAttributeViewPrimaryKeyValues}
	path := "/api/av/" + endpoint
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
	engine.POST(path, handlers[endpoint])
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, http.MethodPost, path, recorder)
	var result struct {
		Code int `json:"code"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, recorder, &result)
	return recorder, result.Code
}

func relationMetadataTargetCarrier(t *testing.T, sourceCarrier string, target *av.AttributeView, boxes ...string) string {
	t.Helper()
	boxID := ""
	if len(boxes) > 0 {
		boxID = boxes[0]
	}
	tree, err := model.LoadTreeByBlockIDInExactBox(sourceCarrier, boxID)
	if err != nil {
		t.Fatal(err)
	}
	id := ast.NewNodeID()
	node := &ast.Node{ID: id, Type: ast.NodeAttributeView, AttributeViewID: target.ID, AttributeViewType: string(av.LayoutTypeTable)}
	node.SetIALAttr("id", id)
	tree.Root.AppendChild(node)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	av.BatchUpsertBlockRel([]*ast.Node{node})
	return id
}

func assertEncryptedRelationMetadata(t *testing.T, f *relationDetailAPIFixture, source, target *av.AttributeView,
	context model.AttributeViewRelationContext, sourceCarrier, boxID string) func() {
	t.Helper()
	targetCarrier := relationMetadataTargetCarrier(t, sourceCarrier, target, boxID)
	selfKey := ast.NewNodeID()
	target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: &av.Key{ID: selfKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID}}})
	if err := target.SetStorageContext(boxID); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	av.UpsertAvBackRel(source.ID, target.ID)
	av.SetAVBoxID(target.ID, "")
	dependency := map[string]any{"relationContext": context, "relationKeyIDs": []string{selfKey, selfKey}}
	requests := []struct {
		endpoint string
		payload  map[string]any
		want     string
	}{
		{"getAttributeView", map[string]any{"id": target.ID, "blockID": sourceCarrier, "relationFieldContext": map[string]any{"sourceAvID": source.ID, "relationKeyID": context.RelationKeyID}}, target.Views[0].ID},
		{"getAttributeViewKeys", map[string]any{"avID": target.ID, "itemID": f.rowIDs[0], "blockID": sourceCarrier, "relationContext": context}, "same-box private target"},
		{"getAttributeView", map[string]any{"id": target.ID, "blockID": targetCarrier}, "same-box private target"},
		{"getAttributeViewKeys", map[string]any{"avID": target.ID, "itemID": f.rowIDs[0], "blockID": targetCarrier}, "same-box private target"},
		{"getAttributeViewBacklinks", map[string]any{"avID": target.ID, "itemID": f.rowIDs[0], "blockID": targetCarrier}, source.ID},
		{"getAttributeView", map[string]any{"id": target.ID, "blockID": sourceCarrier, "relationDependencyContext": dependency}, selfKey},
		{"getAttributeViewPrimaryKeyValues", map[string]any{"id": target.ID, "blockID": sourceCarrier, "relationDependencyContext": dependency, "blockIDs": []string{f.rowIDs[0]}}, "same-box private target"},
	}
	for _, request := range requests {
		r, code := callRelationMetadata(t, request.endpoint, request.payload, model.RoleAdministrator)
		if code != 0 || !bytes.Contains(r.Body.Bytes(), []byte(request.want)) {
			t.Fatalf("encrypted metadata used ordinary twin: %s %s", request.endpoint, r.Body.String())
		}
		if request.endpoint == "getAttributeViewKeys" && !bytes.Contains(r.Body.Bytes(), []byte(`"notebookID":"`+boxID+`"`)) {
			t.Fatalf("encrypted row notebook lost: %s", r.Body.String())
		}
		for _, role := range []model.Role{model.RoleReader, model.RoleVisitor} {
			if r, code := callRelationMetadata(t, request.endpoint, request.payload, role); code != -1 {
				t.Fatalf("encrypted readonly metadata read: %s", r.Body.String())
			}
		}
	}
	nativeCandidates := map[string]any{"avID": source.ID, "keyID": context.RelationKeyID, "blockID": sourceCarrier,
		"includeNewItemPreview": true}
	r, candidates := callRelationDetailCandidatesContract(t, nativeCandidates, model.RoleAdministrator)
	if candidates.Code != 0 || candidates.Data == nil || candidates.Data.NotebookID != boxID ||
		candidates.Data.NewItemPreview == nil || candidates.Data.NewItemPreview.PrimaryKey != "Private scoped task" ||
		!bytes.Contains(r.Body.Bytes(), []byte("same-box private target")) {
		t.Fatalf("native candidate/preview metadata lost the real carrier domain: %s", r.Body.String())
	}
	// 依赖仅在普通域存在时不能跨域回退，即使其全局映射可解析。
	ordinary := av.NewAttributeView(ast.NewNodeID())
	if err := ordinary.SetStorageContext(""); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(ordinary); err != nil {
		t.Fatal(err)
	}
	missingKey := ast.NewNodeID()
	target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: &av.Key{ID: missingKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: ordinary.ID}}})
	if err := av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"getAttributeView", "getAttributeViewPrimaryKeyValues"} {
		payload := map[string]any{"id": ordinary.ID, "blockID": sourceCarrier, "relationDependencyContext": map[string]any{"relationContext": context, "relationKeyIDs": []string{missingKey}}}
		if r, code := callRelationMetadata(t, endpoint, payload, model.RoleAdministrator); code != -1 {
			t.Fatalf("encrypted dependency fell back ordinary: %s", r.Body.String())
		}
	}
	return func() {
		for _, request := range requests {
			if r, code := callRelationMetadata(t, request.endpoint, request.payload, model.RoleAdministrator); code != -1 {
				t.Fatalf("locked metadata read: %s %s", request.endpoint, r.Body.String())
			}
		}
	}
}

func TestAPIContractRelationMetadataAuthority(t *testing.T) {
	f := setupRelationDetailAPITest(t)
	targetCarrier := relationMetadataTargetCarrier(t, f.databaseID, f.target)
	field := map[string]any{"id": f.target.ID, "blockID": f.databaseID,
		"relationFieldContext": map[string]any{"sourceAvID": f.attrView.ID, "relationKeyID": f.relationKeyID}}
	keys := map[string]any{"avID": f.target.ID, "itemID": f.rowIDs[0], "blockID": f.databaseID, "relationContext": f.context}
	key, _ := f.attrView.GetKey(f.relationKeyID)
	key.Relation.DetailView.Enabled = false
	if err := av.SaveAttributeView(f.attrView); err != nil {
		t.Fatal(err)
	}
	r, code := callRelationMetadata(t, "getAttributeView", field, model.RoleAdministrator)
	if code != 0 || bytes.Contains(r.Body.Bytes(), []byte("related target")) || !bytes.Contains(r.Body.Bytes(), []byte(f.target.Views[0].ID)) {
		t.Fatalf("field metadata must be usable before enable and omit rows: %s", r.Body.String())
	}
	if r, code = callRelationMetadata(t, "getAttributeViewKeys", keys, model.RoleAdministrator); code != -1 {
		t.Fatalf("disabled relation read rows: %s", r.Body.String())
	}
	key.Relation.DetailView.Enabled = true
	if err := av.SaveAttributeView(f.attrView); err != nil {
		t.Fatal(err)
	}
	r, code = callRelationMetadata(t, "getAttributeViewKeys", keys, model.RoleAdministrator)
	if code != 0 || !bytes.Contains(r.Body.Bytes(), []byte("related target")) || bytes.Contains(r.Body.Bytes(), []byte("unrelated target")) ||
		!bytes.Contains(r.Body.Bytes(), []byte(targetCarrier)) || !bytes.Contains(r.Body.Bytes(), []byte(`"notebookID":"20260904002000-ctxbox0"`)) {
		t.Fatalf("row metadata lost membership/carrier/notebook: %s", r.Body.String())
	}
	av.UpsertAvBackRel(f.attrView.ID, f.target.ID)
	requests := []struct {
		endpoint string
		payload  map[string]any
	}{
		{"getAttributeView", field}, {"getAttributeViewKeys", keys},
		{"getAttributeView", map[string]any{"id": f.target.ID, "blockID": targetCarrier}},
		{"getAttributeViewKeys", map[string]any{"avID": f.target.ID, "itemID": f.rowIDs[0], "blockID": targetCarrier}},
		{"getAttributeViewBacklinks", map[string]any{"avID": f.target.ID, "itemID": f.rowIDs[0], "blockID": targetCarrier}},
	}
	for _, request := range requests {
		t.Run(request.endpoint, func(t *testing.T) {
			if r, code := callRelationMetadata(t, request.endpoint, request.payload, model.RoleAdministrator); code != 0 {
				t.Fatalf("valid metadata failed: %s", r.Body.String())
			}
			for _, role := range []model.Role{model.RoleReader, model.RoleVisitor} {
				want := -1
				if request.endpoint != "getAttributeView" && request.payload["relationContext"] == nil {
					want = 0
				}
				if r, code := callRelationMetadata(t, request.endpoint, request.payload, role); code != want {
					t.Fatalf("readonly metadata escaped: %s", r.Body.String())
				}
			}
			for _, invalid := range []string{ast.NewNodeID(), f.paragraphID} {
				copy := map[string]any{}
				for key, value := range request.payload {
					copy[key] = value
				}
				copy["blockID"] = invalid
				if r, code := callRelationMetadata(t, request.endpoint, copy, model.RoleAdministrator); code != -1 {
					t.Fatalf("invalid carrier accepted: %s", r.Body.String())
				}
			}
		})
	}
	keys["itemID"] = f.rowIDs[1]
	if r, code := callRelationMetadata(t, "getAttributeViewKeys", keys, model.RoleAdministrator); code != -1 {
		t.Fatalf("nonmember read: %s", r.Body.String())
	}
	keys["itemID"], keys["avID"] = f.rowIDs[0], f.attrView.ID
	if r, code := callRelationMetadata(t, "getAttributeViewKeys", keys, model.RoleAdministrator); code != -1 {
		t.Fatalf("wrong target read: %s", r.Body.String())
	}
	field["id"] = f.attrView.ID
	if r, code := callRelationMetadata(t, "getAttributeView", field, model.RoleAdministrator); code != -1 {
		t.Fatalf("wrong field target read: %s", r.Body.String())
	}
	for _, endpoint := range []string{"getAttributeView", "getAttributeViewKeys", "getAttributeViewBacklinks"} {
		payload := map[string]any{"id": f.target.ID, "avID": f.target.ID, "itemID": f.rowIDs[0], "blockID": f.databaseID}
		if r, code := callRelationMetadata(t, endpoint, payload, model.RoleAdministrator); code != -1 {
			t.Fatalf("source carrier impersonated target: %s", r.Body.String())
		}
	}
}

func TestAPIContractRelationFieldMetadataBoundSource(t *testing.T) {
	f := setupRelationDetailAPITest(t)
	tree, err := model.LoadTreeByBlockID(f.databaseID)
	if err != nil {
		t.Fatal(err)
	}
	heading := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeHeading, HeadingLevel: 2}
	heading.SetIALAttr("id", heading.ID)
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Bound heading")})
	tree.Root.AppendChild(heading)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	for _, blockID := range []string{tree.Root.ID, heading.ID, f.paragraphID} {
		value := f.attrView.GetBlockValue(f.context.SourceItemID)
		value.IsDetached, value.Block.ID = false, blockID
		if err = av.SaveAttributeView(f.attrView); err != nil {
			t.Fatal(err)
		}
		payload := map[string]any{"id": f.target.ID, "blockID": blockID,
			"relationFieldContext": map[string]any{"sourceAvID": f.attrView.ID, "relationKeyID": f.relationKeyID}}
		if r, code := callRelationMetadata(t, "getAttributeView", payload, model.RoleAdministrator); code != 0 {
			t.Fatalf("bound source settings rejected: %s", r.Body.String())
		}
		value.IsDetached, value.Block.ID = true, ""
		if err = av.SaveAttributeView(f.attrView); err != nil {
			t.Fatal(err)
		}
		if r, code := callRelationMetadata(t, "getAttributeView", payload, model.RoleAdministrator); code != -1 {
			t.Fatalf("unbound source impersonated settings carrier: %s", r.Body.String())
		}
	}
}

func TestAPIContractRelationMetadataCarrierPublishParity(t *testing.T) {
	f := setupRelationDetailAPITest(t)
	for _, kv := range f.target.KeyValues {
		if kv.Key.Type == av.KeyTypeBlock {
			continue
		}
		for _, id := range f.rowIDs {
			kv.Values = append(kv.Values, &av.Value{ID: ast.NewNodeID(), KeyID: kv.Key.ID, BlockID: id, Type: kv.Key.Type})
		}
	}
	if err := av.SaveAttributeView(f.target); err != nil {
		t.Fatal(err)
	}
	targetCarrier := relationMetadataTargetCarrier(t, f.databaseID, f.target)
	av.BatchUpsertBlockRel([]*ast.Node{{ID: f.databaseID, Type: ast.NodeAttributeView, AttributeViewID: f.attrView.ID}})
	av.UpsertAvBackRel(f.attrView.ID, f.target.ID)
	previous := model.GetPublishAccess()
	t.Cleanup(func() {
		if err := model.SetPublishAccess(previous); err != nil {
			t.Fatal(err)
		}
	})
	for _, hidden := range []bool{false, true} {
		access := model.PublishAccess{}
		if hidden {
			access = model.PublishAccess{{ID: "20260904002001-ctxdoc0", Visible: false}}
		}
		if err := model.SetPublishAccess(access); err != nil {
			t.Fatal(err)
		}
		for _, endpoint := range []string{"getAttributeViewKeys", "getAttributeViewBacklinks"} {
			for _, role := range []model.Role{model.RoleReader, model.RoleVisitor} {
				payload := map[string]any{"avID": f.target.ID, "itemID": f.rowIDs[0]}
				legacy, legacyCode := callRelationMetadata(t, endpoint, payload, role)
				payload["blockID"] = targetCarrier
				scoped, scopedCode := callRelationMetadata(t, endpoint, payload, role)
				if legacyCode != 0 || scopedCode != 0 {
					t.Fatalf("native readonly metadata denied: legacy=%s scoped=%s", legacy.Body.String(), scoped.Body.String())
				}
				if !bytes.Equal(legacy.Body.Bytes(), scoped.Body.Bytes()) {
					t.Fatalf("native readonly metadata changed publish filtering: legacy=%s scoped=%s", legacy.Body.String(), scoped.Body.String())
				}
				if hidden && (bytes.Contains(scoped.Body.Bytes(), []byte("related target")) || bytes.Contains(scoped.Body.Bytes(), []byte("Source entry"))) {
					t.Fatalf("hidden publish value escaped: %s", scoped.Body.String())
				}
			}
		}
	}
}

func TestAPIContractRelationDependencyMetadata(t *testing.T) {
	f := setupRelationDetailAPITest(t)
	third := av.NewAttributeView(ast.NewNodeID())
	third.Name = "Third database"
	first, second := ast.NewNodeID(), ast.NewNodeID()
	f.target.KeyValues = append(f.target.KeyValues, &av.KeyValues{Key: &av.Key{ID: first, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: third.ID}}})
	third.KeyValues = append(third.KeyValues, &av.KeyValues{Key: &av.Key{ID: second, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: third.ID}}})
	for _, title := range []string{"alpha dependency", "beta dependency"} {
		id := ast.NewNodeID()
		third.GetBlockKeyValues().Values = append(third.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: third.GetBlockKey().ID,
			BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: title}})
		third.Views[0].ItemIDs = append(third.Views[0].ItemIDs, id)
	}
	for _, database := range []*av.AttributeView{f.target, third} {
		if err := av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range [][]string{{first}, {first, second}} {
		payload := map[string]any{"id": third.ID, "blockID": f.databaseID, "relationDependencyContext": map[string]any{"relationContext": f.context, "relationKeyIDs": path}}
		r, code := callRelationMetadata(t, "getAttributeView", payload, model.RoleAdministrator)
		if code != 0 || !bytes.Contains(r.Body.Bytes(), []byte(second)) || bytes.Contains(r.Body.Bytes(), []byte("alpha dependency")) {
			t.Fatalf("dependency schema leaked values or failed: %s", r.Body.String())
		}
		payload["keyword"], payload["pageSize"] = "dependency", 1
		r, code = callRelationMetadata(t, "getAttributeViewPrimaryKeyValues", payload, model.RoleAdministrator)
		if code != 0 || !bytes.Contains(r.Body.Bytes(), []byte(`"total":2`)) {
			t.Fatalf("dependency pagination failed: %s", r.Body.String())
		}
		payload["blockIDs"], payload["keyword"] = []string{third.Views[0].ItemIDs[0]}, "does not match"
		r, code = callRelationMetadata(t, "getAttributeViewPrimaryKeyValues", payload, model.RoleAdministrator)
		if code != 0 || !bytes.Contains(r.Body.Bytes(), []byte("alpha dependency")) || bytes.Contains(r.Body.Bytes(), []byte("beta dependency")) {
			t.Fatalf("selected labels changed native semantics: %s", r.Body.String())
		}
		for _, role := range []model.Role{model.RoleReader, model.RoleVisitor} {
			for _, endpoint := range []string{"getAttributeView", "getAttributeViewPrimaryKeyValues"} {
				if r, code := callRelationMetadata(t, endpoint, payload, role); code != -1 {
					t.Fatalf("readonly dependency read: %s", r.Body.String())
				}
			}
		}
	}
	for _, path := range [][]string{{}, {first, second, second}, {ast.NewNodeID()}, {f.target.GetBlockKey().ID}, {first, ast.NewNodeID()}} {
		payload := map[string]any{"id": third.ID, "blockID": f.databaseID, "relationDependencyContext": map[string]any{"relationContext": f.context, "relationKeyIDs": path}}
		for _, endpoint := range []string{"getAttributeView", "getAttributeViewPrimaryKeyValues"} {
			if r, code := callRelationMetadata(t, endpoint, payload, model.RoleAdministrator); code != -1 {
				t.Fatalf("invalid dependency path read: %s", r.Body.String())
			}
		}
	}
	payload := map[string]any{"id": f.target.ID, "blockID": f.databaseID, "relationDependencyContext": map[string]any{"relationContext": f.context, "relationKeyIDs": []string{first}}}
	for _, endpoint := range []string{"getAttributeView", "getAttributeViewPrimaryKeyValues"} {
		if r, code := callRelationMetadata(t, endpoint, payload, model.RoleAdministrator); code != -1 {
			t.Fatalf("wrong dependency target read: %s", r.Body.String())
		}
	}
}
