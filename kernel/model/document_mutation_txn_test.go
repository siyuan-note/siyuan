// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "testing"

func TestDocumentMutationTxnLifecycle(t *testing.T) {
	transaction := BeginDocumentMutation()
	if transaction == nil || transaction.guard == nil {
		t.Fatal("document mutation transaction did not acquire the identity domain")
	}
	transaction.Abort()
	transaction.Abort()
	if _, err := transaction.RemoveIndex("20260101000000-abcdefg", "20260101000001-abcdefg"); err == nil {
		t.Fatal("closed document mutation transaction accepted a mutation")
	}
}
