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
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentCreateInNewNotebook(t *testing.T) {
	const subprocessEnv = "SIYUAN_TEST_DOCUMENT_CREATE_NEW_NOTEBOOK"
	if os.Getenv(subprocessEnv) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentCreateInNewNotebook$", "-test.v")
		cmd.Env = append(os.Environ(), subprocessEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("new notebook document creation subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	for _, enabled := range []bool{false, true} {
		name := "without notebook document"
		if enabled {
			name = "with notebook document"
		}
		t.Run(name, func(t *testing.T) {
			Conf.FileTree.Load().BoxDocEnabled = enabled
			boxID, err := CreateBox(name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = Mount(boxID); err != nil {
				t.Fatal(err)
			}
			if state := treenode.DocumentMetadataState(boxID); state != "building" {
				t.Fatalf("queued notebook index state = %q, want building", state)
			}
			request := DocumentCreateRequest{Notebook: boxID, ID: ast.NewNodeID(), TitleFormat: "plain",
				Title: "Docker smoke", Markdown: "Docker OCR smoke 123"}
			_, err = CreateDocByParent(request)
			var failure *DocumentCreateFailure
			if !errors.As(err, &failure) || failure.Reason != "indexUnavailable" || failure.CommitState != "none" {
				t.Fatalf("queued index allowed document creation: %#v, %v", failure, err)
			}
			for task.ContainIndexTask() {
				task.ExecTaskJob()
			}
			document, err := CreateDocByParent(request)
			if err != nil {
				t.Fatalf("create document immediately after notebook creation: %v", err)
			}
			if document.ID != request.ID || document.ParentID != nil || document.Title.Text != request.Title {
				t.Fatalf("unexpected created document: %+v", document)
			}
			tree, err := filesys.LoadTree(boxID, document.Path, util.NewLute())
			if err != nil || tree.ID != request.ID {
				t.Fatalf("read created document: %+v, %v", tree, err)
			}
			if markdown := GetBlockKramdownInBox(request.ID, "", boxID); !strings.Contains(markdown, request.Markdown) {
				t.Fatalf("created document lost its content: %s", markdown)
			}
			if state := treenode.DocumentMetadataState(boxID); state != "ready" {
				t.Fatalf("new notebook metadata state = %q, want ready", state)
			}
		})
	}
}

func TestDocumentCreateByParent(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_DOCUMENT_CREATE") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentCreateByParent$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_DOCUMENT_CREATE=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("document creation subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Creation", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	parent := newHPathTestDoc(t, box.ID, "/", "Parent", 1)
	if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	parentPath, err := getDocumentPath(box.ID, parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	request := DocumentCreateRequest{Notebook: box.ID, ParentID: &parent.ID, ID: ast.NewNodeID(),
		TitleFormat: "plain", Title: "**Literal &amp; title**", Markdown: "Initial paragraph",
		ExpectedParentRevision: &parentPath.Revision,
		NameConditions:         []treenode.DocumentNameCondition{{ParentID: &parent.ID, Title: "**Literal &amp; title**"}}}
	document, err := CreateDocByParent(request)
	if err != nil || document.ID != request.ID || document.Title.Text != request.Title || document.Depth != 2 {
		t.Fatalf("create failed: %+v, %v", document, err)
	}
	loaded, err := filesys.LoadTree(box.ID, document.Path, util.NewLute())
	if err != nil || loaded.ID != request.ID || path.Dir(loaded.Path) != "/"+parent.ID {
		t.Fatalf("source identity changed: %+v, %v", loaded, err)
	}
	failure := func(request DocumentCreateRequest, reason string) {
		t.Helper()
		_, err := CreateDocByParent(request)
		var failed *DocumentCreateFailure
		if !errors.As(err, &failed) || failed.Reason != reason || failed.CommitState != "none" {
			t.Fatalf("want %s before source commit, got %#v, %v", reason, failed, err)
		}
	}
	failure(request, "documentIDConflict")
	request.ID = ast.NewNodeID()
	failure(request, "planChanged")
	request.NameConditions = nil
	if err = RenameDoc(box.ID, parent.Path, "Renamed"); err != nil {
		t.Fatal(err)
	}
	failure(request, "planChanged")
	request.ExpectedParentRevision = nil
	request.Title = ""
	document, err = CreateDocByParent(request)
	if err != nil || !document.Title.Empty || document.Title.Text == "" {
		t.Fatalf("empty title lost its explicit marker: %+v, %v", document, err)
	}
	request.ID, request.Title = ast.NewNodeID(), "Invalid\ntitle"
	failure(request, "invalidTitle")
	request.TitleFormat = "markdown"
	failure(request, "unsupportedTitleFormat")
	request.TitleFormat, request.Title = "plain", "Title"
	missing := ast.NewNodeID()
	request.ParentID = &missing
	failure(request, "parentUnavailable")
	request.ParentID = &parent.Root.FirstChild.ID
	failure(request, "parentUnavailable")
	// 两个请求共享不存在条件时，仅一个可以创建祖先，另一个必须要求重新规划。
	var group sync.WaitGroup
	errorsByRequest := make([]error, 2)
	for i := range errorsByRequest {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			_, errorsByRequest[i] = CreateDocByParent(DocumentCreateRequest{
				Notebook: box.ID, ParentID: &parent.ID, ID: ast.NewNodeID(), TitleFormat: "plain", Title: "Concurrent",
				NameConditions: []treenode.DocumentNameCondition{{ParentID: &parent.ID, Title: "Concurrent"}},
			})
		}(i)
	}
	group.Wait()
	succeeded, changed := 0, 0
	for _, createErr := range errorsByRequest {
		var failure *DocumentCreateFailure
		if createErr == nil {
			succeeded++
		} else if errors.As(createErr, &failure) && failure.Reason == "planChanged" && failure.CommitState == "none" {
			changed++
		} else {
			t.Fatalf("unexpected concurrent creation result: %v", createErr)
		}
	}
	if succeeded != 1 || changed != 1 {
		t.Fatalf("duplicate ancestor creation: %v", errorsByRequest)
	}
	target, err := GetDocCreateTarget(box.ID, "document")
	if err != nil {
		t.Fatal(err)
	}
	configured := DocumentCreateRequest{Notebook: box.ID, ID: ast.NewNodeID(), TitleFormat: "plain", Title: "Configured",
		ExpectedTarget: &DocumentTargetRevision{Notebook: box.ID, Purpose: "document", Revision: target.Revision}}
	boxConf.DocCreateTemplatePath = "Changed.md"
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	failure(configured, "planChanged")
	target, err = GetDocCreateTarget(box.ID, "document")
	if err != nil {
		t.Fatal(err)
	}
	configured.ExpectedTarget.Revision = target.Revision
	boxConf.Sort++
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if _, err = CreateDocByParent(configured); err != nil {
		t.Fatal("unrelated configuration invalidated the target", err)
	}
	request.ParentID = nil
	request.DocCreateTemplatePath = "does-not-exist.md"
	request.Markdown = ""
	_, err = CreateDocByParent(request)
	var failed *DocumentCreateFailure
	if !errors.As(err, &failed) || failed.CommitState != "committed" || failed.ID != request.ID || failed.Stage != "template" {
		t.Fatalf("template failure lost committed identity: %#v, %v", failed, err)
	}
	if _, err = filesys.ReadDocumentMetadataTree(box.ID, "/"+request.ID+".sy"); err != nil {
		t.Fatal("template failure removed the committed document", err)
	}
	request.ID, request.DocCreateTemplatePath = ast.NewNodeID(), ""
	sortPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if err = os.Remove(sortPath); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(sortPath, 0755); err != nil {
		t.Fatal(err)
	}
	_, err = CreateDocByParent(request)
	if !errors.As(err, &failed) || failed.CommitState != "committed" || failed.ID != request.ID || failed.Stage != "sort" {
		t.Fatalf("sort failure lost committed identity: %#v, %v", failed, err)
	}
	if _, err = filesys.ReadDocumentMetadataTree(box.ID, "/"+request.ID+".sy"); err != nil {
		t.Fatal("sort failure removed source", err)
	}
}
