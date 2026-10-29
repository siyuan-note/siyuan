// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"errors"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestDocumentAddressingSourcePreservesOrdinaryTitles(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument, Spec: "2"}
	root.SetIALAttr("title", "A&#47;B")
	if err := CheckSpec(&parse.Tree{Root: root}); err != nil {
		t.Fatal("literal entity was decoded twice", err)
	}
	for _, source := range []string{
		`{"Spec":"2","Properties":{"title":"A／B A%2FB **literal** ` + "`code`" + `"}}`,
		`{"Spec":"2","Properties":{"title":"A&amp;#47;B"}}`,
		`{"Spec":"2","Properties":{"title":"","custom-sy-title-empty":"1"}}`,
		`{"Spec":"2","Properties":{"title":null}}`,
		`{"Spec":"2","Properties":{"title":"Legacy"},"Children":[{"Properties":{"title":"A/B"}}]}`,
		`{"Spec":"5","Properties":{"title":"Legacy"},"Children":[{"Type":"NodeMindmap"}]}`,
		`{"Spec":"4","Properties":{"title":"Legacy"},"Children":[{"Type":"NodeTable","Children":[{"Type":"NodeTableRow","Children":[{"Type":"NodeTableCell","TableCellRich":{"spec":1,"format":"kramdown","content":"A/B"}}]}]}]}`,
	} {
		if err := CheckSpecJSON([]byte(source)); err != nil {
			t.Fatalf("ordinary title or body format was rejected: %v", err)
		}
	}
}

func TestDocumentSourceVersionCannotBeShadowed(t *testing.T) {
	if err := CheckSpecJSON([]byte("null")); err == nil {
		t.Fatal("null is not a document source")
	}
	for _, source := range []string{
		`{"Spec":"999","Spec":"2","Properties":{"title":"Legacy"}}`,
		`{"spec":"999","Sp\u0065c":"2","Properties":{"title":"Legacy"}}`,
		`{"Spec":"999","Properties":{"title":{"text":"Future"}}}`,
		`{"Properties":{"title":{"text":"Future"}},"Spec":"999"}`,
	} {
		if err := CheckSpecJSON([]byte(source)); !errors.Is(err, ErrSpecTooNew) {
			t.Fatalf("unsupported source version was hidden: %v", err)
		}
	}
}

func TestDocumentTitleWriteSpec(t *testing.T) {
	for _, source := range []string{
		`{"Spec":"2","Properties":{"title":"A/B"}}`,
		`{"Spec":"5","Properties":{"title":"A\u002fB"}}`,
		`{"Properties":{"title":"A&#47;B"}}`,
		`{"Spec":"2","Properties":{"title":"A&#x2F;B"}}`,
		`{"Spec":"2","Properties":{"title":"A/B","title":"Ordinary"}}`,
		`{"Spec":"2","Properties":{"title":"A/B"},"Properties":{"title":"Ordinary"}}`,
		`{"Spec":"6","Spec":"2","Properties":{"title":"A/B"}}`,
	} {
		if err := CheckSpecJSON([]byte(source)); err != nil {
			t.Fatalf("existing low-spec source is no longer readable: %v", err)
		}
		if err := CheckDocumentTitleWriteSpecJSON([]byte(source)); !errors.Is(err, ErrDocumentTitleSpec) {
			t.Fatalf("raw write accepted an under-versioned title: %s, %v", source, err)
		}
	}
	for _, source := range []string{
		`{"Spec":"6","Properties":{"title":"A/B"}}`,
		`{"Spec":"6","Properties":{"title":"A&#47;B"}}`,
		`{"Spec":"2","Spec":"6","Properties":{"title":"A/B"}}`,
		`{"Spec":"2","Properties":{"title":"A%2FB A／B A&amp;#47;B"}}`,
		`{"Spec":"2","Properties":{"title":"Ordinary"},"Children":[{"Properties":{"title":"A/B"}}]}`,
	} {
		if err := CheckDocumentTitleWriteSpecJSON([]byte(source)); err != nil {
			t.Fatalf("compatible raw title was rejected: %s, %v", source, err)
		}
	}
}

func TestDocumentTitleSpecUpgrade(t *testing.T) {
	for _, test := range []struct {
		title string
		want  string
	}{
		{"A/B", DocumentTitleSpec}, {"A&#47;B", DocumentTitleSpec}, {"A&#x2F;B", DocumentTitleSpec},
		{"A&amp;#47;B", BaseSpec}, {"A%2FB", BaseSpec}, {"A／B", BaseSpec},
	} {
		root := &ast.Node{Type: ast.NodeDocument, Spec: BaseSpec, KramdownIAL: [][]string{{"title", test.title}}}
		UpgradeSpec(&parse.Tree{Root: root})
		if root.Spec != test.want || root.KramdownIAL[0][1] != test.title {
			t.Fatalf("title spec upgrade changed source semantics: %q, %q", root.Spec, root.KramdownIAL[0][1])
		}
	}
}
