// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// 下载响应使用内存替身；DNS 也固定为公网地址，避免回归测试依赖外网。
func mockSkillPublicDNS(t *testing.T) {
	t.Helper()
	previous := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = previous })
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(context.Context, string, string) (net.Conn, error) {
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			var size uint16
			if binary.Read(server, binary.BigEndian, &size) != nil {
				return
			}
			packet := make([]byte, size)
			if _, err := io.ReadFull(server, packet); err != nil {
				return
			}
			var request dnsmessage.Message
			if request.Unpack(packet) != nil {
				return
			}
			response := dnsmessage.Message{Header: dnsmessage.Header{ID: request.ID, Response: true, RecursionAvailable: true}, Questions: request.Questions}
			for _, question := range request.Questions {
				if question.Type == dnsmessage.TypeA {
					response.Answers = append(response.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: question.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.AResource{A: [4]byte{8, 8, 8, 8}}})
				}
			}
			packet, err := response.Pack()
			if err != nil {
				return
			}
			binary.Write(server, binary.BigEndian, uint16(len(packet)))
			server.Write(packet)
		}()
		return client, nil
	}}
}

func TestSkillInstallationDigest(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("body"), 0644)
	os.WriteFile(filepath.Join(dir, "run.bin"), []byte{0, 1, 2}, 0644)
	first, err := skillInstallationDigest(dir)
	if err != nil {
		t.Fatal(err)
	}
	os.Chtimes(filepath.Join(dir, "run.bin"), time.Unix(1, 0), time.Unix(1, 0))
	second, err := skillInstallationDigest(dir)
	if err != nil || first != second {
		t.Fatalf("mtime changed digest: %s %s %v", first, second, err)
	}
	os.Rename(filepath.Join(dir, "run.bin"), filepath.Join(dir, "other.bin"))
	third, _ := skillInstallationDigest(dir)
	if first == third {
		t.Fatal("paths missing from digest")
	}
	os.WriteFile(filepath.Join(dir, "other.bin"), []byte{0, 1, 3}, 0644)
	fourth, _ := skillInstallationDigest(dir)
	if third == fourth {
		t.Fatal("resources missing from digest")
	}
	if err = os.Symlink(filepath.Join(dir, "SKILL.md"), filepath.Join(dir, "linked")); err == nil {
		if _, err = skillInstallationDigest(dir); err == nil {
			t.Fatal("accepted symlink")
		}
	}
}

func TestSkillInstallationLifecycle(t *testing.T) {
	workspace, _ := setSkillTestRoots(t)
	source := SkillInstallation{URL: "https://example.com/SKILL.md"}
	data := []byte("---\nname: sample\n---\nbody")
	if _, err := installFromSingleSkillMD(data, source); err != nil {
		t.Fatal(err)
	}
	infos, err := DiscoverSkillInstallations(nil)
	if err != nil || len(infos) != 1 || infos[0].Installation == nil {
		t.Fatalf("list: %+v %v", infos, err)
	}
	installed := *infos[0].Installation
	if installed.Name != "sample" || installed.Digest == "" || installed.InstalledAt == "" || installed.SiYuanVersion != Ver {
		t.Fatalf("record: %+v", installed)
	}
	if err = SaveSkill("sample", "---\nname: sample\n---\nchanged"); err != nil {
		t.Fatal(err)
	}
	infos, _ = DiscoverSkillInstallations(nil)
	if infos[0].Installation.Digest != installed.Digest {
		t.Fatal("edit replaced historical digest")
	}
	if err = RenameSkill("sample", "renamed"); err != nil {
		t.Fatal(err)
	}
	infos, _ = DiscoverSkillInstallations(nil)
	if infos[0].Installation.Name != "renamed" || infos[0].Installation.Digest != installed.Digest {
		t.Fatal("rename lost binding")
	}
	root, err := openManagedSkillsRoot()
	if err != nil {
		t.Fatal(err)
	}
	revision, err := managedSkillRevision(root, "renamed")
	root.Close()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ManageSkillFiles(SkillFileRequest{Action: "move", Path: "renamed", Target: "moved", Revision: revision}); err != nil {
		t.Fatal(err)
	}
	infos, _ = DiscoverSkillInstallations(nil)
	if infos[0].Installation.Name != "moved" {
		t.Fatal("manager rename lost binding")
	}
	if err = RemoveSkill("sample"); err != nil {
		t.Fatal(err)
	}
	records, _ := readSkillInstallations()
	if len(records.Skills) != 0 {
		t.Fatal("remove left binding")
	}
	writeSkill(t, workspace, "legacy", "legacy", "old", "body")
	infos, _ = DiscoverSkillInstallations(nil)
	if infos[0].Installation != nil {
		t.Fatal("guessed legacy source")
	}
}

