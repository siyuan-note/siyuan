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
	"encoding/json"
	stdhtml "html"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type wpsPresentationTestArchiveEntry struct {
	name string
	data string
}

func TestWPSPresentationUnorderedTexts(t *testing.T) {
	style := `<a:lvl1pPr><a:buChar char="•"/></a:lvl1pPr><a:lvl2pPr><a:buChar char="◦"/></a:lvl2pPr>`
	paragraphs := strings.Join([]string{
		wpsPresentationTestParagraph(0, `<a:buNone/>`, "无序列表"),
		wpsPresentationTestParagraph(0, "", "1<&"),
		wpsPresentationTestParagraph(1, "", "甲"),
		wpsPresentationTestParagraph(1, "", "乙"),
		wpsPresentationTestParagraph(0, "", "2"),
	}, "")
	drawing := wpsPresentationTestDrawing(style, paragraphs, "")
	encoded := buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawingEx.xml", data: `<invalid/>`},
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: drawing})

	htmlContent, converted := wpsPresentationHTML(encoded, "无序列表\r\n1<&\r\n甲\r\n乙\r\n2\r\n", "texts")
	expected := `<p>无序列表</p><ul><li>1&lt;&amp;<ul><li>甲</li><li>乙</li></ul></li><li>2</li></ul>`
	if !converted || htmlContent != expected {
		t.Fatalf("unexpected conversion: converted=%v\n got: %s\nwant: %s", converted, htmlContent, expected)
	}
	if _, converted = wpsPresentationHTML(encoded, "不匹配", "texts"); converted {
		t.Fatal("mismatched plain text must not be converted")
	}
	renamedPrefixDrawing := strings.ReplaceAll(strings.ReplaceAll(drawing, "a:", "d:"), "xmlns:a=", "xmlns:d=")
	renamedPrefix := buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: renamedPrefixDrawing})
	if renamedHTML, ok := wpsPresentationHTML(renamedPrefix, "无序列表\n1<&\n甲\n乙\n2", "texts"); !ok || renamedHTML != expected {
		t.Fatalf("namespace prefix rename changed conversion: converted=%v html=%s", ok, renamedHTML)
	}

	dom, converted := convertWPSPresentation(encoded, "无序列表\n1<&\n甲\n乙\n2", "texts")
	if !converted || !strings.Contains(dom, `data-subtype="u"`) || !strings.Contains(dom, "甲") {
		t.Fatalf("unexpected BlockDOM: converted=%v dom=%s", converted, dom)
	}
}

func TestWPSPresentationOrderedOverrideAndSkippedLevel(t *testing.T) {
	style := `<a:lvl1pPr><a:buChar char="•"/></a:lvl1pPr><a:lvl2pPr><a:buChar char="•"/></a:lvl2pPr><a:lvl3pPr><a:buChar char="•"/></a:lvl3pPr>`
	paragraphs := strings.Join([]string{
		wpsPresentationTestParagraph(0, `<a:buNone/>`, "有序列表"),
		wpsPresentationTestParagraph(0, `<a:buAutoNum type="arabicPeriod" startAt="3"/>`, "A"),
		wpsPresentationTestParagraph(2, `<a:buAutoNum type="arabicPeriod"/>`, "B"),
		wpsPresentationTestParagraph(1, `<a:buAutoNum type="arabicPeriod"/>`, "C"),
		wpsPresentationTestParagraph(0, `<a:buAutoNum type="arabicPeriod"/>`, "D"),
		wpsPresentationTestParagraph(0, `<a:buAutoNum type="romanUcPeriod"/>`, "E"),
	}, "")
	encoded := buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: wpsPresentationTestDrawing(style, paragraphs, "")})

	htmlContent, converted := wpsPresentationHTML(encoded, "", "objects")
	expected := `<p>有序列表</p><ol start="3"><li>A<ol><li>B</li><li>C</li></ol></li><li>D</li></ol><ol><li>E</li></ol>`
	if !converted || htmlContent != expected {
		t.Fatalf("unexpected skipped-level conversion: converted=%v\n got: %s\nwant: %s", converted, htmlContent, expected)
	}
	if strings.Contains(htmlContent, `<li>A<ol><li>B</li></ol><ol>`) {
		t.Fatalf("skipped levels produced adjacent child lists: %s", htmlContent)
	}

	plainText := "有序列表\n3.A\n1.B\n2.C\n4.D\nI.E"
	if numberedHTML, ok := wpsPresentationHTML(encoded, plainText, "texts"); !ok || numberedHTML != expected {
		t.Fatalf("visible auto-number text did not match: converted=%v html=%s", ok, numberedHTML)
	}
	if rawHTML, ok := wpsPresentationHTML(encoded, "有序列表\nA\nB\nC\nD\nE", "texts"); !ok || rawHTML != expected {
		t.Fatalf("raw paragraph text did not match: converted=%v html=%s", ok, rawHTML)
	}
	if _, ok := wpsPresentationHTML(encoded, "有序列表\n2.A\n1.B\n2.C\n4.D\nI.E", "texts"); ok {
		t.Fatal("incorrect visible auto-number text must not match")
	}
}

