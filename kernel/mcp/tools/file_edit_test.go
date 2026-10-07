// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func readFilePage(t *testing.T, args map[string]any) fileReadPage {
	t.Helper()
	args["action"], args["withMetadata"] = "read", true
	result, err := fileHandler(args)
	if err != nil || result.IsError {
		t.Fatalf("read failed: %s %v", probeText(result), err)
	}
	text := probeText(result)
	if len(text) >= fileJSONBudget || !json.Valid([]byte(text)) {
		t.Fatalf("invalid or oversized JSON: %d bytes", len(text))
	}
	var page fileReadPage
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatal(err)
	}
	structured, err := json.Marshal(result.StructuredContent)
	if err != nil || string(structured) != text || !result.StructuredContentSet {
		t.Fatalf("Content/StructuredContent mismatch: %v", err)
	}
	return page
}

func TestFileMetadataBoundedEscapedUTF8Pagination(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	content := strings.Repeat("<\"&\t\r\n中文🙂", 6000)
	writeProbeFile(t, filepath.Join(workspace, "source.js"), content)
	var rebuilt strings.Builder
	offset, pages := 0, 0
	revision := util.TextFileRevision([]byte(content))
	for {
		page := readFilePage(t, map[string]any{"path": "source.js", "byteOffset": offset, "lineLimit": -1, "expectedRevision": revision})
		pages++
		if page.StartByte != offset || page.EndByte != offset+len(page.Content) || page.Revision != revision || page.TotalBytes != len(content) || page.Encoding != "UTF-8" || page.Newline != "CRLF" || !utf8.ValidString(page.Content) {
			t.Fatalf("bad metadata: %+v", page)
		}
		if !page.Truncated {
			t.Fatal("partial page claimed full read")
		}
		rebuilt.WriteString(page.Content)
		if page.NextOffsetByte == nil {
			break
		}
		if *page.NextOffsetByte <= offset {
			t.Fatal("pagination failed to advance")
		}
		offset = *page.NextOffsetByte
	}
	if pages < 2 || rebuilt.String() != content {
		t.Fatalf("pagination corrupted content: pages=%d got=%d want=%d", pages, rebuilt.Len(), len(content))
	}
}

func TestFileMetadataLongLineEmptyAndLegacyCompatibility(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	for _, content := range []string{"", "one\r\ntwo\r\n", strings.Repeat("<", 40000), strings.Repeat("line\n", 400)} {
		writeProbeFile(t, filepath.Join(workspace, "source.js"), content)
		page := readFilePage(t, map[string]any{"path": "source.js"})
		if page.TotalLines != strings.Count(content, "\n")+1 {
			t.Fatalf("line count=%d", page.TotalLines)
		}
		if len(content) < 100 && (page.Truncated || page.Content != content || page.StartByte != 0 || page.EndByte != len(content)) {
			t.Fatalf("small/empty file metadata wrong: %+v", page)
		}
		legacy, err := fileRead(map[string]any{"path": "source.js"})
		lines := strings.Split(content, "\n")
		if err != nil || legacy.IsError || legacy.StructuredContent != nil || probeText(legacy) != strings.Join(lines[:min(200, len(lines))], "\n") {
			t.Fatalf("legacy format changed: %v %s", err, probeText(legacy))
		}
		full, _ := fileRead(map[string]any{"path": "source.js", "limit": float64(-1)})
		if probeText(full) != content {
			t.Fatal("legacy full read changed")
		}
	}
}

func TestFileMetadataRejectsInvalidPaginationAndStaleVersion(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	writeProbeFile(t, filepath.Join(workspace, "source.js"), "a中文\nend")
	for _, extra := range []map[string]any{
		{"offset": float64(0)}, {"byteOffset": -1}, {"byteOffset": 2}, {"byteOffset": 99}, {"byteOffset": 0.5}, {"lineLimit": "bad"}, {"expectedRevision": strings.Repeat("0", 64)},
	} {
		extra["path"], extra["withMetadata"] = "source.js", true
		if result, _ := fileRead(extra); !result.IsError {
			t.Fatalf("accepted invalid args: %v", extra)
		}
	}
	page := readFilePage(t, map[string]any{"path": "source.js", "lineLimit": 1})
	if page.Content != "a中文\n" || page.NextOffsetByte == nil || *page.NextOffsetByte != len(page.Content) {
		t.Fatalf("line page wrong: %+v", page)
	}
	writeProbeFile(t, filepath.Join(workspace, "source.js"), "updated")
	result, _ := fileRead(map[string]any{"path": "source.js", "withMetadata": true, "byteOffset": *page.NextOffsetByte, "expectedRevision": page.Revision})
	if !result.IsError || !strings.Contains(probeText(result), "revision_conflict") {
		t.Fatalf("stale page allowed: %s", probeText(result))
	}
}

