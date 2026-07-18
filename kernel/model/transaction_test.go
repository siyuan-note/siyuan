// SiYuan - Refactor your thinking
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

import "testing"

func TestDoUpdateRejectsInvalidData(t *testing.T) {
	tests := []any{nil, 1, ""}
	for _, data := range tests {
		tx := &Transaction{}
		err := tx.doUpdate(&Operation{ID: "20260718000000-abcdefg", Data: data})
		if nil == err {
			t.Fatalf("expected invalid update data [%v] to be rejected", data)
		}
		if TxErrCodePushMsg != err.Code() {
			t.Fatalf("expected invalid update data [%v] to return code [%d], got [%d]", data, TxErrCodePushMsg, err.Code())
		}
	}
}

func TestTxErrFromPanic(t *testing.T) {
	if err := txErrFromPanic(1, "test"); nil == err {
		t.Fatal("expected an active transaction panic to return an error")
	}
	if err := txErrFromPanic(2, "test"); nil != err {
		t.Fatal("expected a committed transaction panic to preserve the committed result")
	}
}
