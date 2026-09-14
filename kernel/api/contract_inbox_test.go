package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestAPIContractInboxCloudPayload(t *testing.T) {
	fixture := `{"code":0,"msg":"","data":{"pagination":{"paginationPageCount":2,"paginationRecordCount":21,"paginationPageNums":[1,2]},"shorthands":[{"oId":"123","shorthandTitle":"title","shorthandURL":"url","shorthandDesc":"desc","shorthandContent":"<p>text</p>","shorthandFrom":1,"shorthandMd":"text","hCreated":"date"}]}}`
	var original map[string]any
	if err := json.Unmarshal([]byte(fixture), &original); err != nil {
		t.Fatal(err)
	}
	converted, err := decodeCloudInbox[apicontract.ShorthandsData](original)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(converted)
	if err != nil {
		t.Fatal(err)
	}
	var actual map[string]any
	if err := json.Unmarshal(encoded, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, actual) {
		t.Fatalf("cloud response changed: %s", encoded)
	}
}

func TestAPIContractInboxInvalidRequests(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/inbox/getShorthand", getShorthand)
	engine.POST("/api/inbox/getShorthands", getShorthands)
	engine.POST("/api/inbox/removeShorthands", removeShorthands)
	for _, path := range []string{"/api/inbox/getShorthand", "/api/inbox/getShorthands", "/api/inbox/removeShorthands"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(`{}`)))
		requireAPIContract(t, "POST", path, recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("missing field accepted: %s", recorder.Body.String())
		}
	}
	request, err := apicontract.GetShorthands.Decode(strings.NewReader(`{"page":1.9}`))
	if err != nil || int(request.Page) != 1 {
		t.Fatalf("fractional page changed: %#v, %v", request, err)
	}
}
