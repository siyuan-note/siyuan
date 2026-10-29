// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentMovePreflightsEntireBatch(t *testing.T) {
	for _, conflict := range []string{"sourceSpec", "sourceIdentity", "sourceJSON", "destinationDirectory"} {
		t.Run(conflict, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			first := addFileOperationTestDoc(t, fixture, ast.NewNodeID(), "First", false)
			childPath := "/" + fixture.sourceID + "/" + ast.NewNodeID() + ".sy"
			child := treenode.NewTree(fixture.box.ID, childPath, "/Source/Child", "Child")
			if _, err := filesys.WriteTree(child); err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(util.DataDir, fixture.box.ID, childPath)
			if conflict != "destinationDirectory" {
				data, _ := os.ReadFile(filename)
				var fields map[string]json.RawMessage
				if err := json.Unmarshal(data, &fields); err != nil {
					t.Fatal(err)
				}
				if conflict == "sourceSpec" {
					fields["Spec"] = json.RawMessage(`"999"`)
				} else if conflict == "sourceIdentity" {
					fields["ID"] = json.RawMessage(`"` + ast.NewNodeID() + `"`)
				}
				data, _ = json.Marshal(fields)
				if conflict == "sourceJSON" {
					data = data[:len(data)-1]
				}
				if err := os.WriteFile(filename, data, 0644); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.MkdirAll(filepath.Join(util.DataDir, fixture.box.ID, fixture.targetID, fixture.sourceID), 0755); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := os.ReadFile(filename)
			if err := MoveDocs([]string{first.Path, fixture.sourcePath}, fixture.box.ID, fixture.targetPath, nil); err == nil {
				t.Fatal("incompatible later subtree did not reject the batch")
			}
			if _, err := os.Stat(filepath.Join(util.DataDir, fixture.box.ID, first.Path)); err != nil {
				t.Fatal("earlier source moved before complete preflight", err)
			}
			after, _ := os.ReadFile(filename)
			if !bytes.Equal(before, after) {
				t.Fatal("preflight changed source bytes")
			}
		})
	}
}

func TestDocumentMoveAcrossNotebooksPreservesMetadata(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_DOCUMENT_MOVE") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentMoveAcrossNotebooksPreservesMetadata$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_DOCUMENT_MOVE=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("document move subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	sourceBox := &Box{ID: ast.NewNodeID()}
	other := &Box{ID: ast.NewNodeID()}
	value := conf.NewBoxConf()
	value.Name, value.Closed = "Other", false
	for _, box := range []*Box{sourceBox, other} {
		if err := box.SaveConf(value); err != nil {
			t.Fatal(err)
		}
	}
	source := newHPathTestDoc(t, sourceBox.ID, "/", "Source", 1)
	child := newHPathTestDoc(t, sourceBox.ID, "/"+source.ID, "Child", 1)
	if err := MoveDocs([]string{source.Path}, other.ID, "/", nil); err != nil {
		t.Fatal(err)
	}
	document, err := treenode.GetDocumentPath(other.ID, source.ID, other.ID, 1)
	if err != nil || document.Title.Text != "Source" || document.ParentID != nil {
		t.Fatalf("moved identity disappeared during old-box journal recovery: %+v, %v", document, err)
	}
	if treenode.GetBlockTreeInExactBox(source.ID, sourceBox.ID) != nil {
		t.Fatal("old notebook retained the moved identity")
	}
	for _, boxID := range []string{sourceBox.ID, other.ID} {
		pending, err := treenode.PendingDocumentMetadata(boxID)
		if err != nil || len(pending) != 0 {
			t.Fatalf("move did not finish recovery for %s: %v, %v", boxID, pending, err)
		}
	}
	if strings.Contains(document.DisplayPath, source.ID) {
		t.Fatal("display title was derived from storage IDs")
	}
	childDocument, err := treenode.GetDocumentPath(other.ID, child.ID, other.ID, 1)
	if err != nil || childDocument.Depth != 2 || childDocument.ParentID == nil || *childDocument.ParentID != source.ID {
		t.Fatalf("descendant metadata was not moved: %+v, %v", childDocument, err)
	}
}
