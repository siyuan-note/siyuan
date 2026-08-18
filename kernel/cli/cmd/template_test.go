// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestWriteTemplateSearchResults(t *testing.T) {
	results := []*model.TemplateSearchResult{{
		Content:      "Daily report",
		RelativePath: "group/daily.md",
		Path:         "/data/templates/group/daily.md",
	}}
	var output bytes.Buffer
	if err := writeTemplateSearchResults(&output, results); err != nil {
		t.Fatal(err)
	}

	text := output.String()
	for _, expected := range []string{"NAME", "RELATIVE_PATH", "PATH", "group/daily.md", results[0].Path, "1 template(s)"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("template search output missing %q: %q", expected, text)
		}
	}
}
