// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolDescriptionsMatchOperationContracts(t *testing.T) {
	checks := []struct {
		name string
		text string
		want []string
	}{
		{"file", FileTool.Description, []string{"conditional writes require existing parent directories", "Unconditional write creates missing parent directories"}},
		{"decision", DecisionTool.Description, []string{"1-32 independent items for every provider", "1-400 questions for OpenAI", "1-32 questions for TypeSafe"}},
		{"search", SearchTool.Description, []string{"fulltext(query, page=1, pageSize=32", "semantic(query, page=1, pageSize=32", "asset(query, page=1, pageSize=32"}},
		{"search.pageSize", SearchTool.InputSchema.Properties["pageSize"].Description, []string{"default 32", "values below 1 also use 32"}},
		{"image", ImageTool.Description, []string{"only attaches the selected image", "does not return a separate analysis"}},
		{"asset", AssetTool.Description, []string{"omitting path or passing an empty path removes all unused assets", "only when the user explicitly requests it"}},
		{"asset.path", AssetTool.InputSchema.Properties["path"].Description, []string{"omitted or empty path removes all unused assets"}},
		{"repo", RepoTool.Description, []string{"file_get reads stored file content", "file_open returns a title and preview content", "file_rollback restores that file", "file_export writes a temporary export", "<title>.sy.zip", "notebook-scoped managed path"}},
		{"repo.id", RepoTool.InputSchema.Properties["id"].Description, []string{"Snapshot ID from list for tag/checkout", "repository file ID from search or diff", "not interchangeable"}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			for _, want := range check.want {
				if !strings.Contains(check.text, want) {
					t.Errorf("description omits %q: %s", want, check.text)
				}
			}
		})
	}
	if _, exists := ImageTool.InputSchema.Properties["question"]; exists {
		t.Fatal("image must not advertise the unused question parameter")
	}
}

func TestFileWriteParentDirectoryContract(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	result, err := fileHandler(map[string]any{"action": "write", "path": "temp/nested/plain.txt", "data": "plain"})
	if err != nil || result.IsError {
		t.Fatalf("unconditional write must create missing parents: %+v, %v", result, err)
	}
	data, err := os.ReadFile(filepath.Join(workspace, "temp", "nested", "plain.txt"))
	if err != nil || string(data) != "plain" {
		t.Fatalf("unconditional write content: %q, %v", data, err)
	}
	result, err = fileHandler(map[string]any{"action": "write", "path": "temp/absent/conditional.txt", "data": "conditional", "ifAbsent": true})
	if err != nil || !result.IsError {
		t.Fatalf("conditional write must require existing parents: %+v, %v", result, err)
	}
	if _, err = os.Stat(filepath.Join(workspace, "temp", "absent")); !os.IsNotExist(err) {
		t.Fatalf("conditional write must not create its missing parent: %v", err)
	}
}

func TestDecisionItemLimitAppliesToEveryProvider(t *testing.T) {
	input := decisionInput{Action: "evaluate", Questions: []decisionQuestionInput{{ID: "q", Type: "noul", Instructions: "Relevant?"}}}
	_, validator := LookupToolWithValidator("decision")
	for i := range 33 {
		input.Items = append(input.Items, decisionItem{ID: fmt.Sprint(i), Text: "text"})
		if len(input.Items) < 32 {
			continue
		}
		data, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		wantError := len(input.Items) > 32
		if err = validator.ValidateInput(decisionArgs(t, string(data))); (err != nil) != wantError {
			t.Fatalf("schema accepted unexpected item count %d: %v", len(input.Items), err)
		}
		for _, provider := range []string{"openai", "typesafe"} {
			if _, err = decisionQuestions(input, provider); (err != nil) != wantError {
				t.Errorf("%s item count %d: %v", provider, len(input.Items), err)
			}
		}
	}
}
