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

package av

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestValueTextPlainJSONCompatibility(t *testing.T) {
	const content = "**literal** <tag> ((20240101000000-abcdefg))\nnext"
	value := &ValueText{}
	if err := json.Unmarshal([]byte(`{"content":"**literal** <tag> ((20240101000000-abcdefg))\nnext"}`), value); nil != err {
		t.Fatal(err)
	}
	if value.IsRich() || content != value.Content {
		t.Fatalf("plain text changed during decode: %+v", value)
	}

	data, err := json.Marshal(value)
	if nil != err {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `"rich"`) {
		t.Fatalf("plain text unexpectedly persisted rich payload: %s", data)
	}
}

func TestValueTextNormalizeRichContent(t *testing.T) {
	value := &ValueText{
		Content: "untrusted projection",
		Rich: &ValueTextRich{
			Spec:    ValueTextRichSpec,
			Format:  ValueTextRichFormatKramdown,
			Content: "**Bold** and [link](https://example.com)",
		},
	}
	if err := value.NormalizeRichContent(); nil != err {
		t.Fatal(err)
	}
	if "Bold and link" != value.Content {
		t.Fatalf("unexpected plain text projection: %q", value.Content)
	}

	data, err := json.Marshal(value)
	if nil != err {
		t.Fatal(err)
	}
	decoded := &ValueText{}
	if err = json.Unmarshal(data, decoded); nil != err {
		t.Fatal(err)
	}
	if nil == decoded.Rich || value.Content != decoded.Content || value.Rich.Content != decoded.Rich.Content {
		t.Fatalf("rich text did not survive JSON round trip: %+v", decoded)
	}
}

func TestValueTextRichMultiBlockPlainProjection(t *testing.T) {
	value := &Value{
		Type: KeyTypeText,
		Text: &ValueText{Rich: &ValueTextRich{
			Spec:    ValueTextRichSpec,
			Format:  ValueTextRichFormatKramdown,
			Content: "first\n\nsecond",
		}},
	}
	if err := value.Text.NormalizeRichContent(); nil != err {
		t.Fatal(err)
	}
	if "first\nsecond" != value.Text.Content {
		t.Fatalf("unexpected multi-block projection: %q", value.Text.Content)
	}
	if "first\nsecond" != value.String(false) {
		t.Fatalf("text consumers did not receive the plain projection: %q", value.String(false))
	}

	tests := []struct {
		name     string
		source   string
		expected string
	}{
		{"paragraphs", "first\n\nsecond", "first\nsecond"},
		{"headings", "# first\n\n###### second", "first\nsecond"},
		{"list", "- first\n- second", "first\nsecond"},
		{"task list", "- [ ] todo\n- [x] done", "todo\ndone"},
		{"blockquote", "> first\n>\n> second", "first\nsecond"},
		{"code block", "```go\nfirst\nsecond\n```", "first\nsecond"},
		{"math block", "$$\nfirst\nsecond\n$$", "first\nsecond"},
	}
	for _, test := range tests {
		text := &ValueText{Rich: &ValueTextRich{
			Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: test.source,
		}}
		if err := text.NormalizeRichContent(); nil != err {
			t.Fatalf("normalize %s failed: %s", test.name, err)
		}
		if test.expected != text.Content {
			t.Fatalf("unexpected %s projection: want %q, got %q", test.name, test.expected, text.Content)
		}
	}
}

func TestValueTextRichASTWhitelist(t *testing.T) {
	allowed := []string{
		"",
		"# heading\n\n###### small heading",
		"plain **strong** *emphasis* ~~strike~~ ==mark== `code` $x$ [link](https://example.com) " +
			"((20240101000000-abcdefg \"reference\"))",
		"<u>underline</u>",
		"<kbd>Ctrl</kbd>",
		"^superscript^ ~subscript~ #tag#",
		"<span data-type=\"text\" style=\"color: var(--b3-font-color8); background-color: var(--b3-font-background8);\">styled</span>",
		"<span data-type=\"inline-memo\" data-inline-memo-content=\"memo\">annotated</span>",
		"<<assets/document-20240101000000-abcdefg.pdf/20240101000001-bcdefgh \"annotation\">>",
		"- first\n- [ ] task\n  - nested",
		"> quote",
		"```go\nfmt.Println(1)\n```",
		"```javascript\nconsole.log(1)\n```",
		"$$\nx^2\n$$",
	}
	for _, content := range allowed {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if _, err := NormalizeValueTextRich(rich); nil != err {
			t.Fatalf("allowed rich text was rejected, content=%q: %s", content, err)
		}
		normalized := rich.Content
		if _, err := NormalizeValueTextRich(rich); nil != err {
			t.Fatalf("normalized rich text was rejected, content=%q: %s", normalized, err)
		}
		if normalized != rich.Content {
			t.Fatalf("rich text normalization is not idempotent: %q != %q", normalized, rich.Content)
		}
		if strings.Contains(rich.Content, "{: id=") {
			t.Fatalf("normalized rich text leaked generated block attributes: %q", rich.Content)
		}
	}

	rejected := []string{
		"![image](assets/image.png)",
		"| a | b |\n| --- | --- |\n| 1 | 2 |",
		"<div>HTML</div>",
		"{{ SELECT * FROM blocks }}",
		"<div data-type=\"NodeAttributeView\" data-av-id=\"20240101000000-abcdefg\"></div>",
		"<iframe data-type=\"NodeWidget\" data-subtype=\"widget\"></iframe>",
		"<iframe src=\"https://example.com\"></iframe>",
		"<audio src=\"assets/audio.mp3\"></audio>",
		"<video src=\"assets/video.mp4\"></video>",
		"paragraph\n{: style=\"color: red\"}",
		`<span data-type="text">styled</span>{: style="font-family: 'A&#92;B';`,
		`<span data-type="text">styled</span>{: style="color: var(--b3-font-color8);" title="x"}`,
	}
	for _, content := range rejected {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if _, err := NormalizeValueTextRich(rich); nil == err {
			t.Fatalf("unsupported rich text was accepted: %q", content)
		}
	}
}

