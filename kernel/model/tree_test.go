// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"testing"
)

func TestLoadTreeByBlockTreeMissing(t *testing.T) {
	tree, err := loadTreeByBlockTree(nil)
	if tree != nil || !errors.Is(err, ErrTreeNotFound) {
		t.Fatalf("missing block tree returned %v, %v", tree, err)
	}
}