func TestFileSafeMutationSchemaAndCompatibility(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	writeProbeFile(t, filepath.Join(workspace, "source.js"), "one\r\ntwo\r\n")
	page := readFilePage(t, map[string]any{"path": "source.js"})
	args := map[string]any{"action": "edit", "path": "source.js", "expectedRevision": page.Revision, "edits": []any{map[string]any{"oldText": "one", "newText": "new"}}, "dryRun": true}
	validator, err := CompileToolValidator(FileTool)
	if err != nil || validator == nil {
		t.Fatalf("schema invalid: %v", err)
	}
	result, err := fileHandler(args)
	if err != nil || result.IsError {
		t.Fatalf("preview failed: %v %s", err, probeText(result))
	}
	data, _ := os.ReadFile(filepath.Join(workspace, "source.js"))
	if string(data) != "one\r\ntwo\r\n" {
		t.Fatal("dryRun wrote")
	}
	args["dryRun"] = false
	result, _ = fileHandler(args)
	if result.IsError {
		t.Fatal(probeText(result))
	}
	data, _ = os.ReadFile(filepath.Join(workspace, "source.js"))
	if string(data) != "new\r\ntwo\r\n" {
		t.Fatal("edit failed")
	}
	result, _ = fileHandler(args)
	if !result.IsError || !strings.Contains(probeText(result), "revision_conflict") {
		t.Fatal("stale edit allowed")
	}
	result, _ = fileWrite(map[string]any{"path": "empty.js", "data": "", "ifAbsent": true})
	if result.IsError {
		t.Fatal(probeText(result))
	}
	result, _ = fileWrite(map[string]any{"path": "legacy-empty.js", "data": ""})
	if !result.IsError {
		t.Fatal("legacy empty write changed")
	}
	result, _ = fileWrite(map[string]any{"path": "new/legacy.js", "data": "legacy"})
	if result.IsError {
		t.Fatal("legacy mkdir behavior changed")
	}
	for _, action := range []string{"write", "edit", "delete", "rename", "copy"} {
		effects, ok := FileTool.EffectsFor(action)
		if !ok || !effects.LocalWrite || effects.DataEgress || effects.ExternalCost {
			t.Fatalf("unsafe effects for %s: %+v", action, effects)
		}
	}
	for _, action := range []string{"list", "read", "grep", "find", "stat"} {
		effects, ok := FileTool.EffectsFor(action)
		if !ok || !effects.LocalRead || effects.LocalWrite {
			t.Fatalf("wrong read effects for %s", action)
		}
	}
}

func TestFileSafeErrorPreservesUnknownExecutionAndBudget(t *testing.T) {
	result, err := fileSafeError(&util.TextFileError{Code: "result_unknown", Message: strings.Repeat("<", 9000), Written: true})
	if err != nil || !result.IsError || !result.ExecutionUnknown || len(probeText(result)) >= fileJSONBudget || !json.Valid([]byte(probeText(result))) {
		t.Fatalf("unknown execution response lost status or JSON validity: %+v %v", result, err)
	}
	var failure util.TextFileError
	if err := json.Unmarshal([]byte(probeText(result)), &failure); err != nil || !failure.Written || failure.Code != "result_unknown" {
		t.Fatalf("unknown execution envelope is wrong: %+v %v", failure, err)
	}
}

func managedFileFixture(t *testing.T) (context.Context, *util.PluginDevelopmentGrant, string) {
	t.Helper()
	setupProbeWorkspace(t)
	grant := &util.PluginDevelopmentGrant{SessionID: "session", TaskID: "task", PlanHash: strings.Repeat("a", 64), PlanVersion: 1, SkillVersion: "1", SkillDigest: strings.Repeat("b", 64), PackageName: "test-plugin", Frontend: "desktop", SourceRoot: filepath.Join(util.PluginProjectRoot("task"), "source"), AllowFiles: []string{"index.js", "other.js", "nested/empty.js"}}
	ctx := util.WithPluginDevelopmentAccess(context.Background(), func(string) (*util.PluginDevelopmentGrant, error) { return grant, nil })
	if _, err := util.PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	rel, _ := filepath.Rel(util.WorkspaceDir, grant.SourceRoot)
	return ctx, grant, filepath.ToSlash(rel)
}

