// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func nestedEmptyBlockTree(t *testing.T) {
	t.Helper()
	previous := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previous
		if previous != "" {
			treenode.InitBlockTree(false)
		}
	})
}

func TestNestedArchivesRetainDeletedBoundAncestors(t *testing.T) {
	for _, archive := range []string{"history", "snapshot"} {
		t.Run(archive, func(t *testing.T) {
			database, ids := nestedFixture(t, 2)
			nestedEmptyBlockTree(t)
			if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
				t.Fatal(err)
			}
			parent := database.GetBlockKeyValues().Values[0]
			parent.IsDetached = false
			parent.Block.ID = ids[0]
			parent.Block.RefSubtype = av.BlockRefSubtypeStatic
			parent.Block.Content = "Item archived parent"
			var read func(string, *av.NestedRequest) (av.Viewable, error)
			if archive == "history" {
				previous := util.HistoryDir
				util.HistoryDir = t.TempDir()
				t.Cleanup(func() { util.HistoryDir = previous })
				created := time.Date(2026, 10, 28, 10, 20, 30, 0, time.Local)
				directory := filepath.Join(util.HistoryDir, created.Format("2006-01-02-150405")+"-update", "storage", "av")
				if err := os.MkdirAll(directory, 0700); err != nil {
					t.Fatal(err)
				}
				data, err := json.Marshal(database)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(directory, database.ID+".json"), data, 0600); err != nil {
					t.Fatal(err)
				}
				read = func(query string, nested *av.NestedRequest) (av.Viewable, error) {
					view, _, err := RenderHistoryAttributeViewWithOptions(database.ID, "", "", query, 1, 50, nil, strconv.FormatInt(created.Unix(), 10), AttributeViewRenderOptions{Nested: nested})
					return view, err
				}
			} else {
				_, repo, _ := prepareAssetDownloadRepoTest(t)
				if err := av.SaveAttributeView(database); err != nil {
					t.Fatal(err)
				}
				index, err := repo.Index("bound ancestor snapshot", true, nil)
				if err != nil {
					t.Fatal(err)
				}
				read = func(query string, nested *av.NestedRequest) (av.Viewable, error) {
					view, _, err := RenderRepoSnapshotAttributeViewWithPagingOptions(index.ID, database.ID, "", "", query, 1, 50, nil, AttributeViewRenderOptions{Nested: nested})
					return view, err
				}
			}
			// 空查询走身份投影，搜索走 SQL 投影；两个路径都须物化历史绑定父项。
			for _, query := range []string{"", "Item"} {
				for _, nested := range []*av.NestedRequest{nil, {ExpandedIDs: []string{ids[0]}}} {
					instance, err := read(query, nested)
					if err != nil {
						t.Fatal(err)
					}
					table := av.TableFromViewable(instance)
					if len(table.Rows) != 2 || table.Rows[0].ID != ids[0] || table.Rows[1].ID != ids[1] {
						t.Fatalf("archive lost bound source order: query=%q nested=%v rows=%+v", query, nested != nil, table.Rows)
					}
					value := table.Rows[0].GetBlockValue()
					if value.IsDetached || value.Block.ID != ids[0] || value.Block.Content != "Item archived parent" || value.Block.RefSubtype != av.BlockRefSubtypeStatic {
						t.Fatalf("archive changed stored binding: %+v", value)
					}
					if nested != nil && (table.Rows[1].Hierarchy.ParentID != ids[0] || table.Rows[1].Hierarchy.Depth != 1) {
						t.Fatal("archive lost parent hierarchy")
					}
				}
			}
			// 历史上下文不能泄漏到普通实时读取，实时视图仍排除已删除绑定块。
			live := nestedRender(t, database, "", 1, 50, nil, AttributeViewRenderOptions{})
			if len(live.Rows) != 1 || live.Rows[0].ID != ids[1] || live.Rows[0].Hierarchy.ParentID != "" {
				t.Fatal("archive context changed live block existence semantics")
			}
			flat, err := renderAttributeViewWithOptions(database, "", database.Views[0].ID, "", "", 1, 50, nil, false, false, nil, "", AttributeViewRenderOptions{})
			if err != nil || len(av.TableFromViewable(flat).Rows) != 1 || av.TableFromViewable(flat).Rows[0].ID != ids[1] {
				t.Fatalf("archive context changed flat live reading: %v", err)
			}
		})
	}
}

