// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"context"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func TestAttributeViewHTTPTemplateSharesExecutionAndIsolatesScope(t *testing.T) {
	confirmations := 0
	execution := templatehttp.New(context.Background(), "render", func(context.Context, templatehttp.Request) bool {
		confirmations++
		return false
	})
	defer execution.Close()
	renderContext := NewAttributeViewRenderContext()
	renderContext.TemplateHTTP = execution
	blockKey := av.NewKey("block-key", "Primary", "", av.KeyTypeBlock)
	key := av.NewKey("template-key", "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{$r := httpGet "https://example.com/data"}.action{if $r.ok}.action{$r.body}.action{else}fallback.action{end}`
	database := &av.AttributeView{ID: "database-one", KeyValues: []*av.KeyValues{
		{Key: blockKey, Values: []*av.Value{
			newTemplateErrorTestBlockValue(blockKey.ID, "20261030000000-item00b", "Beta"),
			newTemplateErrorTestBlockValue(blockKey.ID, "20261030000000-item00a", "Alpha"),
		}}, {Key: key},
	}}
	render := func() {
		t.Helper()
		table := newHTTPTemplateTestTable(blockKey, key)
		fillAttributeViewTemplateValues(database, &av.View{ID: "view"}, table, nil, renderContext)
		for _, row := range table.Rows {
			if got := row.GetValue(key.ID).Template.Content; got != "fallback" {
				t.Fatalf("unexpected fallback %q", got)
			}
		}
	}
	render()
	render()
	if confirmations != 1 {
		t.Fatalf("row and group duplicates prompted %d times", confirmations)
	}
	database.ID = "database-two"
	render()
	if confirmations != 2 {
		t.Fatalf("another database reused the first scope: %d", confirmations)
	}
	key.Template = `.action{$r := httpGet "https://example.com/data" (dict "headers" (dict "Authorization" "new-secret"))}.action{if $r.ok}.action{$r.body}.action{else}fallback.action{end}`
	render()
	if confirmations != 3 {
		t.Fatalf("new credentials reused a different request: %d", confirmations)
	}
}

func TestAttributeViewHTTPTemplateNeedsInteractionAndRedactsErrors(t *testing.T) {
	tpl, err := compileTemplateField(`.action{(httpGet "https://example.com/data").error}`)
	if err != nil {
		t.Fatal(err)
	}
	content, err := executeTemplateField(tpl, map[string]string{}, nil, map[*av.Value]*av.Value{})
	if err != nil || content != "interaction_required" {
		t.Fatalf("noninteractive result=%q, err=%v", content, err)
	}
	_, err = compileTemplateField(`.action{httpGet "https://example.com/secret-token" unexpected}`)
	if err == nil || strings.Contains(err.Error(), "secret-token") || strings.Contains(err.Error(), "unexpected") {
		t.Fatalf("HTTP parse error was not sanitized: %v", err)
	}
	execution := templatehttp.New(context.Background(), "render", nil)
	defer execution.Close()
	renderContext := NewAttributeViewRenderContext()
	renderContext.TemplateHTTP = execution
	blockKey := av.NewKey("block", "Primary", "", av.KeyTypeBlock)
	key := av.NewKey("template", "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{httpGet "https://example.com/secret-token" unexpected}`
	database := &av.AttributeView{ID: "database", KeyValues: []*av.KeyValues{{Key: blockKey}, {Key: key}}}
	fillAttributeViewTemplateValues(database, &av.View{ID: "view"}, newHTTPTemplateTestTable(blockKey, key), nil, renderContext)
	if err = renderContext.HTTPTemplateError(); err == nil || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("interactive render lost or leaked its template error: %v", err)
	}
}

func TestAttributeViewHTTPTemplateStopsAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	confirmations := 0
	execution := templatehttp.New(ctx, "render", func(context.Context, templatehttp.Request) bool {
		confirmations++
		cancel()
		return false
	})
	defer execution.Close()
	renderContext := NewAttributeViewRenderContext()
	renderContext.TemplateHTTP = execution
	blockKey := av.NewKey("block", "Primary", "", av.KeyTypeBlock)
	key := av.NewKey("template", "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{httpGet "https://example.com/data"}`
	database := &av.AttributeView{ID: "database", KeyValues: []*av.KeyValues{{Key: blockKey}, {Key: key}}}
	table := newHTTPTemplateTestTable(blockKey, key)
	fillAttributeViewTemplateValues(database, &av.View{ID: "view"}, table, nil, renderContext)
	if confirmations != 1 || execution.Err() == nil {
		t.Fatalf("canceled execution continued: prompts=%d err=%v", confirmations, execution.Err())
	}
}

func newHTTPTemplateTestTable(blockKey, templateKey *av.Key) *av.Table {
	table := newTemplateErrorTestTable(blockKey, []*av.Key{templateKey})
	for i, row := range table.Rows {
		row.ID = []string{"20261030000000-item00b", "20261030000000-item00a"}[i]
		for _, cell := range row.Cells {
			cell.Value.BlockID = row.ID
			if cell.Value.Block != nil {
				cell.Value.Block.ID = row.ID
			}
		}
	}
	return table
}

func TestAttributeViewHTTPTemplateNilContextKeepsOfflineBehavior(t *testing.T) {
	blockKey := av.NewKey("block", "Primary", "", av.KeyTypeBlock)
	key := av.NewKey("template", "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{(httpGet "https://example.com/data").error}`
	database := &av.AttributeView{ID: "database", KeyValues: []*av.KeyValues{{Key: blockKey}, {Key: key}}}
	table := newHTTPTemplateTestTable(blockKey, key)
	fillAttributeViewTemplateValues(database, &av.View{ID: "view"}, table, nil, nil)
	for _, row := range table.Rows {
		if got := row.GetValue(key.ID).Template.Content; got != "interaction_required" {
			t.Fatalf("nil context: %q", got)
		}
	}
}

func TestAttributeViewHTTPTemplateIdenticalFieldsKeepSeparateSources(t *testing.T) {
	scopes := []string{}
	execution := templatehttp.New(context.Background(), "render", func(_ context.Context, request templatehttp.Request) bool {
		scopes = append(scopes, request.Scope)
		return false
	})
	defer execution.Close()
	blockKey := av.NewKey("block", "Primary", "", av.KeyTypeBlock)
	first := av.NewKey("first", "First", "", av.KeyTypeTemplate)
	second := av.NewKey("second", "Second", "", av.KeyTypeTemplate)
	first.Template = `.action{(httpGet "https://example.com/data").error}`
	second.Template = first.Template
	database := &av.AttributeView{ID: "database", KeyValues: []*av.KeyValues{{Key: blockKey}, {Key: first}, {Key: second}}}
	table := newTemplateErrorTestTable(blockKey, []*av.Key{first, second})
	renderContext := NewAttributeViewRenderContext()
	renderContext.TemplateHTTP = execution
	renderContext.TemplateHTTPSourceScope = func(owner, avID, keyID, slot, content string) string {
		return owner + "\x00" + avID + "\x00" + keyID + "\x00" + slot
	}
	fillAttributeViewTemplateValues(database, &av.View{ID: "view"}, table, nil, renderContext)
	if len(scopes) != 2 || scopes[0] == scopes[1] {
		t.Fatalf("identical source text reused another field closure: %v", scopes)
	}
}
