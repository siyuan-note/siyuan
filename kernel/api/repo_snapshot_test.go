package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestSnapshotAPIErrors(t *testing.T) {
	original := model.Conf
	t.Cleanup(func() { model.Conf = original })
	model.Conf = model.NewAppConf()
	model.Conf.Repo = conf.NewRepo()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/repo/createSnapshot", createSnapshot)
	engine.POST("/api/repo/checkSnapshot", checkSnapshot)
	engine.POST("/api/repo/setSnapshotMemo", setSnapshotMemo)
	for _, test := range []struct{ path, body string }{
		{"createSnapshot", `{}`},
		{"createSnapshot", `{"memo":""}`},
		{"createSnapshot", `{"memo":false}`},
		{"checkSnapshot", ``},
		{"setSnapshotMemo", `{"id":"invalid","memo":"note"}`},
		{"setSnapshotMemo", `{"id":"invalid"}`},
	} {
		path := "/api/repo/" + test.path
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(test.body)))
		requireAPIContract(t, http.MethodPost, path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 {
			t.Fatalf("invalid request or uninitialized repository accepted: %s %s", path, recorder.Body.String())
		}
	}
}
