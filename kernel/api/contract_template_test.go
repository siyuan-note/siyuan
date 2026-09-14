package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractTemplateInputs(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/template/renderSprig", renderSprig)
	engine.POST("/api/template/getDocSaveAsTemplateInfo", getDocSaveAsTemplateInfo)
	engine.POST("/api/template/docSaveAsTemplate", docSaveAsTemplate)
	for _, entry := range []struct {
		route, body string
		code        int
		content     string
	}{
		{"renderSprig", `{"template":"  text  "}`, 0, "  text  "},
		{"renderSprig", `{"template":""}`, 0, ""},
		{"renderSprig", `{"template":false}`, -1, ""},
		{"getDocSaveAsTemplateInfo", `{"id":"invalid"}`, -1, ""},
		{"docSaveAsTemplate", `{"id":"missing","name":"","overwrite":false,"directory":null}`, -1, ""},
		{"docSaveAsTemplate", `{"id":"missing","name":"","overwrite":false,"databaseMode":null}`, -1, ""},
	} {
		path := "/api/template/" + entry.route
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int     `json:"code"`
			Data *string `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("template response changed: %s, %v", recorder.Body.String(), err)
		}
		if entry.code == 0 && (response.Data == nil || *response.Data != entry.content) {
			t.Fatalf("template whitespace or empty content changed: %s", recorder.Body.String())
		}
	}
}

func TestAPIContractTemplateManagement(t *testing.T) {
	previousData := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousData })
	root := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(filepath.Join(root, "folder"), 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "sample.md")
	if err := os.WriteFile(file, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/template/manage", manageTemplateFiles)
	for _, entry := range []struct {
		body string
		code int
	}{
		{`{"action":"list"}`, 0},
		{`{"Action":"read","Path":"sample.md"}`, 0},
		{`{"action":"read","path":"folder"}`, 0},
		{`{"action":"write","path":"sample.md","content":"replacement","revision":"stale"}`, -1},
		{`{"action":"read","path":"../outside.md"}`, -1},
		{`{"action":false}`, -1},
		{`{`, -1},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/template/manage", strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", "/api/template/manage", recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("template management response changed: %s, %v", recorder.Body.String(), err)
		}
		if strings.Contains(entry.body, `"Path":"sample.md"`) && !strings.Contains(string(response.Data), `"content":"original"`) {
			t.Fatalf("template read changed: %s", response.Data)
		}
		if strings.Contains(entry.body, `"path":"folder"`) && strings.Contains(string(response.Data), `"path"`) {
			t.Fatalf("directory read gained a path field: %s", response.Data)
		}
	}
	content, err := os.ReadFile(file)
	if err != nil || string(content) != "original" {
		t.Fatalf("conflicting write changed source: %q, %v", content, err)
	}
}
