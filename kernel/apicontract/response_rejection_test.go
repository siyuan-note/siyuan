// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

func TestRejectionResponsePreservesCodeAndNullData(t *testing.T) {
	for _, scenario := range []struct {
		err  error
		code int
		msg  string
	}{
		{Reject("invalid"), -1, "invalid"},
		{RejectWith(403, "Forbidden"), 403, "Forbidden"},
		{fmt.Errorf("context: %w", RejectWith(-3, "locked")), -3, "locked"},
		{errors.New("ordinary error"), -1, "ordinary error"},
	} {
		raw, err := json.Marshal(FailureFrom[Null](scenario.err))
		if err != nil {
			t.Fatal(err)
		}
		var envelope struct {
			Code int             `json:"code"`
			Msg  string          `json:"msg"`
			Data json.RawMessage `json:"data"`
		}
		if err = json.Unmarshal(raw, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Code != scenario.code || envelope.Msg != scenario.msg || string(envelope.Data) != "null" {
			t.Fatalf("unexpected rejection envelope: %s", raw)
		}
	}
	raw, err := json.Marshal(SuccessWithoutData[Null]())
	if err != nil || string(raw) != `{"code":0,"msg":"","data":null}` {
		t.Fatalf("unexpected empty success: %s, %v", raw, err)
	}
}
