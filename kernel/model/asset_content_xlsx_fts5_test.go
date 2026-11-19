// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"html"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/xuri/excelize/v2"
)

func buildXlsxAssetTestWorkbook(t *testing.T, sheet, shared string) []byte {
	t.Helper()
	parts := map[string]string{
		"[Content_Types].xml":        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
		"_rels/.rels":                `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml":            `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
		"xl/worksheets/sheet1.xml":   `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` + sheet + `</sheetData></worksheet>`,
		"xl/sharedStrings.xml":       `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>` + shared + `</t></si></sst>`,
	}
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, data := range parts {
		part, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestXlsxAssetContentNormalIndex(t *testing.T) {
	if !assetContentTestChild(t) {
		return
	}
	dir := setupAssetContentRegression(t)
	sheet := `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c><c r="C1" t="b"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>second   row</t></is></c><c r="B3"><f>SUM(1,2)</f><v>3</v></c></row>`
	data := buildXlsxAssetTestWorkbook(t, sheet, "中文 needle &amp; text")
	path := filepath.Join(dir, "normal.xlsx")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	parsed := (&XlsxAssetParser{}).Parse(path)
	want := "中文 needle & text 42 TRUE second row 3"
	if parsed == nil || parsed.Content != want {
		t.Fatalf("content = %+v; want %q", parsed, want)
	}
	indexAssetContent(path)
	if err := sql.FlushAssetContentQueue(); err != nil {
		t.Fatal(err)
	}
	indexed := GetAssetContentByPath("assets/normal.xlsx")
	if indexed == nil || indexed.Content != html.EscapeString(want) {
		t.Fatalf("indexed = %+v", indexed)
	}
	if actual, err := os.ReadFile(path); err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("source changed: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(util.TempDir, "convert", "asset_content"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("temporary files not cleaned: %v %v", entries, err)
	}
}

func TestXlsxAssetContentMalformedCompoundFileDoesNotAbortIndex(t *testing.T) {
	oldTemp, oldData := util.TempDir, util.DataDir
	util.TempDir, util.DataDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.TempDir, util.DataDir = oldTemp, oldData })
	dir := util.GetDataAssetsAbsPath()
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	bad := malformedXlsxCompoundFile(9)
	if err := os.WriteFile(filepath.Join(dir, "000-bad.xlsx"), bad, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "001-good.txt"), []byte("healthyneedle"), 0600); err != nil {
		t.Fatal(err)
	}
	valid := buildXlsxAssetTestWorkbook(t, `<row r="1"><c r="A1" t="s"><v>0</v></c></row>`, "healthyxlsx")
	if err := os.WriteFile(filepath.Join(dir, "002-good.xlsx"), valid, 0600); err != nil {
		t.Fatal(err)
	}
	var indexed []*sql.AssetContent
	err := NewAssetsSearcher().fullIndex(func(batch []*sql.AssetContent) error {
		indexed = append(indexed, batch...)
		return nil
	})
	if err != nil {
		t.Fatalf("malformed XLSX aborted full indexing instead of being skipped: %v", err)
	}
	if len(indexed) != 2 || indexed[0].Content != "healthyneedle" || indexed[1].Content != "healthyxlsx" {
		t.Fatalf("healthy asset not indexed: %+v", indexed)
	}
	if actual, err := os.ReadFile(filepath.Join(dir, "000-bad.xlsx")); err != nil || !bytes.Equal(actual, bad) {
		t.Fatalf("source changed: %v", err)
	}
	assertXlsxAssetTempFilesClosed(t)
}

func malformedXlsxCompoundFile(sectorShift uint16) []byte {
	data := make([]byte, 1<<sectorShift)
	binary.LittleEndian.PutUint64(data, 0xE11AB1A1E011CFD0)
	version, difatCount := uint16(3), uint32(3720050413)
	if sectorShift == 12 {
		version, difatCount = 4, 1188148333
	}
	binary.LittleEndian.PutUint16(data[26:], version)
	binary.LittleEndian.PutUint16(data[30:], sectorShift)
	binary.LittleEndian.PutUint32(data[72:], difatCount)
	return data
}

func assertXlsxAssetTempFilesClosed(t *testing.T) {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(util.TempDir, "convert", "asset_content"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("temporary files not cleaned: %v %v", entries, err)
	}
}

func TestXlsxAssetContentRejectsMalformedInputAndClearsStaleIndex(t *testing.T) {
	if !assetContentTestChild(t) {
		return
	}
	dir := setupAssetContentRegression(t)
	valid := buildXlsxAssetTestWorkbook(t, `<row r="1"><c r="A1" t="s"><v>0</v></c></row>`, "oldneedle")
	cases := []struct {
		name string
		data []byte
	}{
		{"oversized-row", buildXlsxAssetTestWorkbook(t, `<row r="1"><c r="A1"><v>1</v></c></row><row r="231999999999940"><c><v>2</v></c></row>`, "unused")},
		{"compound-v3", malformedXlsxCompoundFile(9)},
		{"compound-v4", malformedXlsxCompoundFile(12)},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			name := test.name + ".xlsx"
			path := filepath.Join(dir, name)
			for _, data := range [][]byte{valid, test.data, valid} {
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
				start := time.Now()
				indexAssetContent(path)
				if time.Since(start) > 2*time.Second {
					t.Fatal("input was not handled promptly")
				}
				if err := sql.FlushAssetContentQueue(); err != nil {
					t.Fatal(err)
				}
				got := GetAssetContentByPath("assets/" + name)
				if bytes.Equal(data, valid) {
					if got == nil || got.Content != "oldneedle" {
						t.Fatalf("valid content was not indexed: %+v", got)
					}
				} else if got != nil {
					t.Fatalf("stale index remains: %+v", got)
				}
				if actual, err := os.ReadFile(path); err != nil || !bytes.Equal(actual, data) {
					t.Fatalf("source changed: %v", err)
				}
				assertXlsxAssetTempFilesClosed(t)
			}
		})
	}
}