func TestSkillInstallationSourceAndFallback(t *testing.T) {
	mockSkillPublicDNS(t)
	src := normalizedSkillSource{downloadURL: "https://user:secret@example.com/SKILL.md?token=secret#secret"}
	if got := installationSource(src, ""); got.URL != "https://example.com/SKILL.md" {
		t.Fatalf("credentials persisted: %+v", got)
	}
	src.ref = strings.Repeat("a", 40)
	if installationSource(src, "").Commit != src.ref {
		t.Fatal("fixed commit missing")
	}
	src.ref = "abc123"
	if installationSource(src, "").Commit != "" {
		t.Fatal("short ref is not immutable commit")
	}
	sha := strings.Repeat("b", 40)
	blob, err := normalizeSkillURL("https://github.com/foo/bar/blob/feature/topic/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if got := installationSource(blob, ""); got.Ref != "" || got.Subdirectory != "" || got.Repository != "https://github.com/foo/bar" || got.URL != "https://raw.githubusercontent.com/foo/bar/feature/topic/SKILL.md" {
		t.Fatalf("guessed blob ref boundary: %+v", got)
	}
	if got := installationSource(codeloadSource("foo/bar", sha), ""); got.Commit != "" {
		t.Fatal("named branch treated as commit")
	}
	for _, rawURL := range []string{"https://github.com/foo/bar/blob/" + sha + "/skills/example/SKILL.md", "https://raw.githubusercontent.com/foo/bar/" + sha + "/skills/example/SKILL.md?token=secret"} {
		normalized, err := normalizeSkillURL(rawURL)
		if err != nil {
			t.Fatal(err)
		}
		got := installationSource(normalized, "")
		if got.Repository != "https://github.com/foo/bar" || got.Commit != sha || got.Subdirectory != "skills/example" || strings.Contains(got.URL, "secret") {
			t.Fatalf("raw source: %+v", got)
		}
	}
	previous := ssrfSafeClient
	t.Cleanup(func() { ssrfSafeClient = previous })
	ssrfSafeClient = &http.Client{Transport: webFetchRoundTripper(func(req *http.Request) (*http.Response, error) {
		status := 200
		if strings.HasSuffix(req.URL.Path, "/main") {
			status = 404
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"text/plain"}}, Body: io.NopCloser(strings.NewReader("body")), Request: req}, nil
	})}
	src = codeloadSource("foo/bar", "main")
	if _, _, err := downloadSkillSource(src, &src); err != nil {
		t.Fatal(err)
	}
	if src.ref != "master" || !strings.HasSuffix(src.downloadURL, "/master") {
		t.Fatalf("recorded failed ref: %+v", src)
	}
}

func TestSkillInstallationRejectsCorruptRecords(t *testing.T) {
	setSkillTestRoots(t)
	if _, err := installFromSingleSkillMD([]byte("---\nname: sample\n---\nold"), SkillInstallation{URL: "https://example.com"}); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{"bad JSON", "null", "{}", `{"skills":{}}`, `{"version":2,"skills":{}}`} {
		os.WriteFile(skillInstallationsPath(), []byte(content), 0600)
		if _, err := installFromSingleSkillMD([]byte("---\nname: sample\n---\nnew"), SkillInstallation{}); err == nil {
			t.Fatal("overwrote unsupported records")
		}
		data, _ := os.ReadFile(filepath.Join(SkillsDir(), "sample", "SKILL.md"))
		if strings.Contains(string(data), "new") {
			t.Fatal("changed skill before checking records")
		}
		if _, err := DiscoverSkillInstallations(nil); err == nil {
			t.Fatal("hid corrupt records")
		}
	}
}

