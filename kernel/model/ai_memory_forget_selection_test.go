// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMemoryForgetSelectionStrictCanonicalSnapshot(t *testing.T) {
	_, entry, q, _, _ := memoryForgetFixture(t, "Forget my coffee preference", "workspace")
	revisions := map[string]memo.Entry{entry.Record.ID: entry}
	valid := `{"targetIDs":["` + entry.Record.ID + `"]}`
	proposal, err := decodeMemoryForgetSelection(valid, q.Text, revisions)
	if err != nil || len(proposal.Actions) != 1 {
		t.Fatalf("valid selection: %+v %v", proposal, err)
	}
	a := proposal.Actions[0]
	if a.Content != entry.Record.Content || a.Instruction != q.Text || a.Subject != entry.Record.Subject || a.Scope != entry.Record.Scope || a.Kind != entry.Record.Kind || a.Operation != "forget" {
		t.Fatalf("noncanonical action: %+v", a)
	}
	for _, raw := range []string{"```json\n" + valid + "\n```", `{}`, `{"targetIDs":null}`, `{"targetIDs":"` + entry.Record.ID + `"}`, `{"targetIDs":[17]}`, `{"targetIDs":[]}`, `{"targetIDs":["unknown"]}`, `{"targetIDs":["` + entry.Record.ID + `","` + entry.Record.ID + `"]}`, `{"targetIDs":["` + entry.Record.ID + `"],"content":"opposite"}`, valid + ` {}`, `{"actions":[]}`} {
		if _, err = decodeMemoryForgetSelection(raw, q.Text, revisions); err == nil {
			t.Fatalf("invalid response accepted: %s", raw)
		}
	}
}

func TestAIMemoryForgetCandidateContentBudget(t *testing.T) {
	cfg, entry, q, sources, _ := memoryForgetFixture(t, "Forget my coffee preference", "workspace")
	entries := []memo.Entry{entry}
	for i := 0; i < 4; i++ {
		other, err := aiMemoryStore().Save(context.Background(), memo.Record{
			Schema: 1, Kind: "fact", Subject: "project", Scope: "workspace", State: "candidate",
			Content: strings.Repeat("Unrelated project fact ", 1500),
			Sources: []memo.Source{{Kind: "user", ID: "project-source", Revision: "one", Evidence: "Project source"}},
		}, "missing", fmt.Sprintf("large-content:%d", i))
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, other)
	}
	calls := 0
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		calls++
		if calls != 1 {
			t.Fatal("over-budget candidate content reached the model")
		}
		return `{"intent":"forget","terms":["coffee"]}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, q, sources, false, task)
	if task.status.State != "failed" || task.status.Error != "memory candidate context exceeds budget; narrow the request" || len(task.status.Results) != 0 || calls != 1 {
		t.Fatalf("candidate budget not enforced: %+v calls=%d", task.status, calls)
	}
	for _, old := range entries {
		current, err := aiMemoryStore().Get(context.Background(), old.Record.ID)
		if err != nil || current.Revision != old.Revision {
			t.Fatal("over-budget request changed a record")
		}
	}
}

func TestAIMemoryForgetSearchOmitsCommandWords(t *testing.T) {
	cfg, target, q, sources, _ := memoryForgetFixture(t, "Forget the coffee preference", "workspace")
	for i := 0; i < 101; i++ {
		_, err := aiMemoryStore().Save(context.Background(), memo.Record{Kind: "fact", Subject: "project", Scope: "workspace", State: "candidate", Content: fmt.Sprintf("The project fact %d", i), Sources: []memo.Source{{Kind: "user", ID: "project", Revision: "one", Evidence: "The project"}}}, "missing", fmt.Sprintf("command-word:%d", i))
		if err != nil {
			t.Fatal(err)
		}
	}
	calls := 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		calls++
		if calls == 1 {
			return `{"intent":"forget","terms":["coffee"]}`, nil
		}
		if strings.HasPrefix(prompt, "Verify a memory forget request") {
			return `{"authorizedIDs":["` + target.Record.ID + `"]}`, nil
		}
		return `{"targetIDs":["` + target.Record.ID + `"]}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, q, sources, false, task)
	if task.status.State != "completed" || len(task.status.Results) != 1 || !task.status.Results[0].Saved || calls != 3 {
		t.Fatalf("command words widened neutral topic retrieval: %+v calls=%d", task.status, calls)
	}
}