func TestValueTextRichHeadingRoundTrip(t *testing.T) {
	rich := &ValueTextRich{
		Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: "## heading",
	}
	tree, err := NormalizeValueTextRich(rich)
	if nil != err {
		t.Fatal(err)
	}
	if "## heading" != rich.Content {
		t.Fatalf("heading syntax was not preserved: %q", rich.Content)
	}
	if nil == tree.Root.FirstChild || ast.NodeHeading != tree.Root.FirstChild.Type ||
		2 != tree.Root.FirstChild.HeadingLevel {
		t.Fatalf("heading structure was not preserved: %v", tree.Root.FirstChild)
	}
}

func TestValueTextRichEmojiAliasRemainsLiteral(t *testing.T) {
	rich := &ValueTextRich{
		Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: ":siyuan: 😀",
	}
	tree, err := NormalizeValueTextRich(rich)
	if nil != err {
		t.Fatal(err)
	}
	if ":siyuan: 😀" != rich.Content || ":siyuan: 😀" != tree.Root.Content() {
		t.Fatalf("emoji alias was not kept as literal text: source=%q plain=%q", rich.Content, tree.Root.Content())
	}
	before := rich.Content
	if _, err = NormalizeValueTextRich(rich); nil != err || before != rich.Content {
		t.Fatalf("emoji alias normalization is not stable, before=%q, after=%q, err=%v", before, rich.Content, err)
	}
}

func TestValueTextRichRejectsExecutableCodeFences(t *testing.T) {
	languages := []string{"abc", "echarts", "flowchart", "graphviz", "infographic", "mermaid", "mindmap", "plantuml"}
	for _, language := range languages {
		rich := &ValueTextRich{
			Spec:    ValueTextRichSpec,
			Format:  ValueTextRichFormatKramdown,
			Content: "```" + language + "\ncontent\n```",
		}
		if _, err := NormalizeValueTextRich(rich); nil == err {
			t.Fatalf("executable code fence %q was accepted", language)
		}
	}

	for _, info := range []string{"MERMAID", "GraphViz options"} {
		rich := &ValueTextRich{
			Spec:    ValueTextRichSpec,
			Format:  ValueTextRichFormatKramdown,
			Content: "```" + info + "\ncontent\n```",
		}
		if _, err := NormalizeValueTextRich(rich); nil == err {
			t.Fatalf("executable code fence info %q was accepted", info)
		}
	}
}

func TestValueTextRichTextMarkReferenceValidation(t *testing.T) {
	const (
		blockID      = "20240101000000-abcdefg"
		annotationID = "20240101000001-bcdefgh"
		annotation   = "assets/document-20240101000000-abcdefg.pdf/" + annotationID
	)
	allowed := []string{
		`<span data-type="block-ref" data-id="` + blockID + `" data-subtype="d">dynamic</span>`,
		`<span data-type="block-ref" data-id="` + blockID + `" data-subtype="s">static</span>`,
		`<span data-type="block-ref" data-id="` + blockID + `">default static</span>`,
		`<span data-type="block-ref text" data-id="` + blockID + `" data-subtype="d" ` +
			`style="color: var(--b3-font-color8);">styled dynamic</span>`,
		`<span data-type="file-annotation-ref" data-id="` + annotation + `">annotation</span>`,
	}
	for _, content := range allowed {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if _, err := NormalizeValueTextRich(rich); nil != err {
			t.Fatalf("valid text mark reference was rejected, content=%q: %s", content, err)
		}
	}

	rejected := []string{
		`<span data-type="block-ref" data-subtype="d">missing ID</span>`,
		`<span data-type="block-ref" data-id="invalid" data-subtype="d">invalid ID</span>`,
		`<span data-type="block-ref" data-id="` + blockID + `" data-subtype="x">invalid subtype</span>`,
		`<span data-type="block-ref file-annotation-ref" data-id="` + blockID +
			`" data-subtype="d">mixed references</span>`,
		`<span data-type="file-annotation-ref" data-id="javascript:alert(1)">protocol</span>`,
		`<span data-type="file-annotation-ref" data-id="assets/document-` + blockID +
			`.png/` + annotationID + `">not PDF</span>`,
		`<span data-type="file-annotation-ref" data-id="assets/document-invalid.pdf/` +
			annotationID + `">invalid file ID</span>`,
		`<span data-type="file-annotation-ref" data-id="assets/document-` + blockID +
			`.pdf/invalid">invalid annotation ID</span>`,
		`<span data-type="file-annotation-ref" data-id="` + annotation + `?box=` + blockID +
			`">query</span>`,
	}
	for _, content := range rejected {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if _, err := NormalizeValueTextRich(rich); nil == err {
			t.Fatalf("invalid text mark reference was accepted: %q", content)
		}
	}
}

