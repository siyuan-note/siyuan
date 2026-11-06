// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func relationDetailFixture(t *testing.T) (*av.AttributeView, *av.AttributeView, *AttributeViewRelationContext, []string) {
	t.Helper()
	setupAttributeViewValidationTest(t)
	source, target := av.NewAttributeView(ast.NewNodeID()), av.NewAttributeView(ast.NewNodeID())
	itemID, keyID := ast.NewNodeID(), ast.NewNodeID()
	source.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: source.GetBlockKey().ID, BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Source"}}}
	ids := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
	for i, id := range ids {
		target.GetBlockKeyValues().Values = append(target.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(),
			KeyID: target.GetBlockKey().ID, BlockID: id, Type: av.KeyTypeBlock, IsDetached: true,
			Block: &av.ValueBlock{Content: fmt.Sprintf("Target %d", i)}})
	}
	target.Views[0].ItemIDs = slices.Clone(ids)
	target.Views[0].PageSize = 1
	source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Related", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: target.ID, DetailView: &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: target.Views[0].ID}}},
		Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: keyID, BlockID: itemID, Type: av.KeyTypeRelation,
			Relation: &av.ValueRelation{BlockIDs: []string{ids[1], ids[3]}}}}})
	for _, db := range []*av.AttributeView{source, target} {
		if err := av.SaveAttributeView(db); err != nil {
			t.Fatal(err)
		}
	}
	return source, target, &AttributeViewRelationContext{SourceAvID: source.ID, SourceItemID: itemID, RelationKeyID: keyID}, ids
}

func TestRelationDetailScopeBeforePageAndLocate(t *testing.T) {
	source, target, context, ids := relationDetailFixture(t)
	key, _ := source.GetKey(context.RelationKeyID)
	key.Relation.CandidateFilters = []*av.ViewFilter{{Column: target.GetBlockKey().ID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "not eligible"}}}}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		page   int
		locate string
		want   string
		status string
	}{{1, "", ids[1], ""}, {2, "", ids[3], ""}, {1, ids[3], ids[3], "visible"}, {1, ids[0], ids[1], "itemNotFound"}} {
		instance, _, location, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", tc.page, 1, nil,
			"", false, false, tc.locate, "", AttributeViewRenderOptions{RelationContext: context})
		if err != nil {
			t.Fatal(err)
		}
		table := instance.(*av.Table)
		if table.RowCount != 2 || tc.locate == "" && (len(table.Rows) != 1 || table.Rows[0].ID != tc.want) {
			t.Fatalf("membership must precede paging: page=%d rows=%+v count=%d", tc.page, table.Rows, table.RowCount)
		}
		for _, row := range table.Rows {
			if row.ID != ids[1] && row.ID != ids[3] {
				t.Fatal("located page included an unrelated row")
			}
		}
		if tc.locate == ids[3] && location.Index != 1 {
			t.Fatalf("locate used the full target index: %+v", location)
		}
		if tc.status != "" && (location == nil || location.Status != tc.status) {
			t.Fatalf("unexpected locate result: %+v", location)
		}
	}
}

func TestRelationDetailTemporaryRenderDoesNotPersist(t *testing.T) {
	_, target, context, ids := relationDetailFixture(t)
	path, _ := av.FindAttributeViewPath(target.ID)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	original, _ := json.Marshal(target)
	baseline, err := av.ParseAttributeView(target.ID)
	if err != nil {
		t.Fatal(err)
	}
	baselineView, _ := json.Marshal(baseline.Views[0])
	instance, _, _, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
		"", true, false, "", "", AttributeViewRenderOptions{RelationContext: context,
			TemporarySort: &av.ViewSort{Column: target.GetBlockKey().ID, Order: av.SortOrderDesc},
			TemporaryFilters: []*av.ViewFilter{{Column: target.GetBlockKey().ID, Operator: av.FilterOperatorContains,
				Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "3"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	table := instance.(*av.Table)
	if table.RowCount != 1 || len(table.Rows) != 1 || table.Rows[0].ID != ids[3] {
		t.Fatalf("temporary filter lost: %+v", table)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("temporary render persisted changes")
	}
	unchanged, _ := json.Marshal(target)
	if string(original) != string(unchanged) {
		t.Fatal("temporary render mutated the original object")
	}
	reloaded, err := av.ParseAttributeView(target.ID)
	if err != nil {
		t.Fatal(err)
	}
	currentView, _ := json.Marshal(reloaded.Views[0])
	if string(baselineView) != string(currentView) {
		t.Fatalf("temporary state leaked through the parse cache: before=%s after=%s", baselineView, currentView)
	}
	instance, _, _, err = RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
		"", false, false, "", "", AttributeViewRenderOptions{RelationContext: context})
	if err != nil || len(instance.(*av.Table).Rows) != 2 || instance.(*av.Table).Rows[0].ID != ids[1] {
		t.Fatalf("subsequent render reused temporary state: %v", err)
	}
}

func TestRelationDetailContextFailsClosed(t *testing.T) {
	source, target, context, _ := relationDetailFixture(t)
	for _, mutate := range []func(*AttributeViewRelationContext){
		func(c *AttributeViewRelationContext) { c.SourceAvID = ast.NewNodeID() },
		func(c *AttributeViewRelationContext) { c.SourceItemID = ast.NewNodeID() },
		func(c *AttributeViewRelationContext) { c.RelationKeyID = ast.NewNodeID() },
	} {
		invalid := *context
		mutate(&invalid)
		if result, _, _, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
			"", true, false, "", "", AttributeViewRenderOptions{RelationContext: &invalid}); err == nil || result != nil {
			t.Fatal("invalid context expanded to the target database")
		}
	}
	if result, _, _, err := RenderAttributeViewWithTargetOptions("", source.ID, "", "", 1, 50, nil,
		"", true, false, "", "", AttributeViewRenderOptions{RelationContext: context}); err == nil || result != nil {
		t.Fatal("mismatched target was accepted")
	}
	key, _ := source.GetKey(context.RelationKeyID)
	source.GetValue(key.ID, context.SourceItemID).Relation.BlockIDs = nil
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	instance, _, _, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
		"", false, false, "", "", AttributeViewRenderOptions{RelationContext: context})
	if err != nil || instance.(*av.Table).RowCount != 0 || len(instance.(*av.Table).Rows) != 0 {
		t.Fatalf("empty relation must stay empty: %v", err)
	}
}

