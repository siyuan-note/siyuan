package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	openai "github.com/sashabaranov/go-openai"
	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func TestAgentChatResolvesSavedUserVariables(t *testing.T) {
	for _, tc := range []struct {
		name       string
		entryID    string
		regenerate bool
	}{
		{"saved user", "user-1", false},
		{"saved user without ID", "", false},
		{"regenerated user", "user-1", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupCompactionAgentTest(t)
			kernelModel.Conf.Variables.Items = []*kernelConf.Variable{{Name: "WORKSPACE", Value: "resolved workspace"}}
			const raw = "Inspect {{vars.WORKSPACE}} and $WORKSPACE"
			const resolved = "Inspect resolved workspace and resolved workspace"
			session := map[string]any{
				"id": testSessionID, "title": "variables", "createdAt": int64(1), "updatedAt": int64(1),
				"entries": []SessionEntry{{ID: "user-1", Type: "user", Content: raw}},
			}
			if _, err := SaveSession(marshalSession(t, session)); err != nil {
				t.Fatal(err)
			}
			payloads := make(chan []openai.ChatCompletionMessage, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request openai.ChatCompletionRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				payloads <- request.Messages
				flusher := prepareTestStream(t, w)
				writeTestStreamChunk(t, w, flusher, "done")
				writeTestStreamDone(t, w, flusher)
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			for event := range AgentChat(ctx, newTestOpenAIClient(server.URL), "openai", "test-model", "", 0,
				testSessionID, tc.entryID, 1, raw, nil, "English", nil, EditorContext{}, nil, tc.regenerate,
				time.Second, 0, "", time.Second, time.Second) {
				if event.Type == "error" {
					t.Fatalf("chat failed: %s", event.Error)
				}
			}
			select {
			case messages := <-payloads:
				users := 0
				for _, message := range messages {
					if message.Role == "user" {
						users++
						if message.Content != resolved {
							t.Fatalf("model received unresolved content: %q", message.Content)
						}
					}
				}
				if users != 1 {
					t.Fatalf("saved user message was duplicated: %d", users)
				}
			default:
				t.Fatal("model request was not sent")
			}
		})
	}
}
