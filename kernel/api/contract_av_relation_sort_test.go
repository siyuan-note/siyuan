package api

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAVRelationCandidateSortContract(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	key := fixture.attrView.GetBlockKey()
	var ids []string
	for i, name := range []string{"Alpha", "Beta", "Gamma"} {
		id := ast.NewNodeID()
		ids = append(ids, id)
		fixture.attrView.KeyValues[0].Values = append(fixture.attrView.KeyValues[0].Values, &av.Value{
			ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: av.KeyTypeBlock, IsDetached: true,
			CreatedAt: int64(i + 1), Block: &av.ValueBlock{Content: name},
		})
	}
	if err := av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(fixture.attrView.Views)
	const path = "/api/av/getAttributeViewRelationCandidates"
	for _, test := range []struct {
		sort any
		page int
		want string
		code int
	}{
		{nil, 1, ids[2], 0},
		{map[string]string{"column": key.ID, "order": "ASC"}, 1, ids[0], 0},
		{map[string]string{"column": key.ID, "order": "ASC"}, 2, ids[1], 0},
		{map[string]string{"column": key.ID, "order": "DESC"}, 1, ids[2], 0},
		{map[string]string{"column": "missing", "order": "ASC"}, 1, "", -1},
		{map[string]string{"column": key.ID, "order": "invalid"}, 1, "", -1},
	} {
		payload := map[string]any{"avID": fixture.attrView.ID, "keyID": fixture.relationKeyID,
			"page": test.page, "pageSize": 1, "selectedBlockIDs": []string{ids[1], ids[0]}}
		if test.sort != nil {
			payload["sort"] = test.sort
		}
		response := callAttributeViewContextFilterAPI(t, path, payload, getAttributeViewRelationCandidates)
		requireAPIContract(t, http.MethodPost, path, response)
		var result struct {
			Code int                                  `json:"code"`
			Data apicontract.AVRelationCandidatesData `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != test.code {
			t.Fatalf("sort %+v: %s (%v)", test, response.Body.String(), err)
		}
		if test.code == 0 {
			if len(result.Data.Rows) != 1 || result.Data.Rows[0].ID != test.want || result.Data.Total != 3 {
				t.Fatalf("unexpected page: %s", response.Body.String())
			}
			var selected []string
			for _, row := range result.Data.SelectedRows {
				selected = append(selected, row.ID)
			}
			if !reflect.DeepEqual(selected, []string{ids[1], ids[0]}) {
				t.Fatalf("selected order changed: %v", selected)
			}
		}
	}
	stored, err := av.ParseAttributeView(fixture.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(stored.Views)
	if string(before) != string(after) {
		t.Fatal("candidate sorting changed database views")
	}
}
