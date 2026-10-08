package model

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAgentSnippetMutationsPreserveOtherEntriesAndFlags(t *testing.T) {
	setupSyncMutationTest(t)
	original := &conf.Snippet{ID: "existing", Name: "Existing", Type: "css", Content: "body{}", Enabled: true}
	if err := SetSnippet([]*conf.Snippet{original}); err != nil {
		t.Fatal(err)
	}
	created, err := MutateAgentSnippet("create", "", "", &conf.Snippet{Name: "Test", Type: "js", Content: "void 0;", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Enabled || !created.DisabledInPublish {
		t.Fatalf("unsafe defaults: %+v", created)
	}
	updated, err := MutateAgentSnippet("update", original.ID, SnippetRevision(original), &conf.Snippet{Name: "New", Content: "body{color:red}", Type: "js", DisabledInPublish: true})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Type != "css" || !updated.Enabled || updated.DisabledInPublish {
		t.Fatalf("flags changed: %+v", updated)
	}
	all, err := LoadSnippets()
	if err != nil || len(all) != 2 || all[1].ID != created.ID || all[1].Content != created.Content {
		t.Fatalf("lost unrelated entry: %+v %v", all, err)
	}
	if _, err = MutateAgentSnippet("remove", original.ID, SnippetRevision(original), nil); err == nil {
		t.Fatal("stale removal accepted")
	}
	for _, action := range []string{"enable", "disable", "remove"} {
		created, err = MutateAgentSnippet(action, created.ID, SnippetRevision(created), nil)
		if err != nil {
			t.Fatal(err)
		}
		if action == "enable" && !created.Enabled || action == "disable" && created.Enabled {
			t.Fatalf("wrong flag after %s", action)
		}
	}
	all, err = LoadSnippets()
	if err != nil || len(all) != 1 || all[0].ID != original.ID {
		t.Fatalf("remove affected another entry: %+v %v", all, err)
	}
}

func TestAgentSnippetConcurrentUpdatesRejectStaleRevision(t *testing.T) {
	setupSyncMutationTest(t)
	snippet, err := MutateAgentSnippet("create", "", "", &conf.Snippet{Name: "Test", Type: "css"})
	if err != nil {
		t.Fatal(err)
	}
	revision := SnippetRevision(snippet)
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, content := range []string{"body{color:red}", "body{color:blue}"} {
		wg.Go(func() {
			_, err := MutateAgentSnippet("update", snippet.ID, revision, &conf.Snippet{Name: "Test", Content: content})
			results <- err
		})
	}
	wg.Wait()
	close(results)
	succeeded := 0
	for err := range results {
		if err == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Fatalf("expected one successful update, got %d", succeeded)
	}
}

func TestAgentSnippetFailuresPreserveConfiguration(t *testing.T) {
	setupSyncMutationTest(t)
	snippet, err := MutateAgentSnippet("create", "", "", &conf.Snippet{Name: "Test", Type: "css", Content: "body{}"})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(util.SnippetsPath, "conf.json")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []*conf.Snippet{
		{Name: "Test", Content: "</STYLE>"}, {Name: "Test", Content: "<script>"}, {Name: " ", Content: "body{}"},
	} {
		if _, err = MutateAgentSnippet("update", snippet.ID, SnippetRevision(snippet), value); err == nil {
			t.Fatal("invalid content accepted")
		}
	}
	Conf.ReadOnly = true
	if _, err = MutateAgentSnippet("enable", snippet.ID, SnippetRevision(snippet), nil); err == nil {
		t.Fatal("read-only write accepted")
	}
	Conf.ReadOnly = false
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(original) {
		t.Fatal("failed operation changed data")
	}
	for _, data := range []string{`[{broken`, `[null]`, `[{"id":"same"},{"id":"same"}]`} {
		if err = os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = MutateAgentSnippet("create", "", "", &conf.Snippet{Name: "New", Type: "css"}); err == nil {
			t.Fatal("corrupt configuration accepted")
		}
		after, err = os.ReadFile(path)
		if err != nil || string(after) != data {
			t.Fatal("corrupt configuration overwritten")
		}
	}
}
