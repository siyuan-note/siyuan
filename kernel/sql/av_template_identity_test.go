// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"bytes"
	"strings"
	"testing"
)

func TestRemapTemplateFieldIDsPreservesTextAndExecution(t *testing.T) {
	const oldID, newID = "20200101120000-abcdefg", "20261028120000-hijklmn"
	for _, test := range []struct {
		name, source, expected, output string
	}{
		{"utf8-prefix", `中文🙂 OLD: .action{index .id_mod "OLD"}`, `中文🙂 OLD: .action{index .id_mod "NEW"}`, "中文🙂 OLD: VALUE"},
		{"raw-quotes", ".action{index .id_mod `OLD`}", ".action{index .id_mod `NEW`}", "VALUE"},
		{"raw-field", `.action{index .id_mod_raw "OLD"}`, `.action{index .id_mod_raw "NEW"}`, "RAW"},
		{"root-index", `.action{index . "id_mod" "OLD"}`, `.action{index . "id_mod" "NEW"}`, "VALUE"},
		{"nested-index", `.action{index (index . "id_mod") "OLD"}`, `.action{index (index . "id_mod") "NEW"}`, "VALUE"},
		{"field-alias", `.action{$fields := .id_mod}.action{index $fields "OLD"}`, `.action{$fields := .id_mod}.action{index $fields "NEW"}`, "VALUE"},
		{"nested-alias", `.action{$fields := index . "id_mod_raw"}.action{index $fields "OLD"}`, `.action{$fields := index . "id_mod_raw"}.action{index $fields "NEW"}`, "RAW"},
		{"root-alias", `.action{$root := .}.action{index $root "id_mod" "OLD"}`, `.action{$root := .}.action{index $root "id_mod" "NEW"}`, "VALUE"},
		{"static-variable", `.action{$key := "OLD"}.action{$key}/.action{index .id_mod $key}`, `.action{$key := "OLD"}.action{$key}/.action{index .id_mod "NEW"}`, "OLD/VALUE"},
		{"static-alias-variable", `.action{$key := "OLD"}.action{$alias := $key}.action{index .id_mod ($alias)}/.action{$alias}`, `.action{$key := "OLD"}.action{$alias := $key}.action{index .id_mod ("NEW")}/.action{$alias}`, "VALUE/OLD"},
		{"with-field-map", `.action{with .id_mod}.action{index . "OLD"}.action{end}`, `.action{with .id_mod}.action{index . "NEW"}.action{end}`, "VALUE"},
		{"outer-root-in-with", `.action{with .rows}.action{index $.id_mod "OLD"}.action{end}`, `.action{with .rows}.action{index $.id_mod "NEW"}.action{end}`, "VALUE"},
		{"same-branch-values", `.action{$key := "OLD"}.action{if .flag}.action{$key = "OLD"}.action{else}.action{$key = "OLD"}.action{end}.action{index .id_mod $key}`, `.action{$key := "OLD"}.action{if .flag}.action{$key = "OLD"}.action{else}.action{$key = "OLD"}.action{end}.action{index .id_mod "NEW"}`, "VALUE"},
		{"scoped-branch-variable", `.action{$key := "OLD"}.action{if $key := "other"}.action{$key}.action{end}/.action{index .id_mod $key}`, `.action{$key := "OLD"}.action{if $key := "other"}.action{$key}.action{end}/.action{index .id_mod "NEW"}`, "other/VALUE"},
		{"unchanged-text-and-print", `OLD .action{printf "%s" "OLD"} .action{index . "OLD"}`, `OLD .action{printf "%s" "OLD"} .action{index . "OLD"}`, "OLD OLD PLAIN"},
		{"escaped-lookup-literal", `.action{index .id_mod "\u00320200101120000-abcdefg"}`, `.action{index .id_mod "NEW"}`, "VALUE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			expand := strings.NewReplacer("OLD", oldID, "NEW", newID)
			source := expand.Replace(test.source)
			actual := RemapTemplateFieldIDs(source, map[string]string{oldID: newID})
			if actual != expand.Replace(test.expected) {
				t.Fatalf("unexpected source rewrite:\n%s\nwant:\n%s", actual, expand.Replace(test.expected))
			}
			tpl, err := compileTemplateField(actual)
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err = tpl.Execute(&output, map[string]any{
				"id_mod": map[string]string{newID: "VALUE"}, "id_mod_raw": map[string]string{newID: "RAW"},
				oldID: "PLAIN", "flag": true, "rows": []int{1, 2},
			}); err != nil {
				t.Fatal(err)
			}
			if output.String() != expand.Replace(test.output) {
				t.Fatalf("rewritten lookup execution = %q, want %q", output.String(), expand.Replace(test.output))
			}
		})
	}
}

