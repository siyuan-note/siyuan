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
	"context"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"os/exec"
	"strings"
	"time"
	"unicode"

	"github.com/88250/gulu"
	"github.com/richardlehane/mscfb"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	maxClipboardMathMLBytes      = 1024 * 1024
	maxClipboardMathPandocOutput = 2 * 1024 * 1024
	clipboardMathPandocTimeout   = 5 * time.Second
	officeCompoundFileSignature  = "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
)

const (
	officeHTMLOMMLNamespace = "http://schemas.microsoft.com/office/2004/12/omml"
	docxOMMLNamespace       = "http://schemas.openxmlformats.org/officeDocument/2006/math"
)

type clipboardMath struct {
	tex     string
	display bool
}

type pandocNode struct {
	typeName string
	content  json.RawMessage
}

func (node *pandocNode) UnmarshalJSON(data []byte) error {
	var value struct {
		TypeName string          `json:"t"`
		Content  json.RawMessage `json:"c"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	node.typeName = value.TypeName
	node.content = value.Content
	return nil
}

type clipboardMathPandocRunner func(from, to string, input []byte) ([]byte, error)

func convertClipboardMath(mathML, office, wps string) (markdown string, converted bool) {
	markdown, converted, err := convertClipboardMathWithRunner(mathML, office, wps, runClipboardMathPandoc)
	if err != nil {
		logging.LogWarnf("convert clipboard math with pandoc failed: %s", err)
	}
	return
}

func convertOfficeHTMLClipboardMath(officeMathHTML string) (markdown string, converted bool) {
	input, ok := officeHTMLClipboardMathInput(officeMathHTML)
	if !ok {
		return
	}
	markdown, converted, err := convertClipboardMathWithRunner("", "", base64.StdEncoding.EncodeToString(input), runClipboardMathPandoc)
	if err != nil {
		logging.LogWarnf("convert Office HTML clipboard math with pandoc failed: %s", err)
	}
	return markdown, converted
}

func convertClipboardMathWithRunner(mathML, office, wps string, runner clipboardMathPandocRunner) (markdown string, converted bool, err error) {
	from, input, ok := clipboardMathPandocInput(mathML, office, wps)
	if !ok {
		return
	}
	output, err := runner(from, "json", input)
	if err != nil {
		return "", false, err
	}
	if len(output) > maxClipboardMathPandocOutput {
		return "", false, fmt.Errorf("pandoc output is too large")
	}
	math, ok := parsePandocSingleMath(output)
	if !ok {
		if from != "docx" || !isSimplePandocMathDocument(output) {
			return "", false, nil
		}
		markdownOutput, writeErr := runner("json", "markdown-raw_attribute", output)
		if writeErr != nil {
			return "", false, writeErr
		}
		if len(markdownOutput) > maxClipboardMathPandocOutput {
			return "", false, fmt.Errorf("pandoc output is too large")
		}
		markdown = strings.TrimSpace(strings.ReplaceAll(string(markdownOutput), "<!-- -->", ""))
		return markdown, markdown != "", nil
	}
	if math.display {
		return "$$\n" + math.tex + "\n$$", true, nil
	}
	return "$" + math.tex + "$", true, nil
}

func clipboardMathPandocInput(mathML, office, wps string) (from string, input []byte, ok bool) {
	if from, input, ok = wpsClipboardMathInput(wps); ok {
		return
	}
	if from, input, ok = officeClipboardMathInput(office); ok {
		return
	}
	if normalized, valid := normalizeClipboardMathML(mathML); valid {
		return "html", []byte(normalized), true
	}
	return
}

func normalizeClipboardMathML(mathML string) (normalized string, ok bool) {
	if len(mathML) == 0 || len(mathML) > maxClipboardMathMLBytes {
		return
	}
	normalized = strings.TrimFunc(mathML, func(r rune) bool {
		return unicode.IsSpace(r) || r == '\u0000' || r == '\uFEFF'
	})
	decoder := xml.NewDecoder(strings.NewReader(normalized))
	for {
		token, err := decoder.Token()
		if err != nil {
			return "", false
		}
		if start, isStart := token.(xml.StartElement); isStart {
			return normalized, start.Name.Local == "math"
		}
	}
}

func wpsClipboardMathInput(encoded string) (from string, input []byte, ok bool) {
	if encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxWPSClipboardBytes) {
		return
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) > maxWPSClipboardBytes {
		return
	}
	if !isClipboardMathDOCX(data) {
		return
	}
	return "docx", data, true
}

func officeClipboardMathInput(encoded string) (from string, input []byte, ok bool) {
	if encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxWPSClipboardBytes) {
		return
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) > maxWPSClipboardBytes ||
		!bytes.HasPrefix(data, []byte(officeCompoundFileSignature)) {
		return
	}
	compoundFile, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		return
	}
	for entry, nextErr := compoundFile.Next(); nextErr == nil; entry, nextErr = compoundFile.Next() {
		if !strings.EqualFold(entry.Name, "Package") || entry.Size <= 0 || entry.Size > maxWPSClipboardBytes {
			continue
		}
		packageData, readErr := io.ReadAll(io.LimitReader(entry, maxWPSClipboardBytes+1))
		if readErr != nil || len(packageData) > maxWPSClipboardBytes || !isClipboardMathDOCX(packageData) {
			return
		}
		return "docx", packageData, true
	}
	return
}

func officeHTMLClipboardMathInput(fragment string) (input []byte, ok bool) {
	if fragment == "" || len(fragment) > maxClipboardMathMLBytes {
		return
	}
	documentBody, ok := normalizeOfficeHTMLOMML(fragment)
	if !ok {
		return nil, false
	}
	documentXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="` + docxOMMLNamespace + `"><w:body>` +
		documentBody + `<w:sectPr/></w:body></w:document>`
	return buildClipboardMathDOCX(documentXML)
}

func normalizeOfficeHTMLOMML(fragment string) (normalized string, ok bool) {
	decoder := xml.NewDecoder(strings.NewReader(`<root xmlns:m="` + officeHTMLOMMLNamespace + `">` + fragment + `</root>`))
	decoder.Entity = map[string]string{"nbsp": "\u00a0"}
	var builder strings.Builder
	var mathStack []string
	rootCount := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", false
		}
		switch value := token.(type) {
		case xml.StartElement:
			if value.Name.Space != officeHTMLOMMLNamespace && value.Name.Space != docxOMMLNamespace {
				continue
			}
			if len(mathStack) == 0 {
				if value.Name.Local != "oMathPara" && value.Name.Local != "oMath" {
					continue
				}
				rootCount++
				builder.WriteString("<w:p>")
			}
			mathStack = append(mathStack, value.Name.Local)
			builder.WriteString("<m:" + value.Name.Local)
			for _, attr := range value.Attr {
				if attr.Name.Space == officeHTMLOMMLNamespace || attr.Name.Space == docxOMMLNamespace {
					builder.WriteString(` m:` + attr.Name.Local + `="` + html.EscapeString(attr.Value) + `"`)
				} else if attr.Name.Space == "http://www.w3.org/XML/1998/namespace" {
					builder.WriteString(` xml:` + attr.Name.Local + `="` + html.EscapeString(attr.Value) + `"`)
				}
			}
			builder.WriteByte('>')
		case xml.EndElement:
			if value.Name.Space != officeHTMLOMMLNamespace && value.Name.Space != docxOMMLNamespace || len(mathStack) == 0 {
				continue
			}
			localName := mathStack[len(mathStack)-1]
			if localName != value.Name.Local {
				return "", false
			}
			builder.WriteString("</m:" + localName + ">")
			mathStack = mathStack[:len(mathStack)-1]
			if len(mathStack) == 0 {
				builder.WriteString("</w:p>")
			}
		case xml.CharData:
			if len(mathStack) == 0 {
				continue
			}
			content := strings.ReplaceAll(string(value), "\u00a0", " ")
			if mathStack[len(mathStack)-1] == "t" {
				builder.WriteString(html.EscapeString(content))
			} else if mathStack[len(mathStack)-1] == "r" && strings.TrimSpace(content) != "" {
				builder.WriteString(`<m:t xml:space="preserve">` + html.EscapeString(content) + `</m:t>`)
			}
		}
	}
	return builder.String(), rootCount > 0 && len(mathStack) == 0
}

