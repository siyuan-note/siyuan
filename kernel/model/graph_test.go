// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import "testing"

func TestMarkLinkedNodesWithSize(t *testing.T) {
	nodes := []*GraphNode{
		{ID: "a", Size: 10},
		{ID: "b", Size: 10},
		{ID: "c", Size: 10},
	}
	links := []*GraphLink{
		{From: "a", To: "b"},
		{From: "c", To: "b", Ref: true},
		{From: "missing", To: "b", Ref: true},
		{From: "a", To: "a", Ref: true},
	}
	markLinkedNodesWithSize(&nodes, &links, 10)
	if len(links) != 2 {
		t.Fatalf("unexpected links: %+v", links)
	}
	if nodes[0].Refs != 1 || nodes[1].Defs != 1 || nodes[2].Refs != 1 {
		t.Fatalf("unexpected node counts: %+v", nodes)
	}
	if nodes[1].Size != 10 {
		t.Fatalf("unexpected target size: %v", nodes[1].Size)
	}
}

func TestPruneUnrefWithLimits(t *testing.T) {
	nodes := []*GraphNode{
		{ID: "a", Refs: 2},
		{ID: "b", Defs: 2},
		{ID: "c", Refs: 1},
		{ID: "d", Refs: 3},
	}
	links := []*GraphLink{
		{From: "a", To: "b"},
		{From: "b", To: "c"},
		{From: "a", To: "d"},
	}
	pruneUnrefWithLimits(&nodes, &links, 2, 2)
	if len(nodes) != 2 || nodes[0].ID != "a" || nodes[1].ID != "b" {
		t.Fatalf("unexpected nodes: %+v", nodes)
	}
	if len(links) != 1 || links[0].From != "a" || links[0].To != "b" {
		t.Fatalf("unexpected links: %+v", links)
	}
}

func TestGrowLinkedNodesUsesIndexesAndStopsCycles(t *testing.T) {
	a := &Block{ID: "a", Type: "NodeDocument"}
	b := &Block{ID: "b", Type: "NodeDocument"}
	c := &Block{ID: "c", Type: "NodeDocument"}
	a.Defs = []*Block{b}
	b.Defs = []*Block{a, c}
	c.Defs = []*Block{b}
	forwardlinks := []*Block{a, b, c}
	backlinks := []*Block{}
	nodes := []*GraphNode{{ID: "a", Size: 10}}
	visitedIDs := graphNodeIDs(nodes)
	forwardDepth, backDepth := 0, 0
	growLinkedNodes(&forwardlinks, &backlinks, &nodes, visitedIDs, 10, &forwardDepth, &backDepth)
	if len(nodes) != 3 || nodes[0].ID != "a" || nodes[1].ID != "b" || nodes[2].ID != "c" {
		t.Fatalf("unexpected grown nodes: %+v", nodes)
	}
}
