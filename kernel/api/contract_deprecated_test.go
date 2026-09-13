package api

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractDeprecatedResponses(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/attr/resetBlockAttrs", resetBlockAttrs)
	engine.POST("/api/av/searchAttributeViewNonRelationKey", searchAttributeViewNonRelationKey)
	engine.POST("/api/storage/setLocalStorage", setLocalStorage)
	engine.POST("/api/system/reloadUI", deprecatedReloadUI)
	for _, path := range []string{"/api/attr/resetBlockAttrs", "/api/av/searchAttributeViewNonRelationKey", "/api/storage/setLocalStorage", "/api/system/reloadUI"} {
		for _, body := range []string{"", "{", "null", "{}"} {
			recorder := httptest.NewRecorder()
			uri := path + "?source=legacy"
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", uri, strings.NewReader(body)))
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int             `json:"code"`
				Msg  string          `json:"msg"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			want := fmt.Sprintf("[%s] is deprecated, visit [https://github.com/siyuan-note/siyuan/issues/15727] for details", uri)
			if response.Code != -1 || response.Msg != want || string(response.Data) != "null" {
				t.Fatalf("deprecated response changed: %s", recorder.Body.String())
			}
		}
	}
}
