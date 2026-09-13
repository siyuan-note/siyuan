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
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractFileTreePayloadConversions(t *testing.T) {
	compare := func(before, after []byte) {
		t.Helper()
		var left, right interface{}
		if err := json.Unmarshal(before, &left); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(after, &right); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(left, right) {
			t.Fatalf("payload changed: %s != %s", before, after)
		}
	}
	for _, result := range []*model.ReorderResult{nil, {}, {Changed: true, Notebook: "box", ParentPath: "/"}} {
		compare(syncMarshal(t, result), syncMarshal(t, fileTreeReorderContract(result)))
	}
	for _, result := range []*model.DocTreeReorderResult{nil, {}, {Changed: true, Conflict: true, Notebook: "box", ParentPath: "/"}} {
		compare(syncMarshal(t, result), syncMarshal(t, fileTreeRespectSortContract(result)))
	}
	for _, files := range [][]*model.File{nil, {}, {nil, {Path: "/doc.sy", ID: "doc", Size: 1 << 63, TitleEmpty: true}}} {
		compare(syncMarshal(t, files), syncMarshal(t, fileTreeFileContracts(files)))
	}
	for _, values := range [][]map[string]string{nil, {}, {{"path": "/", "hPath": "Box/", "box": "box", "boxIcon": ""}}, {{"path": "/doc.sy", "hPath": "Box/Doc", "box": "box", "boxIcon": "", "name": "", "alias": "alias", "newFlashcardCount": "0", "dueFlashcardCount": "1", "flashcardCount": "2"}}} {
		compare(syncMarshal(t, values), syncMarshal(t, fileTreeSearchContracts(values)))
	}
	for _, values := range [][]*DocFile{nil, {}, {nil, {ID: "parent", Children: []*DocFile{{ID: "child"}}}}} {
		compare(syncMarshal(t, values), syncMarshal(t, fileTreeDocFileContracts(values)))
	}
	for _, values := range []model.PublishAccess{nil, {}, {nil, {ID: "id", Visible: true, Password: "secret", Disable: false}}} {
		compare(syncMarshal(t, values), syncMarshal(t, fileTreePublishContracts(values)))
	}
}

func TestAPIContractFileTreeCallbackOmission(t *testing.T) {
	for _, body := range []string{`{"fromPaths":[],"toPath":"/","toNotebook":"box"}`, `{"fromPaths":[],"toPath":"/","toNotebook":"box","callback":null}`} {
		request, err := apicontract.MoveDocs.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if fileTreeCallback(request.Callback) != nil {
			t.Fatal("absent or null callback became a nonnil event value")
		}
	}
	request, err := apicontract.MoveDocs.Decode(strings.NewReader(`{"fromPaths":[],"toPath":"/","toNotebook":"box","callback":{"id":7}}`))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(syncMarshal(t, fileTreeCallback(request.Callback))); got != `{"id":7}` {
		t.Fatalf("callback changed: %s", got)
	}
}

func TestAPIContractFileTreeNoopsAndSortErrors(t *testing.T) {
	engine := gin.New()
	for path, handler := range map[string]gin.HandlerFunc{
		"getFullHPathByID": getFullHPathByID, "getIDsByHPath": getIDsByHPath, "renameDocByID": renameDocByID,
		"setSort": setSort, "setDocSortMode": setDocSortMode, "reorderDocs": reorderDocs,
		"getPathByID": getPathByID, "removeDocByID": removeDocByID,
	} {
		engine.POST("/api/filetree/"+path, handler)
	}
	for _, entry := range []struct {
		name, body string
		code       int
	}{
		{"getFullHPathByID", `{}`, 0}, {"getFullHPathByID", `{"id":null}`, 0},
		{"getIDsByHPath", `{"notebook":false}`, 0}, {"getIDsByHPath", `{"path":null,"notebook":false}`, 0},
		{"renameDocByID", `{"title":false}`, 0}, {"setSort", `{}`, -1},
		{"setDocSortMode", `{"id":"20260913000000-abcdefg"}`, -1},
		{"setDocSortMode", `{"id":"20260913000000-abcdefg","sortMode":1.0}`, -1},
		{"reorderDocs", `{"sourceIDs":[]}`, -1},
		{"getPathByID", `{"id":null}`, -1}, {"removeDocByID", `{"id":"  "}`, -1},
	} {
		path := "/api/filetree/" + entry.name
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code || string(response.Data) != "null" {
			t.Fatalf("%s: %s (%v)", path, recorder.Body.String(), err)
		}
	}
}