func TestValueTextRichTextMarkStyleIALWhitelist(t *testing.T) {
	const (
		fontFamily = "var(--b3-font-family-emoji-reset), 'KaiTi', var(--b3-font-family-editor), " +
			"var(--b3-font-family)"
		complexFontFamily = `var(--b3-font-family-emoji-reset), 'Semi; \'Quoted\' > \\ 字体', ` +
			`var(--b3-font-family-editor), var(--b3-font-family)`
		backtickFontFamily = "var(--b3-font-family-emoji-reset), 'A`B` Semi; \\'Quoted\\' > \\\\ 字体', " +
			"var(--b3-font-family-editor), var(--b3-font-family)"
		hollow = "-webkit-text-stroke: 0.2px var(--b3-theme-on-background); " +
			"-webkit-text-fill-color: transparent;"
		shadow = "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), " +
			"3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)"
	)
	allowed := []struct {
		content string
		style   string
	}{
		{`<span data-type="text" style="color: var(--b3-font-color1);">foreground</span>`,
			"color: var(--b3-font-color1);"},
		{`<span data-type="text" style="color: var(--b3-font-color01);">normalized foreground</span>`,
			"color: var(--b3-font-color1);"},
		{`<span data-type="text" style="background-color: var(--b3-font-background13);">background</span>`,
			"background-color: var(--b3-font-background13);"},
		{`<span data-type="text strong" style="color: var(--b3-inline-builtin-error-color,var(--b3-card-error-color)); ` +
			`background-color: var(--b3-inline-builtin-warning-background-color, var(--b3-card-warning-background));">builtin</span>`,
			"color: var(--b3-inline-builtin-error-color, var(--b3-card-error-color)); " +
				"background-color: var(--b3-inline-builtin-warning-background-color, var(--b3-card-warning-background));"},
		{`<span data-type="text" style="color: var(--b3-inline-style-20240101000000-abcdefg-color,#A1b2C3); ` +
			`background-color: var(--b3-inline-style-20240101000000-abcdefg-background-color, #d4E5f6);">custom</span>`,
			"color: var(--b3-inline-style-20240101000000-abcdefg-color, #a1b2c3); " +
				"background-color: var(--b3-inline-style-20240101000000-abcdefg-background-color, #d4e5f6);"},
		{`<span data-type="text" style="font-size: 9.00px;">minimum pixels</span>`, "font-size: 9px;"},
		{`<span data-type="text" style="font-size: 72px;">maximum pixels</span>`, "font-size: 72px;"},
		{`<span data-type="text" style="font-size: .56em;">minimum em</span>`, "font-size: 0.56em;"},
		{`<span data-type="text" style="font-size: 4.50em;">maximum em</span>`, "font-size: 4.5em;"},
		{`<span data-type="text">single quote IAL</span>{: style='font-size: 1.00em;'}`,
			"font-size: 1em;"},
		{`<span data-type="text" style="font-family: ` + fontFamily + `;">font</span>`,
			"font-family: " + fontFamily + ";"},
		{`<span data-type="text" style="font-family: var(--b3-font-family-emoji-reset), ` +
			`&quot;Double Font&quot;, var(--b3-font-family-editor), var(--b3-font-family);">double quoted font</span>`,
			"font-family: var(--b3-font-family-emoji-reset), 'Double Font', " +
				"var(--b3-font-family-editor), var(--b3-font-family);"},
		{`<span data-type="text" style="font-family: ` + complexFontFamily + `; font-size: 1em;">complex font</span>`,
			"font-size: 1em; font-family: " + complexFontFamily + ";"},
		{`<span data-type="text" style="font-family: ` + backtickFontFamily + `;">backtick font</span>`,
			"font-family: " + backtickFontFamily + ";"},
		{`<span data-type="text" style="unicode-bidi: isolate; direction: rtl;">right to left</span>`,
			"direction: rtl; unicode-bidi: isolate;"},
		{`<span data-type="text" style="-webkit-text-fill-color: transparent; ` +
			`-webkit-text-stroke: 0.2px var(--b3-theme-on-background);">hollow</span>`, hollow},
		{`<span data-type="text" style="text-shadow: ` + shadow + `;">shadow</span>`,
			"text-shadow: " + shadow + ";"},
		{`<span data-type="text" style="unicode-bidi:isolate; font-size: 12.0px; ` +
			`color:var(--b3-font-color8); direction:ltr;">combined</span>`,
			"color: var(--b3-font-color8); font-size: 12px; direction: ltr; unicode-bidi: isolate;"},
	}
	maximumFontFamily := "var(--b3-font-family-emoji-reset), '" + strings.Repeat("字", 256) +
		"', var(--b3-font-family-editor), var(--b3-font-family)"
	allowed = append(allowed, struct {
		content string
		style   string
	}{`<span data-type="text" style="font-family: ` + maximumFontFamily + `;">maximum font</span>`,
		"font-family: " + maximumFontFamily + ";"})
	for _, test := range allowed {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: test.content}
		tree, err := NormalizeValueTextRich(rich)
		if nil != err {
			t.Fatalf("safe text mark style was rejected, content=%q: %s", test.content, err)
		}
		var style string
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeTextMark == node.Type && 0 < len(node.KramdownIAL) {
				style = node.IALAttr("style")
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
		if test.style != style {
			t.Fatalf("style was not canonicalized\nwant: %q\n got: %q\nrich: %q", test.style, style, rich.Content)
		}
		if strings.Contains(test.content, "complex font") && !strings.Contains(rich.Content, "&#92;") {
			t.Fatalf("CSS backslashes were not encoded in the persisted span IAL: %q", rich.Content)
		}
		if strings.Contains(test.content, "backtick font") && !strings.Contains(rich.Content, "&#96;") {
			t.Fatalf("CSS backticks were not encoded in the persisted span IAL: %q", rich.Content)
		}
		before := rich.Content
		if _, err = NormalizeValueTextRich(rich); nil != err || before != rich.Content {
			t.Fatalf("canonical style is not stable, before=%q, after=%q, err=%v", before, rich.Content, err)
		}
	}

	rejected := []string{
		`<span data-type="text" style="color: #112233;">raw color</span>`,
		`<span data-type="text" style="color: var(--theme-color);">arbitrary variable</span>`,
		`<span data-type="text" style="color: var(--b3-font-color0);">zero index</span>`,
		`<span data-type="text" style="color: var(--b3-font-color14);">out of range</span>`,
		`<span data-type="text" style="color: var(--b3-font-background8);">wrong variable family</span>`,
		`<span data-type="text" style="font-size: 8px;">small pixels</span>`,
		`<span data-type="text" style="font-size: 73px;">large pixels</span>`,
		`<span data-type="text" style="font-size: 12.5px;">fractional pixels</span>`,
		`<span data-type="text" style="font-size: 0.55em;">small em</span>`,
		`<span data-type="text" style="font-size: 4.51em;">large em</span>`,
		`<span data-type="text" style="font-size: 1.234em;">precise em</span>`,
		`<span data-type="text" style="font-family: Arial;">unwrapped font</span>`,
		`<span data-type="text" style="font-family: var(--b3-font-family-emoji-reset), 'KaiTi', ` +
			`var(--b3-font-family-editor);">incomplete font fallback</span>`,
		`<span data-type="text" style="font-family: var(--b3-font-family-emoji-reset), ` +
			`'unterminated, var(--b3-font-family-editor), var(--b3-font-family);">unterminated font</span>`,
		`<span data-type="text" style="font-family: var(--b3-font-family-emoji-reset), 'inherit', ` +
			`var(--b3-font-family-editor), var(--b3-font-family);">global font</span>`,
		`<span data-type="text" style="font-family: var(--b3-font-family-emoji-reset), 'var(--evil)', ` +
			`var(--b3-font-family-editor), var(--b3-font-family);">variable font</span>`,
		`<span data-type="text" style="font-family: var(--b3-font-family-emoji-reset), 'Emojis Reset', ` +
			`var(--b3-font-family-editor), var(--b3-font-family);">reserved font</span>`,
		`<span data-type="text" style="direction: rtl;">unpaired direction</span>`,
		`<span data-type="text" style="unicode-bidi: isolate;">unpaired bidi</span>`,
		`<span data-type="text" style="direction: auto; unicode-bidi: isolate;">automatic direction</span>`,
		`<span data-type="text" style="direction: rtl; unicode-bidi: embed;">unsafe bidi</span>`,
		`<span data-type="text" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);">unpaired stroke</span>`,
		`<span data-type="text" style="-webkit-text-stroke: 0.3px var(--b3-theme-on-background); ` +
			`-webkit-text-fill-color: transparent;">wrong stroke</span>`,
		`<span data-type="text" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter);">wrong shadow</span>`,
		`<span data-type="text" style="--b3-parent-background: #fff;">parent background</span>`,
		`<span data-type="text" style="font-weight: bold;">custom CSS</span>`,
		`<span data-type="strong" style="color: var(--b3-font-color8);">style without text type</span>`,
		`<span data-type="text" style="color: var(--b3-font-color8); background-image: url(javascript:alert(1));">URL</span>`,
		`<span data-type="text" style="color: var(--b3-font-color8); color: var(--b3-font-color9);">duplicate</span>`,
		`<span data-type="text" style="color: var(--b3-inline-builtin-danger-color, var(--b3-card-danger-color));">unknown builtin</span>`,
		`<span data-type="text" style="color: var(--b3-inline-style-invalid-color, #112233);">invalid ID</span>`,
		`<span data-type="text" style="color: var(--b3-inline-style-20240101000000-abcdefg-color, url(javascript:alert(1)));">custom URL</span>`,
		`<span data-type="text" custom-foo="bar" style="color: var(--b3-font-color8);">custom attribute</span>`,
	}
	longFamily := strings.Repeat("字", 257)
	rejected = append(rejected, `<span data-type="text" style="font-family: var(--b3-font-family-emoji-reset), '`+
		longFamily+`', var(--b3-font-family-editor), var(--b3-font-family);">long font</span>`)
	for _, content := range rejected {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if _, err := NormalizeValueTextRich(rich); nil == err {
			t.Fatalf("unsafe text mark style was accepted: %q", content)
		}
	}

	tree, err := ParseValueTextRich(&ValueTextRich{
		Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: "**strong**",
	})
	if nil != err {
		t.Fatal(err)
	}
	var paragraph *ast.Node
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeParagraph == node.Type {
			paragraph = node
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if nil == paragraph {
		t.Fatal("paragraph node is missing")
	}
	style := "color: var(--b3-font-color8);"
	strong := &ast.Node{Type: ast.NodeStrong, KramdownIAL: [][]string{{"style", style}}}
	paragraph.AppendChild(strong)
	strong.InsertAfter(&ast.Node{Type: ast.NodeKramdownSpanIAL, Tokens: []byte(`{: style="` + style + `"}`)})
	if err = validateValueTextRichTree(tree); nil == err {
		t.Fatal("span IAL not attached to a text mark was accepted")
	}
}

func TestValueTextRichStyleBackslashEncodingIsScoped(t *testing.T) {
	literal := `</span>{: style="font-family: 'A&#92;B';"}`
	tests := []struct {
		name           string
		content        string
		preserveEntity bool
		protections    int
	}{
		{"fenced code", "```\n" + literal + "\n```", true, 0},
		{"nested container fenced code", "> - ```\n>   " + literal + "\n>   ```", true, 0},
		{"inline code", "`" + literal + "`", true, 0},
		{"multiline inline code", "`line one\n" + literal + "\nline three`", true, 0},
		{"multiline multi-backtick code", "``line one\n" + literal + "\nline three``", true, 0},
		{"math block", "$$\n" + literal + "\n$$", true, 0},
		{"inline math", "$" + literal + "$", false, 1},
	}
	for _, test := range tests {
		protected, protections, protectErr := protectValueTextRichKramdownStyleEntities(test.content)
		if nil != protectErr || test.protections != len(protections) {
			t.Fatalf("span IAL scanner entered %s", test.name)
		}
		if 0 == test.protections && test.content != protected {
			t.Fatalf("literal %s was rewritten: %q", test.name, protected)
		}
		rich := &ValueTextRich{
			Spec:    ValueTextRichSpec,
			Format:  ValueTextRichFormatKramdown,
			Content: test.content,
		}
		tree, err := NormalizeValueTextRich(rich)
		if nil != err {
			t.Fatalf("normalize %s failed: %s", test.name, err)
		}
		if strings.Contains(rich.Content, "\ue000") {
			t.Fatalf("span IAL scanner sentinel leaked from %s: %q", test.name, rich.Content)
		}
		if test.preserveEntity && !strings.Contains(rich.Content, "#92;") {
			t.Fatalf("span IAL entity inside %s was not preserved literally: %q", test.name, rich.Content)
		}
		if !test.preserveEntity && !strings.Contains(rich.Content, `A\B`) {
			t.Fatalf("span IAL entity inside %s lost its math meaning: %q", test.name, rich.Content)
		}
		if "fenced code" == test.name && !strings.Contains(rich.Content, literal) {
			t.Fatalf("fenced code source was changed: %q", rich.Content)
		}
		foundStyle := false
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeTextMark == node.Type && "" != node.IALAttr("style") {
				foundStyle = true
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
		if foundStyle {
			t.Fatalf("span IAL text inside %s was interpreted as a style", test.name)
		}
		normalized := rich.Content
		if _, err = NormalizeValueTextRich(rich); nil != err || normalized != rich.Content {
			t.Fatalf("%s entity normalization is not stable, before=%q, after=%q, err=%v",
				test.name, normalized, rich.Content, err)
		}
	}
}

func TestValueTextRichStyleEntityScannerBoundaries(t *testing.T) {
	styled := `<span data-type="text">styled</span>{: style="font-family: ` +
		`var(--b3-font-family-emoji-reset), 'A&#92;B &gt; C', ` +
		`var(--b3-font-family-editor), var(--b3-font-family);"}`
	backtickFont := `<span data-type="text">styled</span>{: style="font-family: ` +
		`var(--b3-font-family-emoji-reset), 'A` + "`B`" + ` Semi; &#92;'Quoted&#92;' &gt; 字体', ` +
		`var(--b3-font-family-editor), var(--b3-font-family);"}`
	tests := []struct {
		name        string
		content     string
		protections int
		reject      bool
	}{
		{"styled span", styled, 2, false},
		{"backticks inside font IAL", backtickFont, 5, false},
		{"unclosed code opener", "`unclosed " + styled, 2, false},
		{"escaped code opener", `\` + "` literal " + styled, 2, false},
		{"single quoted style IAL", `<span data-type="text">styled</span>{: style='font-family: ` +
			`var(--b3-font-family-emoji-reset), &quot;A&#92;B&quot;, ` +
			`var(--b3-font-family-editor), var(--b3-font-family);'}`, 3, false},
		{"inline code", "`" + styled + "`", 0, false},
		{"multi-backtick code", "``" + styled + "``", 0, false},
		{"multiline inline code", "`line one\n" + styled + "\nline three`", 0, false},
		{"multiline multi-backtick code", "``line one\n" + styled + "\nline three``", 0, false},
		{"fenced code", "```\n" + styled + "\n```", 0, false},
		{"tilde fenced code", "~~~\n" + styled + "\n~~~", 0, false},
		{"blockquote fenced code", "> ```\n> " + styled + "\n> ```", 0, false},
		{"list fenced code", "- ```\n  " + styled + "\n  ```", 0, false},
		{"nested list blockquote fenced code", "- > ```\n  > " + styled + "\n  > ```", 0, false},
		{"nested ordered list fenced code", "1. - ```\n   " + styled + "\n   ```", 0, false},
		{"inline math", "$" + styled + "$", 2, false},
		{"math block", "$$\n" + styled + "\n$$", 0, false},
		{"CRLF fenced code", "```\r\n" + styled + "\r\n```", 0, false},
		{"missing IAL close", `<span data-type="text">styled</span>{: style="color: var(--b3-font-color8);`, 0, true},
		{"extra attr before style", `<span data-type="text">styled</span>{: title="x" ` +
			`style="color: var(--b3-font-color8);"}`, 0, true},
		{"extra attr after style", `<span data-type="text">styled</span>{: ` +
			`style="color: var(--b3-font-color8);" title="x"}`, 0, true},
		{"missing IAL whitespace", `<span data-type="text">styled</span>{:style="color: var(--b3-font-color8);"}`, 0, true},
		{"malformed fenced literal", "```\n<span data-type=\"text\">styled</span>{: style=\"unterminated\n```", 0, false},
		{"nested malformed fenced literal",
			"> - ```\n>   <span data-type=\"text\">styled</span>{: style=\"unterminated\n>   ```", 0, false},
	}
	for _, test := range tests {
		protected, protections, err := protectValueTextRichKramdownStyleEntities(test.content)
		if test.reject != (nil != err) {
			t.Fatalf("unexpected %s error: %v", test.name, err)
		}
		if test.reject {
			continue
		}
		if test.protections != len(protections) {
			t.Fatalf("unexpected %s protection count: want %d, got %d in %q",
				test.name, test.protections, len(protections), protected)
		}
		if 0 == test.protections && test.content != protected {
			t.Fatalf("literal %s was rewritten: %q", test.name, protected)
		}
	}
}

func TestValueTextRichStyleEntitiesInsideDollarDelimitedText(t *testing.T) {
	const expectedStyle = `font-family: var(--b3-font-family-emoji-reset), 'Semi; \'Quoted\' > \\ ` +
		`字体', var(--b3-font-family-editor), var(--b3-font-family);`
	seed := &ValueTextRich{
		Spec:   ValueTextRichSpec,
		Format: ValueTextRichFormatKramdown,
		Content: `<span data-type="text" style="` + expectedStyle +
			`">styled</span>`,
	}
	if _, err := NormalizeValueTextRich(seed); nil != err {
		t.Fatal(err)
	}
	if !strings.Contains(seed.Content, "&#92;") {
		t.Fatalf("seed style does not exercise encoded CSS: %q", seed.Content)
	}

	for _, content := range []string{"$" + seed.Content + "$", "$5 " + seed.Content + " $10"} {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		tree, err := NormalizeValueTextRich(rich)
		if nil != err {
			t.Fatalf("dollar-delimited styled text was rejected, content=%q: %s", content, err)
		}
		var style string
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeTextMark == node.Type && node.IsTextMarkType("text") {
				style = node.IALAttr("style")
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
		if expectedStyle != style {
			t.Fatalf("dollar-delimited text style changed\nwant: %q\n got: %q\nrich: %q", expectedStyle, style, rich.Content)
		}
		if strings.Contains(rich.Content, "\ue000") || !strings.Contains(rich.Content, "&#92;") {
			t.Fatalf("dollar-delimited style entity was not safely persisted: %q", rich.Content)
		}
		before := rich.Content
		if _, err = NormalizeValueTextRich(rich); nil != err || before != rich.Content {
			t.Fatalf("dollar-delimited style normalization is not stable, before=%q, after=%q, err=%v",
				before, rich.Content, err)
		}
	}
}

func TestValueTextRichStyleEntityScannerManyMarkers(t *testing.T) {
	const (
		repetitions = 1024
		styled      = `<span data-type="text">styled</span>{: style="font-family: ` +
			`var(--b3-font-family-emoji-reset), 'A&#92;&#92;B &gt; C', ` +
			`var(--b3-font-family-editor), var(--b3-font-family);"}`
	)
	var markdown strings.Builder
	for i := 0; i < repetitions; i++ {
		markdown.WriteString(styled)
		markdown.WriteByte('\n')
	}
	markdown.WriteString("```\n")
	for i := 0; i < repetitions; i++ {
		markdown.WriteString(styled)
		markdown.WriteByte('\n')
	}
	markdown.WriteString("```\n")
	for i := 0; i < repetitions; i++ {
		markdown.WriteByte('`')
		markdown.WriteString(styled)
		markdown.WriteString("`\n")
	}

	content := markdown.String()
	protected, protections, err := protectValueTextRichKramdownStyleEntities(content)
	if nil != err {
		t.Fatal(err)
	}
	if repetitions*3 != len(protections) {
		t.Fatalf("unexpected protection count: want %d, got %d", repetitions*3, len(protections))
	}
	if !strings.Contains(protected, protections[0].sentinel) {
		t.Fatal("style entities were not protected")
	}
	if !strings.Contains(protected, "```\n"+styled+"\n") ||
		!strings.Contains(protected, "`"+styled+"`\n") {
		t.Fatal("literal marker content was rewritten")
	}
}

func TestValueTextRichStyleSentinelLongCollisionPrefix(t *testing.T) {
	const (
		prefix      = "\ue000siyuan-av-rich-text-backslash"
		suffix      = "\ue001"
		repetitions = 4096
	)
	content := prefix + strings.Repeat(suffix, repetitions)
	sentinel := newValueTextRichBackslashSentinel(content)
	want := prefix + strings.Repeat(suffix, repetitions+1)
	if want != sentinel || strings.Contains(content, sentinel) {
		t.Fatalf("unexpected collision-free sentinel length: want %d bytes, got %d bytes",
			len(want), len(sentinel))
	}
}

func TestValueTextRichRestoresManyStyleEntities(t *testing.T) {
	const (
		repetitions = 128
		styled      = `<span data-type="text">styled</span>{: style="font-family: ` +
			`var(--b3-font-family-emoji-reset), 'A&#92;&#92;B &gt; C', ` +
			`var(--b3-font-family-editor), var(--b3-font-family);"}`
	)
	content := strings.Repeat(styled+"\n\n", repetitions)
	rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
	tree, err := NormalizeValueTextRich(rich)
	if nil != err {
		t.Fatal(err)
	}
	styledMarks := 0
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTextMark == node.Type && node.IsTextMarkType("text") &&
			"" != node.IALAttr("style") {
			styledMarks++
		}
		return ast.WalkContinue
	})
	if repetitions != styledMarks {
		t.Fatalf("unexpected styled mark count: want %d, got %d", repetitions, styledMarks)
	}
	if strings.Contains(rich.Content, "\ue000") || !strings.Contains(rich.Content, "&#92;") {
		t.Fatalf("style entity restoration leaked or lost its encoding")
	}
	before := rich.Content
	if _, err = NormalizeValueTextRich(rich); nil != err || before != rich.Content {
		t.Fatalf("many style entities are not stable, err=%v", err)
	}
}

func TestValueTextRichNormalizationStripsStructuralIAL(t *testing.T) {
	rich := &ValueTextRich{
		Spec:    ValueTextRichSpec,
		Format:  ValueTextRichFormatKramdown,
		Content: "paragraph\n{: id=\"20240101000000-abcdefg\" updated=\"20240101000000\"}",
	}
	if _, err := NormalizeValueTextRich(rich); nil != err {
		t.Fatal(err)
	}
	for _, structuralAttr := range []string{"{:", "data-node-id", "data-node-index", "updated="} {
		if strings.Contains(rich.Content, structuralAttr) {
			t.Fatalf("normalized rich text leaked structural attribute %q: %q", structuralAttr, rich.Content)
		}
	}
}

func TestValueTextRichInlineRoundTrip(t *testing.T) {
	tests := []struct {
		content  string
		typ      string
		nodeType ast.NodeType
	}{
		{"**strong**", "strong", ast.NodeStrong},
		{"<u>underline</u>", "u", ast.NodeUnderline},
		{"<kbd>Ctrl</kbd>", "kbd", ast.NodeKbd},
		{"^superscript^", "sup", ast.NodeSup},
		{"~subscript~", "sub", ast.NodeSub},
		{"#tag#", "tag", ast.NodeTag},
		{"<span data-type=\"text\" style=\"color: var(--b3-font-color8);\">styled</span>", "text", ast.NodeTextMark},
		{"<span data-type=\"inline-memo\" data-inline-memo-content=\"memo\">annotated</span>", "inline-memo", ast.NodeTextMark},
		{"((20240101000000-abcdefg \"reference\"))", "block-ref", ast.NodeBlockRef},
		{"<<assets/document-20240101000000-abcdefg.pdf/20240101000001-bcdefgh \"annotation\">>", "file-annotation-ref", ast.NodeFileAnnotationRef},
	}
	for _, test := range tests {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: test.content}
		for pass := 0; pass < 2; pass++ {
			tree, err := ParseValueTextRich(rich)
			if nil != err {
				t.Fatalf("parse inline type %q failed: %s", test.typ, err)
			}
			found := false
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}
				if ast.NodeTextMark == node.Type && node.IsTextMarkType(test.typ) ||
					ast.NodeTextMark != test.nodeType && test.nodeType == node.Type {
					found = true
					return ast.WalkStop
				}
				return ast.WalkContinue
			})
			if !found {
				var nodeTypes []string
				ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
					if entering {
						nodeTypes = append(nodeTypes, node.Type.String()+":"+node.TextMarkType)
					}
					return ast.WalkContinue
				})
				t.Fatalf("inline type %q was not parsed from %q: %v", test.typ, rich.Content, nodeTypes)
			}
			if 0 == pass {
				if _, err = NormalizeValueTextRich(rich); nil != err {
					t.Fatalf("normalize inline type %q failed: %s", test.typ, err)
				}
			}
		}
	}

	combined := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: "***combined***"}
	for pass := 0; pass < 2; pass++ {
		tree, err := ParseValueTextRich(combined)
		if nil != err {
			t.Fatal(err)
		}
		found := false
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeTextMark == node.Type && node.ContainTextMarkTypes("strong", "em") {
				found = true
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
		if !found {
			t.Fatalf("combined text mark was not preserved: %q", combined.Content)
		}
		if 0 == pass {
			if _, err = NormalizeValueTextRich(combined); nil != err {
				t.Fatal(err)
			}
		}
	}
}

