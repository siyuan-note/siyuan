// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestReadDocHPathDoesNotRepairSource(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	box := "20260915000000-hpath01"
	parent := "20260915000001-hpath01"
	child := "20260915000002-hpath01"
	dir := filepath.Join(util.DataDir, box, parent)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	writeDoc := func(id, p, title string) {
		t.Helper()
		data, err := json.Marshal(map[string]any{"ID": id, "Type": "NodeDocument", "Properties": map[string]string{"id": id, "title": title}})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(p, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	childPath := "/" + parent + "/" + child + ".sy"
	writeDoc(child, filepath.Join(dir, child+".sy"), "Child")
	parentFile := filepath.Join(util.DataDir, box, parent+".sy")
	if _, _, err := ReadDocHPath(box, childPath); !os.IsNotExist(err) {
		t.Fatalf("expected missing parent error, got %v", err)
	}
	if _, err := os.Stat(parentFile); !os.IsNotExist(err) {
		t.Fatal("read-only recovery created a parent file")
	}
	writeDoc(parent, parentFile, "Parent")
	if hpath, props, err := ReadDocHPath(box, childPath); err != nil || hpath != "/Parent/Child" || props["id"] != child {
		t.Fatalf("unexpected path metadata: %q, %#v, %v", hpath, props, err)
	}
	writeDoc(child, parentFile, "Wrong identity")
	before, _ := os.ReadFile(parentFile)
	if _, _, err := ReadDocHPath(box, childPath); err == nil {
		t.Fatal("mismatched source identity was accepted")
	}
	after, _ := os.ReadFile(parentFile)
	if string(before) != string(after) {
		t.Fatal("failed recovery modified the source")
	}
}

func TestDocumentMetadataReaderReauthenticatesEachSource(t *testing.T) {
	box, parent, childPath, data := setupStalePathTest(t)
	previousConf := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConf })
	childFile := writeStalePathFixture(t, box, childPath, data)
	parentPath := "/" + parent + ".sy"
	parentData, err := json.Marshal(map[string]any{"ID": parent, "Type": "NodeDocument",
		"Properties": map[string]string{"id": parent, "title": "Parent"}})
	if err != nil {
		t.Fatal(err)
	}
	parentFile := writeStalePathFixture(t, box, parentPath, parentData)
	reader := newDocumentMetadataReader()
	tree, err := reader.tree(box, childPath)
	if err != nil {
		t.Fatal(err)
	}
	if hpath, err := reader.hpath(tree); err != nil || hpath != "/Parent/Child" {
		t.Fatal(hpath, err)
	}
	if err = os.WriteFile(childFile, []byte(`{"ID":`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = reader.tree(box, childPath); err == nil {
		t.Fatal("metadata recovery reused an earlier source instead of validating it")
	}
	if err = os.WriteFile(parentFile, []byte(`{"ID":`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = newDocumentMetadataReader().hpath(tree); err == nil {
		t.Fatal("metadata recovery reused an ancestor from another operation")
	}
	if tree.Root.ID != util.GetTreeID(childPath) || treenode.ReadDocumentTitle(tree.Root).Text != "Child" {
		t.Fatal("failed reread changed the authenticated snapshot")
	}
}