func TestRemapTemplateFieldIDsKeepsDynamicAndInvalidExpressions(t *testing.T) {
	for _, source := range []string{
		`.action{index .id_mod (print "old")}`,
		`.action{$key := "old"}.action{if .flag}.action{$key = "other"}.action{end}.action{index .id_mod $key}`,
		`.action{$key := "old"}.action{range .rows}.action{index $.id_mod $key}.action{$key = "other"}.action{end}`,
		`.action{$fields := .id_mod}.action{range .rows}.action{index $fields "old"}.action{$fields = .}.action{end}`,
		`.action{with .unknown}.action{index .id_mod "old"}.action{end}`,
		`.action{index .id_mod "old"`,
	} {
		if actual := RemapTemplateFieldIDs(source, map[string]string{"old": "new"}); actual != source {
			t.Fatalf("dynamic or invalid source was rewritten:\n%s\n%s", source, actual)
		}
	}
}

func TestRemapTemplateFieldIDsDoesNotMutateCompiledTree(t *testing.T) {
	source := `.action{index .id_mod "old"}`
	tpl, err := compileTemplateField(source)
	if err != nil {
		t.Fatal(err)
	}
	before := tpl.Tree.Root.String()
	if RemapTemplateFieldIDs(source, map[string]string{"old": "new"}) == source {
		t.Fatal("static lookup was not remapped")
	}
	if before != tpl.Tree.Root.String() {
		t.Fatal("existing compiled tree changed")
	}
	var output bytes.Buffer
	if err = tpl.Execute(&output, map[string]any{"id_mod": map[string]string{"old": "original"}}); err != nil || output.String() != "original" {
		t.Fatalf("existing template execution changed: %q, %v", output.String(), err)
	}
}

func TestRemapTemplateFieldIDsNamedRowTemplate(t *testing.T) {
	for _, test := range []struct{ name, source, output string }{
		{"dot", `.action{define "row"}.action{index .id_mod "old"}.action{end}.action{template "row" .}`, "VALUE"},
		{"root", `.action{define "row"}.action{index .id_mod_raw "old"}.action{end}.action{template "row" $}`, "RAW"},
		{"aliases-and-utf8", `中文🙂 old/.action{define "row"}原文 old/.action{$key := "old"}.action{$fields := .id_mod}.action{$key}/.action{index $fields $key}.action{end}.action{$row := .}.action{template "row" $row}`, "中文🙂 old/原文 old/old/VALUE"},
		{"nested-definitions", `.action{define "outer"}.action{$row := .}.action{template "inner" $row}.action{end}.action{define "inner"}.action{index .id_mod "old"}.action{end}.action{template "outer" .}`, "VALUE"},
		{"root-within-with", `.action{define "row"}.action{index .id_mod "old"}.action{end}.action{with .other}.action{template "row" $}.action{end}`, "VALUE"},
		{"recursive-known-context", `.action{define "row"}.action{index .id_mod "old"}.action{if .recurse}.action{template "row" $}.action{end}.action{end}.action{template "row" .}`, "VALUE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			remapped := RemapTemplateFieldIDs(test.source, map[string]string{"old": "new"})
			tpl, err := compileTemplateField(remapped)
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err = tpl.Execute(&output, map[string]any{
				"id_mod": map[string]string{"new": "VALUE"}, "id_mod_raw": map[string]string{"new": "RAW"}, "other": true,
			}); err != nil || output.String() != test.output {
				t.Fatalf("named row lookup lost remapped field: output=%q want=%q error=%v template=%s", output.String(), test.output, err, remapped)
			}
		})
	}
}

func TestRemapTemplateFieldIDsKeepsUnknownNamedContexts(t *testing.T) {
	for _, test := range []struct{ name, source, output string }{
		{"unknown-input", `.action{define "row"}old:.action{index .id_mod "old"}.action{end}.action{template "row" .other}`, "old:OTHER"},
		{"mixed-inputs", `.action{define "row"}.action{index .id_mod "old"}.action{end}.action{template "row" .}/.action{template "row" .other}`, "ROOT/OTHER"},
		{"mixed-through-nested-call", `.action{define "outer"}.action{template "inner" .}.action{end}.action{define "inner"}.action{index .id_mod "old"}.action{end}.action{template "outer" .}/.action{template "inner" .other}`, "ROOT/OTHER"},
		{"unused-definition", `.action{define "row"}.action{index .id_mod "old"}.action{end}old`, "old"},
	} {
		t.Run(test.name, func(t *testing.T) {
			actual := RemapTemplateFieldIDs(test.source, map[string]string{"old": "new"})
			if actual != test.source {
				t.Fatalf("unknown or mixed named context was rewritten: %s", actual)
			}
			tpl, err := compileTemplateField(actual)
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err = tpl.Execute(&output, map[string]any{
				"id_mod": map[string]string{"old": "ROOT", "new": "WRONG"},
				"other":  map[string]any{"id_mod": map[string]string{"old": "OTHER", "new": "WRONG"}},
			}); err != nil || output.String() != test.output {
				t.Fatalf("conservative named execution changed: %q, %v", output.String(), err)
			}
		})
	}
}

