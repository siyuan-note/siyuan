package agent

import (
	"context"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAIMemoryConversationRoleBoundary(t *testing.T) {
	old := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = old })
	id := "20261029000000-session"
	dir := filepath.Join(sessionsDir(), id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	body := `{"id":"20261029000000-session","lastCommittedTurnID":"turn-1","entries":[{"id":"user-1","type":"user","content":"Concise replies"},{"id":"assistant-1","type":"assistant","content":"SECRET inferred belief"}]}`
	path := filepath.Join(dir, "session.json")
	os.WriteFile(path, []byte(body), 0600)
	text, err := readMemoryConversation(context.Background(), id, "user-1")
	if err != nil || !strings.Contains(text, "Concise replies") || strings.Contains(text, "SECRET") {
		t.Fatal(text, err)
	}
	if _, err = readMemoryConversation(context.Background(), id, "assistant-1"); err == nil {
		t.Fatal("assistant adopted as user source")
	}
	os.WriteFile(path, []byte(strings.Replace(body, `"turn-1"`, `""`, 1)), 0600)
	if _, err = readMemoryConversation(context.Background(), id, "user-1"); err == nil {
		t.Fatal("uncommitted conversation adopted")
	}
	os.Remove(path)
	if _, err = readMemoryConversation(context.Background(), id, "user-1"); err == nil {
		t.Fatal("deleted source remained available")
	}
}

func TestAIMemoryRequestProjectionDoesNotPersist(t *testing.T) {
	original := []openai.ChatCompletionMessage{{Role: "user", Content: "My actual message"}}
	context := "<untrusted_memory>{{UNRESOLVED}} remembered detail</untrusted_memory>"
	request := withAIMemoryMessages(original, context)
	if len(original) != 1 || original[0].Content != "My actual message" || len(request) != 2 || request[1].Content != context {
		t.Fatal("memory mutated original user input")
	}
	request[0].Content = "mutated request copy"
	if original[0].Content != "My actual message" {
		t.Fatal("request aliases checkpoint storage")
	}
	input := []any{map[string]any{"role": "user", "content": "original"}}
	projected := withAIMemoryResponseInput(input, context)
	if len(input) != 1 || len(projected) != 2 {
		t.Fatal("responses memory changed stored input")
	}
}

func TestAIMemoryDisabledHasNoModelCapabilityOrPrompt(t *testing.T) {
	setupCompactionAgentTest(t)
	capabilities := currentCapabilitiesForTest(t)
	if capabilities.hasModelName("memory") || strings.Contains(buildSystemPrompt("English", capabilities), "Long-term memory:") {
		t.Fatal("disabled memory consumed model capability or prompt budget")
	}
}

func TestAIMemoryRequestBudgetKeepsCurrentTask(t *testing.T) {
	messages := []openai.ChatCompletionMessage{{Role: "user", Content: "Current task"}}
	content := strings.Repeat("remembered background ", 2000)
	if got := fitAIMemoryContext("test-model", messages, nil, content, 1000, 512); got == content || !strings.Contains(got, "not loaded") {
		t.Fatal("oversized memory was not explicitly omitted")
	}
	if got := fitAIMemoryContext("test-model", messages, nil, content, 600, 512); got != "" {
		t.Fatal("no-budget request grew")
	}
	if got := fitAIMemoryContext("test-model", messages, nil, "short memory", 2000, 512); got != "short memory" {
		t.Fatal("fitting memory was dropped")
	}
	if len(messages) != 1 || messages[0].Content != "Current task" {
		t.Fatal("current task was mutated")
	}
}
