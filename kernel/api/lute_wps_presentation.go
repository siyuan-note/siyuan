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
	stdhtml "html"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	maxWPSPresentationArchiveEntries   = 256
	maxWPSPresentationDrawingEntries   = 32
	maxWPSPresentationEntryBytes       = 8 * 1024 * 1024
	maxWPSPresentationDrawingBytes     = 4 * 1024 * 1024
	maxWPSPresentationUncompressed     = 32 * 1024 * 1024
	maxWPSPresentationXMLTokens        = 200000
	maxWPSPresentationXMLDepth         = 128
	maxWPSPresentationParagraphs       = 4096
	maxWPSPresentationTextBytes        = 1024 * 1024
	maxWPSPresentationOutputBytes      = 2 * 1024 * 1024
	maxWPSPresentationRequestBytes     = 13 * 1024 * 1024
	maxWPSPresentationOrderedListStart = 32767
	drawingMLNamespace                 = "http://schemas.openxmlformats.org/drawingml/2006/main"
	drawingMLStrictNamespace           = "http://purl.oclc.org/ooxml/drawingml/main"
	presentationMLNamespace            = "http://schemas.openxmlformats.org/presentationml/2006/main"
	presentationMLStrictNamespace      = "http://purl.oclc.org/ooxml/presentationml/main"
)

type wpsPresentationConversionResult struct {
	Converted bool   `json:"converted"`
	DOM       string `json:"dom"`
}

type wpsPresentationBulletKind uint8

const (
	wpsPresentationBulletNone wpsPresentationBulletKind = iota
	wpsPresentationBulletUnordered
	wpsPresentationBulletOrdered
	wpsPresentationBulletTask
)

type wpsPresentationBulletChoice struct {
	set      bool
	kind     wpsPresentationBulletKind
	char     string
	checked  bool
	numType  string
	start    int
	startSet bool
}

type wpsPresentationParagraphProperties struct {
	bullet  wpsPresentationBulletChoice
	font    string
	fontSet bool
}

type wpsPresentationParagraph struct {
	text       string
	textParts  []string
	level      int
	properties wpsPresentationParagraphProperties
}

type wpsPresentationContainer struct {
	defaultProperties wpsPresentationParagraphProperties
	levelProperties   [9]wpsPresentationParagraphProperties
	paragraphs        []wpsPresentationParagraph
}

type wpsPresentationParseLimits struct {
	paragraphs int
	textBytes  int
	tokens     int
}

type wpsPresentationDrawing struct {
	index int
	file  *archivezip.File
}

type wpsPresentationArchive struct {
	containers   []wpsPresentationContainer
	drawingCount int
	mixedObject  bool
}

type wpsPresentationDrawingContent struct {
	containers  []wpsPresentationContainer
	mixedObject bool
}

type wpsPresentationHTMLBlock struct {
	paragraph *string
	list      *wpsPresentationHTMLList
}

type wpsPresentationHTMLList struct {
	kind    wpsPresentationBulletKind
	numType string
	start   int
	next    int
	items   []*wpsPresentationHTMLListItem
}

type wpsPresentationHTMLListItem struct {
	text      string
	checked   bool
	plainMark string
	markSet   bool
	children  []*wpsPresentationHTMLList
}

type wpsPresentationListStackEntry struct {
	rawLevel int
	list     *wpsPresentationHTMLList
}

func wpsPresentation2BlockDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	result := &wpsPresentationConversionResult{}
	ret.Data = result
	defer c.JSON(http.StatusOK, ret)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxWPSPresentationRequestBytes)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var encoded, text, clipboardType string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("data", &encoded, true, true),
		util.BindJsonArg("text", &text, false, false),
		util.BindJsonArg("type", &clipboardType, true, true)) {
		return
	}
	if clipboardType != "texts" && clipboardType != "objects" {
		return
	}

	result.DOM, result.Converted = convertWPSPresentation(encoded, text, clipboardType)
}

func convertWPSPresentation(encoded, text, clipboardType string) (dom string, converted bool) {
	htmlContent, converted := wpsPresentationHTML(encoded, text, clipboardType)
	if !converted {
		return "", false
	}

	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	dom = luteEngine.HTML2BlockDOM(htmlContent)
	if dom == "" || len(dom) > maxWPSPresentationOutputBytes || !strings.Contains(dom, "data-node-id=") {
		return "", false
	}
	return dom, true
}

