// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const permissionTestAVID = "20261030000000-permav1"

func writeTemplateHTTPPermissionTestAV(t *testing.T, avID, fieldID, slot, content string) {
	t.Helper()
	key := map[string]any{"id": fieldID, "type": "text", "name": "HTTP", slot: content}
	if slot == "template" {
		key["type"] = "template"
	}
	data, err := json.Marshal(map[string]any{"id": avID, "keyValues": []any{map[string]any{"key": key, "values": []any{}}}})
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(util.DataDir, "storage", "av")
	if err = os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, avID+".json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func setupTemplateHTTPPermissionTest(t *testing.T) string {
	t.Helper()
	previousData, previousConf := util.DataDir, util.ConfDir
	root := t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "conf")
	if err := os.MkdirAll(filepath.Join(util.DataDir, "templates"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		util.DataDir, util.ConfDir = previousData, previousConf
		templateHTTPPermissionStore.Lock()
		templateHTTPPermissionStore.path = ""
		templateHTTPPermissionStore.Unlock()
	})
	return filepath.Join(util.DataDir, "templates")
}

func TestTemplateHTTPPermissionFileIdentityAndPersistence(t *testing.T) {
	root := setupTemplateHTTPPermissionTest(t)
	filename := filepath.Join(root, "weather.md")
	content := `.action{httpGet "https://example.com/?key=private-template-secret"}`
	if err := os.WriteFile(filename, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	data, source, err := ReadTemplateHTTPFile(filename)
	if err != nil || string(data) != content {
		t.Fatalf("read: %s %v", data, err)
	}
	if !source.Persistable {
		t.Skip("platform does not support persistent file identity")
	}
	if allowed, err := CheckTemplateHTTPSource(source); err != nil || allowed {
		t.Fatalf("fresh source allowed: %t %v", allowed, err)
	}
	if err = GrantTemplateHTTPSource(source); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(filepath.Join(util.ConfDir, templateHTTPPermissionsFile))
	if err != nil || strings.Contains(string(stored), "private-template-secret") || strings.Contains(string(stored), "httpGet") {
		t.Fatalf("source or secret persisted: %s %v", stored, err)
	}
	templateHTTPPermissionStore.Lock()
	templateHTTPPermissionStore.path = ""
	templateHTTPPermissionStore.Unlock()
	_, reloaded, err := ReadTemplateHTTPFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	if allowed, err := CheckTemplateHTTPSource(reloaded); err != nil || !allowed {
		t.Fatalf("persisted permission lost: %t %v", allowed, err)
	}
	copyPath := filepath.Join(root, "copy.md")
	if err = os.WriteFile(copyPath, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	_, copied, err := ReadTemplateHTTPFile(copyPath)
	if err != nil {
		t.Fatal(err)
	}
	if allowed, _ := CheckTemplateHTTPSource(copied); allowed || copied.ID == reloaded.ID {
		t.Fatal("copied template inherited source permission")
	}
	if err = InvalidateTemplateHTTPFilePath(filename); err != nil {
		t.Fatal(err)
	}
	if IsTemplateHTTPSourceCurrent(reloaded) {
		t.Fatal("managed replacement left old source current")
	}
	_, replacement, err := ReadTemplateHTTPFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	if allowed, _ := CheckTemplateHTTPSource(replacement); allowed || replacement.ID == reloaded.ID {
		t.Fatal("same-byte managed replacement inherited permission")
	}
}

func TestTemplateHTTPPermissionFileChangesAndInline(t *testing.T) {
	root := setupTemplateHTTPPermissionTest(t)
	filename := filepath.Join(root, "template.md")
	if err := os.WriteFile(filename, []byte("saved"), 0600); err != nil {
		t.Fatal(err)
	}
	_, source, err := ReadTemplateHTTPFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	inline, err := ResolveTemplateHTTPInlineSource(filename, []byte("unsaved"))
	if err != nil {
		t.Fatal(err)
	}
	if inline.Persistable || GrantTemplateHTTPSource(inline) == nil {
		t.Fatal("unsaved source acquired durable permission")
	}
	if err = os.WriteFile(filename, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if IsTemplateHTTPSourceCurrent(source) || GrantTemplateHTTPSource(source) == nil {
		t.Fatal("changed file accepted stale source")
	}
	if _, _, err = ReadTemplateHTTPFile(filepath.Join(root, "..", "outside.md")); err == nil {
		t.Fatal("outside template source accepted")
	}
}

func TestTemplateHTTPPermissionDatabaseIsolationAndRevocation(t *testing.T) {
	setupTemplateHTTPPermissionTest(t)
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "same")
	source, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "same")
	if err != nil {
		t.Fatal(err)
	}
	if err = GrantTemplateHTTPSource(source); err != nil {
		t.Fatal(err)
	}
	same, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "same")
	if err != nil {
		t.Fatal(err)
	}
	if allowed, _ := CheckTemplateHTTPSource(same); !allowed || source.ID != same.ID {
		t.Fatal("stable template lost permission")
	}
	for _, parts := range [][4]string{{"encrypted", permissionTestAVID, "field", "template"}, {"global", "20261030000000-copyav1", "field", "template"}, {"global", permissionTestAVID, "other", "template"}, {"global", permissionTestAVID, "field", "renderTemplate"}} {
		other, err := ResolveTemplateHTTPDBSource(parts[0], parts[1], parts[2], parts[3], "same")
		if err != nil {
			t.Fatal(err)
		}
		if allowed, _ := CheckTemplateHTTPSource(other); allowed || other.ID == source.ID {
			t.Fatal("database source scope leaked")
		}
	}
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "changed")
	changed, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "changed")
	if err != nil {
		t.Fatal(err)
	}
	if IsTemplateHTTPSourceCurrent(source) || GrantTemplateHTTPSource(source) == nil {
		t.Fatal("old template source revived")
	}
	if err = GrantTemplateHTTPSource(changed); err != nil {
		t.Fatal(err)
	}
	if err = InvalidateTemplateHTTPDatabase("global", permissionTestAVID, "field"); err != nil {
		t.Fatal(err)
	}
	if IsTemplateHTTPSourceCurrent(changed) {
		t.Fatal("revoked database source remained current")
	}
	permissions, err := ListTemplateHTTPPermissions()
	if err != nil || len(permissions) != 0 {
		t.Fatalf("revocation not persisted: %v %v", permissions, err)
	}
}