func TestFileManagedPrivateContextAndConditionalOperations(t *testing.T) {
	ctx, grant, source := managedFileFixture(t)
	p := source + "/index.js"
	args := map[string]any{"action": "write", "path": p, "data": "one\r\n", "ifAbsent": true, "_sessionID": grant.SessionID, "consent": true}
	if result, _ := fileHandler(args); !result.IsError {
		t.Fatal("JSON consent forged managed grant")
	}
	if _, err := os.Stat(filepath.Join(grant.SourceRoot, "index.js")); !os.IsNotExist(err) {
		t.Fatal("denied write changed source")
	}
	result, _ := fileContextHandler(ctx, args)
	if result.IsError {
		t.Fatal(probeText(result))
	}
	read, _ := fileContextHandler(ctx, map[string]any{"action": "read", "path": p, "withMetadata": true})
	if read.IsError {
		t.Fatal(probeText(read))
	}
	var page fileReadPage
	if err := json.Unmarshal([]byte(probeText(read)), &page); err != nil {
		t.Fatal(err)
	}
	for _, args := range []map[string]any{
		{"action": "write", "path": p, "data": "overwrite"},
		{"action": "write", "path": source + "/outside.js", "data": "outside", "ifAbsent": true},
		{"action": "delete", "path": source, "expectedRevision": page.Revision},
		{"action": "copy", "src": p, "dst": "export.js"},
		{"action": "rename", "old": p, "new": "export.js", "expectedRevision": page.Revision},
		{"action": "delete", "path": p, "expectedRevision": page.Revision, "dryRun": true},
	} {
		if result, _ := fileContextHandler(ctx, args); !result.IsError {
			t.Fatalf("unsafe managed operation allowed: %v", args)
		}
	}
	result, _ = fileContextHandler(ctx, map[string]any{"action": "rename", "old": p, "new": source + "/other.js", "expectedRevision": page.Revision})
	if result.IsError {
		t.Fatal(probeText(result))
	}
	result, _ = fileContextHandler(ctx, map[string]any{"action": "delete", "path": source + "/other.js", "expectedRevision": page.Revision})
	if result.IsError {
		t.Fatal(probeText(result))
	}
	result, _ = fileContextHandler(ctx, map[string]any{"action": "write", "path": source + "/nested/empty.js", "data": "", "ifAbsent": true})
	if result.IsError {
		t.Fatal(probeText(result))
	}
	status, err := util.GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil || status.Pending || status.ExternalChanges {
		t.Fatalf("project not clean: %+v %v", status, err)
	}
}

func TestFileManagedRevokedGrantAndRawAncestors(t *testing.T) {
	ctx, grant, source := managedFileFixture(t)
	args := map[string]any{"action": "write", "path": source + "/index.js", "data": "one", "ifAbsent": true}
	if result, _ := fileContextHandler(ctx, args); result.IsError {
		t.Fatal(probeText(result))
	}
	denied := util.WithPluginDevelopmentAccess(context.Background(), func(string) (*util.PluginDevelopmentGrant, error) { return nil, errors.New("disabled") })
	if result, _ := fileContextHandler(denied, map[string]any{"action": "edit", "path": source + "/index.js", "expectedRevision": util.TextFileRevision([]byte("one")), "edits": []any{map[string]any{"oldText": "one", "newText": "two"}}}); !result.IsError {
		t.Fatal("disabled grant accepted")
	}
	for _, parent := range []string{"data/storage/ai/agent", "data/storage/ai/agent/plugin-projects"} {
		if result, _ := fileDelete(map[string]any{"path": parent}); !result.IsError {
			t.Fatalf("ancestor delete allowed: %s", parent)
		}
		if result, _ := fileRename(map[string]any{"old": parent, "new": "moved"}); !result.IsError {
			t.Fatalf("ancestor rename allowed: %s", parent)
		}
	}
	content, err := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js"))
	if err != nil || string(content) != "one" {
		t.Fatalf("denied operation changed source: %q %v", content, err)
	}
}

func TestFileManagedDeliveryReadableButImmutable(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	p := "temp/export/plugin-project-task-" + strings.Repeat("a", 64) + ".zip"
	abs := filepath.Join(workspace, filepath.FromSlash(p))
	writeProbeFile(t, abs, "fixture archive")
	writeProbeFile(t, filepath.Join(workspace, "ordinary.txt"), "replacement")
	if result, _ := fileRead(map[string]any{"path": p}); result.IsError || probeText(result) != "fixture archive" {
		t.Fatalf("delivery read blocked: %s", probeText(result))
	}
	for _, args := range []map[string]any{
		{"action": "write", "path": p, "data": "replacement"},
		{"action": "write", "path": p, "data": "replacement", "expectedRevision": util.TextFileRevision([]byte("fixture archive"))},
		{"action": "edit", "path": p, "expectedRevision": util.TextFileRevision([]byte("fixture archive")), "edits": []any{map[string]any{"oldText": "fixture", "newText": "changed"}}},
		{"action": "delete", "path": p},
		{"action": "rename", "old": p, "new": "ordinary.zip"},
		{"action": "copy", "src": "ordinary.txt", "dst": p},
		{"action": "delete", "path": "temp/export"},
	} {
		if result, _ := fileHandler(args); !result.IsError {
			t.Fatalf("delivery mutation allowed: %v", args)
		}
		got, err := os.ReadFile(abs)
		if err != nil || string(got) != "fixture archive" {
			t.Fatalf("denied delivery mutation changed bytes: %q %v", got, err)
		}
	}
	if err := os.Symlink(abs, filepath.Join(workspace, "delivery-alias.txt")); err == nil {
		result, _ := fileWrite(map[string]any{"path": "delivery-alias.txt", "data": "replacement"})
		if !result.IsError {
			t.Fatal("symlink alias bypassed delivery write guard")
		}
		got, err := os.ReadFile(abs)
		if err != nil || string(got) != "fixture archive" {
			t.Fatalf("denied alias changed bytes: %q %v", got, err)
		}
	}
}
