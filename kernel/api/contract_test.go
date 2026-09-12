package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func requireAPIContract(t *testing.T, method, path string, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusOK || !strings.HasPrefix(recorder.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("unexpected transport response for %s: %d %v", path, recorder.Code, recorder.Header())
	}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err := bundle.ValidateResponse(method, path, recorder.Body.Bytes()); err != nil {
		t.Fatalf("response violates %s: %v\n%s", path, err, recorder.Body.String())
	}
}

func TestAPIContractNotebookConversion(t *testing.T) {
	for _, state := range []model.EncryptedBoxState{"", model.EncryptedBoxStateLocked, model.EncryptedBoxStateUnlocking,
		model.EncryptedBoxStateUnlocked, model.EncryptedBoxStateLocking, model.EncryptedBoxStateError} {
		box := &model.Box{ID: "box", Name: "Notebook", Icon: "icon", Sort: 2, SortMode: 3, Closed: true,
			SubFileCount: 4, NewFlashcardCount: 5, DueFlashcardCount: 6, FlashcardCount: 7,
			Encrypted: state != "", Unlocked: state == model.EncryptedBoxStateUnlocked, State: state}
		before, _ := json.Marshal(box)
		after, _ := json.Marshal(notebookContract(box))
		if string(before) != string(after) {
			t.Fatalf("notebook JSON changed:\n%s\n%s", before, after)
		}
		bundle, err := apicontract.BuildBundle()
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := json.Marshal(apicontract.Success(&apicontract.ListNotebooksData{Notebooks: []*apicontract.Notebook{notebookContract(box)}}))
		if err := bundle.ValidateResponse("POST", "/api/notebook/lsNotebooks", payload); err != nil {
			t.Fatal(err)
		}
	}
	if notebookContract(nil) != nil {
		t.Fatal("nil notebook changed")
	}
}

func TestAPIContractRouterCoverage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	ServeAPI(engine)
	data, err := os.ReadFile("../apicontract/legacy_routes.json")
	if err != nil {
		t.Fatal(err)
	}
	var legacy []apicontract.Route
	if err := json.Unmarshal(data, &legacy); err != nil {
		t.Fatal(err)
	}
	expected := map[string]bool{}
	for _, route := range legacy {
		methods := []string{route.Method}
		if route.Method == "ANY" {
			methods = []string{"GET", "POST", "PUT", "PATCH", "HEAD", "OPTIONS", "DELETE", "CONNECT", "TRACE"}
		}
		for _, method := range methods {
			expected[method+" "+route.Path] = true
		}
	}
	for _, definition := range apicontract.Definitions() {
		for _, method := range definition.Methods {
			expected[method+" "+definition.Path] = true
		}
	}
	for _, route := range engine.Routes() {
		key := route.Method + " " + route.Path
		if !expected[key] {
			t.Fatalf("actual router exposes an undeclared endpoint: %s", key)
		}
		delete(expected, key)
	}
	if len(expected) > 0 {
		t.Fatalf("declared routes are absent from the actual router: %v", expected)
	}
}

