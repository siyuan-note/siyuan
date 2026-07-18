// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestShouldBroadcastAttrViewTransactions(t *testing.T) {
	transactions := []*model.Transaction{{DoOperations: []*model.Operation{
		{Action: "restoreCreatedDoc"},
		{Action: "insertAttrViewBlock"},
	}}}
	if !shouldBroadcastAttrViewTransactions(transactions) {
		t.Fatal("attribute view operation after an internal operation should be broadcast to the initiating client")
	}

	transactions[0].DoOperations = []*model.Operation{{Action: "setAttrViewName"}}
	if shouldBroadcastAttrViewTransactions(transactions) {
		t.Fatal("attribute view name updates should keep using optimistic local updates")
	}
}
