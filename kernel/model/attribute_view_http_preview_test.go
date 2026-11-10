// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func TestAttributeViewHTTPPreviewDoesNotExecuteTemplates(t *testing.T) {
	for _, shape := range []string{"display", "flat-nested-request", "sort", "sort-filter", "filter", "nested", "search"} {
		t.Run(shape, func(t *testing.T) {
			database, _ := nestedFixture(t, 3)
			view := database.Views[0]
			view.SubItemsDisplay = "flat"
			key := av.NewKey("http", "HTTP", "", av.KeyTypeTemplate)
			key.Template = `.action{(httpGet "https://example.com/data").body}`
			database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: key})
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
			preview := &sql.HTTPTemplatePreview{}
			options := AttributeViewRenderOptions{HTTPPreview: preview}
			confirmations := 0
			execution := templatehttp.New(context.Background(), "preview", func(context.Context, templatehttp.Request) bool {
				confirmations++
				return false
			})
			defer execution.Close()
			options.TemplateHTTP = execution
			query := ""
			switch shape {
			case "flat-nested-request":
				options.Nested = &av.NestedRequest{}
			case "sort", "sort-filter":
				options.Nested = &av.NestedRequest{}
				view.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderAsc}}
				if shape == "sort-filter" {
					view.Filters = []*av.ViewFilter{{Column: key.ID, Operator: av.FilterOperatorIsNotEmpty}}
				}
			case "filter":
				view.Filters = []*av.ViewFilter{{Column: key.ID, Operator: av.FilterOperatorIsNotEmpty}}
			case "nested":
				view.SubItemsDisplay = "nested"
				options.Nested = &av.NestedRequest{}
			case "search":
				query = "data"
			}
			result, err := renderAttributeViewWithOptions(database, "", view.ID, "", query, 1, 50, nil, false, false, nil, "", options)
			if err != nil {
				t.Fatal(err)
			}
			table := av.TableFromViewable(result)
			if confirmations != 0 || len(preview.Pending()) != 1 || preview.Pending()[0] != key.ID {
				t.Fatalf("unexpected preview: confirmations=%d pending=%v", confirmations, preview.Pending())
			}
			if shape == "display" || shape == "flat-nested-request" || shape == "sort" {
				if len(table.Rows) != 3 {
					t.Fatalf("stored rows did not render: %d", len(table.Rows))
				}
				for _, row := range table.Rows {
					if row.GetValue(key.ID).Template.Content != "" {
						t.Fatal("unfinished template leaked source or result")
					}
				}
				if shape == "sort" && (len(view.Sorts) != 1 || view.Sorts[0].Column != key.ID) {
					t.Fatal("preview changed the saved sorting rule")
				}
			} else if len(table.Rows) != 0 {
				t.Fatal("preview exposed provisional rows before resolving template-dependent membership or order")
			}
			if key.Template != `.action{(httpGet "https://example.com/data").body}` {
				t.Fatal("preview changed the template source")
			}
		})
	}
}

func TestAttributeViewHTTPSearchUsesCurrentTemplateSnapshot(t *testing.T) {
	templatehttp.ClearTemplateResults()
	t.Cleanup(templatehttp.ClearTemplateResults)
	database, ids := nestedFixture(t, 3)
	view := database.Views[0]
	view.SubItemsDisplay = "flat"
	database.GetBlockKeyValues().Key.Name = "Primary"
	key := av.NewKey("http-search", "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{if false}.action{httpGet "https://example.com/data"}.action{querySQL "select * from blocks"}.action{end}.action{.Primary}:.action{uuidv4}`
	database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: key})
	view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	view.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderDesc}}
	source, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	render := func(query string, automatic bool) *av.Table {
		t.Helper()
		execution := templatehttp.New(context.Background(), "http-search", nil)
		defer execution.Close()
		execution.SetAutomaticRefresh(automatic)
		execution.SetPreserveHTTPResults(automatic)
		current, err := av.ParseAttributeViewData(database.ID, source)
		if err != nil {
			t.Fatal(err)
		}
		result, err := renderAttributeViewWithOptions(current, "", view.ID, "", query, 1, 50, nil,
			false, false, nil, "", AttributeViewRenderOptions{TemplateHTTP: execution})
		if err != nil {
			t.Fatal(err)
		}
		execution.CommitTemplateResults()
		return av.TableFromViewable(result)
	}
	values := func(table *av.Table) map[string]string {
		ret := map[string]string{}
		for _, row := range table.Rows {
			ret[row.ID] = row.GetValue(key.ID).Template.Content
		}
		return ret
	}
	initial := values(render("", false))
	if len(initial) != 3 {
		t.Fatal("initial rows missing", initial)
	}
	match := initial[ids[1]]
	found := render(match, true)
	if len(found.Rows) != 1 || found.Rows[0].ID != ids[1] || found.Rows[0].GetValue(key.ID).Template.Content != match {
		t.Fatal("search recomputed templates instead of matching the current snapshot", values(found))
	}
	if cleared := values(render("", true)); !reflect.DeepEqual(initial, cleared) {
		t.Fatal("clearing search recomputed template results", initial, cleared)
	}
	if refreshed := values(render("", false)); reflect.DeepEqual(initial, refreshed) {
		t.Fatal("manual refresh reused search snapshots")
	}
}
