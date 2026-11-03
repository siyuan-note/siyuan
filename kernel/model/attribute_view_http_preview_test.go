// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func TestAttributeViewHTTPPreviewDoesNotExecuteTemplates(t *testing.T) {
	for _, shape := range []string{"display", "sort", "filter", "nested", "search"} {
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
			case "sort":
				view.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderAsc}}
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
			if shape == "display" {
				if len(table.Rows) != 3 {
					t.Fatalf("stored rows did not render: %d", len(table.Rows))
				}
				for _, row := range table.Rows {
					if row.GetValue(key.ID).Template.Content != "" {
						t.Fatal("unfinished template leaked source or result")
					}
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