func TestNestedMetadataTargetUsesAuthorizedIdentities(t *testing.T) {
	database, ids := nestedFixture(t, 2)
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	filter := func(view av.Viewable) av.Viewable {
		table := av.TableFromViewable(view)
		table.Rows = slices.DeleteFunc(table.Rows, func(row *av.TableRow) bool { return row.ID != ids[1] })
		return view
	}
	for _, item := range []struct{ id, status string }{{ids[0], "itemNotFound"}, {ast.NewNodeID(), "itemNotFound"}, {ids[1], "filtered"}} {
		view, _, target, err := RenderAttributeViewWithTargetOptions("", database.ID, database.Views[0].ID, "", 1, 50, nil, "", false, true, item.id, "", AttributeViewRenderOptions{ReadOnly: true, Nested: &av.NestedRequest{}, ScopeFilter: filter})
		if err != nil {
			t.Fatal(err)
		}
		if target.Status != item.status || len(target.AncestorIDs) != 0 || len(av.TableFromViewable(view).Rows) != 0 {
			t.Fatalf("metadata target leaked hidden identity: %+v", target)
		}
	}
}

func TestNestedTemplatePlanKeepsIndependentDisplayFieldsPaged(t *testing.T) {
	for _, rule := range []string{"sort", "filter"} {
		t.Run(rule, func(t *testing.T) {
			database, ids := nestedFixture(t, 10000)
			var display *av.KeyValues
			var ruleKey *av.Key
			for _, name := range []string{"Dependency", "Rule", "DisplayOnly"} {
				key := av.NewKey(ast.NewNodeID(), name, "", av.KeyTypeTemplate)
				key.Template = `.action{printf "computed"}`
				if name == "Rule" {
					key.Template = `.action{.Dependency}`
					ruleKey = key
				}
				values := &av.KeyValues{Key: key}
				for _, id := range ids {
					values.Values = append(values.Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: key.Type, Template: &av.ValueTemplate{Content: "unevaluated"}})
				}
				database.KeyValues = append(database.KeyValues, values)
				database.Views[0].Table.Columns = append(database.Views[0].Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
				if name == "DisplayOnly" {
					display = values
				}
			}
			if rule == "sort" {
				database.Views[0].Sorts = []*av.ViewSort{{Column: ruleKey.ID, Order: av.SortOrderAsc}}
			} else {
				database.Views[0].Filters = []*av.ViewFilter{{Column: ruleKey.ID, Operator: av.FilterOperatorIsEqual, Value: &av.Value{Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: "computed"}}}}
			}
			started := time.Now()
			table := nestedRender(t, database, "", 1, 50, nil, AttributeViewRenderOptions{})
			evaluated := 0
			for _, value := range display.Values {
				if value.Template.Content == "computed" {
					evaluated++
				}
			}
			if len(table.Rows) != 50 || table.Nested.MatchedCount != len(ids) || evaluated != 50 || table.Rows[0].GetValue(ruleKey.ID).Template.Content != "computed" {
				t.Fatalf("dependency projection failed: matched=%d rows=%d displayEvaluations=%d", table.Nested.MatchedCount, len(table.Rows), evaluated)
			}
			t.Logf("rule=%s source=%d visible=%d displayEvaluations=%d elapsed=%s", rule, len(ids), len(table.Rows), evaluated, time.Since(started))
		})
	}
}

func TestNestedGroupedSearchExpandsOnlyEachRootTree(t *testing.T) {
	database, ids := nestedFixture(t, 2000)
	parents := map[string]string{}
	for i := 0; i < len(ids); i += 2 {
		parents[ids[i+1]] = ids[i]
		database.GetBlockKeyValues().Values[i+1].Block.Content = "Matching child"
	}
	if err := database.SetSubItemsParents(parents); err != nil {
		t.Fatal(err)
	}
	database.Views[0].Group = &av.ViewGroup{Field: database.GetBlockKey().ID, Method: av.GroupMethodValue}
	started := time.Now()
	table := nestedRender(t, database, "Matching", 1, 50, nil, AttributeViewRenderOptions{})
	seen := map[string]bool{}
	for _, group := range table.Groups {
		rows := av.TableFromViewable(group).Rows
		if len(rows) == 0 {
			continue
		}
		if len(rows) != 2 || !rows[0].Hierarchy.Context || !rows[0].Hierarchy.Expanded || rows[1].Hierarchy.ParentID != rows[0].ID {
			t.Fatal("group search did not preserve its matching ancestor path")
		}
		seen[rows[1].ID] = true
	}
	if len(seen) != 1000 || table.Nested.MatchedCount != 1000 {
		t.Fatalf("group search dropped or duplicated matches: visible=%d matched=%d", len(seen), table.Nested.MatchedCount)
	}
	t.Logf("source=%d matchingRoots=%d groups=%d elapsed=%s", len(ids), len(seen), len(table.Groups), time.Since(started))
}

