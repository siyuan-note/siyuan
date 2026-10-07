package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingParentDocDoubleClick(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	engine.POST("/api/setting/patch", patchSetting)
	for _, previous := range []*bool{nil, new(true), new(false)} {
		for _, entry := range []struct {
			path, body string
			want       *bool
		}{
			{"/api/setting/setFiletree", `{}`, previous},
			{"/api/setting/setFiletree", `{"parentDocDoubleClickOpen":null}`, previous},
			{"/api/setting/setFiletree", `{"ParentDocDoubleClickOpen":false}`, new(false)},
			{"/api/setting/setFiletree", `{"parentDocDoubleClickOpen":true}`, new(true)},
			{"/api/setting/patch", `{"fileTree":{"parentDocDoubleClickOpen":false}}`, new(false)},
			{"/api/setting/patch", `{"fileTree":{"parentDocDoubleClickOpen":true}}`, new(true)},
			{"/api/setting/patch", `{"fileTree":{"parentDocDoubleClickOpen":null}}`, previous},
			{"/api/setting/patch", `{"fileTree":{"parentDocClickExpand":false}}`, previous},
		} {
			model.Conf = model.NewAppConf()
			model.Conf.FileTree = conf.NewFileTree()
			model.Conf.FileTree.ParentDocClickExpand = true
			model.Conf.FileTree.ParentDocDoubleClickOpen = previous
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", entry.path, recorder)
			var response struct {
				Code int                          `json:"code"`
				Data *apicontract.SettingFileTree `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code != 0 {
				t.Fatalf("setting failed: %s", recorder.Body.String())
			}
			want := entry.want == nil || *entry.want
			if entry.path == "/api/setting/setFiletree" &&
				(response.Data == nil || response.Data.ParentDocDoubleClickOpen == nil ||
					*response.Data.ParentDocDoubleClickOpen != want) {
				t.Fatalf("response lost the double-click preference: %s", recorder.Body.String())
			}
			if got := model.Conf.FileTree.ParentDocDoubleClickOpen; got == nil || *got != want {
				t.Fatalf("%s: want %v, got %v", entry.body, want, got)
			}
		}
	}
}
