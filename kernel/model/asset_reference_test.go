// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	stdhtml "html"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestRewritePortableAssetReference(t *testing.T) {
	got := rewriteAssetReference("assets/image.png?box=20260812000000-source0&style=thumb#preview",
		assetReferenceRewriteOptions{rewriteUnmapped: true})
	want := "assets/image.png?style=thumb#preview"
	if got != want {
		t.Fatalf("rewrite portable asset reference = %q, want %q", got, want)
	}
}

func TestRewriteTreeAssetReferences(t *testing.T) {
	const targetBoxID = "20260812000001-target0"
	tree := treenode.NewTree(targetBoxID, "/20260812000002-doc0000.sy", "/Document", "Document")
	tree.Root.SetIALAttr("title-img", `background-image: url("assets/title.png?box=20260812000000-source0&style=cover")`)

	paragraph := treenode.NewParagraph("20260812000003-block00")
	paragraph.SetIALAttr("custom-data-assets", "assets/custom.png?box=20260812000000-source0")
	linkDest := &ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/image.png?box=20260812000000-source0")}
	linkTextMark := &ast.Node{
		Type:                ast.NodeTextMark,
		TextMarkType:        "a",
		TextMarkAHref:       "assets/link.pdf?page=2&box=20260812000000-source0",
		TextMarkTextContent: "Link",
	}
	annotationTextMark := &ast.Node{
		Type:                        ast.NodeTextMark,
		TextMarkType:                "file-annotation-ref",
		TextMarkFileAnnotationRefID: "assets/link.pdf/20260812000004-annotat?box=20260812000000-source0",
		TextMarkTextContent:         "Annotation",
	}
	paragraph.AppendChild(linkDest)
	paragraph.AppendChild(linkTextMark)
	paragraph.AppendChild(annotationTextMark)
	tree.Root.AppendChild(paragraph)

	htmlNodes := []*ast.Node{
		{Type: ast.NodeHTMLBlock, Tokens: []byte(`<div data-src="assets/component.html?box=20260812000000-source0&mode=block"></div>`)},
		{Type: ast.NodeInlineHTML, Tokens: []byte(`<span data-src="assets/component.html?box=20260812000000-source0&mode=inline"></span>`)},
		{Type: ast.NodeIFrame, Tokens: []byte(`<iframe src="assets/component.html?box=20260812000000-source0&mode=iframe"></iframe>`)},
		{Type: ast.NodeWidget, Tokens: []byte(`<iframe src="assets/component.html?box=20260812000000-source0&mode=widget"></iframe>`)},
		{Type: ast.NodeAudio, Tokens: []byte(`<audio src="assets/media.mp3?box=20260812000000-source0"></audio>`)},
		{Type: ast.NodeVideo, Tokens: []byte(`<video src="assets/media.mp4?box=20260812000000-source0"></video>`)},
	}
	for _, node := range htmlNodes {
		tree.Root.AppendChild(node)
	}

	options := assetReferenceRewriteOptions{
		pathMap: map[string]string{
			"assets/title.png":      "assets/encrypted-title.png",
			"assets/custom.png":     "assets/encrypted-custom.png",
			"assets/image.png":      "assets/encrypted-image.png",
			"assets/link.pdf":       "assets/encrypted-link.pdf",
			"assets/component.html": "assets/encrypted-component.html",
			"assets/media.mp3":      "assets/encrypted-media.mp3",
			"assets/media.mp4":      "assets/encrypted-media.mp4",
		},
		targetBoxID:   targetBoxID,
		bindTargetBox: true,
	}
	rewriteTreeAssetReferences(tree, options)

	assertAssetReferenceContains(t, tree.Root.IALAttr("title-img"),
		"assets/encrypted-title.png?box="+targetBoxID+"&style=cover")
	if got, want := paragraph.IALAttr("custom-data-assets"), "assets/encrypted-custom.png?box="+targetBoxID; got != want {
		t.Fatalf("custom asset reference = %q, want %q", got, want)
	}
	if got, want := linkDest.TokensStr(), "assets/encrypted-image.png?box="+targetBoxID; got != want {
		t.Fatalf("link destination = %q, want %q", got, want)
	}
	if got, want := linkTextMark.TextMarkAHref, "assets/encrypted-link.pdf?box="+targetBoxID+"&page=2"; got != want {
		t.Fatalf("text mark link = %q, want %q", got, want)
	}
	if got, want := annotationTextMark.TextMarkFileAnnotationRefID,
		"assets/encrypted-link.pdf/20260812000004-annotat?box="+targetBoxID; got != want {
		t.Fatalf("PDF annotation reference = %q, want %q", got, want)
	}

	htmlWants := []string{
		"assets/encrypted-component.html?box=" + targetBoxID + "&mode=block",
		"assets/encrypted-component.html?box=" + targetBoxID + "&mode=inline",
		"assets/encrypted-component.html?box=" + targetBoxID + "&mode=iframe",
		"assets/encrypted-component.html?box=" + targetBoxID + "&mode=widget",
		"assets/encrypted-media.mp3?box=" + targetBoxID,
		"assets/encrypted-media.mp4?box=" + targetBoxID,
	}
	for i, node := range htmlNodes {
		assertAssetReferenceContains(t, string(node.Tokens), htmlWants[i])
	}
}

