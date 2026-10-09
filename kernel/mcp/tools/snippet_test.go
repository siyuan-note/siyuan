package tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupSnippetToolTest(t *testing.T, snippets []*conf.Snippet) {
	t.Helper()
	oldConf, oldPath := model.Conf, util.SnippetsPath
	model.Conf = model.NewAppConf()
	model.Conf.Snippet = conf.NewSnpt()
	util.SnippetsPath = t.TempDir()
	t.Cleanup(func() { model.Conf, util.SnippetsPath = oldConf, oldPath })
	data, err := json.Marshal(snippets)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.SnippetsPath, "conf.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func snippetToolResult(t *testing.T, args map[string]any) map[string]any {
	t.Helper()
	_, validator := LookupToolWithValidator("snippet")
	if err := validator.ValidateInput(args); err != nil {
		t.Fatal(err)
	}
	result, err := snippetHandler(args)
	if err != nil || result.IsError {
		t.Fatalf("snippet failed: %+v %v", result, err)
	}
	var payload map[string]any
	if err = json.Unmarshal([]byte(result.Content[0].Text), &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestSnippetToolPaginationAndPreview(t *testing.T) {
	snippets := []*conf.Snippet{}
	for i := 0; i < 25; i++ {
		snippets = append(snippets, &conf.Snippet{ID: fmt.Sprint(i), Name: "Theme", Type: "js", Content: strings.Repeat("字", 8010)})
	}
	setupSnippetToolTest(t, snippets)
	first := snippetToolResult(t, map[string]any{"action": "list"})
	if len(first["snippets"].([]any)) != 20 || first["nextOffset"] != float64(20) {
		t.Fatalf("bad first page: %+v", first)
	}
	if _, ok := first["snippets"].([]any)[0].(map[string]any)["content"]; ok {
		t.Fatal("list returned code")
	}
	second := snippetToolResult(t, map[string]any{"action": "list", "offset": float64(20)})
	if len(second["snippets"].([]any)) != 5 {
		t.Fatalf("bad second page: %+v", second)
	}
	page := snippetToolResult(t, map[string]any{"action": "get", "id": "0"})
	if len([]rune(page["content"].(string))) != 8000 || page["nextOffset"] != float64(8000) {
		t.Fatal("content page is not bounded")
	}
	last := snippetToolResult(t, map[string]any{"action": "get", "id": "0", "offset": float64(8000), "revision": model.SnippetRevision(snippets[0])})
	if last["content"] != strings.Repeat("字", 10) || last["truncated"] != false {
		t.Fatal("Unicode paging lost content")
	}
	stale, err := snippetHandler(map[string]any{"action": "get", "id": "0", "offset": float64(8000), "revision": strings.Repeat("0", 64)})
	if err != nil || !stale.IsError {
		t.Fatal("stale content page accepted")
	}
	preview, err := AgentSnippetPreview(map[string]any{"action": "enable", "id": "0", "revision": model.SnippetRevision(snippets[0])})
	if err != nil || preview["mayExecuteJS"] != true || preview["content"] != snippets[0].Content {
		t.Fatalf("missing executable code preview: %+v %v", preview, err)
	}
	if _, err = AgentSnippetPreview(map[string]any{"action": "enable", "id": "0", "revision": strings.Repeat("0", 64)}); err == nil {
		t.Fatal("stale preview accepted")
	}
}

func TestSnippetToolSchemaAndEffects(t *testing.T) {
	tool, validator := LookupToolWithValidator("snippet")
	if tool == nil || validator == nil || !tool.AgentOnly {
		t.Fatal("snippet tool must be agent-only")
	}
	for _, args := range []map[string]any{
		{"action": "enable", "id": "test"},
		{"action": "update", "id": "test", "revision": strings.Repeat("a", 64)},
		{"action": "get", "id": "test", "offset": 1},
		{"action": "replace", "id": "test", "revision": strings.Repeat("a", 64), "oldText": ""},
		{"action": "create", "type": "html", "name": "Test", "content": ""},
		{"action": "list", "offset": -1},
		{"action": "list", "offset": 0.5},
		{"action": "create", "type": "js", "name": "Test", "content": "", "enabled": true},
	} {
		if err := validator.ValidateInput(args); err == nil {
			t.Fatalf("invalid arguments accepted: %+v", args)
		}
	}
	for _, action := range []string{"list", "get", "create", "update", "replace", "enable", "disable", "remove"} {
		effects, ok := tool.EffectsFor(action)
		if !ok || effects.LocalWrite != (action != "list" && action != "get") {
			t.Fatalf("wrong effects: %s %+v", action, effects)
		}
	}
}

func TestSnippetToolRoundTripAndReadOnly(t *testing.T) {
	setupSnippetToolTest(t, []*conf.Snippet{})
	created := snippetToolResult(t, map[string]any{"action": "create", "type": "css", "name": "Test", "content": "body{color:red}"})["snippet"].(map[string]any)
	if created["enabled"] != false || created["disabledInPublish"] != true {
		t.Fatal("unsafe creation defaults")
	}
	for _, action := range []string{"enable", "disable", "remove"} {
		created = snippetToolResult(t, map[string]any{"action": action, "id": created["id"], "revision": created["revision"]})["snippet"].(map[string]any)
	}
	if got := snippetToolResult(t, map[string]any{"action": "list"}); got["total"] != float64(0) {
		t.Fatal("remove failed")
	}
	model.Conf.ReadOnly = true
	result, err := snippetHandler(map[string]any{"action": "create", "type": "css", "name": "Test", "content": "body{}"})
	if err != nil || !result.IsError {
		t.Fatal("read-only write accepted")
	}
}

func TestSnippetContentSearchAndPartialEdits(t *testing.T) {
	original := &conf.Snippet{ID: "one", Name: "Calendar", Type: "css", Content: ".av__calendar{border:0}", Enabled: true}
	setupSnippetToolTest(t, []*conf.Snippet{original})
	list := snippetToolResult(t, map[string]any{"action": "list", "keyword": " .AV__CALENDAR "})
	if list["total"] != float64(1) || strings.Contains(fmt.Sprint(list), "border:0") {
		t.Fatal("content search failed or leaked code")
	}
	updated := snippetToolResult(t, map[string]any{"action": "update", "id": "one", "revision": model.SnippetRevision(original), "name": "Renamed"})["snippet"].(map[string]any)
	patched := snippetToolResult(t, map[string]any{"action": "replace", "id": "one", "revision": updated["revision"], "oldText": "border:0", "newText": "outline:0"})["snippet"].(map[string]any)
	read := snippetToolResult(t, map[string]any{"action": "get", "id": "one", "revision": patched["revision"]})
	if read["content"] != ".av__calendar{outline:0}" || patched["name"] != "Renamed" || patched["enabled"] != true {
		t.Fatal("partial edit changed unrelated fields")
	}
	result, err := snippetHandler(map[string]any{"action": "get", "id": "one", "offset": float64(1)})
	if err != nil || !result.IsError {
		t.Fatal("handler accepted unversioned continuation")
	}
}
