// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestGetBlockInfoIDTypeMessage(t *testing.T) {
	for _, value := range []string{`42`, `true`, `[]`, `{}`} {
		_, err := GetBlockInfo.Decode(strings.NewReader(`{"id":` + value + `}`))
		if err == nil || err.Error() != "Field [id] should be of type [String]" {
			t.Errorf("id=%s: unexpected error %v", value, err)
		}
	}
}
