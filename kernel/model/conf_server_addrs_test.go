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

import "testing"

func TestUpdateServerAddrs(t *testing.T) {
	originalConf := Conf
	defer func() {
		Conf = originalConf
	}()
	Conf = nil
	if UpdateServerAddrs([]string{"http://127.0.0.1:6806"}) {
		t.Fatal("update without application configuration should be ignored")
	}
	Conf = NewAppConf()

	serverAddrs := []string{"http://192.168.43.1:6806", "http://127.0.0.1:6806"}
	if !UpdateServerAddrs(serverAddrs) {
		t.Fatal("first update should report a change")
	}
	serverAddrs[0] = "http://10.0.0.1:6806"
	if "http://192.168.43.1:6806" != Conf.ServerAddrs[0] {
		t.Fatal("server address update should copy its input")
	}
	if UpdateServerAddrs([]string{"http://192.168.43.1:6806", "http://127.0.0.1:6806"}) {
		t.Fatal("identical server addresses should not report a change")
	}
}
