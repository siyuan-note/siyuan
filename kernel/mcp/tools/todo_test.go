package tools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTodoWriteRejectsInvalidSessionContext(t *testing.T) {
	for _, sessionID := range []any{nil, "", "..", "20261008120000-invalid/child"} {
		result, err := todoWriteHandler(map[string]any{"_sessionID": sessionID, "todos": []any{}})
		if err != nil || !result.IsError {
			t.Fatalf("invalid session context %v was accepted: %+v, %v", sessionID, result, err)
		}
	}
}

func TestTodoWriteReturnsSessionResultWithoutSeparatePersistence(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	const sessionID = "20261008120000-abcdefg"
	args := map[string]any{
		"_sessionID": sessionID,
		"todos": []any{
			map[string]any{"content": "Pending", "status": "unknown"},
			map[string]any{"content": "Working", "status": "in_progress"},
			map[string]any{"content": "Done", "status": "completed"},
			map[string]any{"content": "Cancelled", "status": "cancelled"},
			map[string]any{"content": ""},
			"invalid",
		},
	}
	want := "Todo List\n\n- [ ] Pending\n- [/] Working\n- [x] Done\n- [-] Cancelled\n"
	result, err := todoWriteHandler(args)
	if err != nil || result.IsError || len(result.Content) != 1 || result.Content[0].Text != want {
		t.Fatalf("unexpected todo result: %+v, %v", result, err)
	}
	entries, err := os.ReadDir(util.DataDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("todo_write created separate persistence: %v, %v", entries, err)
	}
	// 已有待办文件保留原始内容，不因更新工具结果被改写或删除。
	path := filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", sessionID, "todos.json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	const previousTodos = `{"sessionID":"20261008120000-abcdefg","todos":[{"content":"Previous","status":"pending"}]}`
	if err := os.WriteFile(path, []byte(previousTodos), 0600); err != nil {
		t.Fatal(err)
	}
	args["todos"] = []any{}
	result, err = todoWriteHandler(args)
	if err != nil || result.IsError || result.Content[0].Text != "Todo list is empty." {
		t.Fatalf("empty list: %+v, %v", result, err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != previousTodos {
		t.Fatalf("existing todo data changed: %q, %v", data, err)
	}
}
