package util

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func managedSkillTestWorkspace(t *testing.T) {
	t.Helper()
	previous := DataDir
	DataDir = t.TempDir()
	t.Cleanup(func() { DataDir = previous })
}

func requireManagedSkill(t *testing.T, request SkillFileRequest) SkillFileData {
	t.Helper()
	data, err := ManageSkillFiles(request)
	if err != nil {
		t.Fatalf("%+v: %v", request, err)
	}
	return data
}

func TestSkillManagementRawFiles(t *testing.T) {
	managedSkillTestWorkspace(t)
	content := "---\r\nname: display-name\r\ndescription: example\r\ncustom: [one, two]\r\n---\r\n\r\nOriginal\r\n"
	requireManagedSkill(t, SkillFileRequest{Action: "create", Path: "actual-directory", Content: content})
	requireManagedSkill(t, SkillFileRequest{Action: "create", Path: "shadowed", Content: content})
	if err := os.Mkdir(filepath.Join(SkillsDir(), "incomplete"), 0755); err != nil {
		t.Fatal(err)
	}
	requireManagedSkill(t, SkillFileRequest{Action: "mkdir", Path: "actual-directory/references"})
	requireManagedSkill(t, SkillFileRequest{Action: "write", Path: "actual-directory/references/readme.md", Content: "reference\r\n"})
	resourcePath := filepath.Join(SkillsDir(), "actual-directory", "resource.bin")
	resource := []byte{0, 1, 2, 255}
	if err := os.WriteFile(resourcePath, resource, 0644); err != nil {
		t.Fatal(err)
	}
	entries := requireManagedSkill(t, SkillFileRequest{Action: "list"}).Entries
	wanted := map[string]bool{"actual-directory": false, "shadowed": false, "incomplete": false, "actual-directory/SKILL.md": true, "actual-directory/resource.bin": false, "actual-directory/references/readme.md": true}
	for _, entry := range entries {
		if editable, ok := wanted[entry.Path]; ok {
			if editable != entry.Editable {
				t.Fatalf("wrong editability: %+v", entry)
			}
			delete(wanted, entry.Path)
		}
	}
	if len(wanted) != 0 {
		t.Fatalf("missing invalid or shadowed skills: %v", wanted)
	}
	read := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "actual-directory/SKILL.md"})
	if read.Content == nil || *read.Content != content {
		t.Fatalf("source changed: %+v", read)
	}
	updated := strings.Replace(content, "Original", "Modified", 1)
	requireManagedSkill(t, SkillFileRequest{Action: "write", Path: "actual-directory/SKILL.md", Content: updated, Revision: read.Revision})
	if _, err := os.Stat(filepath.Join(SkillsDir(), "display-name")); !os.IsNotExist(err) {
		t.Fatalf("frontmatter name created another skill: %v", err)
	}
	actual, err := os.ReadFile(filepath.Join(SkillsDir(), "actual-directory", "SKILL.md"))
	if err != nil || string(actual) != updated {
		t.Fatalf("raw source changed: %q %v", actual, err)
	}
	actual, err = os.ReadFile(resourcePath)
	if err != nil || !bytes.Equal(actual, resource) {
		t.Fatalf("resource changed: %v %v", actual, err)
	}
	resourceRead := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "actual-directory/resource.bin"})
	if resourceRead.Content != nil || resourceRead.Revision == "" {
		t.Fatalf("resource exposed content or lacks revision: %+v", resourceRead)
	}
	for _, action := range []string{"write", "move", "remove"} {
		if _, err = ManageSkillFiles(SkillFileRequest{Action: action, Path: "actual-directory/resource.bin", Target: "actual-directory/resource.md", Content: "overwrite", Revision: resourceRead.Revision}); err == nil {
			t.Fatalf("resource permits %s", action)
		}
	}
	read = requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "actual-directory/SKILL.md"})
	for _, action := range []string{"move", "remove"} {
		if _, err = ManageSkillFiles(SkillFileRequest{Action: action, Path: "actual-directory/SKILL.md", Target: "actual-directory/renamed.md", Revision: read.Revision}); err == nil {
			t.Fatalf("manifest permits %s", action)
		}
	}
	directory := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "actual-directory"})
	requireManagedSkill(t, SkillFileRequest{Action: "move", Path: "actual-directory", Target: "renamed", Revision: directory.Revision})
	directory = requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "renamed"})
	requireManagedSkill(t, SkillFileRequest{Action: "remove", Path: "renamed", Revision: directory.Revision})
	if _, err = os.Stat(filepath.Join(SkillsDir(), "renamed")); !os.IsNotExist(err) {
		t.Fatalf("skill directory not removed: %v", err)
	}
}

