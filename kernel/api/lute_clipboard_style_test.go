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

package api

import (
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/PuerkitoBio/goquery"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func githubClipboardFixture(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("testdata/github-theme-clipboard.html")
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestMatchHTMLClipboardElements(t *testing.T) {
	input := render.Sanitize(githubClipboardFixture(t)) + `<h2 style="color:red;background:yellow;font:20px serif">` +
		`<strong>heading</strong></h2><p style="color:gray;font-size:1rem">text ` +
		`<a href="https://example.com" title="title" style="color:blue;background-color:transparent;` +
		`font-family:monospace;font-size:12px;text-decoration:underline line-through">link</a></p>`
	output := matchHTMLClipboardElements(input)
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(output))
	if err != nil {
		t.Fatal(err)
	}
	doc.Find("[style]").Each(func(_ int, selection *goquery.Selection) {
		style, _ := selection.Attr("style")
		decl := parse.HTMLStyleDeclarations(style)
		for property := range clipboardTextStyleProperties {
			if decl[property] != "" {
				t.Errorf("text style %s survived: %s", property, output)
			}
		}
	})
	lute := util.NewLute()
	lute.SetHTMLTag2TextMark(true)
	blockDOM := lute.HTML2BlockDOM(output)
	for _, want := range []string{`data-type="NodeHeading"`, `data-type="strong"`, `data-type="a"`, `data-type="s"`, `data-href="https://example.com"`, `data-title="title"`} {
		if !strings.Contains(blockDOM, want) {
			t.Errorf("missing %q: %s", want, blockDOM)
		}
	}
	for _, unexpected := range []string{"color:", "background", "font-family:", "font-size:", `data-type="a u`} {
		if strings.Contains(blockDOM, unexpected) {
			t.Errorf("unexpected %q: %s", unexpected, blockDOM)
		}
	}
	if again := matchHTMLClipboardElements(output); again != output {
		t.Fatal("matching elements is not idempotent")
	}
}

func TestMatchHTMLClipboardElementsAcrossSources(t *testing.T) {
	for _, input := range []string{
		`<div data-lark-html-role="root"><div style="color:gray;font-size:14px">text<span style="color:red;background:yellow">mark</span></div></div>`,
		`<p class="MsoNormal"><span style="font-family:Calibri;font-size:11pt;color:red;background:yellow;font-weight:bold">Office</span></p>`,
		`<p class="MsoNormal"><span style="font-family:宋体;font-size:12pt;color:red;background:yellow;text-decoration:underline;font-style:italic">WPS</span></p>`,
		`<font color="red" face="Arial" size="4"><em>legacy</em></font>`,
	} {
		output := matchHTMLClipboardElements(input)
		lower := strings.ToLower(output)
		for _, unexpected := range []string{"color:", "background", "font-family:", "font-size:", " face=", " size="} {
			if strings.Contains(lower, unexpected) {
				t.Errorf("source appearance survived %q: %s", unexpected, output)
			}
		}
		for trigger, expected := range map[string]string{"font-weight": "<strong>", "text-decoration": "<u>", "font-style": "<em>", "<em>": "<em>"} {
			if strings.Contains(input, trigger) && !strings.Contains(output, expected) {
				t.Errorf("semantic emphasis %q was lost: %s", expected, output)
			}
		}
	}
}

func TestMatchHTMLClipboardElementsPreservesSemanticOverrides(t *testing.T) {
	input := `<p><span style="font-weight:bold;font-style:italic">bold italic ` +
		`<span style="font-weight:normal;font-style:normal">normal</span></span>` +
		`<a href="https://example.com" style="text-decoration:underline">link</a></p>`
	output := matchHTMLClipboardElements(input)
	if !strings.Contains(output, "<em><strong>bold italic </strong></em>") || strings.Contains(output, "<strong><span>normal") || strings.Contains(output, "<u>link</u>") || strings.Contains(output, "style=") {
		t.Fatal(output)
	}
}

func TestPrepareHTMLClipboardStyleModes(t *testing.T) {
	input := `<p style="color:red;background:yellow;font-family:Arial;font-size:18px"><strong>text</strong></p>`
	noMath := func(string, string, string) (string, bool) { return "", false }
	noOffice := func(string) (string, bool) { return "", false }
	matched, useHTML := prepareHTMLClipboardContent(util.NewLute(), input, "", "", "", "", "", false, false, noMath, noOffice)
	if !useHTML || strings.Contains(matched, "color:") || strings.Contains(matched, "font-size:") || !strings.Contains(matched, "<strong>") {
		t.Fatalf("unexpected matched HTML: %s", matched)
	}
	preserved, useHTML := prepareHTMLClipboardContent(util.NewLute(), input, "", "", "", "", "", true, false, noMath, noOffice)
	if !useHTML || preserved != input {
		t.Fatalf("source formatting was not preserved: %s", preserved)
	}
	frozen, useHTML := prepareHTMLClipboardContent(util.NewLute(), preserved, "", "", "", "", "", true, true, noMath, noOffice)
	if !useHTML || frozen != preserved {
		t.Fatalf("prepared HTML changed: %s", frozen)
	}
}

func TestMatchHTMLClipboardElementsPreservesLayout(t *testing.T) {
	input := `<iframe src="https://example.com" style="position:relative;width:100%;color:red;font-size:14px"></iframe>`
	output := matchHTMLClipboardElements(input)
	if !strings.Contains(output, "position:relative") || !strings.Contains(output, "width:100%") || strings.Contains(output, "color:red") || strings.Contains(output, "font-size") {
		t.Fatal(output)
	}
}

func TestFilterClipboardStyle(t *testing.T) {
	input := `color: red !important; color: blue; font-family: "a;b"; background-image: url("a;b"); margin: 0 !important;`
	output := filterClipboardStyle(input, map[string]bool{"color": true})
	if strings.Contains(output, "color:") || !strings.Contains(output, `font-family: "a;b";`) || !strings.Contains(output, `background-image: url("a;b");`) || !strings.Contains(output, "margin: 0 !important;") {
		t.Fatal(output)
	}
}
