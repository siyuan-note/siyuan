// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func TestAttributeViewHTTPRenderCanceledResultIsDiscarded(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	execution := templatehttp.New(ctx, "scope", nil)
	defer execution.Close()
	view, database, target, err := RenderAttributeViewWithTargetOptions("", "invalid", "", "", 1, 10,
		nil, "", false, false, "", "", AttributeViewRenderOptions{TemplateHTTP: execution})
	if !errors.Is(err, context.Canceled) || view != nil || database != nil || target != nil {
		t.Fatalf("canceled result escaped: view=%v database=%v target=%v err=%v", view, database, target, err)
	}
}

func TestNestedAttributeViewHTTPTemplateUsesExecution(t *testing.T) {
	database, _ := nestedFixture(t, 3)
	key := av.NewKey("http-template", "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{(httpGet "https://example.com/data").error}`
	values := &av.KeyValues{Key: key}
	for _, block := range database.GetBlockKeyValues().Values {
		values.Values = append(values.Values, &av.Value{ID: block.ID + "-http", KeyID: key.ID,
			BlockID: block.BlockID, Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: key.Template}})
	}
	database.KeyValues = append(database.KeyValues, values)
	database.Views[0].Table.Columns = append(database.Views[0].Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	confirmations := 0
	execution := templatehttp.New(context.Background(), "scope", func(context.Context, templatehttp.Request) bool {
		confirmations++
		return false
	})
	defer execution.Close()
	table := nestedRender(t, database, "", 1, 10, nil, AttributeViewRenderOptions{TemplateHTTP: execution})
	if confirmations != 1 || len(table.Rows) != 3 {
		t.Fatalf("nested execution mismatch: prompts=%d rows=%d", confirmations, len(table.Rows))
	}
	for _, row := range table.Rows {
		if got := row.GetValue(key.ID).Template.Content; got != "denied" {
			t.Fatalf("nested field did not use the execution: %q", got)
		}
	}
	for _, options := range []AttributeViewRenderOptions{
		{ReadOnly: true},
		{historicalSource: true},
		{ScopeFilter: func(view av.Viewable) av.Viewable { return view }},
	} {
		options.TemplateHTTP = execution
		table = nestedRender(t, database, "", 1, 10, nil, options)
		for _, row := range table.Rows {
			if got := row.GetValue(key.ID).Template.Content; got != "interaction_required" {
				t.Fatalf("restricted render used an interactive execution: %q", got)
			}
		}
	}
	if confirmations != 1 {
		t.Fatalf("restricted render prompted: %d", confirmations)
	}
}