func TestSkillManagementRevisionConflicts(t *testing.T) {
	managedSkillTestWorkspace(t)
	requireManagedSkill(t, SkillFileRequest{Action: "create", Path: "skill", Content: "first"})
	read := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "skill/SKILL.md"})
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, content := range []string{"second", "third"} {
		wg.Go(func() {
			_, err := ManageSkillFiles(SkillFileRequest{Action: "write", Path: "skill/SKILL.md", Content: content, Revision: read.Revision})
			results <- err
		})
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent writes succeeded %d times", successes)
	}
	read = requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "skill/SKILL.md"})
	if err := SaveSkill("skill", "legacy API update"); err != nil {
		t.Fatal(err)
	}
	if _, err := ManageSkillFiles(SkillFileRequest{Action: "write", Path: "skill/SKILL.md", Content: "lost update", Revision: read.Revision}); err == nil {
		t.Fatal("legacy API update was overwritten")
	}
	resourcePath := filepath.Join(SkillsDir(), "skill", "resource.bin")
	if err := os.WriteFile(resourcePath, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(resourcePath)
	if err != nil {
		t.Fatal(err)
	}
	directory := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "skill"})
	if err = os.WriteFile(resourcePath, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(resourcePath, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"move", "remove"} {
		if _, err = ManageSkillFiles(SkillFileRequest{Action: action, Path: "skill", Target: "renamed", Revision: directory.Revision}); err == nil {
			t.Fatalf("directory %s ignored a resource content change", action)
		}
	}
	actual, err := os.ReadFile(resourcePath)
	if err != nil || string(actual) != "new" {
		t.Fatalf("conflicting operation changed resource: %q %v", actual, err)
	}
}

func TestSkillManagementPathBoundaries(t *testing.T) {
	managedSkillTestWorkspace(t)
	requireManagedSkill(t, SkillFileRequest{Action: "create", Path: "skill"})
	for _, p := range []string{"", ".", "..", "../escape", "/absolute", "C:/escape", "skill\\SKILL.md", "skill/../escape.md", "skill/./file.txt", "skill//a.md", "skill/a:stream.md", "skill/CON.md", "skill/COM¹.md", "skill/CONIN$", "skill/a. ", "skill/a.", "skill/SKILL~1.MD", "skill/\x00.md"} {
		if _, err := ManageSkillFiles(SkillFileRequest{Action: "write", Path: p, Content: "outside"}); err == nil {
			t.Fatalf("accepted invalid path %q", p)
		}
	}
	for _, request := range []SkillFileRequest{
		{Action: "write", Path: "loose.md"},
		{Action: "mkdir", Path: "loose"},
		{Action: "create", Path: "skill/nested"},
		{Action: "create", Path: "skill"},
	} {
		if _, err := ManageSkillFiles(request); err == nil {
			t.Fatalf("accepted invalid operation %+v", request)
		}
	}
	requireManagedSkill(t, SkillFileRequest{Action: "mkdir", Path: "skill/sub"})
	requireManagedSkill(t, SkillFileRequest{Action: "write", Path: "skill/extra.md", Content: "original"})
	read := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "skill/extra.md"})
	for _, target := range []string{"skill/sub/extra.md", "../outside.md", "skill/SKILL.md"} {
		if _, err := ManageSkillFiles(SkillFileRequest{Action: "move", Path: "skill/extra.md", Target: target, Revision: read.Revision}); err == nil {
			t.Fatalf("accepted invalid move target %q", target)
		}
	}
	if _, err := ManageSkillFiles(SkillFileRequest{Action: "write", Path: "skill/extra.md", Content: strings.Repeat("x", maxManagedSkillSourceSize+1), Revision: read.Revision}); err == nil {
		t.Fatal("accepted oversized write")
	}
	actual := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "skill/extra.md"})
	if *actual.Content != "original" {
		t.Fatal("invalid operation changed original")
	}
}

func TestSkillManagementLinks(t *testing.T) {
	managedSkillTestWorkspace(t)
	requireManagedSkill(t, SkillFileRequest{Action: "create", Path: "skill"})
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "private.md")
	if err := os.WriteFile(outsideFile, []byte("private"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(SkillsDir(), "skill", "linked")); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	for _, request := range []SkillFileRequest{
		{Action: "read", Path: "skill/linked/private.md"},
		{Action: "write", Path: "skill/linked/private.md", Content: "overwrite"},
		{Action: "read", Path: "skill"},
		{Action: "remove", Path: "skill", Revision: "ignored"},
	} {
		if _, err := ManageSkillFiles(request); err == nil {
			t.Fatalf("accepted linked operation %+v", request)
		}
	}
	entries := requireManagedSkill(t, SkillFileRequest{Action: "list"}).Entries
	for _, entry := range entries {
		if entry.Path == "skill/linked/private.md" || (entry.Path == "skill/linked" && entry.Editable) {
			t.Fatalf("list followed link: %+v", entry)
		}
	}
	actual, err := os.ReadFile(outsideFile)
	if err != nil || string(actual) != "private" {
		t.Fatalf("outside content changed: %q %v", actual, err)
	}
}

func TestSkillManagementCommitConflict(t *testing.T) {
	managedSkillTestWorkspace(t)
	created := requireManagedSkill(t, SkillFileRequest{Action: "create", Path: "skill", Content: "original"})
	root, err := openManagedSkillsRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err = os.WriteFile(filepath.Join(SkillsDir(), "skill", "SKILL.md"), []byte("external edit"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = writeManagedSkillSource(root, "skill/SKILL.md", "stale editor", false, created.Revision); err == nil {
		t.Fatal("commit overwrote an external edit")
	}
	actual, err := root.ReadFile("skill/SKILL.md")
	if err != nil || string(actual) != "external edit" {
		t.Fatalf("external edit changed: %q %v", actual, err)
	}
	entries, err := os.ReadDir(filepath.Join(SkillsDir(), "skill"))
	if err != nil || len(entries) != 1 || entries[0].Name() != "SKILL.md" {
		t.Fatalf("failed save retained a temporary file: %v %v", entries, err)
	}
}
