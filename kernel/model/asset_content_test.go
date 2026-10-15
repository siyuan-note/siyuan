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

package model

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetContentFieldRegexpUsesArguments(t *testing.T) {
	payload := "x'); DELETE FROM asset_contents_fts_case_insensitive; --"
	clause, args := assetContentFieldRegexp(payload)
	if "(name REGEXP ? OR content REGEXP ?)" != clause {
		t.Fatalf("正则过滤子句未使用占位符：%q", clause)
	}
	if strings.Contains(clause, payload) {
		t.Fatalf("正则过滤子句不应包含用户输入：%q", clause)
	}
	if 2 != len(args) || payload != args[0] || payload != args[1] {
		t.Fatalf("正则过滤参数错误：%v", args)
	}
}

func TestBuildAssetContentTypeFilterUsesArguments(t *testing.T) {
	payload := ".pdf'); DELETE FROM asset_contents_fts_case_insensitive; --"
	clause, args := buildAssetContentTypeFilter(map[string]bool{
		".txt":  true,
		payload: true,
		".md":   false,
	})
	if " AND ext IN (?, ?)" != clause {
		t.Fatalf("资源类型过滤子句错误：%q", clause)
	}
	if strings.Contains(clause, payload) {
		t.Fatalf("资源类型过滤子句不应包含用户输入：%q", clause)
	}
	if !slices.Equal(args, []any{payload, ".txt"}) {
		t.Fatalf("资源类型过滤参数错误：%v", args)
	}
}

func TestBuildAssetContentTypeFilterEmpty(t *testing.T) {
	clause, args := buildAssetContentTypeFilter(nil)
	if "" != clause || 0 != len(args) {
		t.Fatalf("未指定资源类型时不应生成过滤条件：%q %v", clause, args)
	}

	clause, args = buildAssetContentTypeFilter(map[string]bool{".txt": false})
	if " AND 1 = 0" != clause || 0 != len(args) {
		t.Fatalf("全部禁用的资源类型应返回空结果条件：%q %v", clause, args)
	}
}

func TestPDFParser(t *testing.T) {
	p := &PdfAssetParser{}
	res := p.Parse("../testdata/parsertest.pdf")
	if res == nil || res.Content == "" {
		t.Fatalf("empty or nil PDF content result")
	}
}

func TestPDFParserRejectsOversizeBeforeCopy(t *testing.T) {
	oldLimit, oldTemp := PDFAssetContentMaxSize, util.TempDir
	t.Cleanup(func() { PDFAssetContentMaxSize, util.TempDir = oldLimit, oldTemp })
	t.Setenv("SIYUAN_PDF_ASSET_CONTENT_INDEX_MAX_SIZE", "16")
	util.TempDir = filepath.Join(t.TempDir(), "unused-temp")
	pdf := filepath.Join(t.TempDir(), "oversize.pdf")
	if err := os.WriteFile(pdf, []byte(strings.Repeat("x", 17)), 0644); err != nil {
		t.Fatal(err)
	}
	if result := (&PdfAssetParser{}).Parse(pdf); result != nil {
		t.Fatal("oversize PDF must be skipped")
	}
	if PDFAssetContentMaxSize != 16 {
		t.Fatal("environment limit was not applied before the size check")
	}
	if _, err := os.Stat(util.TempDir); !os.IsNotExist(err) {
		t.Fatalf("rejected PDF must not create temporary data: %v", err)
	}
}