func TestSkillInstallationOverwriteAndFailure(t *testing.T) {
	setSkillTestRoots(t)
	root := t.TempDir()
	writeSkill(t, root, "one", "one", "", "first")
	writeSkill(t, root, "two", "two", "", "second")
	if _, err := installSkillDirs([]string{"one", "two"}, root, SkillInstallation{URL: "https://example.com/archive.zip"}); err != nil {
		t.Fatal(err)
	}
	records, _ := readSkillInstallations()
	if len(records.Skills) != 2 || records.Skills["one"].Digest == records.Skills["two"].Digest {
		t.Fatalf("per-skill records: %+v", records)
	}
	old := records.Skills["one"].Digest
	writeSkill(t, root, "one", "one", "", "updated")
	if _, err := installSkillDirs([]string{"one"}, root, SkillInstallation{URL: "https://example.com/new.zip"}); err != nil {
		t.Fatal(err)
	}
	records, _ = readSkillInstallations()
	if records.Skills["one"].Digest == old || records.Skills["one"].URL != "https://example.com/new.zip" {
		t.Fatal("stale overwrite binding")
	}
	if _, _, err := prepareSkillInstallationChange("one"); err != nil {
		t.Fatal(err)
	}
	records, _ = readSkillInstallations()
	if _, ok := records.Skills["one"]; ok {
		t.Fatal("interrupted overwrite retained old binding")
	}
	bytes, _ := json.Marshal(records)
	if strings.Contains(string(bytes), old) {
		t.Fatal("stale digest persisted")
	}
}

func TestSkillInstallationSingleFileRetainsResourcesWithExplicitScope(t *testing.T) {
	workspace, _ := setSkillTestRoots(t)
	writeSkill(t, workspace, "sample", "sample", "", "old")
	writeSkillResource(t, workspace, "sample", "scripts/old.txt", []byte("retained"))
	if _, err := installFromSingleSkillMD([]byte("---\nname: sample\n---\nnew"), SkillInstallation{URL: "https://example.com/SKILL.md"}); err != nil {
		t.Fatal(err)
	}
	records, err := readSkillInstallations()
	if err != nil {
		t.Fatal(err)
	}
	if records.Skills["sample"].SourceScope != "manifest-only" {
		t.Fatal("claimed directory source for single-file install")
	}
	before := records.Skills["sample"].Digest
	resource := filepath.Join(workspace, "sample", "scripts", "old.txt")
	if _, err = os.Stat(resource); err != nil {
		t.Fatal("single-file install removed existing resources")
	}
	os.Remove(resource)
	after, err := skillInstallationDigest(filepath.Join(workspace, "sample"))
	if err != nil || before == after {
		t.Fatal("snapshot excluded retained resources")
	}
}

func TestSkillInstallationStaleDestinationAndCreation(t *testing.T) {
	workspace, _ := setSkillTestRoots(t)
	for _, action := range []string{"rename", "save", "create"} {
		t.Run(action, func(t *testing.T) {
			os.MkdirAll(workspace, 0755)
			records := &skillInstallations{Version: 1, Skills: map[string]SkillInstallation{"target": {Name: "target", URL: "https://stale.example"}}}
			if err := writeSkillInstallations(records); err != nil {
				t.Fatal(err)
			}
			var err error
			switch action {
			case "rename":
				writeSkill(t, workspace, "unknown", "unknown", "", "body")
				err = RenameSkill("unknown", "target")
			case "save":
				err = SaveSkill("target", "---\nname: target\n---\nbody")
			case "create":
				_, err = ManageSkillFiles(SkillFileRequest{Action: "create", Path: "target"})
			}
			if err != nil {
				t.Fatal(err)
			}
			records, err = readSkillInstallations()
			if err != nil || len(records.Skills) != 0 {
				t.Fatalf("inherited stale source: %+v %v", records, err)
			}
			os.RemoveAll(filepath.Join(workspace, "target"))
		})
	}
	if _, err := installFromSingleSkillMD([]byte("---\nname: target\n---\nbody"), SkillInstallation{}); err != nil {
		t.Fatal(err)
	}
	root, err := openManagedSkillsRoot()
	if err != nil {
		t.Fatal(err)
	}
	revision, err := managedSkillRevision(root, "target")
	root.Close()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ManageSkillFiles(SkillFileRequest{Action: "remove", Path: "target", Revision: revision}); err != nil {
		t.Fatal(err)
	}
	records, _ := readSkillInstallations()
	if len(records.Skills) != 0 {
		t.Fatal("manager delete retained source")
	}
}