func TestValueTextRichParserIgnoresEditorMarkdownSettings(t *testing.T) {
	original := *util.MarkdownSettings
	defer func() {
		*util.MarkdownSettings = original
	}()

	rich := &ValueTextRich{
		Spec:    ValueTextRichSpec,
		Format:  ValueTextRichFormatKramdown,
		Content: "***em strong*** ==mark== ~~strike~~ ^sup^ ~sub~ #tag# $math$",
	}
	if _, err := NormalizeValueTextRich(rich); nil != err {
		t.Fatal(err)
	}

	util.MarkdownSettings.InlineAsterisk = false
	util.MarkdownSettings.InlineUnderscore = false
	util.MarkdownSettings.InlineSup = false
	util.MarkdownSettings.InlineSub = false
	util.MarkdownSettings.InlineTag = false
	util.MarkdownSettings.InlineMath = false
	util.MarkdownSettings.InlineStrikethrough = false
	util.MarkdownSettings.InlineFullWidthStrikethrough = false
	util.MarkdownSettings.InlineMark = false
	disabled := false
	util.MarkdownSettings.BlockFullWidthTaskList = &disabled
	util.MarkdownSettings.CodeBlockMiddleDot = &disabled

	disabledSettingsRich := &ValueTextRich{
		Spec:    ValueTextRichSpec,
		Format:  ValueTextRichFormatKramdown,
		Content: "***em strong*** ==mark== ~~strike~~ ^sup^ ~sub~ #tag# $math$",
	}
	if _, err := NormalizeValueTextRich(disabledSettingsRich); nil != err {
		t.Fatal(err)
	}

	for _, candidate := range []*ValueTextRich{rich, disabledSettingsRich} {
		tree, err := ParseValueTextRich(candidate)
		if nil != err {
			t.Fatal(err)
		}
		for _, typ := range []string{"em", "strong", "mark", "s", "sup", "sub", "tag", "inline-math"} {
			found := false
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && ast.NodeTextMark == node.Type && node.IsTextMarkType(typ) {
					found = true
					return ast.WalkStop
				}
				return ast.WalkContinue
			})
			if !found {
				t.Fatalf("stored inline type %q depended on editor Markdown settings: %q", typ, candidate.Content)
			}
		}
	}
}

