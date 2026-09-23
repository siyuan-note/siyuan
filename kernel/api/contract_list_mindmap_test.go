package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func testAPIContractMindmapMigration(t *testing.T, engine *gin.Engine, boxID, docID string) {
	const endpoint = "/api/block/migrateLegacyMindmaps"
	engine.POST(endpoint, func(c *gin.Context) {
		role := model.RoleAdministrator
		if c.GetHeader("X-Test-Reader") == "1" {
			role = model.RoleReader
		}
		c.Set(model.RoleContextKey, role)
	}, model.CheckAdminRole, model.CheckReadonly, migrateLegacyMindmaps)
	const id = "20260920000000-oldcode"
	dom := util.NewLute().Md2BlockDOM("```mindmap\n- Root\n  - Child\n```\n{: id=\""+id+"\"}", false)
	if _, err := model.PerformBlockOperation(&model.Operation{Action: "appendInsert", ParentID: docID, Data: dom}); err != nil {
		t.Fatal(err)
	}
	sourceBefore := model.GetBlockDOM(id)
	type response struct {
		Code int                                   `json:"code"`
		Data apicontract.MigrateLegacyMindmapsData `json:"data"`
	}
	post := func(body string) response {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", endpoint, strings.NewReader(body)))
		requireAPIContract(t, "POST", endpoint, recorder)
		var result response
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	for _, body := range []string{"", "null", `{}`, `{"id":42,"notebook":""}`, `{"id":"missing","notebook":""}`} {
		if result := post(body); result.Code == 0 {
			t.Fatalf("invalid migration request accepted: %s", body)
		}
	}
	body, _ := json.Marshal(map[string]string{"id": docID, "notebook": boxID})
	reader := httptest.NewRequest("POST", endpoint, strings.NewReader(string(body)))
	reader.Header.Set("X-Test-Reader", "1")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, reader)
	if recorder.Code != 403 {
		t.Fatalf("reader migration was not denied: %d", recorder.Code)
	}
	if model.GetBlockDOM(id) != sourceBefore {
		t.Fatal("reader request modified source")
	}
	result := post(string(body))
	if result.Code != 0 || result.Data.Converted != 1 || len(result.Data.Blocks) != 1 || result.Data.Blocks[0].ID != id ||
		!strings.Contains(result.Data.Blocks[0].DOM, `data-type="NodeMindmap"`) {
		t.Fatalf("unexpected migration response: %+v", result)
	}
	if result = post(string(body)); result.Code != 0 || result.Data.Converted != 0 || len(result.Data.Blocks) != 1 {
		t.Fatalf("repeat migration did not return current content: %+v", result)
	}
	lute := util.NewLute()
	_, parsed := lute.Md2BlockDOMTree("- Old list root\n  - Child\n", false)
	oldList := parsed.Root.FirstChild
	oldList.SetIALAttr("custom-sy-list-mindmap", "1")
	if _, err := model.PerformBlockOperation(&model.Operation{Action: "appendInsert", ParentID: docID, Data: lute.RenderNodeBlockDOM(oldList)}); err != nil {
		t.Fatal(err)
	}
	result = post(string(body))
	if result.Code != 0 || result.Data.Converted != 1 || len(result.Data.Blocks) != 2 {
		t.Fatalf("old list migration response is incomplete: %+v", result)
	}
	var migratedOldList bool
	for _, block := range result.Data.Blocks {
		if block.ID == oldList.ID {
			migratedOldList = strings.Contains(block.DOM, `data-type="NodeMindmap"`)
		}
	}
	if !migratedOldList {
		t.Fatal("old list did not become a dedicated mind map")
	}
}
