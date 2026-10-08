package model

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
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
	created, err := MutateAgentSnippet("create", "", "", agentSnippetEdit(&conf.Snippet{Name: "Test", Type: "js", Content: "void 0;", Enabled: true}))
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Enabled || !created.DisabledInPublish {
		t.Fatalf("unsafe defaults: %+v", created)
	}
	updated, err := MutateAgentSnippet("update", original.ID, SnippetRevision(original), agentSnippetEdit(&conf.Snippet{Name: "New", Content: "body{color:red}", Type: "js", DisabledInPublish: true}))
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
	snippet, err := MutateAgentSnippet("create", "", "", agentSnippetEdit(&conf.Snippet{Name: "Test", Type: "css"}))
	if err != nil {
		t.Fatal(err)
	}
	revision := SnippetRevision(snippet)
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, content := range []string{"body{color:red}", "body{color:blue}"} {
		wg.Go(func() {
			_, err := MutateAgentSnippet("update", snippet.ID, revision, agentSnippetEdit(&conf.Snippet{Name: "Test", Content: content}))
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
	snippet, err := MutateAgentSnippet("create", "", "", agentSnippetEdit(&conf.Snippet{Name: "Test", Type: "css", Content: "body{}"}))
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
		if _, err = MutateAgentSnippet("update", snippet.ID, SnippetRevision(snippet), agentSnippetEdit(value)); err == nil {
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
		if _, err = MutateAgentSnippet("create", "", "", agentSnippetEdit(&conf.Snippet{Name: "New", Type: "css"})); err == nil {
			t.Fatal("corrupt configuration accepted")
		}
		after, err = os.ReadFile(path)
		if err != nil || string(after) != data {
			t.Fatal("corrupt configuration overwritten")
		}
	}
}

func agentSnippetEdit(value *conf.Snippet) *AgentSnippetEdit {
	return &AgentSnippetEdit{Type: value.Type, Name: &value.Name, Content: &value.Content}
}

func TestAgentSnippetLargeContentAndUniqueReplacement(t *testing.T) {
	setupSyncMutationTest(t)
	large := strings.Repeat("/* existing code */", 5000) + ".target{border:0}"
	snippet := &conf.Snippet{ID: "large", Name: strings.Repeat("n", 300), Type: "css", Content: large}
	if err := SetSnippet([]*conf.Snippet{snippet}); err != nil {
		t.Fatal(err)
	}
	snippet, err := MutateAgentSnippet("enable", snippet.ID, SnippetRevision(snippet), nil)
	if err != nil || !snippet.Enabled || snippet.Content != large {
		t.Fatalf("large existing enable: %v", err)
	}
	name := "Renamed"
	snippet, err = MutateAgentSnippet("update", snippet.ID, SnippetRevision(snippet), &AgentSnippetEdit{Name: &name})
	if err != nil || snippet.Name != name || snippet.Content != large {
		t.Fatalf("rename rewrote code: %v", err)
	}
	oldText, newText := ".target{border:0}", ".target{outline:0}"
	revision := SnippetRevision(snippet)
	snippet, err = MutateAgentSnippet("replace", snippet.ID, revision, &AgentSnippetEdit{OldText: &oldText, NewText: &newText})
	if err != nil || snippet.Content != strings.TrimSuffix(large, oldText)+newText || !snippet.Enabled {
		t.Fatalf("local replacement: %v", err)
	}
	if _, err = MutateAgentSnippet("replace", snippet.ID, revision, &AgentSnippetEdit{OldText: &newText, NewText: &oldText}); err == nil {
		t.Fatal("stale patch accepted")
	}
	tooLarge := strings.Repeat("x", 65537)
	if _, err = MutateAgentSnippet("update", snippet.ID, SnippetRevision(snippet), &AgentSnippetEdit{Content: &tooLarge}); err == nil {
		t.Fatal("oversized replacement accepted")
	}
	if _, err = MutateAgentSnippet("create", "", "", &AgentSnippetEdit{Type: "css", Name: &name, Content: &tooLarge}); err == nil {
		t.Fatal("oversized creation accepted")
	}
	for _, content := range []string{"aaa", "aaXaa", "none"} {
		snippet.Content = content
		if err = SetSnippet([]*conf.Snippet{snippet}); err != nil {
			t.Fatal(err)
		}
		oldText = "aa"
		if _, err = MutateAgentSnippet("replace", snippet.ID, SnippetRevision(snippet), &AgentSnippetEdit{OldText: &oldText, NewText: &newText}); err == nil {
			t.Fatalf("ambiguous/missing match accepted: %s", content)
		}
		stored, err := LoadSnippets()
		if err != nil || stored[0].Content != content {
			t.Fatal("failed replacement changed content")
		}
	}
}

func TestSnippetListRevisionProtectsAgentChanges(t *testing.T) {
	setupSyncMutationTest(t)
	old := []*conf.Snippet{{ID: "one", Name: "One", Type: "css", Content: "body{}"}}
	if err := SetSnippet(old); err != nil {
		t.Fatal(err)
	}
	revision := SnippetsRevision(old)
	name, content := "Two", "a{}"
	if _, err := MutateAgentSnippet("create", "", "", &AgentSnippetEdit{Type: "css", Name: &name, Content: &content}); err != nil {
		t.Fatal(err)
	}
	if err := SetSnippet(old, revision); !errors.Is(err, ErrSnippetConflict) {
		t.Fatalf("stale list accepted: %v", err)
	}
	current, err := LoadSnippets()
	if err != nil || len(current) != 2 {
		t.Fatal("agent-created entry was lost")
	}
	if err = SetSnippet(current, SnippetsRevision(current)); err != nil {
		t.Fatal(err)
	}
	if err = SetSnippet(old); err != nil {
		t.Fatal("legacy unconditional save no longer works")
	}
}

func TestSnippetConcurrentDialogAndAgentSave(t *testing.T) {
	setupSyncMutationTest(t)
	initial := []*conf.Snippet{{ID: "one", Name: "Original", Type: "css", Content: "body{}"}}
	if err := SetSnippet(initial); err != nil {
		t.Fatal(err)
	}
	listRevision, itemRevision := SnippetsRevision(initial), SnippetRevision(initial[0])
	results := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Go(func() {
		results <- SetSnippet([]*conf.Snippet{{ID: "one", Name: "Dialog", Type: "css", Content: "body{}"}}, listRevision)
	})
	wg.Go(func() {
		name := "Agent"
		_, err := MutateAgentSnippet("update", "one", itemRevision, &AgentSnippetEdit{Name: &name})
		results <- err
	})
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("concurrent stale saves succeeded: %d", success)
	}
}
