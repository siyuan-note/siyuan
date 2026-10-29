package model

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
)

func TestAIMemoryProposalValidityRequiresExplicitEvidence(t *testing.T) {
	from, until := "2030-01-01T00:00:00Z", "2031-01-01T00:00:00Z"
	sources := []memo.Source{{Evidence: from + " through " + until}}
	for _, test := range []struct {
		from, until string
		valid       bool
	}{
		{from, until, true}, {"", "", true}, {until, from, false}, {from, from, false}, {"tomorrow", "", false}, {"2029-01-01T00:00:00Z", "", false},
	} {
		err := memoryActionValidity(memoryAction{ValidFrom: test.from, ValidUntil: test.until, SourceIndexes: []int{0}}, sources)
		if (err == nil) != test.valid {
			t.Fatalf("interval %+v: %v", test, err)
		}
	}
}

func TestAIMemoryReplacementProposalChecksTarget(t *testing.T) {
	for _, scenario := range []string{"candidate", "changed-target", "different-scope"} {
		t.Run(scenario, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			ctx := context.Background()
			old, err := aiMemoryStore().Save(ctx, memo.Record{Schema: 1, Kind: "fact", Subject: "project", Scope: "workspace", State: "active", Content: "Project status pending", Sources: []memo.Source{{Kind: "user", ID: "prior", Revision: "one"}}}, "missing", "prior")
			if err != nil {
				t.Fatal(err)
			}
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				if strings.Contains(prompt, `"terms"`) {
					return `{"terms":["Project status"]}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					return "Project status pending", nil
				}
				if scenario == "changed-target" {
					changed := old.Record
					changed.Content = "Project status revised by user"
					if _, e := aiMemoryStore().Save(ctx, changed, old.Revision, "concurrent"); e != nil {
						t.Fatal(e)
					}
				}
				scope := "workspace"
				if scenario == "different-scope" {
					scope = "other"
				}
				return fmt.Sprintf(`{"actions":[{"kind":"fact","subject":"project","scope":%q,"content":"Project status completed","state":"active","sourceIndexes":[0],"supersedes":%q}]}`, scope, old.Record.ID), nil
			}
			runCtx, cancel := context.WithCancel(ctx)
			task := &memoryTask{cancel: cancel}
			runAIMemory(runCtx, cfg, apicontract.AIMemoryMaintainRequest{Text: "Project status completed", OperationID: "replacement"}, []memo.Source{{Kind: "user", ID: "replacement", Revision: "two", Evidence: "Project status completed"}}, false, task)
			if len(task.status.Results) != 1 || task.status.Results[0].Saved != (scenario == "candidate") {
				t.Fatalf("replacement result: %+v", task.status)
			}
			if scenario == "candidate" {
				created, e := aiMemoryStore().Get(ctx, task.status.Results[0].ID)
				if e != nil || created.Record.State != "candidate" || created.Record.Supersedes != old.Record.ID {
					t.Fatalf("replacement not staged: %+v %v", created, e)
				}
				prior, e := aiMemoryStore().Get(ctx, old.Record.ID)
				if e != nil || prior.Revision != old.Revision {
					t.Fatal("proposal deactivated historical fact", e)
				}
				if _, e = GetAIMemoryForModel(ctx, created.Record.ID); e == nil {
					t.Fatal("replacement candidate became usable")
				}
			}
		})
	}
}
