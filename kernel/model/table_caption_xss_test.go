// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func renderTableForCaptionTest(t *testing.T, caption, colgroup string) (preview, blockDOM string) {
	t.Helper()
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte("| a | b |\n| --- | --- |\n| 1 | 2 |\n"), luteEngine.ParseOptions)
	table := tree.Root.FirstChild
	if nil == table || ast.NodeTable != table.Type {
		t.Fatalf("expected table node, got %v", table)
	}
	table.KramdownIAL = [][]string{{"id", table.ID}, {"updated", "20261031020001"}}
	if "" != caption {
		table.KramdownIAL = append(table.KramdownIAL, []string{"caption", caption})
	}
	if "" != colgroup {
		table.KramdownIAL = append(table.KramdownIAL, []string{"colgroup", colgroup})
	}
	return luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions),
		luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
}

func TestTableCaptionXSS(t *testing.T) {
	tests := []struct {
		name    string
		caption string
	}{
		{
			name:    "single encoded image",
			caption: `&lt;caption contenteditable=&quot;false&quot;&gt;&lt;img src=x onerror=window.xssFired=true&gt;&lt;/caption&gt;`,
		},
		{
			name:    "double encoded image",
			caption: `&amp;lt;caption contenteditable=&amp;quot;false&amp;quot;&amp;gt;&amp;lt;img src=x onerror=window.xssFired=true&amp;gt;&amp;lt;/caption&amp;gt;`,
		},
		{
			name:    "raw image",
			caption: `<caption contenteditable="false"><img src=x onerror=window.xssFired=true></caption>`,
		},
		{
			name:    "script",
			caption: `&lt;caption&gt;&lt;script&gt;window.xssFired=true&lt;/script&gt;&lt;/caption&gt;`,
		},
		{
			name:    "quote breakout",
			caption: `"><img src=x onerror=window.xssFired=true>`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			preview, blockDOM := renderTableForCaptionTest(t, test.caption, "")
			for label, html := range map[string]string{"preview": preview, "blockDOM": blockDOM} {
				if strings.Contains(html, "<img") || strings.Contains(html, "<script") ||
					strings.Contains(html, `onerror="`) {
					t.Fatalf("%s contains executable caption markup: %s", label, html)
				}
			}
		})
	}
}

func TestTableCaptionLegit(t *testing.T) {
	caption := `&amp;lt;caption contenteditable=&amp;quot;false&amp;quot; style=&amp;quot;caption-side: bottom;&amp;quot;&amp;gt;A &amp;amp;amp; B&amp;lt;/caption&amp;gt;`
	preview, blockDOM := renderTableForCaptionTest(t, caption, "")
	if !strings.Contains(preview, `<caption style="caption-side: bottom;">A &amp; B</caption>`) {
		t.Fatalf("preview lost legit caption: %s", preview)
	}
	if !strings.Contains(blockDOM, `<caption contenteditable="false" style="caption-side: bottom;">A &amp; B</caption>`) {
		t.Fatalf("block DOM lost legit caption: %s", blockDOM)
	}
}

func TestTableColgroupXSS(t *testing.T) {
	preview, blockDOM := renderTableForCaptionTest(t, "", `width: 100px;" ><img src=x onerror=window.colgroupFired=true>`)
	for label, html := range map[string]string{"preview": preview, "blockDOM": blockDOM} {
		if strings.Contains(html, `" ><img`) || strings.Contains(html, `onerror="`) {
			t.Fatalf("%s contains executable colgroup markup: %s", label, html)
		}
	}
}
