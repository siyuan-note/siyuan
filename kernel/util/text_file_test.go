// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func textFileFixture(t *testing.T, content string) (*os.Root, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "source.js"), []byte(content), 0751); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	return root, dir
}

func requireTextFileError(t *testing.T, err error, code string) {
	t.Helper()
	var failure *TextFileError
	if !errors.As(err, &failure) || failure.Code != code || failure.Written {
		t.Fatalf("error=%v, want %s and written=false", err, code)
	}
}

func assertTextFileUnchanged(t *testing.T, root *os.Root, content string) {
	t.Helper()
	got, err := root.ReadFile("source.js")
	if err != nil || string(got) != content {
		t.Fatalf("source changed: %q, %v", got, err)
	}
	entries, err := os.ReadDir(root.Name())
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".text-file-") {
			t.Fatalf("temporary file leaked: %s", entry.Name())
		}
	}
}

func TestTextFileEditsRejectAllConflicts(t *testing.T) {
	for _, tc := range []struct {
		name, original, code string
		edits                []TextEdit
	}{
		{"empty", "one two", "invalid_edit", nil},
		{"empty anchor", "one two", "invalid_edit", []TextEdit{{"", "x"}}},
		{"missing", "one two", "no_match", []TextEdit{{"absent", "x"}}},
		{"many", "one one", "ambiguous_match", []TextEdit{{"one", "x"}}},
		{"overlapping occurrences", "aaa", "ambiguous_match", []TextEdit{{"aa", "x"}}},
		{"duplicate", "one two", "overlapping_edit", []TextEdit{{"one", "x"}, {"one", "y"}}},
		{"overlap", "one two", "overlapping_edit", []TextEdit{{"one t", "x"}, {"two", "y"}}},
		{"original only", "one two", "no_match", []TextEdit{{"one", "new"}, {"new", "y"}}},
		{"binary replacement", "one two", "unsupported_encoding", []TextEdit{{"one", "\x00"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, _ := textFileFixture(t, tc.original)
			edits := tc.edits
			if edits == nil {
				edits = []TextEdit{}
			}
			_, err := MutateTextFile(context.Background(), root, "source.js", TextFileMutation{ExpectedRevision: TextFileRevision([]byte(tc.original)), Edits: edits})
			requireTextFileError(t, err, tc.code)
			assertTextFileUnchanged(t, root, tc.original)
		})
	}
}

func TestTextFileEditPreservesBytesModeAndPreview(t *testing.T) {
	const original = "\ufefffirst\r\nsecond\r\nthird\r\n"
	root, _ := textFileFixture(t, original)
	before, _ := root.Stat("source.js")
	request := TextFileMutation{ExpectedRevision: TextFileRevision([]byte(original)), Edits: []TextEdit{{"third", "last"}, {"first", "start"}}, DryRun: true}
	preview, err := MutateTextFile(context.Background(), root, "source.js", request)
	if err != nil || !preview.DryRun || len(preview.Ranges) != 2 || preview.Ranges[0].Index != 1 || preview.Diff == "" {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	assertTextFileUnchanged(t, root, original)
	request.DryRun = false
	result, err := MutateTextFile(context.Background(), root, "source.js", request)
	if err != nil || result.NewRevision != preview.NewRevision {
		t.Fatalf("apply=%+v err=%v", result, err)
	}
	want := "\ufeffstart\r\nsecond\r\nlast\r\n"
	assertTextFileUnchanged(t, root, want)
	after, _ := root.Stat("source.js")
	if after.Mode().Perm() != before.Mode().Perm() {
		t.Fatalf("mode changed: %v -> %v", before.Mode(), after.Mode())
	}
	_, err = MutateTextFile(context.Background(), root, "source.js", request)
	requireTextFileError(t, err, "revision_conflict")
	assertTextFileUnchanged(t, root, want)
}

func TestTextFileConditionalCreateReplaceEmpty(t *testing.T) {
	root, _ := textFileFixture(t, "original")
	_, err := MutateTextFile(context.Background(), root, "empty.js", TextFileMutation{IfAbsent: true, Content: ""})
	if err != nil {
		t.Fatal(err)
	}
	data, err := root.ReadFile("empty.js")
	if err != nil || len(data) != 0 {
		t.Fatalf("empty create=%q err=%v", data, err)
	}
	_, err = MutateTextFile(context.Background(), root, "empty.js", TextFileMutation{IfAbsent: true, Content: "overwrite"})
	requireTextFileError(t, err, "revision_conflict")
	_, err = MutateTextFile(context.Background(), root, "source.js", TextFileMutation{ExpectedRevision: TextFileRevision([]byte("original")), Content: ""})
	if err != nil {
		t.Fatal(err)
	}
	assertTextFileUnchanged(t, root, "")
}

func TestTextFileFailuresPreserveTarget(t *testing.T) {
	for _, stage := range []string{"backup", "cancel before", "cancel after temp", "external edit", "destination appears", "grant revoked"} {
		t.Run(stage, func(t *testing.T) {
			root, _ := textFileFixture(t, "original")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			request := TextFileMutation{ExpectedRevision: TextFileRevision([]byte("original")), Content: "new"}
			path := "source.js"
			want := "original"
			calls := 0
			switch stage {
			case "backup":
				request.BeforeCommit = func(string, string, ...string) error { return errors.New("checkpoint unavailable") }
			case "cancel before":
				cancel()
			case "cancel after temp":
				request.Validate = func() error {
					calls++
					if calls == 2 {
						cancel()
					}
					return nil
				}
			case "external edit":
				want = "external"
				request.BeforeCommit = func(string, string, ...string) error { return root.WriteFile(path, []byte(want), 0644) }
			case "destination appears":
				request.ExpectedRevision, request.IfAbsent, path = "", true, "new.js"
				request.BeforeCommit = func(string, string, ...string) error { return root.WriteFile(path, []byte("external"), 0644) }
			case "grant revoked":
				request.Validate = func() error {
					calls++
					if calls == 2 {
						return errors.New("plan revoked")
					}
					return nil
				}
			}
			_, err := MutateTextFile(ctx, root, path, request)
			if err == nil {
				t.Fatal("expected failure")
			}
			assertTextFileUnchanged(t, root, want)
			if stage == "destination appears" {
				data, _ := root.ReadFile(path)
				if string(data) != "external" {
					t.Fatal("overwrote concurrent create")
				}
			}
		})
	}
}

func TestTextFileAfterCommitFailureReportsUnknown(t *testing.T) {
	root, _ := textFileFixture(t, "old")
	_, err := MutateTextFile(context.Background(), root, "source.js", TextFileMutation{ExpectedRevision: TextFileRevision([]byte("old")), Content: "new", AfterCommit: func() error { return errors.New("journal unavailable") }})
	var failure *TextFileError
	if !errors.As(err, &failure) || failure.Code != "result_unknown" || !failure.Written {
		t.Fatalf("unexpected error: %v", err)
	}
	assertTextFileUnchanged(t, root, "new")
}

func TestTextFileAtomicIOFailuresPreserveTarget(t *testing.T) {
	for _, stage := range []string{"write", "short write", "sync", "close", "rename", "create link"} {
		t.Run(stage, func(t *testing.T) {
			root, _ := textFileFixture(t, "original")
			ops := defaultTextFileIO()
			injected := errors.New("synthetic filesystem failure")
			request := TextFileMutation{ExpectedRevision: TextFileRevision([]byte("original")), Content: "replacement"}
			p := "source.js"
			switch stage {
			case "write":
				ops.write = func(f *os.File, content string) (int, error) { n, _ := f.WriteString(content[:2]); return n, injected }
			case "short write":
				ops.write = func(f *os.File, content string) (int, error) { return f.WriteString(content[:2]) }
			case "sync":
				ops.sync = func(*os.File) error { return injected }
			case "close":
				ops.close = func(f *os.File) error { f.Close(); return injected }
			case "rename":
				ops.rename = func(*os.Root, string, string) error { return injected }
			case "create link":
				request.ExpectedRevision, request.IfAbsent, p = "", true, "new.js"
				ops.link = func(*os.Root, string, string) error { return injected }
			}
			_, err := mutateTextFile(context.Background(), root, p, request, ops)
			requireTextFileError(t, err, "write_failed")
			assertTextFileUnchanged(t, root, "original")
			if p != "source.js" {
				if _, err := root.Stat(p); !os.IsNotExist(err) {
					t.Fatalf("failed creation published: %v", err)
				}
			}
		})
	}
}

func TestTextFilePublishedCreateCleanupFailureReportsUnknown(t *testing.T) {
	root, _ := textFileFixture(t, "original")
	ops := defaultTextFileIO()
	ops.remove = func(*os.Root, string) error { return errors.New("synthetic unlink failure") }
	_, err := mutateTextFile(context.Background(), root, "new.js", TextFileMutation{IfAbsent: true, Content: "new"}, ops)
	var failure *TextFileError
	if !errors.As(err, &failure) || failure.Code != "result_unknown" || !failure.Written {
		t.Fatalf("unexpected error: %v", err)
	}
	assertTextFileUnchanged(t, root, "original")
	got, err := ReadTextFile(root, "new.js")
	if err != nil || got != "new" {
		t.Fatalf("published create cannot be verified: %q %v", got, err)
	}
}

func TestTextFileCancellationWhileWaitingForMutationLock(t *testing.T) {
	root, _ := textFileFixture(t, "original")
	unlock, err := lockTextFileMutation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = MutateTextFile(ctx, root, "source.js", TextFileMutation{ExpectedRevision: TextFileRevision([]byte("original")), Content: "new"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("waiting mutation not cancelled: %v", err)
	}
	assertTextFileUnchanged(t, root, "original")
}

func TestTextFileConcurrentConditionalWrites(t *testing.T) {
	for _, create := range []bool{false, true} {
		root, _ := textFileFixture(t, "original")
		request := TextFileMutation{ExpectedRevision: TextFileRevision([]byte("original")), Content: "new"}
		p := "source.js"
		if create {
			request.ExpectedRevision, request.IfAbsent, p = "", true, "new.js"
		}
		var succeeded atomic.Int32
		var wg sync.WaitGroup
		for range 16 {
			wg.Go(func() {
				if _, err := MutateTextFile(context.Background(), root, p, request); err == nil {
					succeeded.Add(1)
				}
			})
		}
		wg.Wait()
		if succeeded.Load() != 1 {
			t.Fatalf("create=%v successes=%d, want 1", create, succeeded.Load())
		}
	}
}

func TestTextFileUnsafePathsAndEncoding(t *testing.T) {
	root, dir := textFileFixture(t, "original")
	for _, p := range []string{"", ".", "../source.js", "a/../source.js", "/source.js", "a\\source.js", "a//source.js", "CON", "a:stream", "source.js."} {
		if _, err := ReadTextFile(root, p); err == nil {
			t.Errorf("unsafe path accepted: %q", p)
		}
	}
	for _, content := range []string{"\x00", "\xff", "\xff\xfeh\x00", "\x1b[0m", strings.Repeat("x", MaxTextFileBytes+1)} {
		if err := root.WriteFile("unsafe", []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadTextFile(root, "unsafe"); err == nil {
			t.Fatal("unsafe source accepted")
		}
	}
	if err := os.Link(filepath.Join(dir, "source.js"), filepath.Join(dir, "linked")); err == nil {
		if _, err = ReadTextFile(root, "source.js"); err == nil {
			t.Fatal("hardlink accepted")
		}
		root.Remove("linked")
	}
	if err := os.Symlink("source.js", filepath.Join(dir, "symlink")); err == nil {
		if _, err = ReadTextFile(root, "symlink"); err == nil {
			t.Fatal("symlink accepted")
		}
	}
	if err := root.Mkdir("directory", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(dir, filepath.Join(dir, "parent-link")); err == nil {
		if _, err = ReadTextFile(root, "parent-link/source.js"); err == nil {
			t.Fatal("linked parent accepted")
		}
	}
	if _, err := ReadTextFile(root, "directory"); err == nil {
		t.Fatal("directory accepted as file")
	}
	assertTextFileUnchanged(t, root, "original")
}

func TestTextFileParentReplacementRejected(t *testing.T) {
	root, _ := textFileFixture(t, "original")
	if err := root.Mkdir("nested", 0755); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile("nested/file.js", []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	request := TextFileMutation{ExpectedRevision: TextFileRevision([]byte("old")), Content: "new"}
	request.BeforeCommit = func(string, string, ...string) error {
		if err := root.Rename("nested", "moved"); err != nil {
			return err
		}
		if err := root.Mkdir("nested", 0755); err != nil {
			return err
		}
		return root.WriteFile("nested/file.js", []byte("external"), 0644)
	}
	_, err := MutateTextFile(context.Background(), root, "nested/file.js", request)
	requireTextFileError(t, err, "invalid_path")
	for path, expected := range map[string]string{"moved/file.js": "old", "nested/file.js": "external"} {
		actual, err := root.ReadFile(path)
		if err != nil || string(actual) != expected {
			t.Fatalf("changed wrong parent %s: %q %v", path, actual, err)
		}
	}
	entries, err := os.ReadDir(filepath.Join(root.Name(), "moved"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("temp leaked into moved parent: %v %v", entries, err)
	}
}

func TestTextFileConditionalRenameDelete(t *testing.T) {
	root, _ := textFileFixture(t, "original")
	request := TextFileMutation{ExpectedRevision: TextFileRevision([]byte("original"))}
	if err := root.WriteFile("occupied.js", []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := MutateTextFileName(context.Background(), root, "source.js", "occupied.js", request)
	requireTextFileError(t, err, "revision_conflict")
	assertTextFileUnchanged(t, root, "original")
	if _, err = MutateTextFileName(context.Background(), root, "source.js", "renamed.js", request); err != nil {
		t.Fatal(err)
	}
	if _, err = root.Stat("source.js"); !os.IsNotExist(err) {
		t.Fatalf("source still exists: %v", err)
	}
	if _, err = MutateTextFileName(context.Background(), root, "renamed.js", "", request); err != nil {
		t.Fatal(err)
	}
	if _, err = root.Stat("renamed.js"); !os.IsNotExist(err) {
		t.Fatalf("deleted still exists: %v", err)
	}
	// 已批准的二进制资源使用 project_status 返回的摘要，移动时不经文本编辑器解码或更改字节。
	binary := []byte{0, 255, 0, 1}
	if err = root.WriteFile("asset.bin", binary, 0644); err != nil {
		t.Fatal(err)
	}
	request.ExpectedRevision = TextFileRevision(binary)
	if _, err = MutateTextFileName(context.Background(), root, "asset.bin", "moved.bin", request); err != nil {
		t.Fatal(err)
	}
	if _, err = MutateTextFileName(context.Background(), root, "moved.bin", "", request); err != nil {
		t.Fatal(err)
	}
}

func TestTextFileNameMutationCancellationBeforeCommit(t *testing.T) {
	for _, target := range []string{"", "renamed.js"} {
		root, _ := textFileFixture(t, "original")
		ctx, cancel := context.WithCancel(context.Background())
		calls := 0
		request := TextFileMutation{ExpectedRevision: TextFileRevision([]byte("original")), Validate: func() error {
			calls++
			if calls == 2 {
				cancel()
			}
			return nil
		}}
		_, err := MutateTextFileName(ctx, root, "source.js", target, request)
		cancel()
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled name mutation proceeded: %v", err)
		}
		assertTextFileUnchanged(t, root, "original")
	}
}

func TestTextFileLargeBinaryAssetRenameDelete(t *testing.T) {
	root, _ := textFileFixture(t, "original")
	// 二进制资源可达项目的 16 MiB 上限，文本读取及编辑仍受独立的 8 MiB 上限约束。
	asset := make([]byte, 12*1024*1024)
	asset[len(asset)-1] = 255
	if err := root.WriteFile("asset.bin", asset, 0644); err != nil {
		t.Fatal(err)
	}
	revision := TextFileRevision(asset)
	_, err := ReadTextFile(root, "asset.bin")
	requireTextFileError(t, err, "too_large")
	_, err = MutateTextFile(context.Background(), root, "asset.bin", TextFileMutation{ExpectedRevision: revision, Content: "replacement"})
	requireTextFileError(t, err, "too_large")
	request := TextFileMutation{ExpectedRevision: revision}
	if _, err = MutateTextFileName(context.Background(), root, "asset.bin", "renamed.bin", request); err != nil {
		t.Fatalf("12 MiB asset rename failed: %v", err)
	}
	if _, err = root.Stat("asset.bin"); !os.IsNotExist(err) {
		t.Fatalf("renamed source still exists: %v", err)
	}
	actual, err := root.ReadFile("renamed.bin")
	if err != nil || len(actual) != len(asset) || TextFileRevision(actual) != revision {
		t.Fatalf("asset bytes changed during rename: bytes=%d err=%v", len(actual), err)
	}
	if _, err = MutateTextFileName(context.Background(), root, "renamed.bin", "", request); err != nil {
		t.Fatalf("12 MiB asset delete failed: %v", err)
	}
	if _, err = root.Stat("renamed.bin"); !os.IsNotExist(err) {
		t.Fatalf("deleted asset still exists: %v", err)
	}
	assertTextFileUnchanged(t, root, "original")
}
