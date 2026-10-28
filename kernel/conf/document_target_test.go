// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDocumentTargetStrictConfiguration(t *testing.T) {
	const valid = `{"version":2,"notebook":"20261023090000-target1","anchor":{"kind":"notebookRoot"},"up":0,"parents":[],"title":"Literal / title","onMissingParent":"error"}`
	var target DocumentTarget
	if err := json.Unmarshal([]byte(valid), &target); err != nil || target.Title != "Literal / title" {
		t.Fatal("a literal template lost its source text", err)
	}
	for name, invalid := range map[string]string{
		"version duplicate":      strings.Replace(valid, `"version":2`, `"version":3,"version":2`, 1),
		"version case duplicate": strings.Replace(valid, `"version":2`, `"version":3,"Version":2`, 1),
		"anchor duplicate":       strings.Replace(valid, `"kind":"notebookRoot"`, `"kind":"future","Kind":"notebookRoot"`, 1),
		"unknown anchor":         strings.Replace(valid, `"kind":"notebookRoot"`, `"kind":"notebookRoot","future":true`, 1),
		"null parents":           strings.Replace(valid, `"parents":[]`, `"parents":null`, 1),
		"missing title":          strings.Replace(valid, `"title":"Literal / title",`, ``, 1),
		"unknown version":        strings.Replace(valid, `"version":2`, `"version":3`, 1),
		"suffix":                 valid + `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(invalid), &target); err == nil {
				t.Fatal("accepted invalid configuration", invalid)
			}
		})
	}
	var targets DocumentTargets
	if err := json.Unmarshal([]byte(`{"docCreateTarget":`+valid+`,"refCreateTarget":null}`), &targets); err != nil || targets.Document == nil {
		t.Fatal("optional configuration fields could not round trip", err)
	}
	for _, invalid := range []string{
		`{"docCreateTarget":` + valid + `,"DocCreateTarget":null}`,
		`{"futureTarget":` + valid + `}`,
	} {
		if err := json.Unmarshal([]byte(invalid), &targets); err == nil {
			t.Fatal("protected target collection ignored an unknown or duplicate field", invalid)
		}
	}
}