func TestValueTextRichSanitizesExecutableInlineMarkup(t *testing.T) {
	tests := []struct {
		content     string
		forbidden   []string
		allowReject bool
	}{
		{"[link](JaVaScRiPt:alert(1))", []string{"javascript:", "alert(1)"}, true},
		{"<span data-type=\"strong\" onclick=\"alert(1)\">bold</span>", []string{"onclick", "alert(1)"}, true},
	}
	for _, test := range tests {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: test.content}
		if _, err := NormalizeValueTextRich(rich); nil != err {
			if test.allowReject {
				continue
			}
			t.Fatalf("safe link structure was rejected instead of sanitized: %s", err)
		}
		blockDOM, _, err := parseValueTextRich(rich)
		if nil != err {
			t.Fatal(err)
		}
		persisted := strings.ToLower(rich.Content)
		rendered := strings.ToLower(blockDOM)
		for _, forbidden := range test.forbidden {
			if strings.Contains(persisted, forbidden) || strings.Contains(rendered, forbidden) {
				t.Fatalf("executable inline markup survived normalization: source=%q rendered=%q", rich.Content, blockDOM)
			}
		}
	}
}

func TestValueTextRichLinkTargetPolicy(t *testing.T) {
	allowed := []string{
		"",
		"https://example.com/path?q=value#fragment",
		"HTTP://localhost:6806/path",
		"mailto:user@example.com",
		"tel:+8613800138000",
		"siyuan://blocks/20240101000000-abcdefg?focus=1",
		"web+siyuan://bazaar/plugins/example/readme",
		"../relative/note.md",
		"/absolute/path",
		"#heading",
		"?query=value",
		"//example.com/path",
		"assets/file with space-20240101000000-abcdefg.pdf?page=2",
		"assets/percent%25-20240101000000-abcdefg.txt",
	}
	blocked := []string{
		" javascript:alert(1)",
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"java\tscript:alert(1)",
		"java\x00script:alert(1)",
		"java\u200bscript:alert(1)",
		"javascript&colon;alert(1)",
		"javascript&amp;colon;alert(1)",
		"java%73cript:alert(1)",
		"vbscript:msgbox(1)",
		"data:text/html,<script>alert(1)</script>",
		"file:///tmp/document.txt",
		"blob:https://example.com/id",
		"ftp://example.com/file",
		"custom://action",
		"https:example.com",
		"http:///missing-host",
		"tel:",
		"siyuan:/blocks/20240101000000-abcdefg",
		"web+siyuan:/bazaar/plugins/example/readme",
		`https:\\example.com`,
		"assets/../outside.txt",
		"relative/%zz",
		"relative/%ff",
		"relative/%C3",
		"relative/%E4%B8",
	}
	for _, target := range allowed {
		linkDest := &ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(target)}
		textMark := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: target}
		if !isAllowedValueTextRichNode(linkDest) {
			t.Fatalf("allowed classic link destination was rejected: %q", target)
		}
		if !isAllowedValueTextMark(textMark) {
			t.Fatalf("allowed text mark link destination was rejected: %q", target)
		}
	}
	for _, target := range blocked {
		linkDest := &ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(target)}
		textMark := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: target}
		if isAllowedValueTextRichNode(linkDest) {
			t.Fatalf("unsafe classic link destination was accepted: %q", target)
		}
		if isAllowedValueTextMark(textMark) {
			t.Fatalf("unsafe text mark link destination was accepted: %q", target)
		}
	}
}

