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
	archivezip "archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	inlineMathPandocJSON  = `{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Math","c":[{"t":"InlineMath"},"x+y"]},{"t":"Str","c":"\u200b"}]}]}`
	displayMathPandocJSON = `{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Plain","c":[{"t":"Math","c":[{"t":"DisplayMath"},"\\frac{S}{N}"]}]}]}`
)

func TestConvertClipboardMathWithRunner(t *testing.T) {
	mathML := `<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>`
	markdown, converted, err := convertClipboardMathWithRunner(mathML, "", "", func(from, to string, input []byte) ([]byte, error) {
		if from != "html" || to != "json" || string(input) != mathML {
			t.Fatalf("unexpected MathML input: from=%q to=%q input=%q", from, to, input)
		}
		return []byte(inlineMathPandocJSON), nil
	})
	if err != nil || !converted || markdown != "$x+y$" {
		t.Fatalf("unexpected MathML conversion: markdown=%q converted=%v err=%v", markdown, converted, err)
	}

	wps := buildWPSClipboard(t, `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><m:oMathPara><m:oMath><m:f><m:num><m:r><m:t>S</m:t></m:r></m:num><m:den><m:r><m:t>N</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara></w:body></w:document>`, "")
	markdown, converted, err = convertClipboardMathWithRunner("", "", wps, func(from, to string, input []byte) ([]byte, error) {
		if from != "docx" || to != "json" || len(input) < 2 || !bytes.Equal(input[:2], []byte{'P', 'K'}) {
			t.Fatalf("unexpected WPS input: from=%q to=%q input=%v", from, to, input)
		}
		return []byte(displayMathPandocJSON), nil
	})
	if err != nil || !converted || markdown != "$$\n\\frac{S}{N}\n$$" {
		t.Fatalf("unexpected WPS conversion: markdown=%q converted=%v err=%v", markdown, converted, err)
	}
}

func TestConvertClipboardMathMixedWPS(t *testing.T) {
	wps := buildWPSClipboard(t, `<w:document xmlns:w="urn:w" xmlns:m="urn:m"><w:body><m:oMath/></w:body></w:document>`, "")
	pandocJSON := `{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"123"}]},{"t":"Para","c":[{"t":"Math","c":[{"t":"DisplayMath"},"\\frac{S}{N}"]}]},{"t":"Para","c":[{"t":"Str","c":"456"}]}]}`
	markdownOutput := "123\n\n$$\\frac{S}{N}$$\n\n456\n"
	calls := 0
	markdown, converted, err := convertClipboardMathWithRunner("", "", wps, func(from, to string, input []byte) ([]byte, error) {
		calls++
		switch calls {
		case 1:
			if from != "docx" || to != "json" {
				t.Fatalf("unexpected reader call: from=%q to=%q", from, to)
			}
			return []byte(pandocJSON), nil
		case 2:
			if from != "json" || to != "markdown-raw_attribute" || string(input) != pandocJSON {
				t.Fatalf("unexpected writer call: from=%q to=%q input=%q", from, to, input)
			}
			return []byte(markdownOutput), nil
		default:
			t.Fatalf("unexpected runner call: %d", calls)
			return nil, nil
		}
	})
	if err != nil || !converted || markdown != strings.TrimSpace(markdownOutput) || calls != 2 {
		t.Fatalf("unexpected mixed conversion: markdown=%q converted=%v calls=%d err=%v", markdown, converted, calls, err)
	}

	adjacentJSON := `{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"Foo"},{"t":"Space"},{"t":"Math","c":[{"t":"InlineMath"},"x"]},{"t":"Str","c":"111"}]}]}`
	calls = 0
	markdown, converted, err = convertClipboardMathWithRunner("", "", wps, func(from, to string, input []byte) ([]byte, error) {
		calls++
		if calls == 1 {
			return []byte(adjacentJSON), nil
		}
		if from != "json" || to != "markdown-raw_attribute" || string(input) != adjacentJSON {
			t.Fatalf("unexpected adjacent writer call: from=%q to=%q input=%q", from, to, input)
		}
		return []byte("Foo $x$<!-- -->111\n"), nil
	})
	if err != nil || !converted || markdown != "Foo $x$111" || calls != 2 {
		t.Fatalf("unexpected adjacent conversion: markdown=%q converted=%v calls=%d err=%v", markdown, converted, calls, err)
	}
}

func TestNormalizeClipboardMathML(t *testing.T) {
	input := "\uFEFF \r\n<?xml version=\"1.0\"?><m:math xmlns:m=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><m:mi>x</m:mi></m:math>\u0000"
	normalized, ok := normalizeClipboardMathML(input)
	if !ok || !strings.HasPrefix(normalized, `<?xml version="1.0"?><m:math`) || !strings.HasSuffix(normalized, `</m:math>`) {
		t.Fatalf("unexpected normalized MathML: normalized=%q ok=%v", normalized, ok)
	}
	if _, ok = normalizeClipboardMathML(`<html><math/></html>`); ok {
		t.Fatal("non-MathML root was accepted")
	}
}

