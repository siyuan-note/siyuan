package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractNotificationResponses(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/notification/pushMsg", pushMsg)
	engine.POST("/api/notification/pushErrMsg", pushErrMsg)
	for _, path := range []string{"/api/notification/pushMsg", "/api/notification/pushErrMsg"} {
		for _, entry := range []struct {
			body string
			code int
		}{
			{`{"msg":" hello "}`, 0},
			{`{"msg":"hello","timeout":null}`, 0},
			{`{"msg":"hello","timeout":1.9}`, 0},
			{`{"msg":"hello","timeout":-1}`, 0},
			{`{"msg":null}`, -1},
			{`{}`, -1},
		} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int `json:"code"`
				Data *struct {
					ID string `json:"id"`
				} `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
				t.Fatalf("%s %s: %s, %v", path, entry.body, recorder.Body.String(), err)
			}
			if entry.code == 0 && (response.Data == nil || response.Data.ID == "") {
				t.Fatalf("missing message ID: %s", recorder.Body.String())
			}
		}
	}
}