func TestXlsxAssetParserMalformedInputs(t *testing.T) {
	oldTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTemp })
	cases := []struct {
		name    string
		data    []byte
		wantNil bool
	}{
		{"notzip", []byte("not an xlsx"), true},
		{"truncatedzip", []byte{'P', 'K', 3, 4}, true},
		{"compound-v3", malformedXlsxCompoundFile(9), true},
		{"compound-v4", malformedXlsxCompoundFile(12), true},
		{"negative-shared-index", buildXlsxAssetTestWorkbook(t, `<row r="1"><c r="A1" t="s"><v>-1</v></c><c r="B1" t="inlineStr"><is><t>healthy</t></is></c></row>`, "valid"), false},
		{"negative-shared-index-disk", buildXlsxAssetTestWorkbook(t, `<row r="1"><c r="A1" t="s"><v>-1</v></c><c r="B1" t="inlineStr"><is><t>healthy</t></is></c></row>`, strings.Repeat("x", 17*1024*1024)), false},
		{"unsorted-cells", buildXlsxAssetTestWorkbook(t, `<row r="1"><c r="D1"><v>4</v></c><c r="C1"><v>3</v></c></row>`, "unused"), false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), test.name+".xlsx")
			if err := os.WriteFile(path, test.data, 0600); err != nil {
				t.Fatal(err)
			}
			result := (&XlsxAssetParser{}).Parse(path)
			if (result == nil) != test.wantNil {
				t.Fatalf("unexpected result: %+v", result)
			}
			if strings.HasPrefix(test.name, "negative-shared-index") && result.Content != "healthy" {
				t.Fatalf("valid neighboring cell lost: %q", result.Content)
			}
			if actual, err := os.ReadFile(path); err != nil || !bytes.Equal(actual, test.data) {
				t.Fatalf("source changed: %v", err)
			}
			assertXlsxAssetTempFilesClosed(t)
		})
	}
}

func TestXlsxAssetParserMultipleSheetsAndFormats(t *testing.T) {
	oldTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTemp })
	workbook := excelize.NewFile()
	defer workbook.Close()
	if _, err := workbook.NewSheet("Dates"); err != nil {
		t.Fatal(err)
	}
	if err := workbook.SetCellValue("Sheet1", "A1", "firstneedle"); err != nil {
		t.Fatal(err)
	}
	if err := workbook.SetCellValue("Dates", "A1", time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if err := workbook.SetCellValue("Dates", "B1", 1234.5); err != nil {
		t.Fatal(err)
	}
	for cell, format := range map[string]string{"A1": "yyyy-mm-dd", "B1": "#,##0.00"} {
		style, err := workbook.NewStyle(&excelize.Style{CustomNumFmt: &format})
		if err != nil {
			t.Fatal(err)
		}
		if err := workbook.SetCellStyle("Dates", cell, cell, style); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "formatted.xlsx")
	if err := workbook.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	result := (&XlsxAssetParser{}).Parse(path)
	if result == nil {
		t.Fatal("valid workbook was rejected")
	}
	for _, want := range []string{"firstneedle", "2026-11-11", "1,234.50"} {
		if !strings.Contains(result.Content, want) {
			t.Fatalf("missing %q in %q", want, result.Content)
		}
	}
	assertXlsxAssetTempFilesClosed(t)
}

func TestXlsxAssetParserMalformedCompoundFileClosesDescriptors(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("descriptor inspection requires procfs")
	}
	if _, err := os.ReadDir("/proc/self/fd"); err != nil {
		t.Skipf("descriptor inspection unavailable: %v", err)
	}
	oldTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTemp })
	oldGC := debug.SetGCPercent(-1)
	t.Cleanup(func() { debug.SetGCPercent(oldGC) })
	path := filepath.Join(t.TempDir(), "malformed.xlsx")
	if err := os.WriteFile(path, malformedXlsxCompoundFile(9), 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		if result := (&XlsxAssetParser{}).Parse(path); result != nil {
			t.Fatalf("malformed workbook accepted: %+v", result)
		}
	}
	assertXlsxAssetTempFilesClosed(t)
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		target, err := os.Readlink(filepath.Join("/proc/self/fd", entry.Name()))
		if err == nil && strings.Contains(target, filepath.Join(util.TempDir, "convert", "asset_content")) {
			t.Fatalf("temporary workbook descriptor leaked: %s", target)
		}
	}
}
