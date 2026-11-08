// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestContractExportHeadingNumberSetting(t *testing.T) {
	for _, input := range []string{`{}`, `{"headingNumber":null}`, `{"headingNumber":false}`, `{"headingNumber":true}`} {
		request, err := SetExport.Decode(strings.NewReader(input))
		if err != nil || request.configError != nil {
			t.Fatalf("valid patch %s: %v %v", input, err, request.configError)
		}
	}
	request, err := SetExport.Decode(strings.NewReader(`{"headingNumber":"false"}`))
	if err == nil && request.configError == nil {
		t.Fatal("invalid string accepted")
	}
}
