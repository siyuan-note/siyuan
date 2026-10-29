// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestCoalesceDocumentPlanAncestors(t *testing.T) {
	parentA, parentB := "parentA", "parentB"
	childA, childB := "childA", "childB"
	plan := func(parent, child, final string) *DocumentCreatePlan {
		return &DocumentCreatePlan{Notebook: "box", Steps: []DocumentCreateRequest{
			{ID: parent, Title: "A/B"},
			{ID: child, ParentID: &parent, Title: "Child", NameConditions: []treenode.DocumentNameCondition{{Title: "A/B", ExpectedID: &parent}}},
			{ID: final, ParentID: &child, Title: "Final", NameConditions: []treenode.DocumentNameCondition{
				{Title: "A/B", ExpectedID: &parent}, {ParentID: &parent, Title: "Child", ExpectedID: &child}}},
		}}
	}
	first, second := plan(parentA, childA, "finalA"), plan(parentB, childB, "finalB")
	coalesceDocumentPlanAncestors([]*DocumentCreatePlan{first, second})
	if len(first.Steps) != 3 || len(second.Steps) != 1 || second.Steps[0].ID != "finalB" || *second.Steps[0].ParentID != childA {
		t.Fatalf("shared ancestors or final identities changed: %+v, %+v", first, second)
	}
	conditions := second.Steps[0].NameConditions
	if *conditions[0].ExpectedID != parentA || *conditions[1].ParentID != parentA || *conditions[1].ExpectedID != childA {
		t.Fatalf("name conditions still point at discarded planned identities: %+v", conditions)
	}
}
