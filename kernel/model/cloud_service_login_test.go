// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestParseLogin2faResult(t *testing.T) {
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
			result, ok := parseLogin2faResult(test.result)
			if test.ok != ok {
				t.Fatalf("unexpected parse status [expected=%t, actual=%t]", test.ok, ok)
			}
			if !test.ok {
				if nil != result {
					t.Fatalf("unexpected result [%+v]", result)
				}
				return
			}
			if test.expectedCode != result.Code {
				t.Fatalf("unexpected code [expected=%d, actual=%d]", test.expectedCode, result.Code)
			}
			if !reflect.DeepEqual(result.Data, test.result) {
				t.Fatalf("response data was not preserved")
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