func TestWPSPresentationTaskMarkers(t *testing.T) {
	style := `<a:lvl1pPr><a:buFont typeface="Wingdings 2"/><a:buChar char="£"/></a:lvl1pPr><a:lvl2pPr><a:buChar char="☑"/></a:lvl2pPr>`
	paragraphs := strings.Join([]string{
		wpsPresentationTestParagraph(0, `<a:buNone/>`, "任务列表"),
		wpsPresentationTestParagraph(0, "", "未完成"),
		wpsPresentationTestParagraph(1, "", "已完成一"),
		wpsPresentationTestParagraph(0, `<a:buFont typeface="Wingdings"/><a:buChar char="ü"/>`, "已完成二"),
	}, "")
	encoded := buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: wpsPresentationTestDrawing(style, paragraphs, "")})

	htmlContent, converted := wpsPresentationHTML(encoded, "", "objects")
	expected := `<p>任务列表</p><ul><li><input type="checkbox">未完成<ul><li><input type="checkbox" checked>已完成一</li></ul></li><li><input type="checkbox" checked>已完成二</li></ul>`
	if !converted || htmlContent != expected {
		t.Fatalf("unexpected task conversion: converted=%v\n got: %s\nwant: %s", converted, htmlContent, expected)
	}
	dom, converted := convertWPSPresentation(encoded, "", "objects")
	if !converted || !strings.Contains(dom, `data-subtype="t"`) || !strings.Contains(dom, `data-task="X"`) {
		t.Fatalf("unexpected task BlockDOM: converted=%v dom=%s", converted, dom)
	}

	tests := []struct {
		marker  rune
		font    string
		checked bool
	}{
		{marker: '□'}, {marker: '☐'},
		{marker: '✔', checked: true}, {marker: '✓', checked: true}, {marker: '☑', checked: true},
		{marker: '☒', checked: true},
		{marker: '£', font: "Wingdings 2"}, {marker: '\uf0a3', font: "Wingdings 2"},
		{marker: 'P', font: "Wingdings 2", checked: true}, {marker: '\uf050', font: "Wingdings 2", checked: true},
		{marker: 'R', font: "Wingdings 2", checked: true}, {marker: '\uf052', font: "Wingdings 2", checked: true},
		{marker: 'p', font: "Wingdings"}, {marker: '\uf070', font: "Wingdings"},
		{marker: 'q', font: "Wingdings"}, {marker: '\uf071', font: "Wingdings"},
		{marker: 'ü', font: "Wingdings", checked: true}, {marker: '\uf0fc', font: "Wingdings", checked: true},
	}
	for _, test := range tests {
		checked, task := wpsPresentationTaskMarker(string(test.marker), test.font)
		if !task || checked != test.checked {
			t.Errorf("unexpected marker mapping: marker=%U font=%q checked=%v task=%v", test.marker, test.font, checked, task)
		}
	}
	if _, task := wpsPresentationTaskMarker("P", ""); task {
		t.Fatal("font-dependent marker must not be inferred without its bullet font")
	}
}

func TestWPSPresentationAutoNumberMarkers(t *testing.T) {
	tests := []struct {
		numType  string
		ordinal  int
		expected string
	}{
		{numType: "arabicPeriod", ordinal: 2, expected: "2."},
		{numType: "alphaLcParenR", ordinal: 27, expected: "aa)"},
		{numType: "alphaUcParenBoth", ordinal: 3, expected: "(C)"},
		{numType: "romanLcPeriod", ordinal: 9, expected: "ix."},
		{numType: "romanUcPlain", ordinal: 14, expected: "XIV"},
	}
	for _, test := range tests {
		marker, ok := wpsPresentationAutoNumberMarker(test.numType, test.ordinal)
		if !ok || marker != test.expected {
			t.Errorf("unexpected auto-number marker: type=%s ordinal=%d marker=%q ok=%v",
				test.numType, test.ordinal, marker, ok)
		}
	}
	if marker, ok := wpsPresentationAutoNumberMarker("arabicDbPeriod", 1); ok || marker != "" {
		t.Fatalf("unsupported auto-number type must not be approximated: marker=%q ok=%v", marker, ok)
	}
}

