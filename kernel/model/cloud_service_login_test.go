// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

// mustMarshal 把测试数据编码为 JSON，失败即终止用例。
func mustMarshal(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestParseLogin2faEnvelope(t *testing.T) {
	tests := []struct {
		name         string
		result       map[string]any
		ok           bool
		expectedCode int
	}{
		{
			name:         "success",
			result:       map[string]any{"code": float64(0), "msg": "", "token": "token"},
			ok:           true,
			expectedCode: 0,
		},
		{
			name:         "invalid verification code",
			result:       map[string]any{"code": float64(-1), "msg": "invalid code"},
			ok:           true,
			expectedCode: 1,
		},
		{
			name:   "missing code",
			result: map[string]any{"msg": "invalid response"},
			ok:     false,
		},
		{
			name:   "success without token",
			result: map[string]any{"code": float64(0), "msg": ""},
			ok:     false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			envelope, ok := parseLogin2faEnvelope(test.result)
			if test.ok != ok {
				t.Fatalf("unexpected parse status [expected=%t, actual=%t]", test.ok, ok)
			}
			if !test.ok {
				if nil != envelope {
					t.Fatalf("unexpected envelope [%+v]", envelope)
				}
				return
			}
			if test.expectedCode != envelope.Code {
				t.Fatalf("unexpected code [expected=%d, actual=%d]", test.expectedCode, envelope.Code)
			}
			// 载荷必须原样保留云端结果的全部字段（含协议扩展字段），以便直接输出。
			encoded, err := json.Marshal(envelope.Data)
			if err != nil {
				t.Fatal(err)
			}
			var got, want map[string]any
			if err = json.Unmarshal(encoded, &got); err != nil {
				t.Fatal(err)
			}
			if err = json.Unmarshal(mustMarshal(t, test.result), &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(want, got) {
				t.Fatalf("response data was not preserved: %s", encoded)
			}
		})
	}
}

func TestResolveCloudUserRefresh(t *testing.T) {
	previous := &conf.User{UserName: "alice"}
	refreshed := &conf.User{UserName: "alice-updated"}

	user, userName, invalid := resolveCloudUserRefresh(previous, refreshed, nil)
	if user != refreshed || "" != userName || invalid {
		t.Fatalf("unexpected successful refresh result [user=%+v, userName=%q, invalid=%t]", user, userName, invalid)
	}

	user, userName, invalid = resolveCloudUserRefresh(previous, nil, errRequestUserFailed)
	if user != previous || "" != userName || invalid {
		t.Fatalf("unexpected temporary failure result [user=%+v, userName=%q, invalid=%t]", user, userName, invalid)
	}

	user, userName, invalid = resolveCloudUserRefresh(previous, nil, errInvalidUser)
	if nil != user || previous.UserName != userName || !invalid {
		t.Fatalf("unexpected invalid user result [user=%+v, userName=%q, invalid=%t]", user, userName, invalid)
	}
}
