// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"testing"
)

func TestTemplateHTTPCheckoutSourcePaths(t *testing.T) {
	for _, test := range []struct {
		name, owner, avID string
		ok                bool
	}{
		{"/storage/av/field.json", "global", "field", true},
		{"/encrypted-box/storage/av/field.json", "encrypted-box", "field", true},
		{"/storage/av/.json", "", "", false},
		{"/storage/av/field.json.bak", "", "", false},
		{"/assets/storage/av/deeper/field.json", "", "", false},
		{"/templates/example.md", "", "", false},
	} {
		owner, avID, ok := templateHTTPCheckoutDatabase(test.name)
		if ok != test.ok || ok && (owner != test.owner || avID != test.avID) {
			t.Errorf("%s: (%q, %q, %v)", test.name, owner, avID, ok)
		}
	}
	for name, want := range map[string]bool{"/templates/a.md": true, "/templates/pkg/a.md": true, "/templates-other/a.md": false, "/box/templates/a.md": false} {
		if got := templateHTTPCheckoutTemplate(name); got != want {
			t.Errorf("template path %s: %v", name, got)
		}
	}
}

func prepareTemplateHTTPMutationTest(t *testing.T) {
	t.Helper()
	oldData, oldConf := util.DataDir, util.ConfDir
	util.DataDir, util.ConfDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.DataDir, util.ConfDir = oldData, oldConf })
	if err := os.MkdirAll(filepath.Join(util.DataDir, "templates"), 0700); err != nil {
		t.Fatal(err)
	}
}

func grantTemplateHTTPMutationFile(t *testing.T, name string) *TemplateHTTPSource {
	t.Helper()
	_, source, err := ReadTemplateHTTPFile(filepath.Join(util.DataDir, "templates", name))
	if err != nil {
		t.Fatal(err)
	}
	if !source.Persistable {
		t.Skip("file provenance is unavailable on this platform")
	}
	if err = GrantTemplateHTTPSource(source); err != nil {
		t.Fatal(err)
	}
	return source
}

func TestTemplateHTTPManagedMutationsRevoke(t *testing.T) {
	for _, action := range []string{"write", "move", "remove"} {
		t.Run(action, func(t *testing.T) {
			prepareTemplateHTTPMutationTest(t)
			ret, err := ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "a.md", Content: "same bytes"})
			if err != nil {
				t.Fatal(err)
			}
			source := grantTemplateHTTPMutationFile(t, "a.md")
			listing, err := ManageTemplateFiles(TemplateFileRequest{Action: "list"})
			if err != nil || !listing.([]TemplateFileEntry)[0].HTTPPermission {
				t.Fatalf("permission listing: %v, %v", listing, err)
			}
			_, err = ManageTemplateFiles(TemplateFileRequest{Action: action, Path: "a.md", Target: "b.md", Content: "same bytes", Revision: ret.(map[string]string)["revision"]})
			if err != nil {
				t.Fatal(err)
			}
			if IsTemplateHTTPSourceCurrent(source) {
				t.Fatal("managed mutation kept old source identity")
			}
			if action != "remove" {
				name := "a.md"
				if action == "move" {
					name = "b.md"
				}
				allowed, err := GetTemplateHTTPFilePermission(name)
				if err != nil || allowed {
					t.Fatalf("replacement inherited permission: %v, %v", allowed, err)
				}
			}
		})
	}
}

func TestTemplateHTTPCheckoutInvalidation(t *testing.T) {
	prepareTemplateHTTPMutationTest(t)
	if err := os.WriteFile(filepath.Join(util.DataDir, "templates", "a.md"), []byte("template"), 0600); err != nil {
		t.Fatal(err)
	}
	fileSource := grantTemplateHTTPMutationFile(t, "a.md")
	dbSource, err := ResolveTemplateHTTPDBSource("global", "20261030000000-testav1", "field", "template", "formula")
	if err != nil {
		t.Fatal(err)
	}
	oldAV := templateHTTPMutationAV("formula", "old")
	if err = os.MkdirAll(filepath.Join(util.DataDir, "storage", "av"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "storage", "av", "20261030000000-testav1.json"), oldAV, 0600); err != nil {
		t.Fatal(err)
	}
	if err = GrantTemplateHTTPSource(dbSource); err != nil {
		t.Fatal(err)
	}
	plan := &dejavu.CheckoutPlan{Upserts: []*entity.File{{Path: "/templates/a.md"}, {Path: "/storage/av/20261030000000-testav1.json"}}}
	if err = templateHTTPCheckoutPreflightRead(util.DataDir, plan, func(string) ([]byte, error) { return templateHTTPMutationAV("formula", "new"), nil }); err != nil {
		t.Fatal(err)
	}
	if IsTemplateHTTPSourceCurrent(fileSource) {
		t.Fatal("template upsert kept source identity")
	}
	if allowed, err := CheckTemplateHTTPSource(dbSource); err != nil || !allowed {
		t.Fatalf("AV cell upsert revoked field: %v, %v", allowed, err)
	}
	plan = &dejavu.CheckoutPlan{Removes: []*entity.File{{Path: "/storage/av/20261030000000-testav1.json"}}}
	if err = templateHTTPCheckoutPreflight(util.DataDir, plan); err != nil {
		t.Fatal(err)
	}
	if IsTemplateHTTPSourceCurrent(dbSource) {
		t.Fatal("AV delete kept source identity")
	}
}

