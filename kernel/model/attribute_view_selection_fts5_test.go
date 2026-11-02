// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"errors"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewDocumentSelection(t *testing.T) {
	for _, mode := range []string{"item", "markdown", "relation", "batch"} {
		t.Run(mode, func(t *testing.T) {
			template := &av.NewItemTemplate{TargetType: av.NewItemTargetDocument, PrimaryKeyTemplate: "Selected item",
				SaveLocation: &av.NewItemSaveLocation{PathTemplate: "/Repeated/"}}
			fixture := setupRelationItemTest(t, template)
			first := newHPathTestDoc(t, fixture.files.box.ID, "/", "Repeated", 1)
			newHPathTestDoc(t, fixture.files.box.ID, "/", "Repeated", 1)
			if mode == "batch" {
				fixture.source.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Batch", TargetType: av.NewItemTargetDocument, SaveLocation: template.SaveLocation}}
				fixture.source.DefaultTemplateID = fixture.source.NewItemTemplates[0].ID
				if err := av.SaveAttributeView(fixture.source); err != nil {
					t.Fatal(err)
				}
			}
			preview := PreviewAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Input")
			if preview.Error != "" || preview.PrimaryKey != "Selected item" {
				t.Fatalf("relation candidate was hidden: %+v", preview)
			}
			create := func(selection *DocumentSelection) ([]string, error) {
				var result *CreateAttributeViewItemResult
				var err error
				switch mode {
				case "item":
					result, err = CreateAttributeViewItemWithSelection(fixture.target.ID, fixture.targetBlockID, "", template.ID, "", "", nil, selection)
				case "markdown":
					result, err = CreateAttributeViewItemWithMarkdown(fixture.target.ID, fixture.targetBlockID, "", template.ID, "", "", &CreateAttributeViewItemMarkdown{Title: "Input", Markdown: "Body"}, selection)
				case "relation":
					result, err = CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Input",
						[]*AttributeViewRelationItemCell{{ItemID: fixture.itemIDs[0]}}, preview, false, selection)
				case "batch":
					batch, createErr := CreateAttributeViewItemDocs(fixture.source.ID, fixture.sourceBlockID, CreateAttributeViewItemDocsSaveModeTemplate, fixture.itemIDs, selection)
					if createErr != nil {
						return nil, createErr
					}
					return batch.BlockIDs, nil
				}
				if err != nil {
					return nil, err
				}
				return []string{result.BlockID}, nil
			}
			_, err := create(nil)
			var ambiguity *DocumentAncestorAmbiguity
			if !errors.As(err, &ambiguity) {
				t.Fatalf("expected ambiguity: %v", err)
			}
			if view, err := av.ParseAttributeView(fixture.target.ID); err != nil || len(view.GetBlockKeyValues().Values) != 0 {
				t.Fatal("preflight created a row", err)
			}
			parent, err := getDocumentPath(fixture.files.box.ID, first.ID)
			if err != nil {
				t.Fatal(err)
			}
			selection := &DocumentSelection{Time: ambiguity.Time, TargetRevision: ambiguity.TargetRevision,
				AncestorChoices: []DocumentAncestorChoice{{Index: ambiguity.Index, ID: first.ID, Revision: parent.Revision}}}
			stale := *selection
			stale.TargetRevision = "changed"
			if _, err = create(&stale); err == nil {
				t.Fatal("stale template selection accepted")
			}
			documents, err := create(selection)
			if err != nil {
				t.Fatal(err)
			}
			want := 1
			if mode == "batch" {
				want = 2
			}
			if len(documents) != want {
				t.Fatal("missing bound documents", documents)
			}
			for _, id := range documents {
				document, err := getDocumentPath(fixture.files.box.ID, id)
				if err != nil || document.ParentID == nil || *document.ParentID != first.ID {
					t.Fatalf("wrong parent: %+v %v", document, err)
				}
			}
		})
	}
}