func TestNestedArchiveCreatedUsesBoundBlockIdentity(t *testing.T) {
	for _, archive := range []string{"history", "snapshot"} {
		t.Run(archive, func(t *testing.T) {
			database, ids := nestedFixture(t, 3)
			nestedEmptyBlockTree(t)
			primary := database.GetBlockKeyValues()
			primary.Values[1].IsDetached, primary.Values[1].Block.ID = false, "20200101120000-abcdefg"
			primary.Values[2].IsDetached, primary.Values[2].Block.ID = false, "20210101120000-abcdefg"
			// 游离条目的来源块 ID 即使仍保留，也不能取代条目自己的创建身份。
			primary.Values[0].Block.ID = "19990101120000-abcdefg"
			key := av.NewKey(ast.NewNodeID(), "Created", "", av.KeyTypeCreated)
			database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: key})
			database.Views[0].Table.Columns = append(database.Views[0].Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
			database.Views[0].ItemIDs = []string{ids[0], ids[2], ids[1]}
			for _, rule := range []string{"sort", "filter"} {
				view, err := cloneNestedView(database.Views[0])
				if err != nil {
					t.Fatal(err)
				}
				view.ID = ast.NewNodeID()
				if rule == "sort" {
					view.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderAsc}}
				} else {
					view.Filters = []*av.ViewFilter{{Column: key.ID, Operator: av.FilterOperatorIsLess, Value: &av.Value{Type: av.KeyTypeCreated, Created: &av.ValueCreated{Content: time.Date(2020, 6, 1, 0, 0, 0, 0, time.Local).UnixMilli(), IsNotEmpty: true}}}}
				}
				database.Views = append(database.Views, view)
			}
			var read func(string, *av.NestedRequest) (av.Viewable, error)
			if archive == "history" {
				previous := util.HistoryDir
				util.HistoryDir = t.TempDir()
				t.Cleanup(func() { util.HistoryDir = previous })
				created := time.Date(2026, 10, 28, 10, 20, 30, 0, time.Local)
				directory := filepath.Join(util.HistoryDir, created.Format("2006-01-02-150405")+"-update", "storage", "av")
				if err := os.MkdirAll(directory, 0700); err != nil {
					t.Fatal(err)
				}
				data, err := json.Marshal(database)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(directory, database.ID+".json"), data, 0600); err != nil {
					t.Fatal(err)
				}
				read = func(viewID string, nested *av.NestedRequest) (av.Viewable, error) {
					view, _, err := RenderHistoryAttributeViewWithOptions(database.ID, viewID, "", "", 1, 50, nil, strconv.FormatInt(created.Unix(), 10), AttributeViewRenderOptions{Nested: nested})
					return view, err
				}
			} else {
				_, repo, _ := prepareAssetDownloadRepoTest(t)
				if err := av.SaveAttributeView(database); err != nil {
					t.Fatal(err)
				}
				index, err := repo.Index("created source identity", true, nil)
				if err != nil {
					t.Fatal(err)
				}
				read = func(viewID string, nested *av.NestedRequest) (av.Viewable, error) {
					view, _, err := RenderRepoSnapshotAttributeViewWithPagingOptions(index.ID, database.ID, viewID, "", "", 1, 50, nil, AttributeViewRenderOptions{Nested: nested})
					return view, err
				}
			}
			for viewIndex, view := range database.Views {
				for _, nested := range []*av.NestedRequest{nil, {}} {
					instance, err := read(view.ID, nested)
					if err != nil {
						t.Fatal(err)
					}
					rows := av.TableFromViewable(instance).Rows
					want := [][]string{{ids[0], ids[2], ids[1]}, {ids[1], ids[2], ids[0]}, {ids[1]}}[viewIndex]
					if len(rows) != len(want) {
						t.Fatalf("Created filter changed archive membership: rule=%d nested=%v rows=%d", viewIndex, nested != nil, len(rows))
					}
					for i, row := range rows {
						if row.ID != want[i] {
							t.Fatalf("Created sort used item time: rule=%d nested=%v item=%s want=%s", viewIndex, nested != nil, row.ID, want[i])
						}
						identity := row.ID
						block := row.GetBlockValue()
						if !block.IsDetached {
							identity = block.Block.ID
						}
						expected, err := time.ParseInLocation("20060102150405", identity[:14], time.Local)
						if err != nil || row.GetValue(key.ID).Created.Content != expected.UnixMilli() {
							t.Fatalf("Created value lost source identity: item=%s identity=%s got=%+v", row.ID, identity, row.GetValue(key.ID).Created)
						}
					}
				}
			}
		})
	}
}
