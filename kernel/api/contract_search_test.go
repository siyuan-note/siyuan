package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
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

func TestAPIContractSearchAssetFilters(t *testing.T) {
	assetsDir := setupAssetContractWorkspace(t)
	model.Conf.Search = conf.NewSearch()
	files := []string{"alpha-cover.png", "alpha-note.txt", "beta-cover.PNG", "covers/gamma-cover.webp"}
	for _, name := range files {
		path := filepath.Join(assetsDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("asset"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	cache.LoadAssets()
	t.Cleanup(func() {
		for _, name := range files {
			_ = os.Remove(filepath.Join(assetsDir, filepath.FromSlash(name)))
		}
		cache.LoadAssets()
	})
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.POST("/api/search/searchAsset", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, searchAsset)
	search := func(body string) (int, []string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/search/searchAsset", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/search/searchAsset", recorder)
		var response struct {
			Code int                        `json:"code"`
			Data []*apicontract.SearchAsset `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("asset search response: %s, %v", recorder.Body.String(), err)
		}
		var paths []string
		for _, asset := range response.Data {
			paths = append(paths, asset.Path)
		}
		return response.Code, paths
	}
	for _, entry := range []struct {
		body string
		want []string
	}{
		{`{"k":"","exts":[".png"]}`, []string{"assets/alpha-cover.png", "assets/beta-cover.PNG"}},
		{`{"k":"","exts":["png"],"match":{"mode":"suffix","value":"PHA-COVER.png"}}`, []string{"assets/alpha-cover.png"}},
		{`{"k":"","match":{"mode":"prefix","value":"ALPHA"},"page":1,"pageSize":2}`, []string{"assets/alpha-cover.png", "assets/alpha-note.txt"}},
		{`{"k":"","match":{"field":"path","mode":"prefix","value":"ASSETS/COVERS/"}}`, []string{"assets/covers/gamma-cover.webp"}},
		{`{"k":"","match":{"mode":"regex","value":"(?i)^beta-.*\\.png$"}}`, []string{"assets/beta-cover.PNG"}},
		{`{"k":"","match":{"field":"path","mode":"regex","value":"^assets/covers/.*\\.webp$"}}`, []string{"assets/covers/gamma-cover.webp"}},
	} {
		code, paths := search(entry.body)
		if code != 0 || !reflect.DeepEqual(paths, entry.want) {
			t.Fatalf("asset search %s: code=%d paths=%v", entry.body, code, paths)
		}
	}
	firstCode, first := search(`{"k":"","page":1,"pageSize":2}`)
	secondCode, second := search(`{"k":"","page":2,"pageSize":2}`)
	thirdCode, third := search(`{"k":"","page":3,"pageSize":2}`)
	_, repeated := search(`{"k":"","page":1,"pageSize":2}`)
	seen := map[string]bool{}
	for _, path := range append(first, second...) {
		seen[path] = true
	}
	if firstCode != 0 || secondCode != 0 || thirdCode != 0 || len(first) != 2 || len(second) != 2 ||
		len(third) != 0 || len(seen) != len(files) || !reflect.DeepEqual(first, repeated) {
		t.Fatalf("asset pagination changed: first=%v second=%v third=%v repeated=%v", first, second, third, repeated)
	}
	for _, body := range []string{
		`{"k":"","match":{"mode":"regex","value":"["}}`,
		`{"k":"","page":0,"pageSize":2}`,
	} {
		if code, _ := search(body); code != -1 {
			t.Fatalf("invalid asset search accepted: %s", body)
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
