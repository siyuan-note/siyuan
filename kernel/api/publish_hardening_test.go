package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublishReaderCannotReadHiddenNotebookSavePaths(t *testing.T) {
	const boxID = "20260821140000-hiddenbox"
	oldConf, oldDataDir, oldPublishAccess := model.Conf, util.DataDir, model.GetPublishAccess()
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	t.Cleanup(func() {
		_ = model.SetPublishAccess(oldPublishAccess)
		model.Conf, util.DataDir = oldConf, oldDataDir
	})

	boxConf := conf.NewBoxConf()
	boxConf.Name = "Hidden notebook"
	boxConf.DocCreateSaveBox = boxID
	boxConf.DocCreateSavePath = "/private-docs"
	boxConf.DocCreateTemplatePath = "/private-template.sy"
	boxConf.RefCreateSaveBox = boxID
	boxConf.RefCreateSavePath = "/private-refs"
	boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(boxConfPath), 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(boxConfPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: boxID, Visible: false}}); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		handler gin.HandlerFunc
		path    string
	}{
		{name: "document creation", handler: getDocCreateSavePath, path: "/api/filetree/getDocCreateSavePath"},
		{name: "reference creation", handler: getRefCreateSavePath, path: "/api/filetree/getRefCreateSavePath"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, role := range []model.Role{model.RoleReader, model.RoleVisitor, model.RoleAdministrator} {
				engine := gin.New()
				engine.Use(func(c *gin.Context) {
					c.Set(model.RoleContextKey, role)
					c.Next()
				})
				engine.POST(test.path, test.handler)

				recorder := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(`{"notebook":"`+boxID+`"}`))
				request.Header.Set("Content-Type", "application/json")
				engine.ServeHTTP(recorder, request)

				response := struct {
					Code int            `json:"code"`
					Msg  string         `json:"msg"`
					Data map[string]any `json:"data"`
				}{}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
					t.Fatalf("unmarshal response failed: %v; body=%s", err, recorder.Body.String())
				}
				if model.IsReadOnlyRole(role) {
					if response.Code != -1 || response.Msg != "notebook ["+boxID+"] not found" || response.Data != nil {
						t.Fatalf("reader received hidden save-path configuration: role=%d body=%s", role, recorder.Body.String())
					}
					continue
				}
				if response.Code != 0 || response.Data == nil {
					t.Fatalf("administrator lost hidden-notebook save-path access: body=%s", recorder.Body.String())
				}
			}
		})
	}
}

func TestPublishReaderCannotEnumerateHiddenAttributeViewKeys(t *testing.T) {
	const (
		boxID      = "20260821135000-avbox"
		databaseID = "20260821135001-avdb"
		avID       = "20260821135002-av0001"
	)
	oldDataDir, oldBlockTreeDBPath, oldPublishAccess := util.DataDir, util.BlockTreeDBPath, model.GetPublishAccess()
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		_ = model.SetPublishAccess(oldPublishAccess)
		util.DataDir, util.BlockTreeDBPath = oldDataDir, oldBlockTreeDBPath
	})

	treenode.UpsertBlockTree(treenode.NewTree(boxID, "/"+databaseID+".sy", "/Database", "Database"))
	av.UpsertBlockRel(avID, databaseID)
	if err := model.SetPublishAccess(model.PublishAccess{{ID: databaseID, Visible: false}}); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	engine.POST("/api/av/getAttributeViewKeysByID", getAttributeViewKeysByID)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/av/getAttributeViewKeysByID", strings.NewReader(`{"avID":"`+avID+`","keyIDs":[]}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := struct {
		Code int              `json:"code"`
		Data []map[string]any `json:"data"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response failed: %v; body=%s", err, recorder.Body.String())
	}
	if response.Code != 0 || len(response.Data) != 0 {
		t.Fatalf("reader received hidden attribute-view key definitions: body=%s", recorder.Body.String())
	}
}

func TestPublishReaderCannotReadHiddenNotebookRawFile(t *testing.T) {
	const boxID = "20260821140001-hiddenbox"
	oldConf, oldDataDir, oldPublishAccess := model.Conf, util.DataDir, model.GetPublishAccess()
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	t.Cleanup(func() {
		_ = model.SetPublishAccess(oldPublishAccess)
		model.Conf, util.DataDir = oldConf, oldDataDir
	})

	boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(boxConfPath), 0755); err != nil {
		t.Fatal(err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Hidden notebook"
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(boxConfPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	secretPath := filepath.Join(util.DataDir, boxID, "20260821140002-secret.sy")
	if err := os.WriteFile(secretPath, []byte("PRIVATE_NOTE_CANARY"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: boxID, Visible: false}}); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	engine.POST("/api/file/getFile", getFile)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile", strings.NewReader(`{"path":"`+boxID+`/20260821140002-secret.sy"}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted || !strings.Contains(recorder.Body.String(), `"code":403`) {
		t.Fatalf("reader received hidden notebook raw file: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
