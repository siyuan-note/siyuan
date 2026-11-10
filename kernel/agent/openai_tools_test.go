// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestOpenAINativeToolProjectionPreservesExecutionValidation(t *testing.T) {
	for _, tool := range []*tools.Tool{tools.SnippetTool, tools.MemoryTool} {
		t.Run(tool.Name, func(t *testing.T) {
			validator, err := tools.CompileToolValidator(tool)
			if err != nil {
				t.Fatal(err)
			}
			original := convertSchema(tool.InputSchema).(map[string]any)
			before, _ := json.Marshal(original)
			for _, protocol := range []string{util.OpenAIProtocolChatCompletions, util.OpenAIProtocolResponses} {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var payload map[string]any
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Error(err)
						return
					}
					function := payload["tools"].([]any)[0].(map[string]any)
					if !util.IsOpenAIResponsesProtocol(protocol) {
						function = function["function"].(map[string]any)
					}
					parameters := function["parameters"].(map[string]any)
					if _, exists := parameters["allOf"]; exists {
						t.Errorf("%s root allOf was sent to %s", tool.Name, protocol)
					}
					if parameters["properties"].(map[string]any)["action"] == nil {
						t.Error("action property was lost")
					}
					w.Header().Set("Content-Type", "application/json")
					if util.IsOpenAIResponsesProtocol(protocol) {
						_, _ = w.Write([]byte(`{"id":"resp_1","status":"completed","output":[]}`))
					} else {
						_, _ = w.Write([]byte(`{"id":"chat_1","choices":[{"message":{"role":"assistant","content":"OK"}}]}`))
					}
				}))
				client := util.NewAIClientWithModel("test", server.URL+"/v1", "test")
				_, err := util.CreateOpenAICompletion(context.Background(), client, protocol, openai.ChatCompletionRequest{
					Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}},
					Tools: []openai.Tool{{Type: openai.ToolTypeFunction, Function: &openai.FunctionDefinition{Name: tool.Name, Parameters: original}}},
				}, nil)
				server.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			after, _ := json.Marshal(convertSchema(tool.InputSchema))
			if string(before) != string(after) {
				t.Fatal("model projection modified the execution schema")
			}
			if err := validator.ValidateInput(map[string]any{"action": "list"}); err != nil {
				t.Fatalf("read-only list rejected: %v", err)
			}
			for _, args := range []map[string]any{{"action": "get"}, {"action": "update"}, {"action": "invalid"}} {
				if err := validator.ValidateInput(args); err == nil {
					t.Fatalf("missing action parameters or unknown action accepted: %#v", args)
				}
			}
		})
	}
}