func TestTemplateHTTPPermissionCorruptionAndWriteFailure(t *testing.T) {
	setupTemplateHTTPPermissionTest(t)
	if err := os.MkdirAll(util.ConfDir, 0700); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(util.ConfDir, templateHTTPPermissionsFile)
	if err := os.WriteFile(filename, []byte(`{"version":99,"sources":{}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "source"); err == nil {
		t.Fatal("unknown store version accepted")
	}
	if err := os.Remove(filename); err != nil {
		t.Fatal(err)
	}
	templateHTTPPermissionStore.Lock()
	templateHTTPPermissionStore.path = ""
	templateHTTPPermissionStore.Unlock()
	source, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "source")
	if err != nil {
		t.Fatal(err)
	}
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "source")
	if err = os.Mkdir(filename, 0700); err != nil {
		t.Fatal(err)
	}
	if err = GrantTemplateHTTPSource(source); err == nil {
		t.Fatal("failed persistence reported success")
	}
	if allowed, _ := CheckTemplateHTTPSource(source); allowed {
		t.Fatal("failed save granted runtime authority")
	}
	if err = os.Remove(filename); err != nil {
		t.Fatal(err)
	}
	if err = RevokeTemplateHTTPSource(source.ID); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filename)
	if err != nil || !strings.Contains(string(data), `"sources":{}`) {
		t.Fatalf("failed write was not repaired by revoke retry: %s %v", data, err)
	}
}

func TestTemplateHTTPPermissionDatabaseChecksActualSourceBeforeGrant(t *testing.T) {
	setupTemplateHTTPPermissionTest(t)
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "A")
	source, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "A")
	if err != nil {
		t.Fatal(err)
	}
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "B")
	if IsTemplateHTTPSourceCurrent(source) || GrantTemplateHTTPSource(source) == nil {
		t.Fatal("stale confirmation granted source after direct field replacement")
	}
}

func TestTemplateHTTPPermissionCallbackRunsOutsideStoreLock(t *testing.T) {
	setupTemplateHTTPPermissionTest(t)
	previous := TemplateHTTPSourceRevoked
	t.Cleanup(func() { TemplateHTTPSourceRevoked = previous })
	called := false
	TemplateHTTPSourceRevoked = func(ids []string) {
		called = true
		if _, err := ListTemplateHTTPPermissions(); err != nil {
			t.Error(err)
		}
	}
	source, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "source")
	if err != nil {
		t.Fatal(err)
	}
	if err = RevokeTemplateHTTPSource(source.ID); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("revocation notification missing")
	}
	encoded, _ := json.Marshal(TemplateHTTPPermission{ID: "id", Kind: "database", Label: "av/field", Granted: true})
	if strings.Contains(string(encoded), "sourceVersion") {
		t.Fatal("private identity exposed in management record")
	}
}

func TestTemplateHTTPPermissionDatabaseRejectsAmbiguousSource(t *testing.T) {
	setupTemplateHTTPPermissionTest(t)
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "A")
	source, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "A")
	if err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(util.DataDir, "storage", "av", permissionTestAVID+".json")
	for _, body := range []string{
		`{"id":"` + permissionTestAVID + `","spec":999,"keyValues":[{"key":{"id":"field","type":"template","template":"A"}}]}`,
		`{"id":"` + permissionTestAVID + `","keyValues":[{"key":{"id":"field","type":"template","template":"A"}},{"key":{"id":"field","type":"template","template":"A"}}]}`,
	} {
		if err = os.WriteFile(filename, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if IsTemplateHTTPSourceCurrent(source) || GrantTemplateHTTPSource(source) == nil {
			t.Fatal("ambiguous database source granted authority")
		}
	}
}
