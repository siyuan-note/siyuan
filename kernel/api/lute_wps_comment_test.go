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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/PuerkitoBio/goquery"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNormalizeWPSComments(t *testing.T) {
	document := `<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>11111</w:t></w:r>` +
		`<w:commentRangeStart w:id="0"/><w:r><w:t>111</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
		`<w:r><w:commentReference w:id="0"/></w:r><w:r><w:t>1111111111</w:t></w:r></w:p></w:body></w:document>`
	comments := `<?xml version="1.0"?><w:comments xmlns:w="urn:w"><w:comment w:id="0"><w:p><w:r>` +
		`<w:t>22222222222222</w:t></w:r></w:p></w:comment></w:comments>`
	encoded := buildWPSClipboard(t, document, comments)
	dom := `<p><span>11111111</span><span>1111111111</span></p>`

	normalized := normalizeWPSComments(dom, "111111111111111111", encoded)
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(normalized))
	if err != nil {
		t.Fatal(err)
	}
	memo := doc.Find(`span[title="22222222222222"]`)
	if memo.Length() != 1 || memo.Text() != "111" {
		t.Fatalf("unexpected normalized WPS memo: %s", normalized)
	}
	if doc.Find("body").Text() != "111111111111111111" {
		t.Fatalf("unexpected normalized text: %s", doc.Find("body").Text())
	}

	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	tree := luteEngine.HTML2Tree(normalized)
	var inlineMemo *ast.Node
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTextMark == node.Type && node.IsTextMarkType("inline-memo") {
			inlineMemo = node
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if inlineMemo == nil || inlineMemo.TextMarkTextContent != "111" ||
		inlineMemo.TextMarkInlineMemoContent != "22222222222222" {
		t.Fatal("WPS comment was not converted to an inline memo")
	}
}

func TestNormalizeWPSCommentsRequiresMatchingText(t *testing.T) {
	encoded := buildWPSClipboard(t,
		`<w:document xmlns:w="urn:w"><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>text</w:t></w:r>`+
			`<w:commentRangeEnd w:id="0"/></w:p></w:body></w:document>`,
		`<w:comments xmlns:w="urn:w"><w:comment w:id="0"><w:p><w:r><w:t>memo</w:t></w:r></w:p></w:comment></w:comments>`)
	dom := `<p>different</p>`
	if normalized := normalizeWPSComments(dom, "different", encoded); normalized != dom {
		t.Fatalf("mismatched WPS content was modified: %s", normalized)
	}
}

func buildWPSClipboard(t *testing.T, document, comments string) string {
	t.Helper()
	var buffer bytes.Buffer
	writer := archivezip.NewWriter(&buffer)
	for name, content := range map[string]string{
		"word/document.xml": document,
		"word/comments.xml": comments,
	} {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buffer.Bytes())
}
