package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractBasicRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, entry := range []struct {
		path, body string
		handler    gin.HandlerFunc
		code       int
	}{
		{"/api/system/currentTime", "", currentTime, 0},
		{"/api/system/bootProgress", "", bootProgress, 0},
		{"/api/system/getWorkspaceInfo", "", getWorkspaceInfo, 0},
		{"/api/block/getDOMText", `{"dom":null}`, getDOMText, -1},
		{"/api/system/setAutoLaunch", `{"autoLaunch":"1"}`, setAutoLaunch, -1},
		{"/api/system/setFollowSystemLockScreen", `{}`, setFollowSystemLockScreen, -1},
		{"/api/system/setNetworkServe", `{"networkServe":null}`, setNetworkServe, -1},
		{"/api/system/setNetworkServeTLS", `{"networkServeTLS":1}`, setNetworkServeTLS, -1},
		{"/api/system/setNetworkProxy", `{"scheme":"http","host":"host"}`, setNetworkProxy, -1},
		{"/api/system/setDownloadInstallPkg", `{"downloadInstallPkg":"true"}`, setDownloadInstallPkg, -1},
		{"/api/system/setUpdateChannel", `{"updateChannel":null}`, setUpdateChannel, -1},
		{"/api/setting/setEditorReadOnly", `{"readonly":1}`, setEditorReadOnly, -1},
		{"/api/setting/addVirtualBlockRefInclude", `{"keywords":[null]}`, addVirtualBlockRefInclude, -1},
		{"/api/setting/addVirtualBlockRefExclude", `{"keywords":1}`, addVirtualBlockRefExclude, -1},
		{"/api/attr/batchGetBlockAttrs", `{"ids":[null]}`, batchGetBlockAttrs, -1},
		{"/api/attr/batchSetBlockAttrs", `{"blockAttrs":[{}]}`, batchSetBlockAttrs, -1},
		{"/api/bookmark/removeBookmark", `{}`, removeBookmark, -1},
		{"/api/bookmark/renameBookmark", `{"oldBookmark":"a"}`, renameBookmark, -1},
		{"/api/tag/getTag", `{"sort":"1"}`, getTag, -1},
		{"/api/tag/removeTag", `{"label":null}`, removeTag, -1},
		{"/api/tag/renameTag", `{"oldLabel":"a","newLabel":" "}`, renameTag, -1},
	} {
		t.Run(entry.path, func(t *testing.T) {
			engine := gin.New()
			engine.POST(entry.path, entry.handler)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body)))
			requireAPIContract(t, "POST", entry.path, recorder)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
				t.Fatalf("unexpected response: %s, %v", recorder.Body.String(), err)
			}
		})
	}
}

func TestAPIContractTagConversion(t *testing.T) {
	for _, tags := range []model.Tags{nil, {}, {nil}, {&model.Tag{Name: "root", Label: "Root", Type: "tag", Depth: 1, Count: 2, Children: model.Tags{&model.Tag{Name: "child", Children: model.Tags{}}}}}} {
		before, err := json.Marshal(tags)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(tagContracts(tags))
		if err != nil || string(before) != string(after) {
			t.Fatalf("tag JSON changed: %s != %s, %v", before, after, err)
		}
	}
}