func TestValueTextRichRejectsObfuscatedLinkTargets(t *testing.T) {
	contents := []string{
		"[classic](<vbscript:msgbox(1)>)",
		"[classic](<java%73cript:alert(1)>)",
		"[classic](<data:text/html,active>)",
		`<span data-type="a" data-href=" javascript:alert(1)">leading whitespace</span>`,
		`<span data-type="a" data-href="java&#x0A;script:alert(1)">control</span>`,
		`<span data-type="a" data-href="javascript&amp;colon;alert(1)">entity</span>`,
		`<span data-type="a" data-href="file:///tmp/document.txt">file</span>`,
	}
	for _, content := range contents {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if _, err := NormalizeValueTextRich(rich); nil == err {
			t.Fatalf("obfuscated rich text link target was accepted: %q", content)
		}
	}
}

func TestValueTextRichInlineMemoIsPlainText(t *testing.T) {
	allowed := []string{
		"plain memo",
		"plain & safe",
		"copyright ©",
		"2 < 3 and 4 > 1",
		"heart <3",
		"tab\tline",
		"line one\nline two\rline three",
		"\U0001f469\u200d\U0001f4bb developer",
		"\u200fنص ثنائي الاتجاه",
	}
	blocked := []string{
		"<img src=x onerror=alert(1)>",
		"<span data-type=\"file-annotation-ref\" data-id=\"assets/document.pdf/id\">fake</span>",
		"&lt;script&gt;alert(1)&lt;/script&gt;",
		"&amp;lt;img src=x onerror=alert(1)&amp;gt;",
		"memo\x00control",
	}
	for _, content := range allowed {
		node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkInlineMemoContent: content}
		if !isAllowedValueTextMark(node) {
			t.Fatalf("plain inline memo was rejected: %q", content)
		}
	}
	for _, content := range blocked {
		node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkInlineMemoContent: content}
		if isAllowedValueTextMark(node) {
			t.Fatalf("active or ambiguous inline memo was accepted: %q", content)
		}
	}

	allowedRich := &ValueTextRich{
		Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown,
		Content: `<span data-type="inline-memo" data-inline-memo-content="plain &amp; safe">annotated</span>`,
	}
	if _, err := NormalizeValueTextRich(allowedRich); nil != err {
		t.Fatalf("plain inline memo failed normalization: %v", err)
	}
	malicious := []string{
		`<span data-type="inline-memo" data-inline-memo-content="&lt;img src=x onerror=alert(1)&gt;">image</span>`,
		`<span data-type="inline-memo" data-inline-memo-content="&lt;span data-type='file-annotation-ref'&gt;fake&lt;/span&gt;">fake</span>`,
		`<span data-type="inline-memo" data-inline-memo-content="&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;">entity</span>`,
		"<span data-type=\"inline-memo\" data-inline-memo-content=\"memo&#127;control\">control</span>",
	}
	for _, content := range malicious {
		rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content}
		if _, err := NormalizeValueTextRich(rich); nil == err {
			t.Fatalf("active inline memo was accepted: %q", content)
		}
	}
}

