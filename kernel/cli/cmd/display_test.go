// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import "testing"

func TestDocumentSearchDisplayFields(t *testing.T) {
	tests := []struct {
		name     string
		doc      map[string]string
		wantType string
		wantID   string
		wantName string
	}{
		{
			name: "document",
			doc: map[string]string{
				"path":  "/20260722120000-parent1/20260722123000-child01.sy",
				"hPath": "Notebook/Parent/Document",
				"box":   "20260722110000-boxid01",
			},
			wantType: "DOCUMENT",
			wantID:   "20260722123000-child01",
			wantName: "Document",
		},
		{
			name: "notebook",
			doc: map[string]string{
				"path":  "/",
				"hPath": "Notebook/",
				"box":   "20260722110000-boxid01",
			},
			wantType: "NOTEBOOK",
			wantID:   "20260722110000-boxid01",
			wantName: "Notebook",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			typ, id, name := documentSearchDisplayFields(test.doc)
			if typ != test.wantType || id != test.wantID || name != test.wantName {
				t.Fatalf("documentSearchDisplayFields() = (%q, %q, %q), want (%q, %q, %q)", typ, id, name, test.wantType, test.wantID, test.wantName)
			}
		})
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		name   string
		value  string
		length int
		want   string
	}{
		{name: "ascii unchanged", value: "SiYuan", length: 6, want: "SiYuan"},
		{name: "ascii truncated", value: "SiYuan", length: 2, want: "Si..."},
		{name: "Chinese unchanged", value: "思源笔记", length: 4, want: "思源笔记"},
		{name: "Chinese truncated", value: "思源笔记", length: 2, want: "思源..."},
		{name: "mixed", value: "SiYuan思源", length: 7, want: "SiYuan思..."},
		{name: "zero", value: "SiYuan", length: 0, want: "..."},
		{name: "empty", value: "", length: 0, want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := truncate(test.value, test.length); got != test.want {
				t.Fatalf("truncate(%q, %d) = %q, want %q", test.value, test.length, got, test.want)
			}
		})
	}
}