func TestOfficeHTMLClipboardMathInput(t *testing.T) {
	fragment := `<m:oMathPara xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"><m:oMath><m:r><span>SNR&nbsp;(dB)=20×</span></m:r><m:sSub><m:e><m:r><span>log</span></m:r></m:e><m:sub><m:r><span>10</span></m:r></m:sub></m:sSub><m:d><m:e><m:f><m:num><m:r><span>&#119878;</span></m:r></m:num><m:den><m:r><span>&#119873;</span></m:r></m:den></m:f></m:e></m:d></m:oMath></m:oMathPara>`
	normalized, ok := normalizeOfficeHTMLOMML(fragment)
	if !ok || !strings.Contains(normalized, `<m:t xml:space="preserve">SNR (dB)=20×</m:t>`) ||
		!strings.Contains(normalized, `<m:sSub>`) || !strings.Contains(normalized, `<m:f>`) ||
		strings.Contains(normalized, "<span") || !strings.Contains(normalized, "<m:oMathPara>") {
		t.Fatalf("unexpected normalized Office HTML math: normalized=%q ok=%v", normalized, ok)
	}
	docx, ok := officeHTMLClipboardMathInput(fragment)
	if !ok || !isClipboardMathDOCX(docx) {
		t.Fatal("Office HTML math was not converted to a valid DOCX payload")
	}
	archive, err := archivezip.NewReader(bytes.NewReader(docx), int64(len(docx)))
	if err != nil {
		t.Fatal(err)
	}
	documentXML, err := readWPSClipboardFile(archive, "word/document.xml")
	if err != nil || !bytes.Contains(documentXML, []byte(`<m:oMath>`)) ||
		!bytes.Contains(documentXML, []byte(docxOMMLNamespace)) {
		t.Fatalf("unexpected generated document.xml: xml=%q err=%v", documentXML, err)
	}
}

func TestClipboardMathPandocInputPriority(t *testing.T) {
	mathML := `<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>`
	wps := buildWPSClipboard(t, `<w:document xmlns:w="urn:w" xmlns:m="urn:m"><w:body><m:oMath/></w:body></w:document>`, "")
	from, input, ok := clipboardMathPandocInput(mathML, "", wps)
	if !ok || from != "docx" || len(input) < 2 || !bytes.Equal(input[:2], []byte{'P', 'K'}) {
		t.Fatalf("WPS DOCX was not preferred: from=%q input=%v ok=%v", from, input, ok)
	}
	invalidOffice := base64.StdEncoding.EncodeToString([]byte("not a compound file"))
	from, input, ok = clipboardMathPandocInput(mathML, invalidOffice, "")
	if !ok || from != "html" || string(input) != mathML {
		t.Fatalf("MathML fallback failed: from=%q input=%q ok=%v", from, input, ok)
	}
}

func TestConvertClipboardMathFallback(t *testing.T) {
	runnerCalled := false
	wps := buildWPSClipboard(t, `<w:document xmlns:w="urn:w"><w:body><w:p/></w:body></w:document>`, "")
	_, converted, err := convertClipboardMathWithRunner("not MathML", "", wps, func(string, string, []byte) ([]byte, error) {
		runnerCalled = true
		return nil, nil
	})
	if err != nil || converted || runnerCalled {
		t.Fatalf("unexpected fallback: converted=%v called=%v err=%v", converted, runnerCalled, err)
	}

	expectedErr := errors.New("pandoc failed")
	_, converted, err = convertClipboardMathWithRunner(`<math/>`, "", "", func(string, string, []byte) ([]byte, error) {
		return nil, expectedErr
	})
	if converted || !errors.Is(err, expectedErr) {
		t.Fatalf("unexpected runner error: converted=%v err=%v", converted, err)
	}

	mixedJSON := `{"blocks":[{"t":"Para","c":[{"t":"Str","c":"before"}]},{"t":"Para","c":[{"t":"Math","c":[{"t":"DisplayMath"},"x"]}]}]}`
	calls := 0
	_, converted, err = convertClipboardMathWithRunner("", "", buildWPSClipboard(t,
		`<w:document xmlns:w="urn:w" xmlns:m="urn:m"><w:body><m:oMath/></w:body></w:document>`, ""),
		func(string, string, []byte) ([]byte, error) {
			calls++
			if calls == 1 {
				return []byte(mixedJSON), nil
			}
			return nil, expectedErr
		})
	if converted || !errors.Is(err, expectedErr) || calls != 2 {
		t.Fatalf("unexpected writer error: converted=%v calls=%d err=%v", converted, calls, err)
	}
}