func TestRewriteAttributeViewAssetReferences(t *testing.T) {
	const (
		sourceBoxID = "20260812000000-source0"
		targetBoxID = "20260812000001-target0"
	)
	richText := &av.ValueText{
		Content: "stale rich projection",
		Rich: &av.ValueTextRich{
			Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
			Content: strings.Join([]string{
				"[Markdown](assets/rich.png)",
				`<span data-type="a" data-href="assets/rich-text-mark.png">Text mark</span>`,
				`<<assets/native-20200101000001-bcdefgh.pdf/20200101000002-cdefghi "PDF shorthand">>`,
				`<span data-type="file-annotation-ref" data-id="assets/span-20200101000003-defghij.pdf/20200101000004-efghijk">PDF text mark</span>`,
				"[Network](https://example.com/remote.png)",
			}, "\n\n"),
		},
	}
	relationRichText := &av.ValueText{Content: "stale relation projection", Rich: &av.ValueTextRich{
		Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
		Content: "[Relation rich](assets/relation-rich.png)",
	}}
	rollupRichText := &av.ValueText{Content: "stale rollup projection", Rich: &av.ValueTextRich{
		Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
		Content: "[Rollup rich](assets/rollup-rich.png)",
	}}
	templateRichText := &av.ValueText{Content: "stale template projection", Rich: &av.ValueTextRich{
		Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
		Content: "[Template rich](assets/template-rich.png)",
	}}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{Values: []*av.Value{
		{URL: &av.ValueURL{Content: "assets/url.png?box=" + sourceBoxID}},
		{MAsset: []*av.ValueAsset{{Content: "assets/file.pdf?page=3&box=" + sourceBoxID}}},
		{Text: richText},
		{Relation: &av.ValueRelation{Contents: []*av.Value{{
			URL:  &av.ValueURL{Content: "assets/relation.png?box=" + sourceBoxID},
			Text: relationRichText,
		}}}},
		{Rollup: &av.ValueRollup{Contents: []*av.Value{{
			MAsset: []*av.ValueAsset{{Content: "assets/rollup.png?box=" + sourceBoxID}},
			Text:   rollupRichText,
		}}}},
	}}}, NewItemTemplates: []*av.NewItemTemplate{{
		FieldValues: map[string]*av.NewItemFieldValue{
			"text": {Value: &av.Value{Text: templateRichText}},
		},
	}}}
	options := assetReferenceRewriteOptions{
		pathMap: map[string]string{
			"assets/url.png":                           "assets/encrypted-url.png",
			"assets/file.pdf":                          "assets/encrypted-file.pdf",
			"assets/rich.png":                          "assets/encrypted-rich.png",
			"assets/rich-text-mark.png":                "assets/encrypted-rich-text-mark.png",
			"assets/native-20200101000001-bcdefgh.pdf": "assets/encrypted-native-20200101000011-lmnopqr.pdf",
			"assets/span-20200101000003-defghij.pdf":   "assets/encrypted-span-20200101000013-nopqrst.pdf",
			"assets/relation.png":                      "assets/encrypted-relation.png",
			"assets/relation-rich.png":                 "assets/encrypted-relation-rich.png",
			"assets/rollup.png":                        "assets/encrypted-rollup.png",
			"assets/rollup-rich.png":                   "assets/encrypted-rollup-rich.png",
			"assets/template-rich.png":                 "assets/encrypted-template-rich.png",
		},
		targetBoxID:   targetBoxID,
		bindTargetBox: true,
	}
	if !rewriteAttributeViewAssetReferences(attrView, options) {
		t.Fatal("attribute view asset references were not updated")
	}

	values := attrView.KeyValues[0].Values
	assertEqualAssetReference(t, values[0].URL.Content, "assets/encrypted-url.png?box="+targetBoxID)
	assertEqualAssetReference(t, values[1].MAsset[0].Content, "assets/encrypted-file.pdf?box="+targetBoxID+"&page=3")
	assertEqualAssetReference(t, values[3].Relation.Contents[0].URL.Content,
		"assets/encrypted-relation.png?box="+targetBoxID)
	assertEqualAssetReference(t, values[4].Rollup.Contents[0].MAsset[0].Content,
		"assets/encrypted-rollup.png?box="+targetBoxID)

	wantRichAssets := []string{
		"assets/encrypted-rich.png?box=" + targetBoxID,
		"assets/encrypted-rich-text-mark.png?box=" + targetBoxID,
		"assets/encrypted-native-20200101000011-lmnopqr.pdf",
		"assets/encrypted-span-20200101000013-nopqrst.pdf",
	}
	assertAttributeViewRichAssets(t, richText, wantRichAssets)
	if got, want := richText.Content, "Markdown\nText mark\nPDF shorthand\nPDF text mark\nNetwork"; got != want {
		t.Fatalf("rich plain projection = %q, want %q", got, want)
	}
	assertAttributeViewRichAssets(t, relationRichText,
		[]string{"assets/encrypted-relation-rich.png?box=" + targetBoxID})
	assertAttributeViewRichAssets(t, rollupRichText,
		[]string{"assets/encrypted-rollup-rich.png?box=" + targetBoxID})
	assertAttributeViewRichAssets(t, templateRichText,
		[]string{"assets/encrypted-template-rich.png?box=" + targetBoxID})
	if got, want := relationRichText.Content, "Relation rich"; got != want {
		t.Fatalf("relation rich plain projection = %q, want %q", got, want)
	}
	if got, want := rollupRichText.Content, "Rollup rich"; got != want {
		t.Fatalf("rollup rich plain projection = %q, want %q", got, want)
	}
	if got, want := templateRichText.Content, "Template rich"; got != want {
		t.Fatalf("template rich plain projection = %q, want %q", got, want)
	}
}

func assertAttributeViewRichAssets(t *testing.T, text *av.ValueText, want []string) {
	t.Helper()
	tree, err := av.ParseValueTextRich(text.Rich)
	if nil != err {
		t.Fatalf("parse rewritten attribute view rich text: %v", err)
	}
	if got := getAssetsLinkDests(tree.Root, false); !reflect.DeepEqual(got, want) {
		t.Fatalf("rewritten attribute view rich assets: got %v, want %v", got, want)
	}
	normalized := text.Rich.Content
	if err = text.NormalizeRichContent(); nil != err {
		t.Fatalf("renormalize rewritten attribute view rich text: %v", err)
	}
	if text.Rich.Content != normalized {
		t.Fatalf("rewritten attribute view rich text is not normalized:\ngot  %q\nwant %q", text.Rich.Content, normalized)
	}
}

func assertAssetReferenceContains(t *testing.T, got, want string) {
	t.Helper()
	got = stdhtml.UnescapeString(got)
	if !strings.Contains(got, want) {
		t.Fatalf("asset reference %q does not contain %q", got, want)
	}
}

func assertEqualAssetReference(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("asset reference = %q, want %q", got, want)
	}
}
