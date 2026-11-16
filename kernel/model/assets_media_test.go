// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNativeMediaAssetReferences(t *testing.T) {
	for _, typ := range []ast.NodeType{ast.NodeAudio, ast.NodeVideo} {
		tag := "audio"
		if typ == ast.NodeVideo {
			tag = "video"
		}
		for _, test := range []struct {
			name, markup string
			want         []string
		}{
			{"src first", `<MEDIA src="assets/current" data-src="assets/stale"></MEDIA>`, []string{"assets/current"}},
			{"data-src first", `<MEDIA DATA-SRC='assets/stale' SRC = 'assets/current'></MEDIA>`, []string{"assets/current"}},
			{"identical paths", `<MEDIA src=assets/current data-src=assets/current></MEDIA>`, []string{"assets/current"}},
			{"remote src", `<MEDIA data-src="assets/stale" src="https://example.com/media"></MEDIA>`, []string{}},
			{"legacy data-src", `<MEDIA data-src="assets/legacy"></MEDIA>`, []string{"assets/legacy"}},
			{"empty src", `<MEDIA src="" data-src="assets/legacy"></MEDIA>`, []string{"assets/legacy"}},
			{"blank src", `<MEDIA src=" &#32; " data-src="assets/legacy"></MEDIA>`, []string{"assets/legacy"}},
			{"first duplicate src wins", `<MEDIA src="" src="assets/second" data-src="assets/legacy"></MEDIA>`, []string{"assets/second", "assets/legacy"}},
			{"multiple sources", `<MEDIA data-src="assets/legacy"><source src="assets/one"><source src="assets/two"></MEDIA>`, []string{"assets/legacy", "assets/one", "assets/two"}},
			{"children and poster", `<MEDIA src="assets/current" data-src="assets/stale" poster="assets/poster"><source src="assets/one"><source src="assets/two"><track src="assets/subtitles"><img src="assets/preview" data-src="assets/original"><span data-src="assets/custom"></span></MEDIA>`, []string{"assets/current", "assets/poster", "assets/one", "assets/two", "assets/subtitles", "assets/preview", "assets/original", "assets/custom"}},
			{"nested and sibling media", `<MEDIA src="assets/current" data-src="assets/stale"><MEDIA src="assets/nested" data-src="assets/nested-custom"></MEDIA></MEDIA><MEDIA src="assets/sibling" data-src="assets/sibling-custom"></MEDIA>`, []string{"assets/current", "assets/nested", "assets/nested-custom", "assets/sibling", "assets/sibling-custom"}},
			{"unexpected wrapper", `<div data-src="assets/wrapper"><MEDIA src="assets/current" data-src="assets/custom"></MEDIA></div>`, []string{"assets/wrapper", "assets/current", "assets/custom"}},
			{"leading comment", ` <!-- media --> <MEDIA data-src="assets/stale" src="assets/a&amp;b"/>`, []string{"assets/a&b"}},
		} {
			t.Run(tag+"/"+test.name, func(t *testing.T) {
				markup := strings.ReplaceAll(test.markup, "MEDIA", strings.ToUpper(tag))
				node := &ast.Node{Type: typ, Tokens: []byte(markup)}
				for _, expand := range []bool{false, true} {
					got := getAssetsLinkDestsWithOptions(node, false, nil, assetLinkScanOptions{expandAssetLists: expand}, normalizeAssetScanLinkDest)
					if !slices.Equal(got, test.want) {
						t.Fatalf("expand=%v: got %v, want %v", expand, got, test.want)
					}
				}
				if got := getAssetLinkDestsByNode(node, false); !slices.Equal(got, test.want) {
					t.Fatalf("per-node references: got %v, want %v", got, test.want)
				}
				if string(node.Tokens) != markup {
					t.Fatal("reference scanning changed stored media")
				}
			})
		}
	}
	for _, typ := range []ast.NodeType{ast.NodeHTMLBlock, ast.NodeInlineHTML, ast.NodeIFrame} {
		node := &ast.Node{Type: typ, Tokens: []byte(`<video src="assets/current" data-src="assets/custom"></video><img src="assets/preview" data-src="assets/original">`)}
		want := []string{"assets/current", "assets/custom", "assets/preview", "assets/original"}
		if got := getAssetsLinkDests(node, false); !slices.Equal(got, want) {
			t.Errorf("%v: got %v, want %v", typ, got, want)
		}
		if got := htmlAssetLinkDests(node.Tokens, false); !slices.Equal(got, want) {
			t.Errorf("generic HTML scan: got %v, want %v", got, want)
		}
	}
}