func TestAPIContractHandlers(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_API_CONTRACT_HANDLERS") != "1" {
		// 数据库和缓存带有进程级状态，使用独立测试进程避免污染其他测试。
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractHandlers$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_API_CONTRACT_HANDLERS=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("contract subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DataDir, util.TempDir, util.ConfDir = filepath.Join(root, "data"), root, root
	util.QueueDir = filepath.Join(root, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(root, "siyuan.db"), filepath.Join(root, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(root, "asset_content.db"), filepath.Join(root, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	util.TimeLangs["en"] = map[string]any{}
	for _, key := range []string{"albl", "blbl", "now", "1s", "xs", "1m", "xm", "1h", "xh", "1d", "xd", "1w", "xw", "1M", "xM", "1y", "2y", "xy", "max"} {
		util.TimeLangs["en"][key] = "time"
	}
	model.Conf.FileTree, model.Conf.Sync = conf.NewFileTree(), conf.NewSync()
	model.Conf.Search, model.Conf.Editor, model.Conf.Export = conf.NewSearch(), conf.NewEditor(), conf.NewExport()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	const boxID, docID = "20260912000000-boxapi1", "20260912000001-docapi1"
	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Contracts", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Contract", "Contract")
	tree.Root.SetIALAttr("custom-value", "before")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	request := func(method, path, body string, role model.Role, handlers ...gin.HandlerFunc) map[string]any {
		t.Helper()
		engine := gin.New()
		engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		engine.Handle(method, path, handlers...)
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, req)
		requireAPIContract(t, method, path, recorder)
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response
	}
	admin := model.RoleAdministrator
	for _, method := range []string{"GET", "POST"} {
		response := request(method, "/api/system/version", "", admin, version)
		if response["data"] != util.Ver {
			t.Fatal("version payload changed")
		}
	}
	info := request("POST", "/api/block/getBlockInfo", `{"id":"`+docID+`"}`, admin, getBlockInfo)
	if info["code"] != float64(0) || info["data"].(map[string]any)["rootID"] != docID {
		t.Fatalf("block info failed: %+v", info)
	}
	attrs := request("POST", "/api/attr/getBlockAttrs", `{"id":"`+docID+`"}`, admin, getBlockAttrs)
	if attrs["data"].(map[string]any)["custom-value"] != "before" {
		t.Fatal("attribute fixture was not read")
	}
	changed := request("POST", "/api/attr/setBlockAttrs", `{"id":"`+docID+`","attrs":{"custom-value":null,"custom-other":"after"}}`, admin, setBlockAttrs)
	if changed["code"] != float64(0) || changed["data"] != nil {
		t.Fatalf("attribute update failed: %+v", changed)
	}
	attrs = request("POST", "/api/attr/getBlockAttrs", `{"id":"`+docID+`"}`, admin, getBlockAttrs)
	values := attrs["data"].(map[string]any)
	if _, exists := values["custom-value"]; exists {
		t.Fatal("null did not remove the attribute")
	}
	if values["custom-other"] != "after" {
		t.Fatal("attribute update was not preserved")
	}
	tags := request("POST", "/api/search/searchTag", `{"k":""}`, admin, searchTag)
	if !reflect.DeepEqual(tags["data"].(map[string]any)["tags"], []any{}) {
		t.Fatalf("empty tag response changed: %+v", tags)
	}
	for _, body := range []string{`{}`, `{"page":null}`, `{"page":1.9,"type":0.9}`} {
		response := request("POST", "/api/history/searchHistory", body, admin, searchHistory)
		if response["code"] != float64(0) {
			t.Fatalf("history request failed: %+v", response)
		}
	}
	for _, body := range []string{"", "{}", "null", "invalid", `{"flashcard":false}`} {
		response := request("POST", "/api/notebook/lsNotebooks", body, admin, lsNotebooks)
		if response["code"] != float64(0) || len(response["data"].(map[string]any)["notebooks"].([]any)) != 1 {
			t.Fatalf("legacy notebook request changed: %+v", response)
		}
	}
	for _, entry := range []struct {
		path, body string
		handler    gin.HandlerFunc
	}{
		{"/api/attr/getBlockAttrs", `{}`, getBlockAttrs},
		{"/api/attr/setBlockAttrs", `{"id":"` + docID + `","attrs":{"x":1}}`, setBlockAttrs},
		{"/api/search/searchTag", `{"k":1}`, searchTag},
		{"/api/history/searchHistory", `{"page":"1"}`, searchHistory},
		{"/api/notebook/lsNotebooks", `{"flashcard":1}`, lsNotebooks},
		{"/api/block/getBlockInfo", `{"id":" "}`, getBlockInfo},
	} {
		response := request("POST", entry.path, entry.body, admin, entry.handler)
		if response["code"] != float64(-1) {
			t.Fatalf("invalid request did not return an error: %+v", response)
		}
	}
	readonly := request("POST", "/api/attr/setBlockAttrs", `{"id":"`+docID+`","attrs":{}}`, model.RoleReader, model.CheckReadonly, setBlockAttrs)
	if readonly["code"] != float64(-1) {
		t.Fatal("readonly middleware did not reject the write")
	}
	for _, visible := range []bool{false, true} {
		if err := model.SetPublishAccess(model.PublishAccess{{ID: docID, Visible: visible, Password: "password"}}); err != nil {
			t.Fatal(err)
		}
		response := request("POST", "/api/block/getBlockInfo", `{"id":"`+docID+`"}`, model.RoleReader, getBlockInfo)
		data := response["data"].(map[string]any)
		if data["publishAccessRequired"] != true {
			t.Fatalf("publish gate changed: %+v", response)
		}
		if _, exists := data["box"]; exists {
			t.Fatal("publish gate exposed full block information")
		}
		if !visible && data["rootTitle"] != "" {
			t.Fatal("private document title was exposed")
		}
	}
}