func wpsPresentationHTML(encoded, text, clipboardType string) (htmlContent string, converted bool) {
	if clipboardType != "texts" && clipboardType != "objects" {
		return "", false
	}
	if encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxWPSClipboardBytes) ||
		len(text) > maxWPSPresentationTextBytes {
		return "", false
	}

	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(data) == 0 || len(data) > maxWPSClipboardBytes {
		return "", false
	}
	archive, err := parseWPSPresentationArchive(data)
	if err != nil || len(archive.containers) == 0 {
		return "", false
	}
	if clipboardType == "objects" &&
		(archive.drawingCount != 1 || len(archive.containers) != 1 || archive.mixedObject) {
		return "", false
	}
	var blocks []wpsPresentationHTMLBlock
	convertedItems := 0
	for _, container := range archive.containers {
		containerBlocks, count := buildWPSPresentationHTMLBlocks(container)
		convertedItems += count
		blocks = append(blocks, containerBlocks...)
	}
	if convertedItems == 0 {
		return "", false
	}
	if clipboardType == "texts" && (text == "" || !wpsPresentationTextMatches(archive.containers, blocks, text)) {
		return "", false
	}

	var builder strings.Builder
	for _, block := range blocks {
		renderWPSPresentationHTMLBlock(&builder, block)
		if builder.Len() > maxWPSPresentationOutputBytes {
			return "", false
		}
	}
	return builder.String(), true
}

func parseWPSPresentationArchive(data []byte) (wpsPresentationArchive, error) {
	archive, err := archivezip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return wpsPresentationArchive{}, err
	}
	if len(archive.File) == 0 || len(archive.File) > maxWPSPresentationArchiveEntries {
		return wpsPresentationArchive{}, io.ErrUnexpectedEOF
	}

	var totalUncompressed uint64
	var drawings []wpsPresentationDrawing
	drawingIndexes := map[int]struct{}{}
	for _, file := range archive.File {
		if file.UncompressedSize64 > maxWPSPresentationEntryBytes ||
			totalUncompressed > maxWPSPresentationUncompressed-file.UncompressedSize64 {
			return wpsPresentationArchive{}, io.ErrUnexpectedEOF
		}
		totalUncompressed += file.UncompressedSize64

		index, ok := wpsPresentationDrawingIndex(file.Name)
		if !ok {
			continue
		}
		if file.UncompressedSize64 > maxWPSPresentationDrawingBytes || len(drawings) >= maxWPSPresentationDrawingEntries {
			return wpsPresentationArchive{}, io.ErrUnexpectedEOF
		}
		if _, exists := drawingIndexes[index]; exists {
			return wpsPresentationArchive{}, io.ErrUnexpectedEOF
		}
		drawingIndexes[index] = struct{}{}
		drawings = append(drawings, wpsPresentationDrawing{index: index, file: file})
	}
	if len(drawings) == 0 {
		return wpsPresentationArchive{}, io.EOF
	}
	sort.Slice(drawings, func(i, j int) bool {
		return drawings[i].index < drawings[j].index
	})

	limits := &wpsPresentationParseLimits{}
	var containers []wpsPresentationContainer
	mixedObject := false
	for _, drawing := range drawings {
		reader, openErr := drawing.file.Open()
		if openErr != nil {
			return wpsPresentationArchive{}, openErr
		}
		drawingXML, readErr := io.ReadAll(io.LimitReader(reader, maxWPSPresentationDrawingBytes+1))
		closeErr := reader.Close()
		if readErr != nil {
			return wpsPresentationArchive{}, readErr
		}
		if closeErr != nil {
			return wpsPresentationArchive{}, closeErr
		}
		if len(drawingXML) > maxWPSPresentationDrawingBytes {
			return wpsPresentationArchive{}, io.ErrUnexpectedEOF
		}
		parsed, parseErr := parseWPSPresentationDrawing(drawingXML, limits)
		if parseErr != nil {
			return wpsPresentationArchive{}, parseErr
		}
		containers = append(containers, parsed.containers...)
		mixedObject = mixedObject || parsed.mixedObject
	}
	return wpsPresentationArchive{containers: containers, drawingCount: len(drawings), mixedObject: mixedObject}, nil
}