func TestWPSPresentationEmptyParagraphs(t *testing.T) {
	style := `<a:lvl1pPr><a:buChar char="•"/></a:lvl1pPr>`
	paragraphs := strings.Join([]string{
		wpsPresentationTestParagraph(0, "", "A"),
		wpsPresentationTestParagraph(0, "", ""),
		wpsPresentationTestParagraph(0, "", "B"),
		wpsPresentationTestParagraph(0, `<a:buChar char="•"/>`, ""),
		wpsPresentationTestParagraph(0, "", "C"),
		wpsPresentationTestParagraph(0, "", ""),
	}, "")
	encoded := buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: wpsPresentationTestDrawing(style, paragraphs, "")})

	htmlContent, converted := wpsPresentationHTML(encoded, "", "objects")
	expected := `<ul><li>A</li></ul><p><br></p><ul><li>B</li><li></li><li>C</li></ul>`
	if !converted || htmlContent != expected {
		t.Fatalf("unexpected empty paragraph conversion: converted=%v\n got: %s\nwant: %s", converted, htmlContent, expected)
	}
}

func TestWPSPresentationObjectGuards(t *testing.T) {
	style := `<a:lvl1pPr><a:buChar char="•"/></a:lvl1pPr>`
	paragraph := wpsPresentationTestParagraph(0, "", "A")
	drawing := wpsPresentationTestDrawing(style, paragraph, "")

	tests := []struct {
		name    string
		entries []wpsPresentationTestArchiveEntry
	}{
		{
			name: "multiple drawings",
			entries: []wpsPresentationTestArchiveEntry{
				{name: "clipboard/drawings/drawing1.xml", data: drawing},
				{name: "clipboard/drawings/drawing2.xml", data: drawing},
			},
		},
		{
			name: "multiple text bodies",
			entries: []wpsPresentationTestArchiveEntry{{
				name: "clipboard/drawings/drawing1.xml",
				data: `<a:graphic xmlns:a="` + drawingMLNamespace + `">` +
					wpsPresentationTestTextBody(style, paragraph) + wpsPresentationTestTextBody(style, paragraph) + `</a:graphic>`,
			}},
		},
		{
			name: "mixed picture object",
			entries: []wpsPresentationTestArchiveEntry{{
				name: "clipboard/drawings/drawing1.xml",
				data: wpsPresentationTestDrawing(style, paragraph, `<a:pic/>`),
			}},
		},
		{
			name: "multiple DrawingML shapes",
			entries: []wpsPresentationTestArchiveEntry{{
				name: "clipboard/drawings/drawing1.xml",
				data: wpsPresentationTestDrawing(style, paragraph, `<a:sp/>`),
			}},
		},
		{
			name:    "extension drawing only",
			entries: []wpsPresentationTestArchiveEntry{{name: "clipboard/drawings/drawingEx.xml", data: drawing}},
		},
		{
			name: "namespace spoofing",
			entries: []wpsPresentationTestArchiveEntry{{
				name: "clipboard/drawings/drawing1.xml",
				data: `<txBody><lstStyle><lvl1pPr><buChar char="•"/></lvl1pPr></lstStyle><p><pPr lvl="0"/><r><t>A</t></r></p></txBody>`,
			}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			encoded := buildWPSPresentationTestArchive(t, test.entries...)
			if _, converted := wpsPresentationHTML(encoded, "", "objects"); converted {
				t.Fatal("complex or untrusted object must fall back to its preview image")
			}
		})
	}

	for _, name := range []string{
		"clipboard/drawings/drawing.xml",
		"clipboard/drawings/drawingEx.xml",
		"clipboard/drawings/drawing1.xml/extra",
		"clipboard/drawing1.xml",
	} {
		if _, ok := wpsPresentationDrawingIndex(name); ok {
			t.Errorf("unexpected drawing path match: %q", name)
		}
	}
	if index, ok := wpsPresentationDrawingIndex("clipboard/drawings/drawing12.xml"); !ok || index != 12 {
		t.Fatalf("expected numeric drawing path, got index=%d ok=%v", index, ok)
	}
}

