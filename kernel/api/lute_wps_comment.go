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
	"encoding/xml"
	"io"
	"sort"
	"strings"

	"github.com/PuerkitoBio/goquery"
	nethtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const maxWPSClipboardBytes = 8 * 1024 * 1024

type wpsCommentRange struct {
	id    string
	start int
	end   int
}

type wpsHTMLChar struct {
	node   *nethtml.Node
	offset int
}

type wpsNodeRange struct {
	start int
	end   int
	memo  string
}

func normalizeWPSComments(dom, text, encoded string) string {
	if encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxWPSClipboardBytes) {
		return dom
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) > maxWPSClipboardBytes {
		return dom
	}
	archive, err := archivezip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return dom
	}
	documentXML, err := readWPSClipboardFile(archive, "word/document.xml")
	if err != nil {
		return dom
	}
	commentsXML, err := readWPSClipboardFile(archive, "word/comments.xml")
	if err != nil {
		return dom
	}

	documentText, ranges, err := parseWPSDocumentComments(documentXML)
	if err != nil || len(ranges) == 0 {
		return dom
	}
	comments, err := parseWPSCommentTexts(commentsXML)
	if err != nil || len(comments) == 0 {
		return dom
	}
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(dom))
	if err != nil {
		return dom
	}
	htmlText, positions := wpsHTMLTextPositions(doc.Find("body").Get(0))
	if documentText != htmlText || documentText != normalizeWPSClipboardText(text) {
		return dom
	}

	nodeRanges := map[*nethtml.Node][]wpsNodeRange{}
	for _, commentRange := range ranges {
		memo := comments[commentRange.id]
		if memo == "" || commentRange.start < 0 || commentRange.start >= commentRange.end || len(positions) < commentRange.end {
			continue
		}
		start := positions[commentRange.start]
		end := positions[commentRange.end-1]
		if start.node != end.node {
			continue
		}
		nodeRanges[start.node] = append(nodeRanges[start.node], wpsNodeRange{
			start: start.offset,
			end:   end.offset + 1,
			memo:  memo,
		})
	}
	if len(nodeRanges) == 0 {
		return dom
	}
	var commentSpans []*nethtml.Node
	for node, ranges := range nodeRanges {
		commentSpans = append(commentSpans, wrapWPSCommentRanges(node, ranges)...)
	}
	for _, span := range commentSpans {
		liftWPSCommentSpan(span)
	}

	ret, err := doc.Find("body").Html()
	if err != nil {
		return dom
	}
	return ret
}

func readWPSClipboardFile(archive *archivezip.Reader, name string) ([]byte, error) {
	for _, file := range archive.File {
		if file.Name != name {
			continue
		}
		if file.UncompressedSize64 > maxWPSClipboardBytes {
			return nil, io.ErrUnexpectedEOF
		}
		reader, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		return io.ReadAll(io.LimitReader(reader, maxWPSClipboardBytes+1))
	}
	return nil, io.EOF
}

func parseWPSDocumentComments(data []byte) (string, []wpsCommentRange, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	starts := map[string]int{}
	var text []rune
	var ranges []wpsCommentRange
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", nil, err
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "commentRangeStart":
			starts[xmlAttribute(start.Attr, "id")] = len(text)
		case "commentRangeEnd":
			id := xmlAttribute(start.Attr, "id")
			if offset, exists := starts[id]; exists {
				ranges = append(ranges, wpsCommentRange{id: id, start: offset, end: len(text)})
			}
		case "t":
			var value string
			if err = decoder.DecodeElement(&value, &start); err != nil {
				return "", nil, err
			}
			text = appendNormalizedWPSRunes(text, value)
		}
	}
	return string(text), ranges, nil
}

func parseWPSCommentTexts(data []byte) (map[string]string, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	comments := map[string]string{}
	currentID := ""
	var text []rune
	paragraphHasText := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch element := token.(type) {
		case xml.StartElement:
			switch element.Name.Local {
			case "comment":
				currentID = xmlAttribute(element.Attr, "id")
				text = nil
				paragraphHasText = false
			case "p":
				if currentID != "" && paragraphHasText {
					text = append(text, '\n')
					paragraphHasText = false
				}
			case "t":
				if currentID == "" {
					continue
				}
				var value string
				if err = decoder.DecodeElement(&value, &element); err != nil {
					return nil, err
				}
				text = append(text, []rune(value)...)
				paragraphHasText = true
			}
		case xml.EndElement:
			if element.Name.Local == "comment" && currentID != "" {
				if value := strings.TrimSpace(string(text)); value != "" {
					comments[currentID] = value
				}
				currentID = ""
			}
		}
	}
	return comments, nil
}