func wpsPresentationDrawingIndex(name string) (int, bool) {
	const prefix = "clipboard/drawings/drawing"
	const suffix = ".xml"
	if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, suffix) {
		return 0, false
	}
	digits := name[len(prefix) : len(name)-len(suffix)]
	if digits == "" {
		return 0, false
	}
	for _, char := range digits {
		if char < '0' || '9' < char {
			return 0, false
		}
	}
	index, err := strconv.Atoi(digits)
	if err != nil {
		return 0, false
	}
	return index, true
}

func parseWPSPresentationDrawing(data []byte, limits *wpsPresentationParseLimits) (wpsPresentationDrawingContent, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var elementStack []xml.Name
	var containers []wpsPresentationContainer
	var container *wpsPresentationContainer
	containerDepth := -1
	lstStyleDepth := -1
	var paragraph *wpsPresentationParagraph
	paragraphDepth := -1
	var properties *wpsPresentationParagraphProperties
	propertiesDepth := -1
	textDepth := -1
	presentationShapeCount := 0
	drawingShapeCount := 0
	drawingTextShapeCount := 0
	mixedObject := false

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return wpsPresentationDrawingContent{}, err
		}
		limits.tokens++
		if limits.tokens > maxWPSPresentationXMLTokens {
			return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
		}

		switch element := token.(type) {
		case xml.StartElement:
			parent := xml.Name{}
			if 0 < len(elementStack) {
				parent = elementStack[len(elementStack)-1]
			}
			elementStack = append(elementStack, element.Name)
			depth := len(elementStack)
			if depth > maxWPSPresentationXMLDepth {
				return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
			}
			if textDepth != -1 {
				return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
			}

			if isPresentationMLElement(element.Name, "sp") {
				presentationShapeCount++
				mixedObject = mixedObject || 1 < presentationShapeCount
			} else if isDrawingMLElement(element.Name, "sp") {
				drawingShapeCount++
				mixedObject = mixedObject || 1 < drawingShapeCount
			} else if isDrawingMLElement(element.Name, "txSp") {
				drawingTextShapeCount++
				mixedObject = mixedObject || 1 < drawingTextShapeCount
			} else if isUnsupportedWPSPresentationObject(element.Name) {
				mixedObject = true
			}

			if isPresentationTextBody(element.Name) {
				if container != nil {
					return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
				}
				container = &wpsPresentationContainer{}
				containerDepth = depth
				continue
			}
			if container == nil || !isDrawingMLNamespace(element.Name.Space) {
				continue
			}

			switch element.Name.Local {
			case "lstStyle":
				if isPresentationTextBody(parent) {
					lstStyleDepth = depth
				}
			case "defPPr":
				if lstStyleDepth == depth-1 && isDrawingMLElement(parent, "lstStyle") {
					properties = &container.defaultProperties
					propertiesDepth = depth
				}
			case "p":
				if isPresentationTextBody(parent) {
					if paragraph != nil || limits.paragraphs >= maxWPSPresentationParagraphs {
						return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
					}
					paragraph = &wpsPresentationParagraph{}
					paragraphDepth = depth
					limits.paragraphs++
				}
			case "pPr":
				if paragraph != nil && paragraphDepth == depth-1 && isDrawingMLElement(parent, "p") {
					level, parseErr := wpsPresentationParagraphLevel(element.Attr)
					if parseErr != nil {
						return wpsPresentationDrawingContent{}, parseErr
					}
					paragraph.level = level
					properties = &paragraph.properties
					propertiesDepth = depth
				}
			case "buNone", "buChar", "buAutoNum", "buBlip":
				if properties != nil && propertiesDepth == depth-1 {
					if properties.bullet.set {
						return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
					}
					bullet, parseErr := parseWPSPresentationBullet(element)
					if parseErr != nil {
						return wpsPresentationDrawingContent{}, parseErr
					}
					properties.bullet = bullet
				}
			case "buFont":
				if properties != nil && propertiesDepth == depth-1 {
					font := strings.TrimSpace(wpsPresentationXMLAttribute(element.Attr, "typeface"))
					if font != "" {
						properties.font = font
						properties.fontSet = true
					}
				}
			case "buFontTx":
				if properties != nil && propertiesDepth == depth-1 {
					properties.font = ""
					properties.fontSet = true
				}
			case "t":
				if paragraph != nil {
					if textDepth != -1 {
						return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
					}
					textDepth = depth
				}
			case "br":
				if paragraph != nil && isDrawingMLElement(parent, "p") {
					if err = appendWPSPresentationText(paragraph, "\n", limits); err != nil {
						return wpsPresentationDrawingContent{}, err
					}
				}
			case "tab":
				if paragraph != nil {
					if err = appendWPSPresentationText(paragraph, "\t", limits); err != nil {
						return wpsPresentationDrawingContent{}, err
					}
				}
			default:
				if lstStyleDepth == depth-1 && isDrawingMLElement(parent, "lstStyle") {
					if level, ok := wpsPresentationStyleLevel(element.Name.Local); ok {
						properties = &container.levelProperties[level]
						propertiesDepth = depth
					}
				}
			}
		case xml.CharData:
			if paragraph != nil && textDepth != -1 {
				if err = appendWPSPresentationText(paragraph, string(element), limits); err != nil {
					return wpsPresentationDrawingContent{}, err
				}
			}
		case xml.EndElement:
			depth := len(elementStack)
			if depth == 0 || elementStack[depth-1] != element.Name {
				return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
			}
			if textDepth == depth && isDrawingMLElement(element.Name, "t") {
				textDepth = -1
			}
			if propertiesDepth == depth {
				properties = nil
				propertiesDepth = -1
			}
			if paragraphDepth == depth && isDrawingMLElement(element.Name, "p") {
				paragraph.text = strings.Join(paragraph.textParts, "")
				paragraph.textParts = nil
				container.paragraphs = append(container.paragraphs, *paragraph)
				paragraph = nil
				paragraphDepth = -1
			}
			if lstStyleDepth == depth && isDrawingMLElement(element.Name, "lstStyle") {
				lstStyleDepth = -1
			}
			if containerDepth == depth && isPresentationTextBody(element.Name) {
				containers = append(containers, *container)
				container = nil
				containerDepth = -1
			}
			elementStack = elementStack[:depth-1]
		case xml.Directive:
			return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
		case xml.ProcInst:
			if element.Target != "xml" || len(elementStack) != 0 {
				return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
			}
		}
	}
	if len(elementStack) != 0 || container != nil || paragraph != nil || textDepth != -1 {
		return wpsPresentationDrawingContent{}, io.ErrUnexpectedEOF
	}
	return wpsPresentationDrawingContent{containers: containers, mixedObject: mixedObject}, nil
}