func buildClipboardMathDOCX(documentXML string) (data []byte, ok bool) {
	var buffer bytes.Buffer
	writer := archivezip.NewWriter(&buffer)
	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>` +
			`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>` +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml": documentXML,
	}
	for name, content := range files {
		file, err := writer.Create(name)
		if err != nil {
			return nil, false
		}
		if _, err = file.Write([]byte(content)); err != nil {
			return nil, false
		}
	}
	if err := writer.Close(); err != nil {
		return nil, false
	}
	return buffer.Bytes(), true
}

func isClipboardMathDOCX(data []byte) bool {
	archive, err := archivezip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return false
	}
	var totalUncompressed uint64
	for _, file := range archive.File {
		if file.UncompressedSize64 > maxWPSClipboardBytes ||
			totalUncompressed > maxWPSClipboardBytes-file.UncompressedSize64 {
			return false
		}
		totalUncompressed += file.UncompressedSize64
	}
	documentXML, err := readWPSClipboardFile(archive, "word/document.xml")
	if err != nil || !bytes.Contains(documentXML, []byte("<m:oMath")) {
		return false
	}
	return true
}

func runClipboardMathPandoc(from, to string, input []byte) ([]byte, error) {
	pandocBinPath := util.GetPandocRuntime().BinPath
	if pandocBinPath == "" {
		return nil, util.ErrPandocNotFound
	}
	ctx, cancel := context.WithTimeout(context.Background(), clipboardMathPandocTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, pandocBinPath, "--from="+from, "--to="+to, "--wrap=none")
	gulu.CmdAttr(command)
	command.Stdin = bytes.NewReader(input)
	output, err := command.Output()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, err
	}
	return output, nil
}

func isSimplePandocMathDocument(data []byte) bool {
	var document struct {
		Blocks []pandocNode `json:"blocks"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return false
	}
	hasMath := false
	for _, block := range document.Blocks {
		switch block.typeName {
		case "Null":
			continue
		case "Para", "Plain":
			var inlines []pandocNode
			if len(block.content) == 0 || bytes.Equal(bytes.TrimSpace(block.content), []byte("null")) {
				continue
			}
			if err := json.Unmarshal(block.content, &inlines); err != nil {
				return false
			}
			meaningfulCount := 0
			displayMath := false
			for _, inline := range inlines {
				switch inline.typeName {
				case "Math":
					math, valid := parsePandocMath(inline.content)
					if !valid {
						return false
					}
					hasMath = true
					displayMath = displayMath || math.display
					meaningfulCount++
				case "Str":
					if !isIgnorablePandocInline(inline) {
						meaningfulCount++
					}
				case "Space", "SoftBreak", "LineBreak":
				default:
					return false
				}
			}
			if displayMath && meaningfulCount != 1 {
				return false
			}
		default:
			return false
		}
	}
	return hasMath
}

