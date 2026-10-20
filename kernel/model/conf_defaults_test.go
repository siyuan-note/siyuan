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
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

// 以下默认值取决于 conf.json 是否存在：新工作空间使用构造函数默认值，已有工作空间缺少字段时沿用旧默认值。
func TestNormalizeFileTreeDefaultIcon(t *testing.T) {
	for _, test := range []struct {
		name           string
		fileTree       *conf.FileTree
		confFileExists bool
		want           bool
	}{
		{name: "new workspace", want: true},
		{name: "existing workspace without file tree", confFileExists: true},
		{name: "existing setting enabled", fileTree: &conf.FileTree{UseSVGDefaultIcon: true}, confFileExists: true, want: true},
		{name: "existing setting disabled", fileTree: &conf.FileTree{UseSVGDefaultIcon: false}, confFileExists: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			fileTree := normalizeFileTreeDefaultIcon(test.fileTree, test.confFileExists)
			if test.want != fileTree.UseSVGDefaultIcon {
				t.Fatalf("unexpected default icon setting: got %t, want %t", fileTree.UseSVGDefaultIcon, test.want)
			}
		})
	}
}

func TestNormalizeOCRConfig(t *testing.T) {
	for _, test := range []struct {
		name           string
		value          *conf.OCR
		confFileExists bool
		want           conf.OCR
	}{
		{name: "new device", want: conf.OCR{Provider: "paddleocr", Model: "tiny", Auto: false}},
		{name: "legacy device", confFileExists: true, want: conf.OCR{Provider: "tesseract", Model: "tiny", Auto: true}},
		{
			name:           "existing workspace without provider",
			value:          &conf.OCR{},
			confFileExists: true,
			want:           conf.OCR{Provider: "tesseract", Model: "tiny", Auto: true},
		},
		{
			name:           "existing workspace with provider but without model",
			value:          &conf.OCR{Provider: "paddleocr", Auto: true},
			confFileExists: true,
			want:           conf.OCR{Provider: "paddleocr", Model: "tiny", Auto: true},
		},
		{
			name:           "new device without model",
			value:          &conf.OCR{Provider: "paddleocr"},
			confFileExists: false,
			want:           conf.OCR{Provider: "paddleocr", Model: "tiny", Auto: false},
		},
		{
			name:           "saved PaddleOCR with auto enabled",
			value:          &conf.OCR{Provider: "paddleocr", Model: "small", Auto: true},
			confFileExists: true,
			want:           conf.OCR{Provider: "paddleocr", Model: "tiny", Auto: true},
		},
		{
			name:           "saved Tesseract with auto disabled",
			value:          &conf.OCR{Provider: "tesseract", Model: "tiny", Auto: false},
			confFileExists: true,
			want:           conf.OCR{Provider: "tesseract", Model: "tiny", Auto: false},
		},
		{
			name:           "saved PaddleOCR with imported model",
			value:          &conf.OCR{Provider: "paddleocr", Model: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", Auto: false},
			confFileExists: true,
			want:           conf.OCR{Provider: "paddleocr", Model: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", Auto: false},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.want.ShowText = new(true)
			got := normalizeOCRConfig(test.value, test.confFileExists)
			if !reflect.DeepEqual(*got, test.want) {
				t.Fatalf("OCR config: got %+v, want %+v", *got, test.want)
			}
			if test.value != nil && got != test.value {
				t.Fatal("saved OCR config should be retained")
			}
		})
	}
}
