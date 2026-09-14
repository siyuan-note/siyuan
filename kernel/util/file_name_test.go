package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFilterFileNamePortableUnicode(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"\u03a2\u01f0\ufffd\ufffd-report.pdf", "\u01f0__-report.pdf"},
		{"\ufffe\U0001ffff.pdf", ".pdf"},
		{"\ue000\U000f0000.pdf", "\ue000\U000f0000.pdf"},
		{"\u5fae\u524d\u7aef.pdf", "\u5fae\u524d\u7aef.pdf"},
		{"bad\xff.pdf", "bad_.pdf"},
		{"a/b:c.pdf", "a_b_c.pdf"},
	} {
		if got := FilterFileName(tc.input); got != tc.want {
			t.Errorf("FilterFileName(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestExistingEmojiFileNameCompatibility(t *testing.T) {
	for _, name := range []string{"\ufffd.png", "_.png", "\ue000.png"} {
		if !IsValidExistingEmojiFileName(name) {
			t.Errorf("existing emoji name rejected: %q", name)
		}
	}
	for _, name := range []string{"bad\xff.png", "[icon].png", "<img>.png", "a/b.png"} {
		if IsValidExistingEmojiFileName(name) {
			t.Errorf("unsafe emoji name accepted: %q", name)
		}
	}
	if IsValidUploadFileName("\ufffd.png") {
		t.Fatal("new upload validation accepted an unfiltered name")
	}
}

func TestRenameEmojiFilePreservesExistingDestination(t *testing.T) {
	for _, directory := range []bool{false, true} {
		t.Run(map[bool]string{false: "file", true: "directory"}[directory], func(t *testing.T) {
			root := t.TempDir()
			source, destination := filepath.Join(root, "[icon]"), filepath.Join(root, "icon")
			paths := []string{source, destination}
			for i, name := range paths {
				if directory {
					if err := os.Mkdir(name, 0700); err != nil {
						t.Fatal(err)
					}
					paths[i] = filepath.Join(name, "keep")
				}
				if err := os.WriteFile(paths[i], []byte{byte(i)}, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := RenameEmojiFile(source, destination); !os.IsExist(err) {
				t.Fatalf("expected destination-exists error, got %v", err)
			}
			for i, name := range paths {
				got, err := os.ReadFile(name)
				if err != nil || len(got) != 1 || got[0] != byte(i) {
					t.Fatalf("existing data changed: %q, %v", got, err)
				}
			}
			if err := RenameEmojiFile(source, filepath.Join(root, "available")); err != nil {
				t.Fatalf("rename to available destination failed: %v", err)
			}
		})
	}
}