func TestAPIContractFileTreeEncryptedAdmission(t *testing.T) {
	const boxID = "20260913000000-encrypt"
	previousConf, previousData, previousWorkspace := model.Conf, util.DataDir, util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	t.Cleanup(func() { model.Conf, util.DataDir, util.WorkspaceDir = previousConf, previousData, previousWorkspace })
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.Role{model.RoleReader, model.RoleAdministrator} {
		engine := gin.New()
		engine.Use(boxLeaseMiddleware)
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role) })
		engine.POST("/api/filetree/getDoc", getDoc)
		engine.POST("/api/filetree/listDocsByPath", listDocsByPath)
		engine.POST("/api/filetree/listDocTree", listDocTree)
		for _, entry := range []struct {
			path, body string
			code       int
		}{
			{"getDoc", `{"id":"20260913000001-encrypt","notebook":"` + boxID + `","index":false}`, 1},
			{"listDocTree", `{"notebook":"` + boxID + `","path":false}`, -1},
			{"listDocsByPath", `{"notebook":"` + boxID + `","path":"/","sort":false}`, -1},
		} {
			path := "/api/filetree/" + entry.path
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
			requireAPIContract(t, "POST", path, recorder)
			expected := entry.code
			if role == model.RoleReader && entry.path == "getDoc" {
				expected = 3
			}
			if role == model.RoleReader && entry.path == "listDocsByPath" {
				expected = 0
			}
			var response struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != expected {
				t.Fatalf("admission changed: %s (%v)", recorder.Body.String(), err)
			}
			if entry.path == "listDocTree" && response.Msg != model.Conf.Language(314) {
				t.Fatalf("directory lease must precede path decoding: %s", recorder.Body.String())
			}
		}
	}
}

func TestAPIContractFileTreeDirectoryContents(t *testing.T) {
	previousConf, previousWorkspace, previousData := model.Conf, util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf, util.WorkspaceDir, util.DataDir = previousConf, previousWorkspace, previousData })
	const boxID = "20260913000000-dirtest"
	boxConf := conf.NewBoxConf()
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	directoryRoot := filepath.Join(util.DataDir, boxID, "folder")
	if err := os.MkdirAll(directoryRoot, 0755); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/filetree/listDocTree", listDocTree)
	for _, nested := range []bool{false, true} {
		if nested {
			directory := filepath.Join(directoryRoot, "20260913000001-parentx")
			if err := os.MkdirAll(directory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "20260913000002-childxx.sy"), nil, 0644); err != nil {
				t.Fatal(err)
			}
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/filetree/listDocTree", strings.NewReader(`{"notebook":"`+boxID+`","path":"/folder"}`)))
		requireAPIContract(t, "POST", "/api/filetree/listDocTree", recorder)
		var response struct {
			Code int                             `json:"code"`
			Data apicontract.FileTreeDocTreeData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("directory response changed: %s %v", recorder.Body.String(), err)
		}
		if !nested && response.Data.Tree != nil {
			t.Fatal("empty directory no longer returns null tree")
		}
		if nested && (len(response.Data.Tree) != 1 || len(response.Data.Tree[0].Children) != 1) {
			t.Fatalf("directory hierarchy changed: %s", recorder.Body.String())
		}
	}
}
