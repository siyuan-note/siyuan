// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"testing"
	"unicode/utf16"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestOfficeClipboardMalformedCFBFallback(t *testing.T) {
	for _, test := range []struct {
		name           string
		version, shift uint16
		count          uint32
	}{{"v3", 3, 9, 3720050413}, {"v4", 4, 12, 1188148333}} {
		t.Run(test.name, func(t *testing.T) {
			data := make([]byte, 512)
			copy(data, officeCompoundFileSignature)
			binary.LittleEndian.PutUint16(data[26:], test.version)
			binary.LittleEndian.PutUint16(data[30:], test.shift)
			binary.LittleEndian.PutUint32(data[72:], test.count)
			office := base64.StdEncoding.EncodeToString(data)
			from, input, ok := officeClipboardMathInput(office)
			if ok || from != "" || input != nil {
				t.Fatalf("invalid CFB accepted: from=%q input=%v ok=%v", from, input, ok)
			}
			mathML := `<math><mi>x</mi></math>`
			called := false
			markdown, converted, err := convertClipboardMathWithRunner(mathML, office, "", func(from, to string, input []byte) ([]byte, error) {
				called = true
				if from != "html" || to != "json" || string(input) != mathML {
					t.Fatalf("MathML fallback lost: from=%q to=%q input=%q", from, to, input)
				}
				return []byte(inlineMathPandocJSON), nil
			})
			if err != nil || !called || !converted || markdown != "$x+y$" {
				t.Fatalf("MathML conversion failed: markdown=%q converted=%v called=%v err=%v", markdown, converted, called, err)
			}
			dom := `<p>preserved text</p>`
			got, useHTML := resolveHTMLClipboardContent(util.NewLute(), dom, "", office, "", "", func(mathML, office, wps string) (string, bool) {
				markdown, converted, err := convertClipboardMathWithRunner(mathML, office, wps, func(string, string, []byte) ([]byte, error) {
					t.Fatal("invalid CFB must not invoke pandoc")
					return nil, nil
				})
				if err != nil {
					t.Fatal(err)
				}
				return markdown, converted
			}, func(string) (string, bool) { return "", false })
			if !useHTML || got != dom {
				t.Fatalf("HTML fallback lost: dom=%q useHTML=%v", got, useHTML)
			}
		})
	}
}

func TestOfficeClipboardValidCFBPackage(t *testing.T) {
	docx, ok := buildClipboardMathDOCX(`<w:document xmlns:w="urn:w" xmlns:m="urn:m"><w:body><m:oMath/></w:body></w:document>`)
	if !ok || len(docx) > 4096 {
		t.Fatal("cannot build bounded DOCX fixture")
	}
	stream := make([]byte, 4096)
	copy(stream, docx)
	data := make([]byte, 512+10*512)
	copy(data, officeCompoundFileSignature)
	put16 := func(offset int, value uint16) { binary.LittleEndian.PutUint16(data[offset:], value) }
	put32 := func(offset int, value uint32) { binary.LittleEndian.PutUint32(data[offset:], value) }
	put16(24, 0x3e)
	put16(26, 3)
	put16(28, 0xfffe)
	put16(30, 9)
	put16(32, 6)
	put32(44, 1)
	put32(48, 1)
	put32(56, 4096)
	put32(60, 0xfffffffe)
	put32(68, 0xfffffffe)
	for i := 76; i < 512; i += 4 {
		put32(i, 0xffffffff)
	}
	put32(76, 0)
	for i := 512; i < 1024; i += 4 {
		put32(i, 0xffffffff)
	}
	put32(512, 0xfffffffd)
	put32(516, 0xfffffffe)
	for sector := 2; sector < 9; sector++ {
		put32(512+sector*4, uint32(sector+1))
	}
	put32(512+9*4, 0xfffffffe)
	entry := func(offset int, name string, kind byte, child, start uint32, size uint64) {
		encoded := utf16.Encode([]rune(name + "\x00"))
		for i, value := range encoded {
			put16(offset+i*2, value)
		}
		put16(offset+64, uint16(len(encoded)*2))
		data[offset+66], data[offset+67] = kind, 1
		put32(offset+68, 0xffffffff)
		put32(offset+72, 0xffffffff)
		put32(offset+76, child)
		put32(offset+116, start)
		binary.LittleEndian.PutUint64(data[offset+120:], size)
	}
	entry(1024, "Root Entry", 5, 1, 0xfffffffe, 0)
	entry(1152, "Package", 2, 0xffffffff, 2, uint64(len(stream)))
	copy(data[1536:], stream)
	office := base64.StdEncoding.EncodeToString(data)
	from, input, ok := officeClipboardMathInput(office)
	if !ok || from != "docx" || !bytes.Equal(input, stream) {
		t.Fatalf("valid Package rejected: from=%q bytes=%d ok=%v", from, len(input), ok)
	}
	called := false
	markdown, converted, err := convertClipboardMathWithRunner("", office, "", func(from, to string, input []byte) ([]byte, error) {
		called = true
		if from != "docx" || to != "json" || !bytes.Equal(input, stream) {
			t.Fatal("Office package changed before conversion")
		}
		return []byte(inlineMathPandocJSON), nil
	})
	if err != nil || !called || !converted || markdown != "$x+y$" {
		t.Fatalf("valid Office conversion failed: markdown=%q converted=%v called=%v err=%v", markdown, converted, called, err)
	}
}