func TestWPSPresentationSafetyLimits(t *testing.T) {
	if _, converted := wpsPresentationHTML("not-base64", "", "objects"); converted {
		t.Fatal("invalid base64 must not be converted")
	}

	entries := make([]wpsPresentationTestArchiveEntry, maxWPSPresentationArchiveEntries+1)
	for index := range entries {
		entries[index] = wpsPresentationTestArchiveEntry{name: "entry" + strconv.Itoa(index), data: "x"}
	}
	entries[0] = wpsPresentationTestArchiveEntry{
		name: "clipboard/drawings/drawing1.xml",
		data: wpsPresentationTestDrawing(`<a:lvl1pPr><a:buChar char="•"/></a:lvl1pPr>`,
			wpsPresentationTestParagraph(0, "", "A"), ""),
	}
	if _, converted := wpsPresentationHTML(buildWPSPresentationTestArchive(t, entries...), "", "objects"); converted {
		t.Fatal("archive entry limit must reject the payload")
	}

	oversized := strings.Repeat("x", maxWPSPresentationEntryBytes+1)
	if _, converted := wpsPresentationHTML(buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "large.bin", data: oversized},
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: "<invalid/>"}), "", "objects"); converted {
		t.Fatal("single-entry size limit must reject the payload")
	}

	deep := `<a:x xmlns:a="` + drawingMLNamespace + `">` + strings.Repeat(`<a:x>`, maxWPSPresentationXMLDepth) +
		strings.Repeat(`</a:x>`, maxWPSPresentationXMLDepth) + `</a:x>`
	if _, converted := wpsPresentationHTML(buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: deep}), "", "objects"); converted {
		t.Fatal("XML depth limit must reject the payload")
	}

	largeText := strings.Repeat("&", maxWPSPresentationOutputBytes/5+1)
	largeDrawing := wpsPresentationTestDrawing(`<a:lvl1pPr><a:buChar char="•"/></a:lvl1pPr>`,
		wpsPresentationTestParagraph(0, "", largeText), "")
	if _, converted := wpsPresentationHTML(buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: largeDrawing}), "", "objects"); converted {
		t.Fatal("generated HTML size limit must reject the payload")
	}
}

func TestWPSPresentationRequestBodyLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/lute/wpsPresentation2BlockDOM", wpsPresentation2BlockDOM)
	recorder := httptest.NewRecorder()
	body := strings.NewReader(`{"data":"` + strings.Repeat("A", maxWPSPresentationRequestBytes) + `","type":"objects"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/lute/wpsPresentation2BlockDOM", body)
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	var response struct {
		Code int `json:"code"`
		Data struct {
			Converted bool `json:"converted"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code == 0 || response.Data.Converted {
		t.Fatalf("oversized request body was not rejected: %s", recorder.Body.String())
	}
}

func TestWPSPresentationHandler(t *testing.T) {
	style := `<a:lvl1pPr><a:buChar char="•"/></a:lvl1pPr>`
	drawing := wpsPresentationTestDrawing(style, wpsPresentationTestParagraph(0, "", "A"), "")
	encoded := buildWPSPresentationTestArchive(t,
		wpsPresentationTestArchiveEntry{name: "clipboard/drawings/drawing1.xml", data: drawing})
	body, err := json.Marshal(map[string]string{"data": encoded, "text": "", "type": "objects"})
	if err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/lute/wpsPresentation2BlockDOM", wpsPresentation2BlockDOM)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/lute/wpsPresentation2BlockDOM", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	var response struct {
		Code int `json:"code"`
		Data struct {
			Converted bool   `json:"converted"`
			DOM       string `json:"dom"`
		} `json:"data"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != 0 || !response.Data.Converted || !strings.Contains(response.Data.DOM, `data-subtype="u"`) {
		t.Fatalf("unexpected handler response: %s", recorder.Body.String())
	}
}

func wpsPresentationTestDrawing(style, paragraphs, extra string) string {
	return `<a:graphic xmlns:a="` + drawingMLNamespace + `"><a:sp/>` + extra + `<a:txSp>` +
		wpsPresentationTestTextBody(style, paragraphs) + `</a:txSp></a:graphic>`
}

func wpsPresentationTestTextBody(style, paragraphs string) string {
	return `<a:txBody><a:bodyPr/><a:lstStyle>` + style + `</a:lstStyle>` + paragraphs + `</a:txBody>`
}

func wpsPresentationTestParagraph(level int, bullet, text string) string {
	return `<a:p><a:pPr lvl="` + strconv.Itoa(level) + `">` + bullet + `</a:pPr><a:r><a:t>` +
		stdhtml.EscapeString(text) + `</a:t></a:r></a:p>`
}

func buildWPSPresentationTestArchive(t *testing.T, entries ...wpsPresentationTestArchiveEntry) string {
	t.Helper()
	var buffer bytes.Buffer
	writer := archivezip.NewWriter(&buffer)
	for _, entry := range entries {
		file, err := writer.Create(entry.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte(entry.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buffer.Bytes())
}
