package util

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSkillManagementTextFiles(t *testing.T) {
	managedSkillTestWorkspace(t)
	requireManagedSkill(t, SkillFileRequest{Action: "create", Path: ".hidden-skill"})
	requireManagedSkill(t, SkillFileRequest{Action: "mkdir", Path: ".hidden-skill/.claude"})
	for _, name := range []string{".config.json", "config.yaml", "run.py", "README", "notes.bin", ".claude/settings.json"} {
		t.Run(name, func(t *testing.T) {
			p := ".hidden-skill/" + name
			content := "\ufeff# 中文\r\ntext\r\n"
			written := requireManagedSkill(t, SkillFileRequest{Action: "write", Path: p, Content: content})
			read := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: p})
			if read.Content == nil || *read.Content != content || read.Revision != written.Revision || read.ReadOnlyReason != "" {
				t.Fatalf("text or BOM/line endings lost: %+v", read)
			}
			found := false
			for _, entry := range requireManagedSkill(t, SkillFileRequest{Action: "list"}).Entries {
				if entry.Path == p {
					found = entry.Editable
				}
			}
			if !found {
				t.Fatal("text file not listed as editable")
			}
			updated := requireManagedSkill(t, SkillFileRequest{Action: "write", Path: p, Content: content + "updated\r\n", Revision: read.Revision})
			if _, err := ManageSkillFiles(SkillFileRequest{Action: "write", Path: p, Content: "stale", Revision: read.Revision}); err == nil {
				t.Fatal("stale revision overwrote text")
			}
			target := p + ".renamed"
			requireManagedSkill(t, SkillFileRequest{Action: "move", Path: p, Target: target, Revision: updated.Revision})
			read = requireManagedSkill(t, SkillFileRequest{Action: "read", Path: target})
			requireManagedSkill(t, SkillFileRequest{Action: "remove", Path: target, Revision: read.Revision})
			if _, err := os.Stat(filepath.Join(SkillsDir(), filepath.FromSlash(target))); !os.IsNotExist(err) {
				t.Fatalf("text file was not deleted: %v", err)
			}
		})
	}
	// 脚本只保存文本，替换时保留执行权限。
	if runtime.GOOS != "windows" {
		p := filepath.Join(SkillsDir(), ".hidden-skill", "run.sh")
		if err := os.WriteFile(p, []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
			t.Fatal(err)
		}
		before, _ := os.Stat(p)
		read := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: ".hidden-skill/run.sh"})
		requireManagedSkill(t, SkillFileRequest{Action: "write", Path: ".hidden-skill/run.sh", Content: "#!/bin/sh\nexit 1\n", Revision: read.Revision})
		after, err := os.Stat(p)
		if err != nil || before.Mode().Perm() != after.Mode().Perm() {
			t.Fatalf("script permissions changed: %v", err)
		}
	}
}

func TestSkillManagementTextProtection(t *testing.T) {
	managedSkillTestWorkspace(t)
	requireManagedSkill(t, SkillFileRequest{Action: "create", Path: "skill"})
	for _, test := range []struct {
		name    string
		content []byte
		reason  string
	}{
		{"binary.json", []byte{'a', 0, 'b'}, "binary"},
		{"control.md", []byte{'a', 1, 'b'}, "binary"},
		{"encoding.txt", []byte{0xe9, 0x20}, "encoding"},
		{"utf16.txt", []byte{0xff, 0xfe, 'a', 0}, "encoding"},
		{"utf32.txt", []byte{0, 0, 0xfe, 0xff, 0, 0, 0, 'a'}, "encoding"},
		{"large.txt", bytes.Repeat([]byte{'a'}, maxManagedSkillSourceSize+1), "tooLarge"},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := "skill/" + test.name
			abs := filepath.Join(SkillsDir(), filepath.FromSlash(p))
			if err := os.WriteFile(abs, test.content, 0644); err != nil {
				t.Fatal(err)
			}
			read := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: p})
			if read.Content != nil || read.ReadOnlyReason != test.reason || read.Revision == "" {
				t.Fatalf("incorrect read-only response: %+v", read)
			}
			for _, entry := range requireManagedSkill(t, SkillFileRequest{Action: "list"}).Entries {
				if entry.Path == p && entry.Editable {
					t.Fatal("non-text file marked editable")
				}
			}
			for _, action := range []string{"write", "move", "remove"} {
				if _, err := ManageSkillFiles(SkillFileRequest{Action: action, Path: p, Target: p + ".txt", Content: "replacement", Revision: read.Revision}); err == nil {
					t.Fatalf("non-text file permits %s", action)
				}
			}
			if _, err := ManageSkillFiles(SkillFileRequest{Action: "write", Path: "skill/new.txt", Content: string(test.content)}); err == nil {
				t.Fatal("invalid text was written")
			}
			actual, err := os.ReadFile(abs)
			if err != nil || !bytes.Equal(actual, test.content) {
				t.Fatalf("protected bytes changed: %v", err)
			}
		})
	}
	content := strings.Repeat("a", maxManagedSkillSourceSize)
	requireManagedSkill(t, SkillFileRequest{Action: "write", Path: "skill/boundary", Content: content})
	read := requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "skill/boundary"})
	if read.Content == nil || *read.Content != content {
		t.Fatal("exact size limit must remain editable")
	}
	// 外部修改即使提供最新修订号，也不能绕过文本类型校验。
	if err := os.WriteFile(filepath.Join(SkillsDir(), "skill", "boundary"), []byte{0, 1}, 0644); err != nil {
		t.Fatal(err)
	}
	read = requireManagedSkill(t, SkillFileRequest{Action: "read", Path: "skill/boundary"})
	if _, err := ManageSkillFiles(SkillFileRequest{Action: "write", Path: "skill/boundary", Content: "overwrite", Revision: read.Revision}); err == nil {
		t.Fatal("external binary content overwritten")
	}
}
