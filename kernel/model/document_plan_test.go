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
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestDocumentCreationPlans(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_DOCUMENT_PLAN") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentCreationPlans$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_DOCUMENT_PLAN=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("document planning subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Plans", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	parent := newHPathTestDoc(t, box.ID, "/", "Parent", 1)
	contextDoc := newHPathTestDoc(t, box.ID, "/"+parent.ID, "Context", 1)
	if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	fixedNow := time.Date(2026, 10, 23, 23, 59, 59, 0, time.Local)
	for _, test := range []struct {
		name, template, title, parentID string
	}{
		{"empty is current child", "", "", contextDoc.ID},
		{"relative parent", "../Title", "Title", parent.ID},
		{"absolute root", "/Title", "Title", ""},
		{"trailing separator", "../", "", parent.ID},
		{"root ascent saturates", "../../../../Title", "Title", ""},
		{"time snapshot", "{{now | date \"2006-01-02\"}}", "2026-10-23", contextDoc.ID},
	} {
		t.Run(test.name, func(t *testing.T) {
			boxConf.DocCreateSavePath = test.template
			if err := box.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			plan, err := PlanDocumentCreation(DocumentPlanRequest{Notebook: box.ID, Purpose: "document", ContextID: &contextDoc.ID,
				ID: ast.NewNodeID(), Now: fixedNow})
			if err != nil || len(plan.Steps) != 1 || plan.Title != test.title {
				t.Fatalf("unexpected plan: %+v, %v", plan, err)
			}
			step := plan.Steps[0]
			actual := ""
			if step.ParentID != nil {
				actual = *step.ParentID
			}
			if actual != test.parentID || step.ExpectedParentRevision == nil || step.ExpectedTarget == nil {
				t.Fatalf("identity or preview conditions lost: %+v", step)
			}
		})
	}
	boxConf.DocCreateSavePath = "/New ancestor/Second/Title"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	request := DocumentPlanRequest{Notebook: box.ID, Purpose: "document", ContextID: &contextDoc.ID, ID: ast.NewNodeID()}
	plan, err := PlanDocumentCreation(request)
	if err != nil || len(plan.Steps) != 3 {
		t.Fatalf("missing ancestor plan: %+v, %v", plan, err)
	}
	for _, step := range plan.Steps {
		if treenode.GetBlockTree(step.ID) != nil {
			t.Fatal("planning wrote a document")
		}
	}
	var last *treenode.DocumentPath
	for i, step := range plan.Steps {
		if last != nil {
			step.ExpectedParentRevision = &last.Revision
		}
		last, err = CreateDocByParent(step)
		if err != nil || last.ID != step.ID {
			t.Fatalf("step %d failed: %+v, %v", i, last, err)
		}
	}
	if last.Depth != 3 || path.Base(last.Path) != request.ID+".sy" {
		t.Fatal("plan changed final identity or depth", last)
	}
	request.Reuse = true
	plan, err = PlanDocumentCreation(request)
	if err != nil || plan.ExistingID != request.ID || len(plan.Steps) != 0 {
		t.Fatalf("explicit reuse did not find the planned document: %+v, %v", plan, err)
	}
	// 版本 2 保留渲染前的段边界，同一次求值的各段共享时间。
	structured := &EffectiveDocumentTarget{Notebook: box.ID, Structured: &conf.DocumentTarget{
		Version: 2, Notebook: box.ID, Anchor: conf.DocumentTargetAnchor{Kind: "context"}, Up: 1,
		Parents: []string{`{{printf "A/B"}}`, `{{now | date "2006-01-02"}}`},
		Title:   `{{now | date "2006-01-02"}}`, OnMissingParent: "create",
	}}
	rendered, err := renderDocumentTarget(structured, DocumentPlanRequest{Notebook: box.ID, ContextID: &contextDoc.ID, Now: fixedNow})
	if err != nil || *rendered.parentID != parent.ID || len(rendered.parents) != 2 || rendered.parents[0] != "A/B" ||
		rendered.parents[1] != "2026-10-23" || rendered.title != "2026-10-23" {
		t.Fatalf("structured target lost boundaries or time: %+v, %v", rendered, err)
	}
	t.Run("legacy frontend parser compatibility", func(t *testing.T) {
		other := &Box{ID: ast.NewNodeID()}
		otherConf := conf.NewBoxConf()
		otherConf.Name, otherConf.Closed = "Other", false
		if err := other.SaveConf(otherConf); err != nil {
			t.Fatal(err)
		}
		if err := treenode.SetDocumentMetadataState(other.ID, "ready"); err != nil {
			t.Fatal(err)
		}
		// 对应原前端 parseNewDocTarget 的根、相对、容器、显式标题、跨本和文件树规则。
		for _, test := range []struct {
			template, title, placement, expected string
			root, cross, explicit                bool
		}{
			{"", "", "", "/Parent/Context/", false, false, false},
			{"", "Named", "", "/Parent/Context/Named", false, false, true},
			{"", "", "", "/", true, false, false},
			{"", "Named", "", "/Named", true, false, true},
			{"/Folder/", "", "", "/Folder/", false, false, false},
			{"/Folder/", "Named", "", "/Folder/Named", false, false, true},
			{"/", "", "", "/", false, false, false},
			{"/Parent/", "", "", "/Parent/", false, false, false},
			{"Folder/", "", "", "/Parent/Context/Folder/", false, false, false},
			{"Folder/Sub/", "", "", "/Parent/Context/Folder/Sub/", false, false, false},
			{"../", "", "", "/Parent/", false, false, false},
			{"../", "Named", "", "/Parent/Named", false, false, true},
			{"../../", "", "", "/", false, false, false},
			{"../Folder/", "", "", "/Parent/Folder/", false, false, false},
			{"../../Folder/Sub/", "", "", "/Folder/Sub/", false, false, false},
			{"../", "", "", "/", true, false, false},
			{"  Folder/  ", "", "", "/Parent/Context/Folder/", false, false, false},
			{"Named", "", "", "/Parent/Context/Named", false, false, false},
			{"Named", "Override", "", "/Parent/Context/Override", false, false, true},
			{"  Named  ", "", "", "/Parent/Context/Named", false, false, false},
			{"/Named", "", "", "/Named", false, false, false},
			{"/Named", "Override", "", "/Override", false, false, true},
			{"Folder/Named", "", "", "/Parent/Context/Folder/Named", false, false, false},
			{"/Folder/Named", "", "", "/Folder/Named", false, false, false},
			{"../Named", "", "", "/Parent/Named", false, false, false},
			{"../../Named", "", "", "/Named", false, false, false},
			{"../Folder/Named", "", "", "/Parent/Folder/Named", false, false, false},
			{"../Named", "", "", "/Named", true, false, false},
			{"Named", "", "", "/Named", false, true, false},
			{"Folder/Sub/", "", "", "/Folder/Sub/", false, true, false},
			{"../Named", "", "", "/Named", false, true, false},
			{"/Folder/Named", "", "", "/Folder/Named", false, true, false},
			{"", "Named", "", "/Named", true, true, true},
			{"", "", "", "/", false, true, false},
			{"", "Named", "", "/Named", false, true, true},
			{"", "", "child", "/Parent/Context/", false, false, false},
			{"", "Named", "child", "/Parent/Context/Named", false, false, true},
			{"Named", "", "child", "/Parent/Context/Named", false, false, false},
			{"Folder/Named", "", "child", "/Parent/Context/Named", false, false, false},
			{"/Named", "", "child", "/Parent/Context/Named", false, false, false},
			{"Folder/", "", "child", "/Parent/Context/", false, false, false},
			{"Folder/", "Named", "child", "/Parent/Context/Named", false, false, true},
			{"Named", "Override", "child", "/Override", true, false, true},
		} {
			request := DocumentPlanRequest{Notebook: box.ID, Purpose: "document", ContextID: &contextDoc.ID,
				ID: ast.NewNodeID(), Placement: test.placement, Target: &EffectiveDocumentTarget{Notebook: box.ID, Path: test.template}}
			if test.root {
				request.ContextID = nil
			}
			if test.cross {
				request.Target.Notebook = other.ID
			}
			if test.explicit {
				request.Title = &test.title
			}
			plan, err := PlanDocumentCreation(request)
			if err != nil || plan.DisplayPath != test.expected {
				t.Fatalf("legacy target %+v: %+v, %v", test, plan, err)
			}
		}
	})
	t.Run("all template formats reject ambiguous ancestors and reuse targets", func(t *testing.T) {
		for i := 0; i < 2; i++ {
			newHPathTestDoc(t, box.ID, "/", "Ambiguous parent", 1)
			newHPathTestDoc(t, box.ID, "/", "Ambiguous reuse", 1)
		}
		for _, structured := range []bool{false, true} {
			for _, reuse := range []bool{false, true} {
				target := &EffectiveDocumentTarget{Notebook: box.ID, Path: "/Ambiguous parent/Title"}
				parents, title := []string{"Ambiguous parent"}, "Title"
				if reuse {
					target.Path, parents, title = "/Ambiguous reuse", []string{}, "Ambiguous reuse"
				}
				if structured {
					target.Structured = &conf.DocumentTarget{Version: 2, Notebook: box.ID,
						Anchor: conf.DocumentTargetAnchor{Kind: "notebookRoot"}, Parents: parents, Title: title, OnMissingParent: "create"}
				}
				id := ast.NewNodeID()
				plan, err := PlanDocumentCreation(DocumentPlanRequest{Notebook: box.ID, Purpose: "document", ID: id,
					Reuse: reuse, Target: target})
				var failure *DocumentAddressingError
				if plan != nil || !errors.As(err, &failure) || failure.Reason != "planChanged" {
					t.Fatalf("structured=%t reuse=%t selected an ambiguous document: %+v, %v", structured, reuse, plan, err)
				}
				if treenode.GetBlockTree(id) != nil {
					t.Fatal("rejected plan created a document")
				}
			}
		}
	})
}
