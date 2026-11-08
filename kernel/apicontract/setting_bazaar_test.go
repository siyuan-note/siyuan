// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestContractBazaarBatchUpdateExclusions(t *testing.T) {
	for _, input := range []string{
		`{}`,
		`{"batchUpdateExcluded":null}`,
		`{"batchUpdateExcluded":{"plugins":{"sample":true,"other":false},"themes":{}}}`,
	} {
		if request, err := SetBazaar.Decode(strings.NewReader(input)); err != nil || request.configError != nil {
			t.Fatalf("valid exclusion patch %s: %v", input, err)
		}
	}
	for _, input := range []string{
		`{"batchUpdateExcluded":true}`,
		`{"batchUpdateExcluded":{"plugins":{"sample":42}}}`,
	} {
		if request, err := SetBazaar.Decode(strings.NewReader(input)); err == nil && request.configError == nil {
			t.Fatalf("invalid exclusion patch accepted: %s", input)
		}
	}
}
