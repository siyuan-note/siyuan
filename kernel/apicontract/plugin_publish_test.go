// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestPluginPublishContracts(t *testing.T) {
	for _, body := range []string{`{}`, `{"packageName":"example","data":null}`, `{"packageName":"example","data":{"x":[]}}`, `{"packageName":"example","data":{"x":{}}}`} {
		if _, err := SavePluginPublishData.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid snapshot accepted: %s", body)
		}
	}
	if _, err := SavePluginPublishData.Decode(strings.NewReader(`{"packageName":"example","data":{"text":"a","number":1234567890123456789,"bool":true,"nil":null}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := SetPluginPublishDataGrant.Decode(strings.NewReader(`{"packageName":"example","fields":["x"],"enabled":"true"}`)); err == nil {
		t.Fatal("non-boolean grant accepted")
	}
}