func TestValueTextRichInlineMemoWhitespaceFromBlockDOM(t *testing.T) {
	blockDOM := `<div data-node-id="20240101000000-abcdefg" data-type="NodeParagraph" class="p">` +
		`<div contenteditable="true" spellcheck="false"><span data-type="inline-memo" ` +
		"data-inline-memo-content=\"tab\tline one\nline two\rline three\">annotated</span></div>" +
		`<div class="protyle-attr" contenteditable="false"></div></div>`
	markdown := newValueTextRichLute().BlockDOM2Md(blockDOM)
	rich := &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: markdown}
	tree, err := NormalizeValueTextRich(rich)
	if nil != err {
		t.Fatalf("normalize inline memo textarea whitespace from BlockDOM: %v, markdown=%q", err, markdown)
	}

	want := "tab\tline one" + editor.IALValEscNewLine + "line two" + editor.IALValEscNewLine + "line three"
	got := ""
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsTextMarkType("inline-memo") {
			got = node.TextMarkInlineMemoContent
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if got != want {
		t.Fatalf("inline memo textarea whitespace = %q, want %q, markdown=%q", got, want, markdown)
	}
}

func TestValueTextRejectsUnsupportedRichPayload(t *testing.T) {
	tests := []*ValueTextRich{
		{Spec: ValueTextRichSpec + 1, Format: ValueTextRichFormatKramdown},
		{Spec: ValueTextRichSpec, Format: "block-dom"},
	}
	for _, rich := range tests {
		value := &ValueText{Rich: rich}
		if err := value.NormalizeRichContent(); nil == err {
			t.Fatalf("unsupported rich payload was accepted: %+v", rich)
		}
	}
}
