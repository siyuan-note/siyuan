// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"slices"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestStaticTemplateKeyDependencies(t *testing.T) {
	text := av.NewKey("text", "Text", "", av.KeyTypeText)
	template := av.NewKey("template", "Template", "", av.KeyTypeTemplate)
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{Key: text}, {Key: template}}}
	for _, test := range []struct {
		content string
		known   bool
	}{
		{`.action{.Text}`, true}, {`.action{index . "Text"}`, true},
		{`.action{.Text_raw.Text.Content}`, true}, {`.action{.id_mod.text}`, true},
		{`.action{index .id_mod "text"}`, true}, {`.action{index .id_mod_raw "text"}`, true},
		{`.action{printf "%s" .Text}`, true},
		{`.action{if .Text}.action{.Text}.action{end}`, false},
		{`.action{range .}.action{.Text}.action{end}`, false},
		{`.action{with .}.action{.Text}.action{end}`, false},
		{`.action{$x := .}.action{index $x "Text"}`, false},
		{`.action{index . (print "Te" "xt")}`, false},
		{`.action{index .id_mod (print "text")}`, false},
		{`.action{index .id_mod.text "Text"}`, false},
		{`.action{index . "id_mod" "text"}`, false}, {`.action{index . "id_mod_raw"}`, false},
		{`.action{template "named" .}`, false}, {`.action{.id_mod}`, false}, {`.action{`, false},
	} {
		t.Run(test.content, func(t *testing.T) {
			template.Template = test.content
			dependencies, known := StaticTemplateKeyDependencies(attrView, template)
			if known != test.known {
				t.Fatalf("known=%t, want %t", known, test.known)
			}
			if known {
				var ids []string
				for _, key := range dependencies {
					ids = append(ids, key.ID)
				}
				if !slices.Equal(ids, []string{"text"}) {
					t.Fatalf("missing or extra dependency: %v", ids)
				}
			}
		})
	}
	if _, known := StaticTemplateKeyDependencies(attrView, nil); known {
		t.Fatal("nil template was treated as known")
	}
}

func TestReusableTemplateKeyRequiresClosedPureExpressions(t *testing.T) {
	text := av.NewKey("text", "Text", "", av.KeyTypeText)
	key := av.NewKey("template", "Template", "", av.KeyTypeTemplate)
	database := &av.AttributeView{KeyValues: []*av.KeyValues{{Key: text}, {Key: key}}}
	for _, test := range []struct {
		content string
		reuse   bool
	}{
		{`.action{.Text}`, true}, {`.action{index . "Text"}`, true},
		{`.action{.id_mod.text}`, true}, {`.action{index .id_mod "text"}`, true},
		{`.action{printf "%s %%" .Text}`, true}, {`.action{.Text | printf "%10s"}`, true},
		{`.action{print .Text " suffix"}`, true}, {`.action{println .Text}`, true},
		{`.action{printf "%p" .Text}`, false}, {`.action{printf "%[1]p" .Text}`, false},
		{`.action{printf .Text "value"}`, false}, {`.action{printf "%T" .Text}`, false},
		{`.action{now}`, false}, {`.action{queryBlocks "SELECT * FROM blocks"}`, false},
		{`.action{.Text_raw.Text.Content}`, false}, {`.action{.Text_created}`, false},
		{`.action{index .id_mod_raw "text"}`, false}, {`.action{.Unknown}`, false},
		{`.action{index . "Unknown"}`, false}, {`.action{.id_mod.text.Unknown}`, false},
		{`.action{if .Text}.action{.Text}.action{end}`, false}, {`.action{`, false},
	} {
		t.Run(test.content, func(t *testing.T) {
			key.Template = test.content
			if reusable := IsReusableTemplateKey(database, key); reusable != test.reuse {
				t.Fatalf("reusable=%t, want %t", reusable, test.reuse)
			}
		})
	}
}