func TestRelationDetailGroupsAndSavedFiltersRemainScoped(t *testing.T) {
	_, target, context, ids := relationDetailFixture(t)
	view := target.Views[0]
	view.Group = &av.ViewGroup{Field: target.GetBlockKey().ID, Method: av.GroupMethodValue, Order: av.GroupOrderAsc}
	regenAttrViewGroups(target)
	if err := av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	instance, _, _, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
		"", false, false, "", "", AttributeViewRenderOptions{RelationContext: context})
	if err != nil {
		t.Fatal(err)
	}
	table := instance.(*av.Table)
	rows := 0
	for _, group := range table.Groups {
		for _, row := range group.(*av.Table).Rows {
			if row.ID != ids[1] && row.ID != ids[3] {
				t.Fatal("group included an unrelated row")
			}
			rows++
		}
		if group.(*av.Table).Name == "Target 0" || group.(*av.Table).Name == "Target 2" {
			t.Fatal("group generation used unrelated entries")
		}
	}
	if rows != 2 {
		t.Fatalf("grouping lost related rows: %d", rows)
	}
	view.Group, view.Groups = nil, nil
	view.Filters = []*av.ViewFilter{{Column: target.GetBlockKey().ID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "1"}}}}
	if err = av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	instance, _, _, err = RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
		"", false, false, "", "", AttributeViewRenderOptions{RelationContext: context,
			TemporaryFilters: []*av.ViewFilter{{Combination: av.FilterCombinationOr, Filters: []*av.ViewFilter{
				{Column: target.GetBlockKey().ID, Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "0"}}},
				{Column: target.GetBlockKey().ID, Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "3"}}},
			}}}})
	if err != nil || instance.(*av.Table).RowCount != 0 {
		t.Fatalf("temporary OR overrode existing view filters: %v", err)
	}
	for _, invalid := range []*av.ViewFilter{{Column: ast.NewNodeID(), Operator: av.FilterOperatorContains},
		{Column: target.GetBlockKey().ID, Operator: "invalid"}, {Combination: "xor"}, nil} {
		if result, _, _, renderErr := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
			"", false, false, "", "", AttributeViewRenderOptions{RelationContext: context, TemporaryFilters: []*av.ViewFilter{invalid}}); renderErr == nil || result != nil {
			t.Fatal("invalid temporary filter was silently ignored")
		}
	}
}

func TestRelationDetailLargeMembershipBeforePagination(t *testing.T) {
	source, target, context, _ := relationDetailFixture(t)
	const size = 4000
	ids := make([]string, 0, size)
	target.GetBlockKeyValues().Values = nil
	for i := 0; i < size; i++ {
		id := ast.NewNodeID()
		ids = append(ids, id)
		target.GetBlockKeyValues().Values = append(target.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: target.GetBlockKey().ID, BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: fmt.Sprint(i)}})
	}
	target.Views[0].ItemIDs = slices.Clone(ids)
	members := make([]string, 0, size/2)
	for i := 0; i < size; i += 2 {
		members = append(members, ids[i])
	}
	source.GetValue(context.RelationKeyID, context.SourceItemID).Relation.BlockIDs = members
	for _, view := range []*av.AttributeView{source, target} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	rendered, _, _, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 2, 25, nil, "", false, false, "", "", AttributeViewRenderOptions{RelationContext: context})
	if err != nil {
		t.Fatal(err)
	}
	table := rendered.(*av.Table)
	if table.RowCount != size/2 || len(table.Rows) != 25 || table.Rows[0].ID != members[25] {
		t.Fatalf("large membership pagination escaped scope: count=%d rows=%d", table.RowCount, len(table.Rows))
	}
}