func TestAIMemoryForgetProductionHTTPProtocols(t *testing.T) {
	for _, protocol := range []string{util.OpenAIProtocolResponses, util.OpenAIProtocolChatCompletions} {
		t.Run(protocol, func(t *testing.T) {
			cfg, entry, q, sources, _ := memoryForgetFixture(t, "删掉中西文空格规则", "workspace")
			r := entry.Record
			r.Content = "中西文之间不加空格"
			var err error
			entry, err = aiMemoryStore().Save(context.Background(), r, entry.Revision, "spacing")
			if err != nil {
				t.Fatal(err)
			}
			// 少量候选也可能携带很大的来源快照，删除匹配只需要完整记忆正文。
			others := []memo.Entry{}
			for i := 0; i < 4; i++ {
				other, saveErr := aiMemoryStore().Save(context.Background(), memo.Record{
					Schema: 1, Kind: "fact", Subject: "project", Scope: "workspace", State: "candidate",
					Content: fmt.Sprintf("Unrelated project fact %d", i),
					Sources: []memo.Source{{Kind: "user", ID: "project-source", Revision: "one", Evidence: strings.Repeat("PRIVATE_SOURCE_EVIDENCE", 1500)}},
				}, "missing", fmt.Sprintf("PRIVATE_MEMORY_OPERATION:%d", i))
				if saveErr != nil {
					t.Fatal(saveErr)
				}
				others = append(others, other)
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				encoded, _ := json.Marshal(payload)
				request := string(encoded)
				var content string
				switch calls {
				case 1:
					if !strings.Contains(request, "Classify the complete manual Text") {
						t.Error("missing intent prompt")
					}
					content = `{"intent":"forget","terms":["中西文","空格"]}`
				case 2:
					if !strings.Contains(request, "Select existing memories to forget") || strings.Contains(request, "existing ID or empty") || strings.Contains(request, "Optional validFrom") {
						t.Error("forget request contains conflicting save schema")
					}
					if !strings.Contains(request, entry.Record.ID) || !strings.Contains(request, entry.Record.Content) {
						t.Error("missing actual snapshot candidate")
					}
					for _, other := range others {
						if !strings.Contains(request, other.Record.ID) || !strings.Contains(request, other.Record.Content) {
							t.Error("candidate omitted from forget selection")
						}
					}
					if strings.Contains(request, "PRIVATE_SOURCE_EVIDENCE") || strings.Contains(request, "PRIVATE_MEMORY_OPERATION") {
						t.Error("forget selection included source evidence or operation metadata")
					}
					content = `{"targetIDs":["` + entry.Record.ID + `"]}`
				case 3:
					if !strings.Contains(request, "Verify a memory forget request") || !strings.Contains(request, q.Text) || !strings.Contains(request, "negative fact being deleted") {
						t.Error("missing independent full intent verification")
					}
					for _, other := range others {
						if !strings.Contains(request, other.Record.ID) || !strings.Contains(request, other.Record.Content) {
							t.Error("candidate omitted from forget verification")
						}
					}
					if strings.Contains(request, "PRIVATE_SOURCE_EVIDENCE") || strings.Contains(request, "PRIVATE_MEMORY_OPERATION") {
						t.Error("forget verification included source evidence or operation metadata")
					}
					content = `{"authorizedIDs":["` + entry.Record.ID + `"]}`
				default:
					t.Errorf("unexpected model request %d", calls)
					w.WriteHeader(500)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				if protocol == util.OpenAIProtocolResponses {
					if r.URL.Path != "/v1/responses" {
						t.Error(r.URL.Path)
					}
					json.NewEncoder(w).Encode(map[string]any{"id": "resp_test", "status": "completed", "output": []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": content}}}}})
				} else {
					if r.URL.Path != "/v1/chat/completions" {
						t.Error(r.URL.Path)
					}
					json.NewEncoder(w).Encode(map[string]any{"id": "chat_test", "choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": content}}}})
				}
			}))
			defer server.Close()
			cfg.Providers[0].BaseURL = server.URL + "/v1"
			cfg.Providers[0].Protocol = protocol
			ctx, cancel := context.WithCancel(context.Background())
			task := &memoryTask{cancel: cancel}
			runAIMemory(ctx, cfg, q, sources, false, task)
			if task.status.State != "completed" || len(task.status.Results) != 1 || !task.status.Results[0].Saved || calls != 3 {
				t.Fatalf("production pipeline: %+v calls=%d", task.status, calls)
			}
			if _, err = aiMemoryStore().Get(context.Background(), entry.Record.ID); err == nil {
				t.Fatal("target remains")
			}
			for _, other := range others {
				current, readErr := aiMemoryStore().Get(context.Background(), other.Record.ID)
				if readErr != nil || current.Revision != other.Revision {
					t.Fatal("unrelated candidate changed")
				}
			}
			view, err := ReadAIMemoryOverview(context.Background())
			if err != nil || view.Stale || view.Memory != "" || view.Count != 0 {
				t.Fatal(fmt.Sprintf("overview %+v %v", view, err))
			}
		})
	}
}