func TestSimplePandocMathDocument(t *testing.T) {
	tests := []struct {
		name  string
		input string
		ok    bool
	}{
		{name: "display with paragraphs", input: `{"blocks":[{"t":"Para","c":[{"t":"Str","c":"123"}]},{"t":"Para","c":[{"t":"Math","c":[{"t":"DisplayMath"},"x"]}]},{"t":"Para","c":[{"t":"Str","c":"456"}]}]}`, ok: true},
		{name: "inline with text", input: `{"blocks":[{"t":"Para","c":[{"t":"Str","c":"before"},{"t":"Space"},{"t":"Math","c":[{"t":"InlineMath"},"x"]},{"t":"Space"},{"t":"Str","c":"after"}]}]}`, ok: true},
		{name: "multiple math", input: `{"blocks":[{"t":"Para","c":[{"t":"Math","c":[{"t":"InlineMath"},"x"]}]},{"t":"Para","c":[{"t":"Math","c":[{"t":"DisplayMath"},"y"]}]}]}`, ok: true},
		{name: "display with text", input: `{"blocks":[{"t":"Para","c":[{"t":"Str","c":"before"},{"t":"Math","c":[{"t":"DisplayMath"},"x"]}]}]}`},
		{name: "strong", input: `{"blocks":[{"t":"Para","c":[{"t":"Strong","c":[{"t":"Str","c":"text"}]},{"t":"Math","c":[{"t":"InlineMath"},"x"]}]}]}`},
		{name: "image", input: `{"blocks":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[],["image.png",""]]},{"t":"Math","c":[{"t":"InlineMath"},"x"]}]}]}`},
		{name: "other block", input: `{"blocks":[{"t":"CodeBlock","c":[["",[],[]],"x"]},{"t":"Para","c":[{"t":"Math","c":[{"t":"InlineMath"},"x"]}]}]}`},
		{name: "no math", input: `{"blocks":[{"t":"Para","c":[{"t":"Str","c":"text"}]}]}`},
		{name: "invalid", input: `{`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := isSimplePandocMathDocument([]byte(test.input)); actual != test.ok {
				t.Fatalf("unexpected result: %v", actual)
			}
		})
	}
}

func TestParsePandocSingleMath(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		tex     string
		display bool
		ok      bool
	}{
		{name: "inline", input: inlineMathPandocJSON, tex: "x+y", ok: true},
		{name: "display", input: displayMathPandocJSON, tex: `\frac{S}{N}`, display: true, ok: true},
		{name: "empty paragraphs", input: `{"blocks":[{"t":"Para","c":[]},{"t":"Para","c":[{"t":"Math","c":[{"t":"InlineMath"},"x"]}]},{"t":"Plain","c":[]}]}`, tex: "x", ok: true},
		{name: "text", input: `{"blocks":[{"t":"Plain","c":[{"t":"Math","c":[{"t":"InlineMath"},"x"]},{"t":"Str","c":"text"}]}]}`},
		{name: "multiple", input: `{"blocks":[{"t":"Plain","c":[{"t":"Math","c":[{"t":"InlineMath"},"x"]},{"t":"Math","c":[{"t":"InlineMath"},"y"]}]}]}`},
		{name: "other block", input: `{"blocks":[{"t":"CodeBlock","c":[["",[],[]],"x"]}]}`},
		{name: "invalid", input: `{`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			math, ok := parsePandocSingleMath([]byte(test.input))
			if ok != test.ok || math.tex != test.tex || math.display != test.display {
				t.Fatalf("unexpected result: math=%+v ok=%v", math, ok)
			}
		})
	}
}

func TestClipboardMathMarkdownBlockDOM(t *testing.T) {
	luteEngine := util.NewLute()
	luteEngine.SetInlineMath(true)
	inline := luteEngine.Md2BlockDOM("$x+y$", false)
	if !strings.Contains(inline, `data-type="inline-math"`) {
		t.Fatalf("inline math was not generated: %s", inline)
	}
	display := luteEngine.Md2BlockDOM("$$\n\\frac{S}{N}\n$$", false)
	if !strings.Contains(display, `data-type="NodeMathBlock"`) {
		t.Fatalf("display math was not generated: %s", display)
	}
	mixed := luteEngine.Md2BlockDOM("123\n\n$$\\frac{S}{N}$$\n\n456", false)
	formulaIndex := strings.Index(mixed, `data-type="NodeMathBlock"`)
	if textBefore, textAfter := strings.Index(mixed, "123"), strings.Index(mixed, "456"); textBefore < 0 || formulaIndex < textBefore || textAfter < formulaIndex {
		t.Fatalf("mixed content order was not preserved: %s", mixed)
	}
	adjacent := luteEngine.Md2BlockDOM("Foo $x$111", false)
	if !strings.Contains(adjacent, `data-type="inline-math"`) || !strings.Contains(adjacent, "Foo") ||
		!strings.Contains(adjacent, "111") || strings.Contains(adjacent, "{=html}") || strings.Contains(adjacent, "&lt;!--") {
		t.Fatalf("adjacent inline content was not preserved: %s", adjacent)
	}
}