func xmlAttribute(attributes []xml.Attr, name string) string {
	for _, attribute := range attributes {
		if attribute.Name.Local == name {
			return attribute.Value
		}
	}
	return ""
}

func normalizeWPSClipboardText(text string) string {
	return string(appendNormalizedWPSRunes(nil, text))
}

func appendNormalizedWPSRunes(dest []rune, text string) []rune {
	for _, char := range text {
		switch char {
		case '\r', '\n':
			continue
		case '\u00a0':
			char = ' '
		}
		dest = append(dest, char)
	}
	return dest
}

func wpsHTMLTextPositions(root *nethtml.Node) (string, []wpsHTMLChar) {
	if root == nil {
		return "", nil
	}
	var text []rune
	var positions []wpsHTMLChar
	var walk func(*nethtml.Node)
	walk = func(node *nethtml.Node) {
		if node.Type == nethtml.TextNode {
			for offset, char := range []rune(node.Data) {
				if char == '\r' || char == '\n' {
					continue
				}
				if char == '\u00a0' {
					char = ' '
				}
				text = append(text, char)
				positions = append(positions, wpsHTMLChar{node: node, offset: offset})
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(root)
	return string(text), positions
}

func wrapWPSCommentRanges(node *nethtml.Node, ranges []wpsNodeRange) (ret []*nethtml.Node) {
	if node.Parent == nil {
		return
	}
	sort.Slice(ranges, func(i, j int) bool {
		return ranges[i].start < ranges[j].start
	})
	text := []rune(node.Data)
	cursor := 0
	for _, commentRange := range ranges {
		if commentRange.start < cursor || len(text) < commentRange.end {
			continue
		}
		if cursor < commentRange.start {
			node.Parent.InsertBefore(&nethtml.Node{Type: nethtml.TextNode, Data: string(text[cursor:commentRange.start])}, node)
		}
		span := &nethtml.Node{
			Type:     nethtml.ElementNode,
			DataAtom: atom.Span,
			Data:     "span",
			Attr:     []nethtml.Attribute{{Key: "title", Val: commentRange.memo}},
		}
		span.AppendChild(&nethtml.Node{Type: nethtml.TextNode, Data: string(text[commentRange.start:commentRange.end])})
		node.Parent.InsertBefore(span, node)
		ret = append(ret, span)
		cursor = commentRange.end
	}
	if cursor == 0 {
		return
	}
	if cursor < len(text) {
		node.Parent.InsertBefore(&nethtml.Node{Type: nethtml.TextNode, Data: string(text[cursor:])}, node)
	}
	node.Parent.RemoveChild(node)
	return
}

func liftWPSCommentSpan(span *nethtml.Node) {
	for span.Parent != nil && (span.Parent.DataAtom == atom.Font || span.Parent.DataAtom == atom.Span) {
		parent := span.Parent
		grandparent := parent.Parent
		if grandparent == nil {
			return
		}
		before := cloneWPSInline(parent)
		for parent.FirstChild != span {
			child := parent.FirstChild
			parent.RemoveChild(child)
			before.AppendChild(child)
		}
		parent.RemoveChild(span)
		after := cloneWPSInline(parent)
		for parent.FirstChild != nil {
			child := parent.FirstChild
			parent.RemoveChild(child)
			after.AppendChild(child)
		}
		if before.FirstChild != nil {
			grandparent.InsertBefore(before, parent)
		}
		grandparent.InsertBefore(span, parent)
		if after.FirstChild != nil {
			grandparent.InsertBefore(after, parent)
		}
		grandparent.RemoveChild(parent)
	}
}

func cloneWPSInline(node *nethtml.Node) *nethtml.Node {
	return &nethtml.Node{
		Type:      node.Type,
		DataAtom:  node.DataAtom,
		Data:      node.Data,
		Namespace: node.Namespace,
		Attr:      append([]nethtml.Attribute(nil), node.Attr...),
	}
}