func TestNativeMediaMissingAndUnusedAssets(t *testing.T) {
	boxID, docPath := setupUnusedAssetWorkspace(t)
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	root := &ast.Node{Type: ast.NodeDocument, ID: "20260918000001-abcdefg", Spec: treenode.CurrentSpec}
	for i, node := range []*ast.Node{
		{Type: ast.NodeAudio, Tokens: []byte(`<audio data-src="assets/stale.mp3" src="assets/current.mp3"></audio>`)},
		{Type: ast.NodeVideo, Tokens: []byte(`<video src="assets/current.mp4" data-src="assets/stale.mp4" poster="assets/poster.png"><source src="assets/one.webm"><source src="assets/two.webm"><track src="assets/subtitles.vtt"><img data-src="assets/fallback.png"></video>`)},
		{Type: ast.NodeAudio, Tokens: []byte(`<audio data-src="assets/legacy.mp3"></audio>`)},
		{Type: ast.NodeVideo, Tokens: []byte(`<video src=" " data-src="assets/legacy.mp4"></video>`)},
		{Type: ast.NodeHTMLBlock, Tokens: []byte(`<video src="assets/current.mp4" data-src="assets/custom.mp4"></video><img src="assets/preview.png" data-src="assets/original.png"><img src="assets/stale.mp4">`)},
		{Type: ast.NodeWidget, KramdownIAL: [][]string{{"custom-data-assets", "assets/widget.png"}}},
	} {
		node.ID = fmt.Sprintf("202609180000%02d-abcdefg", i+2)
		root.AppendChild(node)
	}
	engine := util.NewLute()
	data := render.NewJSONRenderer(&parse.Tree{Root: root}, engine.RenderOptions, engine.ParseOptions).Render()
	if err := os.WriteFile(docPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	retained := []string{"current.mp3", "current.mp4", "poster.png", "one.webm", "two.webm", "subtitles.vtt", "fallback.png", "legacy.mp3", "legacy.mp4", "custom.mp4", "preview.png", "original.png", "stale.mp4", "widget.png"}
	for _, name := range append(slices.Clone(retained), "unused.png") {
		if err := os.WriteFile(filepath.Join(util.DataDir, "assets", name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if missing, err := MissingAssets(); err != nil || len(missing) != 0 {
		t.Fatalf("stale media attributes reported missing: %+v, %v", missing, err)
	}
	if unused, err := UnusedAssets(false); err != nil || len(unused) != 1 || unused[0].Item != "assets/unused.png" {
		t.Fatalf("referenced media resources considered unused: %+v, %v", unused, err)
	}
	for _, name := range retained {
		if err := os.Remove(filepath.Join(util.DataDir, "assets", name)); err != nil {
			t.Fatal(err)
		}
	}
	missing, err := MissingAssets()
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, item := range missing {
		got = append(got, strings.TrimPrefix(item.Item, "assets/"))
		if len(item.BlockIDs) == 0 {
			t.Errorf("missing block location for %s", item.Item)
		}
	}
	slices.Sort(got)
	slices.Sort(retained)
	if !slices.Equal(got, retained) {
		t.Fatalf("actual missing resources: got %v, want %v", got, retained)
	}
	if actual, err := os.ReadFile(docPath); err != nil || string(actual) != string(data) {
		t.Fatalf("asset scans modified stored document: %v", err)
	}
}

func TestCreateDocMediaLinks(t *testing.T) {
	for _, test := range []struct {
		ext, tag string
		typ      ast.NodeType
	}{{"mp3", "audio", ast.NodeAudio}, {"mp4", "video", ast.NodeVideo}} {
		t.Run(test.ext, func(t *testing.T) {
			const id = "20260918000001-abcdefg"
			dest := "assets/current." + test.ext
			dom := `<div data-type="NodeParagraph" data-node-id="20260918000002-abcdefg"><div contenteditable="true"><span data-type="a" data-href="` + dest + `">media</span></div></div>`
			tree, err := buildCreateDocTree("20260918000000-abcdefg", &createDocValidation{id: id, path: "/" + id + ".sy", hPath: "/media", title: "media"}, dom)
			if err != nil {
				t.Fatal(err)
			}
			node := tree.Root.FirstChild
			if node == nil || node.Type != test.typ {
				t.Fatalf("unexpected converted media: %+v", node)
			}
			for next := node.Next; next != nil; next = next.Next {
				if next.Type != ast.NodeKramdownBlockIAL {
					t.Fatalf("unexpected content after converted media: %v", next.Type)
				}
			}
			want := `<` + test.tag + ` controls="controls" src="` + dest + `"></` + test.tag + `>`
			if string(node.Tokens) != want {
				t.Fatalf("converted media: got %s, want %s", node.Tokens, want)
			}
			if got := getAssetsLinkDests(node, false); !slices.Equal(got, []string{dest}) {
				t.Fatalf("converted media references: %v", got)
			}
		})
	}
}
