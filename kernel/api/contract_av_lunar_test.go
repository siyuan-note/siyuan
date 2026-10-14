package api

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAVContractLunarField(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	key := av.NewKey("20261009120000-lunara1", "Birthday", "", av.KeyTypeDate)
	key.DateFormat = av.DateDisplayFormatLunar
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: key, Values: []*av.Value{}})
	fixture.attrView.Views[0].Table.Columns = append(fixture.attrView.Views[0].Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	if err := av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	path := "/api/av/renderAttributeView"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{
		"id": fixture.attrView.ID, "blockID": fixture.databaseID, "ignoreRows": true,
	}, renderAttributeView)
	if !bytes.Contains(response.Body.Bytes(), []byte(`"dateFormat":"lunar"`)) {
		t.Fatalf("lunar field missing from response: %s", response.Body.String())
	}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateHTTPResponse(http.MethodPost, path, response.Code,
		response.Header().Get("Content-Type"), response.Body.Bytes()); err != nil {
		t.Fatalf("lunar response violates contract: %v", err)
	}
}
