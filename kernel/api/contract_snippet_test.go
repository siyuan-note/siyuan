package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
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
