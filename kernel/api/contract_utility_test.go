package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractUtilityResponses(t *testing.T) {
	previous := util.SnippetsPath
	util.SnippetsPath = t.TempDir()
	t.Cleanup(func() { util.SnippetsPath = previous })
	engine := gin.New()
	engine.POST("/api/lute/md2html", md2HTML)
	engine.POST("/api/notification/pushMsg", pushMsg)
	engine.POST("/api/notification/pushErrMsg", pushErrMsg)
	for _, entry := range []struct {
		path, body string
		code       int
	}{
		{"/api/lute/md2html", `{"markdown":"hello","mode":null}`, 0},
		{"/api/lute/md2html", `{"markdown":"","mode":"invalid"}`, -1},
		{"/api/notification/pushMsg", `{"msg":" hello ","timeout":1.9}`, 0},
		{"/api/notification/pushErrMsg", `{"msg":"hello","timeout":null}`, 0},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", entry.path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("%s: %s, %v", entry.path, recorder.Body.String(), err)
		}
	}
}
