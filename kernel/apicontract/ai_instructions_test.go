// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestAIAgentInstructionsContract(t *testing.T) {
	for _, body := range []string{``, `{}`, `{"content":""}`, `{"revision":"missing"}`, `{"content":null,"revision":"missing"}`, `{"content":1,"revision":"missing"}`, `{"content":"","revision":false}`} {
		if _, err := AISetAgentInstructions.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid request: %s", body)
		}
	}
	if _, err := AISetAgentInstructions.Decode(strings.NewReader(`{"content":"","revision":"missing"}`)); err != nil {
		t.Fatal(err)
	}
}
