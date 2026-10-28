// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "testing"

func TestSearchDocDisplayFields(t *testing.T) {
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
				"path":  "/20260903120000-parent1/20260903123000-child01.sy",
				"hPath": "Notebook/Parent/Document",
				"title": "Literal / title",
				"box":   "20260903110000-boxid01",
			},
			wantType: "DOCUMENT",
			wantID:   "20260903123000-child01",
			wantName: "Literal / title",
		},
		{
			name: "notebook",
			doc: map[string]string{
				"path":  "/",
				"hPath": "Notebook/",
				"title": "Notebook",
				"box":   "20260903110000-boxid01",
			},
			wantType: "NOTEBOOK",
			wantID:   "20260903110000-boxid01",
			wantName: "Notebook",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			typ, id, name := SearchDocDisplayFields(test.doc)
			if typ != test.wantType || id != test.wantID || name != test.wantName {
				t.Fatalf("SearchDocDisplayFields() = (%q, %q, %q), want (%q, %q, %q)",
					typ, id, name, test.wantType, test.wantID, test.wantName)
			}
		})
	}
}
