package api

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSearchPermissions(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	for _, entry := range []struct {
		path, body string
		role       model.Role
		readOnly   bool
		code       int
		data       string
	}{
		{"fullTextSearchBlock", `{"method":2}`, model.RoleEditor, false, -1, `null`},
		{"fullTextSearchAssetContent", `{"method":2}`, model.RoleReader, false, -1, `null`},
		{"fullTextSearchBlock", `{"method":2}`, model.RoleAdministrator, true, -1, `{"closeTimeout":5000}`},
		{"updateEmbedBlock", `invalid JSON`, model.RoleReader, false, 0, `null`},
		{"searchRefBlock", `{"reqId":{"sequence":12},"rootID":false}`, model.RoleEditor, false, 0, `{"reqId":{"sequence":12}}`},
	} {
		util.ReadOnly = entry.readOnly
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, entry.role) })
		engine.POST("/api/search/fullTextSearchBlock", fullTextSearchBlock)
		engine.POST("/api/search/fullTextSearchAssetContent", fullTextSearchAssetContent)
		engine.POST("/api/search/updateEmbedBlock", updateEmbedBlock)
		engine.POST("/api/search/searchRefBlock", searchRefBlock)
		path := "/api/search/" + entry.path
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code || string(response.Data) != entry.data {
			t.Fatalf("search permission response changed: %s: %s, %v", path, recorder.Body.String(), err)
		}
	}
}

func TestAPIContractSearchLockedNotebook(t *testing.T) {
	_, boxID := setupArchiveWorkspace(t)
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.POST("/api/search/searchRefBlock", searchRefBlock)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/search/searchRefBlock", strings.NewReader(`{"id":false,"notebook":"`+boxID+`","reqId":7}`)))
	requireAPIContract(t, "POST", "/api/search/searchRefBlock", recorder)
	var response struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != "encrypted notebook is locked, please unlock it first" || string(response.Data) != `{"reqId":7}` {
		t.Fatalf("locked ref search order changed: %s, %v", recorder.Body.String(), err)
	}
}

func TestAPIContractSearchEmbedConversion(t *testing.T) {
	for _, blocks := range [][]*model.EmbedBlock{nil, {}, {nil, {}, {Block: &model.Block{ID: "block", Children: []*model.Block{}}, BlockPaths: []*model.BlockPath{}, AllowChildOperation: true}}} {
		expected, err := json.Marshal(blocks)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(embedBlockContracts(blocks))
		if err != nil || string(actual) != string(expected) {
			t.Fatalf("embed serialization changed: %s != %s, %v", actual, expected, err)
		}
	}
}

func TestAPIContractSearchPathAndSubtypeCompatibility(t *testing.T) {
	body := `{"paths":["20260101000000-abcdefg/20260101000000-hijklmn.sy","20260101000000-abcdefg/20260101000000-hijklmn.sy","bad'box/doc.sy"],"subTypes":{"heading":{"h1":true,"h2":"true"},"list":{"t":true}}}`
	request, err := apicontract.SemanticSearchBlock.Decode(strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, paths, boxes, _, subtypes, _, _, _ := parseSearchBlockRequest(request)
	if !reflect.DeepEqual(paths, []string{"/20260101000000-hijklmn.sy"}) || !reflect.DeepEqual(boxes, []string{"20260101000000-abcdefg"}) || !reflect.DeepEqual(subtypes, map[string]bool{"h1": true, "list:t": true}) {
		t.Fatalf("search path filtering changed: %v, %v, %v", paths, boxes, subtypes)
	}
}

// 搜索查询在契约测试的独立进程内访问临时数据库。
func testSearchQueryContracts(t *testing.T, docID string) {
	t.Helper()
	for _, entry := range []struct {
		path, body string
		handler    gin.HandlerFunc
	}{
		{"searchAsset", `{"k":"missing","exts":[]}`, searchAsset},
		{"searchWidget", `{"k":" missing "}`, searchWidget},
		{"searchTemplate", `{"k":" missing "}`, searchTemplate},
		{"getAssetContent", `{"id":"missing","query":"","queryMethod":0}`, getAssetContent},
		{"getAssetContentByPath", `{"path":"assets/missing"}`, getAssetContentByPath},
		{"fullTextSearchAssetContent", `{"query":"missing","page":2}`, fullTextSearchAssetContent},
		{"listInvalidBlockRefs", `{}`, listInvalidBlockRefs},
		{"fullTextSearchBlock", `{"query":"missing"}`, fullTextSearchBlock},
		{"getEmbedBlock", `{"embedBlockID":"` + docID + `","includeIDs":[]}`, getEmbedBlock},
		{"searchEmbedBlock", `{"embedBlockID":"` + docID + `","stmt":"select * from blocks where id = 'missing'","excludeIDs":[null]}`, searchEmbedBlock},
		{"searchRefBlock", `{"id":"` + docID + `","rootID":"` + docID + `","k":"missing","beforeLen":32,"reqId":12}`, searchRefBlock},
	} {
		engine := gin.New()
		engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
		path := "/api/search/" + entry.path
		engine.POST(path, entry.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("search query failed: %s: %s, %v", path, recorder.Body.String(), err)
		}
	}
}
