// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLegacyDocumentPaths(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_LEGACY_DOCUMENT_PATHS") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestLegacyDocumentPaths$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_LEGACY_DOCUMENT_PATHS=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Legacy"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	plain := newHPathTestDoc(t, box.ID, "/", "Plain", 1)
	parent := newHPathTestDoc(t, box.ID, "/", "A", 1)
	child := newHPathTestDoc(t, box.ID, parent.Path, "B", 1)
	literal := newHPathTestDoc(t, box.ID, "/", "A/B", 1)
	newHPathTestDoc(t, box.ID, literal.Path, "C", 1)
	if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		hp    string
		count int
		want  error
	}{
		{"/Plain", 1, nil}, {"/missing", 0, nil}, {"/A/B", 0, documentaddressing.ErrPathAmbiguous}, {"/A/B/C", 0, documentaddressing.ErrLegacyPathUnsupported},
	} {
		ids, err := GetIDsByHPath(test.hp, box.ID)
		if !errors.Is(err, test.want) || len(ids) != test.count {
			t.Fatalf("%s: %v %v", test.hp, ids, err)
		}
	}
	before, err := archiveDirectoryFiles(util.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, hp := range []string{"/A/B/New", "/A/B/C/M/New"} {
		if _, err := CreateWithMarkdown("", box.ID, hp, "body", child.ID, ast.NewNodeID(), false, "", nil); !errors.Is(err, documentaddressing.ErrPathAmbiguous) {
			t.Fatal("collision accepted", hp, err)
		}
	}
	after, err := archiveDirectoryFiles(util.DataDir)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("rejected create wrote files", err)
	}
	if err := RenameDoc(box.ID, literal.Path, "Other/slash"); err != nil {
		t.Fatal(err)
	}
	ids, err := GetIDsByHPath("/A/B", box.ID)
	if err != nil || !reflect.DeepEqual(ids, []string{child.ID}) {
		t.Fatal(ids, err)
	}
	before, _ = archiveDirectoryFiles(util.DataDir)
	if _, err := CreateWithMarkdown("", box.ID, "/Other/slash/M/New", "", "", ast.NewNodeID(), false, "", nil); !errors.Is(err, documentaddressing.ErrPathAmbiguous) {
		t.Fatal("missing early prefix bypassed slash collision", err)
	}
	after, _ = archiveDirectoryFiles(util.DataDir)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("late prefix collision wrote files")
	}
	id, err := CreateWithMarkdown("", box.ID, "/Plain/Child", "body", "", ast.NewNodeID(), false, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if bt := treenode.GetBlockTreeInExactBox(id, box.ID); bt == nil || path.Dir(bt.Path) != strings.TrimSuffix(plain.Path, ".sy") {
		t.Fatal("clean parent changed", bt)
	}
	first := newHPathTestDoc(t, box.ID, "/", "Duplicate", 1)
	second := newHPathTestDoc(t, box.ID, "/", "Duplicate", 1)
	ids, err = GetIDsByHPath("/Duplicate", box.ID)
	if err != nil || len(ids) != 2 {
		t.Fatal(ids, err)
	}
	if _, err := ResolveLegacyDocumentPath(box.ID, "/Duplicate", false); !errors.Is(err, documentaddressing.ErrPathAmbiguous) {
		t.Fatal("single-target lookup selected a duplicate", err)
	}
	if _, err := CreateWithMarkdown("", box.ID, "/Duplicate/Child", "", "", ast.NewNodeID(), false, "", nil); !errors.Is(err, documentaddressing.ErrPathAmbiguous) {
		t.Fatal(err)
	}
	id, err = CreateWithMarkdown("", box.ID, "/Duplicate/Child", "", second.ID, ast.NewNodeID(), false, "", nil)
	if err != nil {
		t.Fatal("parent ID failed to disambiguate", err)
	}
	if bt := treenode.GetBlockTreeInExactBox(id, box.ID); bt == nil || path.Dir(bt.Path) != strings.TrimSuffix(second.Path, ".sy") {
		t.Fatal("wrong duplicate parent", bt, first.ID)
	}
	fileTree := *Conf.FileTree.Load()
	fileTree.BoxDocEnabled = true
	Conf.FileTree.Store(&fileTree)
	if ids, err := GetIDsByHPath("/", box.ID); err != nil || len(ids) != 1 || ids[0] != box.ID {
		t.Fatal("logical notebook root changed", ids, err)
	}
	if root, err := ResolveLegacyDocumentPath(box.ID, "/", false); err != nil || root == nil || root.Path != "/" {
		t.Fatal(root, err)
	}
	for _, state := range []string{"building", "pending"} {
		if state == "building" {
			if err := treenode.SetDocumentMetadataState(box.ID, "building"); err != nil {
				t.Fatal(err)
			}
		} else {
			if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
				t.Fatal(err)
			}
			if _, err := treenode.BeginDocumentMetadataRecovery(treenode.GetBlockTreeInExactBox(plain.ID, box.ID)); err != nil {
				t.Fatal(err)
			}
		}
		before, _ = archiveDirectoryFiles(util.DataDir)
		if ids, err := GetIDsByHPath("/missing", box.ID); err == nil || len(ids) != 0 {
			t.Fatal("unready index was empty", ids, err)
		}
		if _, err := CreateWithMarkdown("", box.ID, "/New", "", "", ast.NewNodeID(), false, "", nil); err == nil {
			t.Fatal("unready index admitted creation")
		}
		after, _ = archiveDirectoryFiles(util.DataDir)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("unready index wrote files")
		}
	}
}
