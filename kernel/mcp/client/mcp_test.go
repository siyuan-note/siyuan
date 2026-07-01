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

package client

import (
	"errors"
	"testing"
)

func TestIsReconnectableError(t *testing.T) {
	sseErr := errors.New(`connection closed: standalone SSE stream: exceeded 5 retries without progress`)
	if !isReconnectableError(sseErr) {
		t.Fatal("expected SSE disconnect to be reconnectable")
	}

	authErr := errors.New("401 Unauthorized: invalid_token")
	if isReconnectableError(authErr) {
		t.Fatal("expected auth error not to trigger reconnect")
	}
}
