// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentTitleMentionSources(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	testDocumentTitleMentionSources(t, prepareDocumentTitleFeatureBox(t))
}

func testDocumentTitleMentionSources(t *testing.T, boxID string) string {
	t.Helper()
	previousSearch := Conf.Search.Load()
	Conf.Search.Store(conf.NewSearch())
	defer Conf.Search.Store(previousSearch)
	settings := Conf.Search.Load()
	settings.BacklinkMentionDoc, settings.BacklinkMentionName = true, false
	settings.BacklinkMentionAlias, settings.BacklinkMentionAnchor = false, false
	const needle = "MentionNeedle"
	const bodyMarker = "BODY_MUST_NOT_APPEAR_IN_TITLE_PREVIEW"
	var trees []*parse.Tree
	source := func(title string) *parse.Tree {
		tree := newHPathTestDoc(t, boxID, "/", title, 1)
		for tree.Root.FirstChild != nil {
			tree.Root.FirstChild.Unlink()
		}
		body := treenode.NewParagraph(ast.NewNodeID())
		body.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(bodyMarker)})
		tree.Root.AppendChild(body)
		trees = append(trees, tree)
		return tree
	}
	setRichTitle := func(tree *parse.Tree, nodes ...*ast.Node) {
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		for _, node := range nodes {
			paragraph.AppendChild(node)
		}
		if err := treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
			t.Fatal(err)
		}
	}
	target := source(needle)
	target.Root.FirstChild.FirstChild.Tokens = []byte(needle)
	plain := source("Prefix <&> " + needle + " notes")
	named := source("Named document")
	named.Root.SetIALAttr("name", strings.ToLower(needle))
	aliased := source("Aliased document")
	aliased.Root.SetIALAttr("alias", "another,"+needle)
	literal := source("**" + needle + "**")
	rich := source("Rich document")
	setRichTitle(rich, &ast.Node{Type: ast.NodeText, Tokens: []byte(needle + " ")},
		&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "other"})
	strong := source("Strong document")
	setRichTitle(strong, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong em", TextMarkTextContent: needle})
	linked := source("Linked document")
	setRichTitle(linked, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: needle,
		TextMarkAHref: "https://example.com"})
	code := source("Code document")
	setRichTitle(code, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "code", TextMarkTextContent: needle})
	math := source("Math document")
	setRichTitle(math, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-math", TextMarkInlineMathContent: needle})
	codeNamed := source("Code named document")
	setRichTitle(codeNamed, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "code", TextMarkTextContent: "code-only"})
	codeNamed.Root.SetIALAttr("name", needle)
	memoOnly := source("Memo only document")
	memoOnly.Root.SetIALAttr("memo", needle)
	referenced := source("Referenced document")
	setRichTitle(referenced, &ast.Node{Type: ast.NodeText, Tokens: []byte(needle + " ")},
		&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: target.ID,
			TextMarkBlockRefSubtype: "s", TextMarkTextContent: needle})
	anchorOnly := source("Anchor only document")
	setRichTitle(anchorOnly, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: plain.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: needle})
	body := source("Body document")
	body.Root.FirstChild.FirstChild.Unlink()
	body.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong em", TextMarkTextContent: needle})

	originals := map[string][]byte{}
	for _, tree := range trees {
		saveDocumentTitleFeatureTree(t, tree)
		p := filepath.Join(util.DataDir, boxID, tree.Path)
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		originals[p] = data
	}
	queryBox := ""
	if IsEncryptedBox(boxID) {
		queryBox = boxID
	}
	searchMentions := func(excluded *hashset.Set) []*Block {
		excluded.Add(referenced.ID)
		_, blocks := searchBackmentionInBox([]string{needle}, "", excluded, target.ID, 12, queryBox)
		return blocks
	}
	blocks := searchMentions(hashset.New())
	bodyFound := false
	for _, block := range blocks {
		bodyFound = bodyFound || block.ID == body.Root.FirstChild.ID
	}
	if !bodyFound {
		t.Fatal("existing mention rules must continue to include strong/emphasized body text")
	}
	want := []string{plain.ID, named.ID, aliased.ID, literal.ID, rich.ID, strong.ID, linked.ID, codeNamed.ID, body.Root.FirstChild.ID}
	sort.Sort(sort.Reverse(sort.StringSlice(want)))
	ids := func(blocks []*Block) []string {
		ret := []string{}
		for _, block := range blocks {
			ret = append(ret, block.ID)
		}
		return ret
	}
	if got := ids(blocks); !reflect.DeepEqual(got, want) {
		t.Fatalf("document title/name/alias mentions = %v, want %v", got, want)
	}
	for _, limit := range []int{1, 2, 4} {
		settings.Limit = limit
		if got := ids(searchMentions(hashset.New())); !reflect.DeepEqual(got, want[:limit]) {
			t.Fatalf("filtered document mention pagination %d = %v, want %v", limit, got, want[:limit])
		}
	}
	settings.Limit = 64
	if got := ids(searchMentions(hashset.New(plain.ID))); len(got) != len(want)-1 || slices.Contains(got, plain.ID) {
		t.Fatal("explicit backlink source exclusion changed", got)
	}
	for _, field := range []string{"name", "alias", "case"} {
		settings.Name, settings.Alias, settings.CaseSensitive = field != "name", field != "alias", field == "case"
		got := ids(searchMentions(hashset.New()))
		filtered := []string{}
		for _, id := range want {
			if field == "name" && (id == named.ID || id == codeNamed.ID) || field == "alias" && id == aliased.ID || field == "case" && id == named.ID {
				continue
			}
			filtered = append(filtered, id)
		}
		if !reflect.DeepEqual(got, filtered) {
			t.Fatalf("document mention ignored %s search setting: %v, want %v", field, got, filtered)
		}
	}
	settings.Name, settings.Alias, settings.CaseSensitive = true, true, false
	_, filtered := searchBackmentionInBox([]string{needle}, "Prefix", hashset.New(), target.ID, 12, queryBox)
	if got := ids(filtered); !reflect.DeepEqual(got, []string{plain.ID}) {
		t.Fatal("document mention keyword filtering changed", got)
	}
	_, _, mentions, _, count := GetBacklink2InBox(target.ID, "", "", 0, 0, false, queryBox)
	if len(mentions) != len(want) || count != len(want) {
		t.Fatalf("document mention groups/count = %d/%d, want %d", len(mentions), count, len(want))
	}
	for _, tree := range []*parse.Tree{plain, named, aliased, literal, rich, strong, linked, codeNamed} {
		previews, _ := GetBackmentionDocInBox(target.ID, tree.ID, "", false, true, queryBox)
		if len(previews) != 1 || previews[0].ID != tree.ID || previews[0].Type != ast.NodeDocument.String() ||
			!strings.Contains(previews[0].DOM, `data-document-title="true"`) || strings.Contains(previews[0].DOM, bodyMarker) {
			t.Fatalf("document mention did not render only its title: %s, %+v", tree.ID, previews)
		}
	}
	if queryBox != "" {
		_, global := searchBackmention([]string{needle}, "", hashset.New(), target.ID, 12)
		if len(global) != 0 {
			t.Fatal("encrypted document mentions leaked into global search")
		}
	}
	for p, original := range originals {
		got, err := os.ReadFile(p)
		if err != nil || !bytes.Equal(got, original) {
			t.Fatal("mention search changed document source", p, err)
		}
	}
	plain.Root.SetIALAttr("title", "Renamed document")
	saveDocumentTitleFeatureTree(t, plain)
	if got := ids(searchMentions(hashset.New())); len(got) != len(want)-1 || slices.Contains(got, plain.ID) {
		t.Fatal("document title rename retained an obsolete mention", got)
	}
	return target.ID
}