func TestTemplateHTTPManagedMutationFailsClosed(t *testing.T) {
	prepareTemplateHTTPMutationTest(t)
	filename := filepath.Join(util.DataDir, "templates", "a.md")
	if err := os.WriteFile(filename, []byte("unchanged"), 0600); err != nil {
		t.Fatal(err)
	}
	ret, err := ManageTemplateFiles(TemplateFileRequest{Action: "read", Path: "a.md"})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.ConfDir, templateHTTPPermissionsFile), []byte("invalid json"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err = ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "a.md", Content: "changed", Revision: ret.(map[string]string)["revision"]})
	if err == nil {
		t.Fatal("mutation continued when permission invalidation failed")
	}
	content, err := os.ReadFile(filename)
	if err != nil || string(content) != "unchanged" {
		t.Fatalf("failed mutation changed source: %q, %v", content, err)
	}
}

func templateHTTPMutationAV(formula, value string) []byte {
	data, _ := json.Marshal(map[string]any{"id": "20261030000000-testav1", "spec": 0, "keyValues": []any{map[string]any{"key": map[string]string{"id": "field", "type": "template", "template": formula}, "values": []string{value}}}})
	return data
}

func TestTemplateHTTPCheckoutSourceReplay(t *testing.T) {
	for _, mode := range []string{"changed", "deleted", "unreadable", "unknown"} {
		t.Run(mode, func(t *testing.T) {
			prepareTemplateHTTPMutationTest(t)
			original := templateHTTPMutationAV("A", "cell")
			if err := os.MkdirAll(filepath.Join(util.DataDir, "storage", "av"), 0700); err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(util.DataDir, "storage", "av", "20261030000000-testav1.json")
			if err := os.WriteFile(filename, original, 0600); err != nil {
				t.Fatal(err)
			}
			source, err := ResolveTemplateHTTPDBSource("global", "20261030000000-testav1", "field", "template", "A")
			if err != nil {
				t.Fatal(err)
			}
			if err = GrantTemplateHTTPSource(source); err != nil {
				t.Fatal(err)
			}
			intermediate := templateHTTPMutationAV("B", "cell")
			if mode == "deleted" {
				intermediate = []byte(`{"id":"20261030000000-testav1","spec":0,"keyValues":[]}`)
			}
			if mode == "unknown" {
				intermediate = []byte(`{"id":"20261030000000-testav1","spec":999999,"keyValues":[]}`)
			}
			plan := &dejavu.CheckoutPlan{Upserts: []*entity.File{{Path: "/storage/av/20261030000000-testav1.json"}}}
			read := func(string) ([]byte, error) {
				if mode == "unreadable" {
					return nil, errors.New("unreadable incoming source")
				}
				return intermediate, nil
			}
			if err = templateHTTPCheckoutPreflightRead(util.DataDir, plan, read); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filename, intermediate, 0600); err != nil {
				t.Fatal(err)
			}
			// 两次同步之间不解析或渲染字段，仍不能让旧版本授权复活。
			if err = templateHTTPCheckoutPreflightRead(util.DataDir, plan, func(string) ([]byte, error) { return original, nil }); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filename, original, 0600); err != nil {
				t.Fatal(err)
			}
			if IsTemplateHTTPSourceCurrent(source) {
				t.Fatal("old confirmation source revived after checkout replay")
			}
			replacement, err := ResolveTemplateHTTPDBSource("global", "20261030000000-testav1", "field", "template", "A")
			if err != nil {
				t.Fatal(err)
			}
			if allowed, err := CheckTemplateHTTPSource(replacement); err != nil || allowed {
				t.Fatalf("recreated source inherited permission: %v, %v", allowed, err)
			}
		})
	}
}

func TestTemplateHTTPCheckoutEncryptedFields(t *testing.T) {
	for _, mode := range []string{"cell-only", "changed", "tampered", "locked"} {
		t.Run(mode, func(t *testing.T) {
			prepareTemplateHTTPMutationTest(t)
			const boxID = "20261030000000-encbox1"
			const avID = "20261030000000-testav1"
			dek := bytes.Repeat([]byte{0x53}, 32)
			defer clear(dek)
			prepareUnlockedEncryptedBoxTest(t, boxID, dek)
			encrypt := func(formula, value string) []byte {
				data, err := av.EncryptAVData(boxID, avID, templateHTTPMutationAV(formula, value))
				if err != nil {
					t.Fatal(err)
				}
				return data
			}
			previous := encrypt("A", "old cell")
			incoming := encrypt("A", "new cell")
			if mode == "changed" {
				incoming = encrypt("B", "new cell")
			}
			if mode == "tampered" {
				incoming[len(incoming)-1] ^= 1
			}
			filename := filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
			if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filename, previous, 0600); err != nil {
				t.Fatal(err)
			}
			source, err := ResolveTemplateHTTPDBSource(boxID, avID, "field", "template", "A")
			if err != nil {
				t.Fatal(err)
			}
			if err = GrantTemplateHTTPSource(source); err != nil {
				t.Fatal(err)
			}
			if mode == "locked" {
				cachedDEKsLock.Lock()
				clear(cachedDEKs[boxID])
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
				setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
			}
			if err = invalidateTemplateHTTPCheckoutFields(boxID, avID, previous, incoming); err != nil {
				t.Fatal(err)
			}
			templateHTTPPermissionStore.Lock()
			record, exists := templateHTTPSourceMatchesLocked(source)
			templateHTTPPermissionStore.Unlock()
			if kept := exists && record.Granted; kept != (mode == "cell-only") {
				t.Fatalf("encrypted field permission kept=%v", kept)
			}
		})
	}
}