func TestRemapTemplateFieldIDsBranchBindingsRemainLexical(t *testing.T) {
	for _, source := range []string{
		`.action{$key := "other"}.action{if .flag}.action{$key := "old"}.action{else}.action{$key := "old"}.action{end}.action{index .id_mod $key}`,
		`.action{$key := "other"}.action{range .rows}.action{$key := "old"}.action{else}.action{$key := "old"}.action{end}.action{index .id_mod $key}`,
		`.action{$key := "other"}.action{if .flag}.action{$key := "local"}.action{$key = "old"}.action{else}.action{$key := "local"}.action{$key = "old"}.action{end}.action{index .id_mod $key}`,
		`.action{$key := "other"}.action{range .rows}.action{$key := "local"}.action{$key = "old"}.action{else}.action{$key := "local"}.action{$key = "old"}.action{end}.action{index .id_mod $key}`,
		`.action{define "row"}.action{index .id_mod "old"}.action{end}.action{$row := .other}.action{if .flag}.action{$row := .}.action{else}.action{$row := .}.action{end}.action{template "row" $row}`,
	} {
		actual := RemapTemplateFieldIDs(source, map[string]string{"old": "new"})
		if actual != source {
			t.Fatalf("local declaration changed an outer binding: %s", actual)
		}
		for _, flag := range []bool{false, true} {
			for _, rows := range [][]int{nil, {1, 2}} {
				tpl, err := compileTemplateField(actual)
				if err != nil {
					t.Fatal(err)
				}
				var output bytes.Buffer
				err = tpl.Execute(&output, map[string]any{
					"id_mod": map[string]string{"other": "ORIGINAL", "old": "STALE", "new": "WRONG"},
					"other":  map[string]any{"id_mod": map[string]string{"old": "ORIGINAL", "new": "WRONG"}},
					"flag":   flag, "rows": rows,
				})
				if err != nil || output.String() != "ORIGINAL" {
					t.Fatalf("lexical scope changed: output=%q err=%v flag=%v rows=%d", output.String(), err, flag, len(rows))
				}
			}
		}
	}
}

func TestRemapTemplateFieldIDsOuterAssignmentSurvivesLocalShadow(t *testing.T) {
	for _, source := range []string{
		`.action{$key := "other"}.action{if .flag}.action{$key = "old"}.action{$key := "other"}.action{else}.action{$key = "old"}.action{$key := "other"}.action{end}.action{index .id_mod $key}`,
		`.action{define "row"}.action{index .id_mod "old"}.action{end}.action{$row := .other}.action{if .flag}.action{$row = .}.action{$row := .other}.action{else}.action{$row = .}.action{$row := .other}.action{end}.action{template "row" $row}`,
	} {
		actual := RemapTemplateFieldIDs(source, map[string]string{"old": "new"})
		for _, flag := range []bool{false, true} {
			tpl, err := compileTemplateField(actual)
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			err = tpl.Execute(&output, map[string]any{
				"id_mod": map[string]string{"new": "VALUE", "other": "WRONG"},
				"other":  map[string]any{"id_mod": map[string]string{"old": "WRONG"}}, "flag": flag,
			})
			if err != nil || output.String() != "VALUE" {
				t.Fatalf("outer assignment before shadow was lost: %q, %v, %s", output.String(), err, actual)
			}
		}
	}
}

func TestRemapTemplateFieldIDsMixedRootRecursion(t *testing.T) {
	source := `.action{index .id_mod "old"}.action{if .other}.action{template "" .other}.action{end}`
	actual := RemapTemplateFieldIDs(source, map[string]string{"old": "new"})
	if actual != source {
		t.Fatal("entry template bypassed mixed-context checks")
	}
	tpl, err := compileTemplateField(actual)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	err = tpl.Execute(&output, map[string]any{
		"id_mod": map[string]string{"old": "ROOT", "new": "NEWROOT"},
		"other":  map[string]any{"id_mod": map[string]string{"old": "OTHER", "new": "WRONG"}},
	})
	if err != nil || output.String() != "ROOTOTHER" {
		t.Fatalf("entry recursion changed execution: %q, %v", output.String(), err)
	}
}