func parsePandocSingleMath(data []byte) (ret clipboardMath, ok bool) {
	var document struct {
		Blocks []pandocNode `json:"blocks"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return
	}
	found := false
	for _, block := range document.Blocks {
		switch block.typeName {
		case "Null":
			continue
		case "Para", "Plain":
			var inlines []pandocNode
			if len(block.content) == 0 || bytes.Equal(bytes.TrimSpace(block.content), []byte("null")) {
				continue
			}
			if err := json.Unmarshal(block.content, &inlines); err != nil {
				return clipboardMath{}, false
			}
			for _, inline := range inlines {
				if inline.typeName == "Math" {
					if found {
						return clipboardMath{}, false
					}
					math, valid := parsePandocMath(inline.content)
					if !valid {
						return clipboardMath{}, false
					}
					ret = math
					found = true
					continue
				}
				if !isIgnorablePandocInline(inline) {
					return clipboardMath{}, false
				}
			}
		default:
			return clipboardMath{}, false
		}
	}
	return ret, found
}

func parsePandocMath(content json.RawMessage) (ret clipboardMath, ok bool) {
	var parts []json.RawMessage
	if err := json.Unmarshal(content, &parts); err != nil || len(parts) != 2 {
		return
	}
	var mathType pandocNode
	if err := json.Unmarshal(parts[0], &mathType); err != nil {
		return
	}
	if mathType.typeName != "InlineMath" && mathType.typeName != "DisplayMath" {
		return
	}
	if err := json.Unmarshal(parts[1], &ret.tex); err != nil {
		return clipboardMath{}, false
	}
	ret.tex = strings.TrimSpace(ret.tex)
	if ret.tex == "" {
		return clipboardMath{}, false
	}
	ret.display = mathType.typeName == "DisplayMath"
	return ret, true
}

func isIgnorablePandocInline(inline pandocNode) bool {
	switch inline.typeName {
	case "Space", "SoftBreak", "LineBreak":
		return true
	case "Str":
		var text string
		if err := json.Unmarshal(inline.content, &text); err != nil {
			return false
		}
		return strings.TrimFunc(text, func(r rune) bool {
			return unicode.IsSpace(r) || r == '\u200B' || r == '\uFEFF'
		}) == ""
	default:
		return false
	}
}