func isDrawingMLNamespace(namespace string) bool {
	return namespace == drawingMLNamespace || namespace == drawingMLStrictNamespace
}

func isDrawingMLElement(name xml.Name, local string) bool {
	return name.Local == local && isDrawingMLNamespace(name.Space)
}

func isPresentationTextBody(name xml.Name) bool {
	return isPresentationMLElement(name, "txBody") || isDrawingMLElement(name, "txBody")
}

func isPresentationMLElement(name xml.Name, local string) bool {
	return name.Local == local && (name.Space == presentationMLNamespace || name.Space == presentationMLStrictNamespace)
}

func isUnsupportedWPSPresentationObject(name xml.Name) bool {
	switch name.Local {
	case "pic", "graphicFrame", "grpSp", "cxnSp", "contentPart":
		return isPresentationMLElement(name, name.Local) || isDrawingMLElement(name, name.Local)
	}
	return false
}

func wpsPresentationXMLAttribute(attributes []xml.Attr, name string) string {
	for _, attribute := range attributes {
		if attribute.Name.Space == "" && attribute.Name.Local == name {
			return attribute.Value
		}
	}
	return ""
}

func wpsPresentationParagraphLevel(attributes []xml.Attr) (int, error) {
	value := wpsPresentationXMLAttribute(attributes, "lvl")
	if value == "" {
		return 0, nil
	}
	level, err := strconv.Atoi(value)
	if err != nil || level < 0 || 8 < level {
		return 0, io.ErrUnexpectedEOF
	}
	return level, nil
}

func wpsPresentationStyleLevel(name string) (int, bool) {
	if !strings.HasPrefix(name, "lvl") || !strings.HasSuffix(name, "pPr") {
		return 0, false
	}
	value := name[len("lvl") : len(name)-len("pPr")]
	level, err := strconv.Atoi(value)
	if err != nil || level < 1 || 9 < level {
		return 0, false
	}
	return level - 1, true
}

