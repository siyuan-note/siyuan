// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"context"
	"testing"
	"text/template"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func TestTemplateInputSignatureTracksRootDependencies(t *testing.T) {
	for _, test := range []struct {
		name, source string
		unrelated    bool
	}{
		{"field", `{{.Price}}`, true},
		{"branch and variable", `{{$p := .Price}}{{if $p}}{{$p}}{{else}}{{.Price}}{{end}}`, true},
		{"raw", `{{.Price_raw.Number.Content}}`, true},
		{"by ID", `{{.id_mod.price}}`, true},
		{"index ID", `{{index .id_mod "price"}}`, true},
		{"index root", `{{index . "Price"}}`, true},
		{"range", `{{range .Rows}}{{.Price}}{{end}}`, true},
		{"with", `{{with .Row}}{{.Price}}{{else}}{{.Price}}{{end}}`, true},
		{"root in nested scope", `{{with .Row}}{{$.Price}}{{end}}`, true},
		{"dynamic root", `{{$root := .}}{{index $root "Price"}}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			tpl := template.Must(template.New("").Parse(test.source))
			data := map[string]any{"Price": "one", "Other": "one", "Price_raw": map[string]any{"Number": map[string]any{"Content": "one"}},
				"id_mod": map[string]any{"price": "one", "other": "one"}, "Rows": []any{map[string]any{"Price": "one"}}, "Row": map[string]any{"Price": "one"}}
			before, ok := templateInputSignature(tpl, data)
			if !ok {
				t.Fatal("uncacheable input")
			}
			data["Other"] = "two"
			data["id_mod"].(map[string]any)["other"] = "two"
			after, _ := templateInputSignature(tpl, data)
			if (before == after) != test.unrelated {
				t.Fatal("unrelated dependency was incorrectly classified")
			}
			data["Price"] = "two"
			data["Price_raw"].(map[string]any)["Number"].(map[string]any)["Content"] = "two"
			data["id_mod"].(map[string]any)["price"] = "two"
			data["Rows"] = []any{map[string]any{"Price": "two"}}
			data["Row"] = map[string]any{"Price": "two"}
			changed, _ := templateInputSignature(tpl, data)
			if changed == after {
				t.Fatal("related dependency was omitted")
			}
		})
	}
}

func TestAttributeViewAutomaticTemplateRefreshUsesChangedInputs(t *testing.T) {
	templatehttp.ClearTemplateResults()
	t.Cleanup(templatehttp.ClearTemplateResults)
	primary := av.NewKey("primary", "Primary", "", av.KeyTypeBlock)
	price := av.NewKey("price", "Price", "", av.KeyTypeText)
	other := av.NewKey("other", "Other", "", av.KeyTypeText)
	computed := av.NewKey("computed", "Computed", "", av.KeyTypeTemplate)
	computed.Template = `.action{$price := .Price}.action{if $price}.action{$price}.action{end}:.action{uuidv4}`
	rows := []string{"20261030000000-item00b", "20261030000000-item00a"}
	data := &av.AttributeView{ID: "automatic-template-test", KeyValues: []*av.KeyValues{
		{Key: primary}, {Key: price}, {Key: other}, {Key: computed},
	}}
	for _, row := range rows {
		data.KeyValues[0].Values = append(data.KeyValues[0].Values, newTemplateErrorTestBlockValue(primary.ID, row, "Primary"))
		for _, keyValues := range data.KeyValues[1:3] {
			keyValues.Values = append(keyValues.Values, &av.Value{KeyID: keyValues.Key.ID, BlockID: row,
				Type: av.KeyTypeText, Text: &av.ValueText{Content: "one"}})
		}
	}
	render := func(automatic bool) []string {
		t.Helper()
		execution := templatehttp.New(context.Background(), "database", nil)
		defer execution.Close()
		execution.SetAutomaticRefresh(automatic)
		ctx := NewAttributeViewRenderContext()
		ctx.TemplateHTTP = execution
		table := newHTTPTemplateTestTable(primary, computed)
		for i, row := range table.Rows {
			row.ID = rows[i]
		}
		fillAttributeViewTemplateValues(data, &av.View{ID: "view"}, table, nil, ctx)
		if ctx.HasTemplateErrors() || execution.Err() != nil {
			t.Fatal("template failed", ctx.templateErrors, execution.Err())
		}
		execution.CommitTemplateResults()
		return []string{table.Rows[0].GetValue(computed.ID).Template.Content, table.Rows[1].GetValue(computed.ID).Template.Content}
	}
	first := render(false)
	data.KeyValues[2].Values[0].Text.Content = "unrelated"
	if got := render(true); got[0] != first[0] || got[1] != first[1] {
		t.Fatal("unrelated edit recalculated rows", first, got)
	}
	data.KeyValues[0].Values[0].Block.ID = "20261103000000-bound01"
	if got := render(true); got[0] != first[0] {
		t.Fatal("unrelated primary binding recalculated template")
	}
	data.KeyValues[1].Values[0].Text.Content = "related"
	changed := render(true)
	if changed[0] == first[0] || changed[1] != first[1] {
		t.Fatal("related edit did not isolate the affected row", first, changed)
	}
	rows[1] = "20261103000000-newrow1"
	for _, keyValues := range data.KeyValues[:3] {
		keyValues.Values[1].BlockID = rows[1]
	}
	added := render(true)
	if added[0] != changed[0] || added[1] == changed[1] {
		t.Fatal("new row recalculated existing row or reused another row")
	}
	manual := render(false)
	if manual[0] == added[0] || manual[1] == added[1] {
		t.Fatal("manual refresh failed to recalculate")
	}
	computed.Template += ":changed"
	if got := render(true); got[0] == manual[0] {
		t.Fatal("changed template reused output")
	}
	computed.Template = `.action{.id}:.action{uuidv4}`
	beforeBinding := render(false)
	data.KeyValues[0].Values[0].Block.ID = "20261103000000-bound02"
	bound := render(true)
	if bound[0] == beforeBinding[0] || bound[1] != beforeBinding[1] {
		t.Fatal("primary-dependent binding did not isolate recalculation")
	}
}

func TestTemplateInputSignatureDoesNotCacheExternalReads(t *testing.T) {
	for _, source := range []string{`.action{getBlock "block"}`, `.action{querySQL "select * from blocks"}`,
		`.action{statBlock "block"}`, `.action{getHPathByID "block"}`} {
		tpl, err := compileTemplateField(source)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := templateInputSignature(tpl, map[string]any{}); ok {
			t.Fatal("external read cached", source)
		}
	}
}

func TestTemplateInputSignaturePreservesInputTypes(t *testing.T) {
	for _, source := range []string{`{{kindOf .Value}}`, `{{kindOf (index .id_mod "value")}}`, `{{printf "%v" .}}`} {
		tpl := template.Must(template.New("").Funcs(template.FuncMap{"kindOf": func(any) string { return "" }}).Parse(source))
		date := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
		data := map[string]any{"Value": date, "id_mod": map[string]any{"value": date}}
		before, _ := templateInputSignature(tpl, data)
		data["Value"] = date.Format(time.RFC3339)
		data["id_mod"].(map[string]any)["value"] = date.Format(time.RFC3339)
		after, _ := templateInputSignature(tpl, data)
		if before == after {
			t.Fatal("same JSON from different field types reused", source)
		}
	}
}

func TestTemplateResolutionIncludesBranchDependencies(t *testing.T) {
	first := av.NewKey("first", "First", "", av.KeyTypeTemplate)
	first.Template = "first"
	second := av.NewKey("second", "Second", "", av.KeyTypeTemplate)
	for _, content := range []string{`.action{if .First}.action{.First}.action{end}`,
		`.action{with .First}.action{.}.action{end}`, `.action{range .First}.action{.}.action{end}`,
		`.action{if true}.action{$.First}.action{end}`,
		`.action{define "show"}.action{.First}.action{end}.action{template "show" .}`} {
		second.Template = content
		data := &av.AttributeView{KeyValues: []*av.KeyValues{{Key: second}, {Key: first}}}
		keys, resolved := GetTemplateKeysByResolutionOrder(data)
		if !resolved || len(keys) != 2 || keys[0].ID != first.ID {
			t.Fatal("branch dependency evaluated out of order", content, keys)
		}
	}
}