func TestRelationDetailTemplateHTTPExecution(t *testing.T) {
	for _, approved := range []bool{false, true} {
		for _, scoped := range []bool{false, true} {
			name := map[bool]string{false: "native", true: "related"}[scoped] + "/" +
				map[bool]string{false: "denied", true: "approved-canceled-before-network"}[approved]
			t.Run(name, func(t *testing.T) {
				source, target, relation, ids := relationDetailFixture(t)
				key := av.NewKey(ast.NewNodeID(), "HTTP result", "", av.KeyTypeTemplate)
				key.Template = `.action{(httpGet "https://example.com/data").error}`
				target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: key})
				target.Views[0].Table.Columns = append(target.Views[0].Table.Columns,
					&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
				if err := av.SaveAttributeView(target); err != nil {
					t.Fatal(err)
				}
				before := map[string][]byte{}
				if scoped {
					for _, database := range []*av.AttributeView{source, target} {
						path, _ := av.FindAttributeViewPath(database.ID)
						data, err := os.ReadFile(path)
						if err != nil {
							t.Fatal(err)
						}
						before[path] = data
					}
				}
				confirmations, requests := 0, 0
				execution := templatehttp.New(context.Background(), "relation-detail", func(_ context.Context, request templatehttp.Request) bool {
					confirmations++
					if request.Method != "GET" || request.URL != "https://example.com/data" {
						t.Fatalf("unexpected HTTP confirmation: %+v", request)
					}
					return approved
				})
				defer execution.Close()
				execution.SetRequestStarted(func() {
					requests++
					if !approved || confirmations != 1 {
						t.Fatal("HTTP request started without approval")
					}
					// 确认通过后在传输前取消，离线验证交互执行和取消传播。
					execution.Close()
				})
				options := AttributeViewRenderOptions{TemplateHTTP: execution}
				if scoped {
					options.RelationContext = relation
				}
				result, _, _, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil,
					"", false, false, "", "", options)
				if confirmations != 1 {
					t.Fatalf("expected one interactive confirmation, got %d", confirmations)
				}
				if approved {
					if requests != 1 || !errors.Is(err, context.Canceled) || result != nil {
						t.Fatalf("approved execution lost cancellation: requests=%d result=%v err=%v", requests, result, err)
					}
				} else {
					if err != nil || requests != 0 {
						t.Fatalf("denied execution failed: requests=%d err=%v", requests, err)
					}
					table := result.(*av.Table)
					wantRows := len(ids)
					if scoped {
						wantRows = 2
					}
					if len(table.Rows) != wantRows {
						t.Fatalf("unexpected rendered rows: got %d want %d", len(table.Rows), wantRows)
					}
					for _, row := range table.Rows {
						if got := row.GetValue(key.ID).Template.Content; got != "denied" {
							t.Fatalf("interactive HTTP execution was dropped: %q", got)
						}
					}
				}
				for path, data := range before {
					after, readErr := os.ReadFile(path)
					if readErr != nil || !bytes.Equal(data, after) {
						t.Fatalf("related HTTP render persisted database changes: %s: %v", path, readErr)
					}
				}
			})
		}
	}
}

func TestRelationDetailTemplateHTTPReadOnlyModes(t *testing.T) {
	for _, mode := range []string{"readonly", "history", "publish"} {
		t.Run(mode, func(t *testing.T) {
			_, target, relation, _ := relationDetailFixture(t)
			key := av.NewKey(ast.NewNodeID(), "HTTP result", "", av.KeyTypeTemplate)
			key.Template = `.action{(httpGet "https://example.com/data").error}`
			target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: key})
			target.Views[0].Table.Columns = append(target.Views[0].Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
			if err := av.SaveAttributeView(target); err != nil {
				t.Fatal(err)
			}
			confirmations := 0
			execution := templatehttp.New(context.Background(), "readonly-related", func(context.Context, templatehttp.Request) bool { confirmations++; return false })
			defer execution.Close()
			options := AttributeViewRenderOptions{RelationContext: relation, TemplateHTTP: execution}
			switch mode {
			case "readonly":
				options.ReadOnly = true
			case "history":
				options.historicalSource = true
			case "publish":
				options.ScopeFilter = func(view av.Viewable) av.Viewable { return view }
			}
			result, _, _, err := RenderAttributeViewWithTargetOptions("", target.ID, "", "", 1, 50, nil, "", false, false, "", "", options)
			if err != nil || result == nil || confirmations != 0 {
				t.Fatalf("restricted render enabled interactive HTTP: %d %v", confirmations, err)
			}
			for _, row := range result.(*av.Table).Rows {
				if got := row.GetValue(key.ID).Template.Content; got != "interaction_required" {
					t.Fatalf("readonly HTTP result %q", got)
				}
			}
		})
	}
}