func parseWPSPresentationBullet(element xml.StartElement) (wpsPresentationBulletChoice, error) {
	bullet := wpsPresentationBulletChoice{set: true}
	switch element.Name.Local {
	case "buNone":
		bullet.kind = wpsPresentationBulletNone
	case "buChar":
		char := wpsPresentationXMLAttribute(element.Attr, "char")
		if char == "" {
			return wpsPresentationBulletChoice{}, io.ErrUnexpectedEOF
		}
		bullet.kind = wpsPresentationBulletUnordered
		bullet.char = char
	case "buAutoNum":
		bullet.kind = wpsPresentationBulletOrdered
		bullet.numType = strings.TrimSpace(wpsPresentationXMLAttribute(element.Attr, "type"))
		if value := wpsPresentationXMLAttribute(element.Attr, "startAt"); value != "" {
			start, err := strconv.Atoi(value)
			if err != nil || start < 1 || maxWPSPresentationOrderedListStart < start {
				return wpsPresentationBulletChoice{}, io.ErrUnexpectedEOF
			}
			bullet.start = start
			bullet.startSet = true
		}
	case "buBlip":
		bullet.kind = wpsPresentationBulletUnordered
	default:
		return wpsPresentationBulletChoice{}, io.ErrUnexpectedEOF
	}
	return bullet, nil
}

func appendWPSPresentationText(paragraph *wpsPresentationParagraph, value string, limits *wpsPresentationParseLimits) error {
	if len(value) > maxWPSPresentationTextBytes-limits.textBytes {
		return io.ErrUnexpectedEOF
	}
	limits.textBytes += len(value)
	paragraph.textParts = append(paragraph.textParts, value)
	return nil
}

func wpsPresentationNormalizedText(containers []wpsPresentationContainer) string {
	var builder strings.Builder
	for _, container := range containers {
		for _, paragraph := range container.paragraphs {
			builder.WriteString(paragraph.text)
		}
	}
	return normalizeWPSClipboardText(builder.String())
}

func wpsPresentationTextMatches(containers []wpsPresentationContainer, blocks []wpsPresentationHTMLBlock, text string) bool {
	normalized := normalizeWPSClipboardText(text)
	if wpsPresentationNormalizedText(containers) == normalized {
		return true
	}
	for _, separator := range []string{"", " ", "\t"} {
		var builder strings.Builder
		valid := true
		for _, block := range blocks {
			if !appendWPSPresentationPlainText(&builder, block, separator) {
				valid = false
				break
			}
		}
		if valid && normalizeWPSClipboardText(builder.String()) == normalized {
			return true
		}
	}
	return false
}

func appendWPSPresentationPlainText(builder *strings.Builder, block wpsPresentationHTMLBlock, separator string) bool {
	if block.paragraph != nil {
		builder.WriteString(*block.paragraph)
		return true
	}
	if block.list == nil {
		return true
	}
	for _, item := range block.list.items {
		if block.list.kind == wpsPresentationBulletOrdered {
			if !item.markSet {
				return false
			}
			builder.WriteString(item.plainMark)
			builder.WriteString(separator)
		}
		builder.WriteString(item.text)
		for _, child := range item.children {
			if !appendWPSPresentationPlainText(builder, wpsPresentationHTMLBlock{list: child}, separator) {
				return false
			}
		}
	}
	return true
}

func wpsPresentationAutoNumberMarker(numType string, ordinal int) (string, bool) {
	var suffix string
	for _, candidate := range []string{"ParenBoth", "ParenR", "Period", "Plain"} {
		if strings.HasSuffix(numType, candidate) {
			suffix = candidate
			numType = strings.TrimSuffix(numType, candidate)
			break
		}
	}
	if suffix == "" {
		return "", false
	}

	var value string
	switch numType {
	case "arabic":
		value = strconv.Itoa(ordinal)
	case "alphaLc", "alphaUc":
		value = wpsPresentationAlphabeticNumber(ordinal)
		if numType == "alphaLc" {
			value = strings.ToLower(value)
		}
	case "romanLc", "romanUc":
		value = wpsPresentationRomanNumber(ordinal)
		if numType == "romanLc" {
			value = strings.ToLower(value)
		}
	default:
		return "", false
	}
	if value == "" {
		return "", false
	}

	switch suffix {
	case "ParenBoth":
		return "(" + value + ")", true
	case "ParenR":
		return value + ")", true
	case "Period":
		return value + ".", true
	case "Plain":
		return value, true
	}
	return "", false
}

