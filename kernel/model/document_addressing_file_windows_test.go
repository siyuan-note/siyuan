// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
)

func TestDocumentAddressingRawPathJunctions(t *testing.T) {
	documentAddressingRawPathAliases(t, func(link, target string) {
		testutil.Junction(t, link, target)
	})
}
