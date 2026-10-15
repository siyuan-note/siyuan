package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSnippetResponses(t *testing.T) {
	previous := util.SnippetsPath
	util.SnippetsPath = t.TempDir()
	t.Cleanup(func() { util.SnippetsPath = previous })
	engine := gin.New()
	engine.POST("/api/snippet/setSnippet", setSnippet)
	engine.POST("/api/snippet/getSnippet", getSnippet)
	engine.POST("/api/snippet/removeSnippet", removeSnippet)
	for _, entry := range []struct {
		path, body string
		code       int
	}{
		{"/api/snippet/setSnippet", `{"snippets":[{"id":"sample","name":"Example","type":"css","content":"body {}","enabled":true,"disabledInPublish":null}]}`, 0},
		{"/api/snippet/getSnippet", `{"type":" all ","enabled":2,"keyword":null}`, 0},
		{"/api/snippet/setSnippet", `{"snippets":[{"id":"bad","name":"bad","type":"css","content":"</style>","enabled":true}]}`, -1},
		{"/api/snippet/removeSnippet", `{"id":" sample "}`, 0},
		{"/api/snippet/getSnippet", `{"type":"css","enabled":2}`, 0},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", entry.path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("%s: %s, %v", entry.path, recorder.Body.String(), err)
		}
	}
}

func TestAPIContractSnippetModelConversion(t *testing.T) {
	for _, value := range []*conf.Snippet{nil, {ID: "id", Name: "name", Type: "css", Content: "body {}", Enabled: true, DisabledInPublish: true}} {
		before, _ := json.Marshal(value)
		after, err := json.Marshal(snippetContract(value))
		if err != nil || string(before) != string(after) {
			t.Fatalf("snippet JSON changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractSnippetRevisionCompatibility(t *testing.T) {
	previous := util.SnippetsPath
	util.SnippetsPath = t.TempDir()
	t.Cleanup(func() { util.SnippetsPath = previous })
	engine := gin.New()
	role := model.RoleAdministrator
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
	engine.POST("/api/snippet/setSnippet", setSnippet)
	engine.POST("/api/snippet/getSnippet", getSnippet)
	request := func(path, body string, want int) map[string]json.RawMessage {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var result struct {
			Code int                        `json:"code"`
			Msg  string                     `json:"msg"`
			Data map[string]json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != want {
			t.Fatalf("unexpected response: %s (%v)", recorder.Body.String(), err)
		}
		if want != 0 && result.Msg != model.ErrSnippetConflict.Error() {
			t.Fatalf("unexpected conflict: %s", result.Msg)
		}
		return result.Data
	}
	initial := request("/api/snippet/getSnippet", `{"type":"all","enabled":2}`, 0)
	var emptyRevision string
	if err := json.Unmarshal(initial["revision"], &emptyRevision); err != nil || emptyRevision == "" {
		t.Fatal("missing initial revision")
	}
	snippets := `[{"id":"one","name":"One","type":"css","enabled":true,"content":"body{}"}]`
	request("/api/snippet/setSnippet", `{"snippets":`+snippets+`,"revision":"`+emptyRevision+`"}`, 0)
	request("/api/snippet/setSnippet", `{"snippets":[],"revision":"`+emptyRevision+`"}`, -1)
	read := request("/api/snippet/getSnippet", `{"type":"all","enabled":2}`, 0)
	var current []*conf.Snippet
	if err := json.Unmarshal(read["snippets"], &current); err != nil || len(current) != 1 {
		t.Fatal("conflict removed data")
	}
	filtered := request("/api/snippet/getSnippet", `{"type":"js","enabled":2}`, 0)
	if string(filtered["revision"]) != string(read["revision"]) {
		t.Fatal("revision must describe the full store")
	}
	request("/api/snippet/setSnippet", `{"snippets":[],"revision":null}`, 0)
	request("/api/snippet/setSnippet", `{"snippets":`+snippets+`}`, 0)
	request("/api/snippet/setSnippet", `{"snippets":[],"revision":""}`, -1)
	role = model.RoleReader
	reader := request("/api/snippet/getSnippet", `{"type":"all","enabled":2}`, 0)
	if _, exists := reader["revision"]; exists {
		t.Fatal("publish reader received full-store revision")
	}
}