func wpsPresentationAlphabeticNumber(ordinal int) string {
	if ordinal < 1 {
		return ""
	}
	var reversed []byte
	for 0 < ordinal {
		ordinal--
		reversed = append(reversed, byte('A'+ordinal%26))
		ordinal /= 26
	}
	for left, right := 0, len(reversed)-1; left < right; left, right = left+1, right-1 {
		reversed[left], reversed[right] = reversed[right], reversed[left]
	}
	return string(reversed)
}

func wpsPresentationRomanNumber(ordinal int) string {
	if ordinal < 1 {
		return ""
	}
	values := []struct {
		value  int
		symbol string
	}{
		{1000, "M"}, {900, "CM"}, {500, "D"}, {400, "CD"},
		{100, "C"}, {90, "XC"}, {50, "L"}, {40, "XL"},
		{10, "X"}, {9, "IX"}, {5, "V"}, {4, "IV"}, {1, "I"},
	}
	var builder strings.Builder
	for _, item := range values {
		for item.value <= ordinal {
			builder.WriteString(item.symbol)
			ordinal -= item.value
		}
	}
	return builder.String()
}

func resolveWPSPresentationBullet(container wpsPresentationContainer, paragraph wpsPresentationParagraph) wpsPresentationBulletChoice {
	properties := []wpsPresentationParagraphProperties{
		paragraph.properties,
		container.levelProperties[paragraph.level],
		container.defaultProperties,
	}
	bullet := wpsPresentationBulletChoice{}
	font := ""
	fontResolved := false
	for _, candidate := range properties {
		if !bullet.set && candidate.bullet.set {
			bullet = candidate.bullet
		}
		if !fontResolved && candidate.fontSet {
			font = candidate.font
			fontResolved = true
		}
	}
	if !bullet.set {
		bullet = wpsPresentationBulletChoice{set: true, kind: wpsPresentationBulletNone}
	}
	if bullet.kind == wpsPresentationBulletUnordered {
		if checked, task := wpsPresentationTaskMarker(bullet.char, font); task {
			bullet.kind = wpsPresentationBulletTask
			bullet.checked = checked
		}
	}
	return bullet
}

func wpsPresentationTaskMarker(char, font string) (checked, task bool) {
	if char == "" {
		return false, false
	}
	runes := []rune(char)
	if len(runes) != 1 {
		return false, false
	}
	marker := runes[0]
	switch marker {
	case '\u25a1', '\u2610':
		return false, true
	case '\u2714', '\u2713', '\u2611', '\u2612':
		return true, true
	}

	font = strings.TrimSpace(font)
	if strings.EqualFold(font, "Wingdings 2") {
		switch marker {
		case '\u00a3', '\uf0a3':
			return false, true
		case 'P', '\uf050', 'R', '\uf052':
			return true, true
		}
	}
	if strings.EqualFold(font, "Wingdings") {
		switch marker {
		case 'p', '\uf070', 'q', '\uf071':
			return false, true
		case '\u00fc', '\uf0fc':
			return true, true
		}
	}
	return false, false
}

