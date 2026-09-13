package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAPIContractRichClipboardValidation(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/clipboard/prepareRichText", prepareRichText)
	engine.POST("/api/clipboard/cleanupRichText", cleanupRichText)
	for _, entry := range []struct{ handler, body, message string }{
		{"prepareRichText", `{"assets":[]}`, "Field [assets] must not be empty"},
		{"prepareRichText", `{"assets":[null]}`, "Field [assets.0] should be of type [Object]"},
		{"prepareRichText", `{"assets":[{"index":0.5,"path":"file.png"}]}`, "Invalid rich clipboard asset at index [0]"},
		{"prepareRichText", `{"assets":[{"index":0,"path":"file.png","box":null}]}`, "Field [assets.0.box] should be of type [String]"},
		{"cleanupRichText", `{"batch":" ","groups":["g"]}`, "Field [batch] must not be empty"},
		{"cleanupRichText", `{"batch":"b","groups":[]}`, "Field [groups] must not be empty"},
		{"cleanupRichText", `{"batch":"b","groups":[null]}`, "Field [groups.0] should be of type [String]"},
	} {
		recorder := httptest.NewRecorder()
		path := "/api/clipboard/" + entry.handler
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != entry.message {
			t.Fatalf("validation changed: %s, %v", recorder.Body.String(), err)
		}
	}
	request, err := apicontract.PrepareRichText.Decode(strings.NewReader(`{"assets":[{"index":1.0,"path":" file.png ","box":" box "}]}`))
	if err != nil || len(request.Assets) != 1 || request.Assets[0].Path != "file.png" || request.Assets[0].Box != "box" {
		t.Fatalf("asset normalization changed: %#v, %v", request, err)
	}
}
