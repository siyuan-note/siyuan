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