func buildWPSPresentationHTMLBlocks(container wpsPresentationContainer) ([]wpsPresentationHTMLBlock, int) {
	paragraphs := container.paragraphs
	for 0 < len(paragraphs) && strings.TrimSpace(paragraphs[len(paragraphs)-1].text) == "" {
		paragraphs = paragraphs[:len(paragraphs)-1]
	}

	var blocks []wpsPresentationHTMLBlock
	var stack []wpsPresentationListStackEntry
	convertedItems := 0
	for _, paragraph := range paragraphs {
		if strings.TrimSpace(paragraph.text) == "" && !paragraph.properties.bullet.set {
			text := ""
			blocks = append(blocks, wpsPresentationHTMLBlock{paragraph: &text})
			stack = nil
			continue
		}
		bullet := resolveWPSPresentationBullet(container, paragraph)
		if bullet.kind == wpsPresentationBulletNone {
			text := paragraph.text
			blocks = append(blocks, wpsPresentationHTMLBlock{paragraph: &text})
			stack = nil
			continue
		}

		for 0 < len(stack) && paragraph.level < stack[len(stack)-1].rawLevel {
			if len(stack) == 1 {
				stack[0].rawLevel = paragraph.level
				break
			}
			if 1 < len(stack) && stack[len(stack)-2].rawLevel < paragraph.level {
				stack[len(stack)-1].rawLevel = paragraph.level
				break
			}
			stack = stack[:len(stack)-1]
		}
		if 0 < len(stack) && stack[len(stack)-1].rawLevel == paragraph.level &&
			!canContinueWPSPresentationList(stack[len(stack)-1].list, bullet, paragraph.properties.bullet.startSet) {
			stack = stack[:len(stack)-1]
		}

		var list *wpsPresentationHTMLList
		if 0 < len(stack) && stack[len(stack)-1].rawLevel == paragraph.level {
			list = stack[len(stack)-1].list
		} else {
			start := 1
			if bullet.startSet {
				start = bullet.start
			}
			list = &wpsPresentationHTMLList{kind: bullet.kind, numType: bullet.numType, start: start, next: start}
			if len(stack) == 0 {
				blocks = append(blocks, wpsPresentationHTMLBlock{list: list})
			} else {
				parentItems := stack[len(stack)-1].list.items
				if len(parentItems) == 0 {
					text := paragraph.text
					blocks = append(blocks, wpsPresentationHTMLBlock{paragraph: &text})
					stack = nil
					continue
				}
				parent := parentItems[len(parentItems)-1]
				parent.children = append(parent.children, list)
			}
			stack = append(stack, wpsPresentationListStackEntry{rawLevel: paragraph.level, list: list})
		}

		item := &wpsPresentationHTMLListItem{text: paragraph.text, checked: bullet.checked}
		if list.kind == wpsPresentationBulletOrdered {
			item.plainMark, item.markSet = wpsPresentationAutoNumberMarker(list.numType, list.next)
		}
		list.items = append(list.items, item)
		list.next++
		convertedItems++
	}
	return blocks, convertedItems
}

func canContinueWPSPresentationList(list *wpsPresentationHTMLList, bullet wpsPresentationBulletChoice, paragraphStartSet bool) bool {
	if list.kind != bullet.kind {
		return false
	}
	if bullet.kind == wpsPresentationBulletOrdered && list.numType != bullet.numType {
		return false
	}
	return bullet.kind != wpsPresentationBulletOrdered || !paragraphStartSet || bullet.start == list.next
}

func renderWPSPresentationHTMLBlock(builder *strings.Builder, block wpsPresentationHTMLBlock) {
	if block.paragraph != nil {
		builder.WriteString("<p>")
		if *block.paragraph == "" {
			builder.WriteString("<br>")
		} else {
			renderWPSPresentationText(builder, *block.paragraph)
		}
		builder.WriteString("</p>")
		return
	}
	if block.list != nil {
		renderWPSPresentationHTMLList(builder, block.list)
	}
}

func renderWPSPresentationHTMLList(builder *strings.Builder, list *wpsPresentationHTMLList) {
	tag := "ul"
	if list.kind == wpsPresentationBulletOrdered {
		tag = "ol"
	}
	builder.WriteByte('<')
	builder.WriteString(tag)
	if tag == "ol" && list.start != 1 {
		builder.WriteString(` start="`)
		builder.WriteString(strconv.Itoa(list.start))
		builder.WriteByte('"')
	}
	builder.WriteByte('>')
	for _, item := range list.items {
		builder.WriteString("<li>")
		if list.kind == wpsPresentationBulletTask {
			builder.WriteString(`<input type="checkbox"`)
			if item.checked {
				builder.WriteString(" checked")
			}
			builder.WriteByte('>')
		}
		renderWPSPresentationText(builder, item.text)
		for _, child := range item.children {
			renderWPSPresentationHTMLList(builder, child)
		}
		builder.WriteString("</li>")
	}
	builder.WriteString("</")
	builder.WriteString(tag)
	builder.WriteByte('>')
}

func renderWPSPresentationText(builder *strings.Builder, text string) {
	parts := strings.Split(text, "\n")
	for index, part := range parts {
		if 0 < index {
			builder.WriteString("<br>")
		}
		builder.WriteString(stdhtml.EscapeString(part))
	}
}
