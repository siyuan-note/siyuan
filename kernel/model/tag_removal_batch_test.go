// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"slices"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestTagRemovalBatchLabels(t *testing.T) {
	for _, item := range []struct {
		name   string
		label  string
		labels []string
		want   []string
	}{
		{"single", "todo", nil, []string{"todo"}},
		{"deduplicate", "", []string{"todo", "done", "todo"}, []string{"todo", "done"}},
		{"exact", "", []string{"todo", "todo/child", "Todo", " todo "}, []string{"todo", "todo/child", "Todo", " todo "}},
		{"missing", "", nil, nil},
		{"empty", "", []string{}, nil},
		{"emptyLabel", "", []string{"todo", ""}, nil},
		{"mixed", "todo", []string{"done"}, nil},
		{"mixedEmpty", "todo", []string{}, nil},
		{"rawLimit", "", slices.Repeat([]string{"todo"}, 101), nil},
		{"atLimit", "", slices.Repeat([]string{"todo"}, 100), []string{"todo"}},
	} {
		t.Run(item.name, func(t *testing.T) {
			got, err := tagRemovalLabels(item.label, item.labels)
			if (err != nil) != (item.want == nil) || !slices.Equal(got, item.want) {
				t.Fatalf("labels = %v, %v; want %v", got, err, item.want)
			}
		})
	}
	if _, err := tagRemovalChanges(apicontract.TagRemovalPreviewRequest{Labels: []string{"todo"}, Changes: []*apicontract.TagRemovalChange{{ID: "20261116000000-test001", Tags: []string{"todo"}}}}); err == nil {
		t.Fatal("labels and block changes accepted together")
	}
	if _, err := tagRemovalChanges(apicontract.TagRemovalPreviewRequest{Label: "todo", Changes: []*apicontract.TagRemovalChange{{ID: "20261116000000-test001", Tags: []string{"todo"}}}}); err == nil || err.Error() != "label and changes are mutually exclusive" {
		t.Fatalf("single-label conflict error changed: %v", err)
	}
}
