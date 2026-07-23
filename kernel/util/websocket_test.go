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

package util

import (
	"sync"
	"testing"

	"github.com/olahol/melody"
)

func TestIsPublishSession(t *testing.T) {
	tests := []struct {
		name      string
		value     any
		setValue  bool
		isPublish bool
	}{
		{name: "unset"},
		{name: "false", value: false, setValue: true},
		{name: "true", value: true, setValue: true, isPublish: true},
		{name: "non-boolean", value: "true", setValue: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			session := &melody.Session{}
			if test.setValue {
				session.Set("isPublish", test.value)
			}
			if actual := isPublishSession(session); actual != test.isPublish {
				t.Fatalf("isPublishSession() = %v, want %v", actual, test.isPublish)
			}
		})
	}
}

func TestSessionsByTypeExcludesPublishSession(t *testing.T) {
	const (
		appID       = "test-publish-session-filter"
		sessionType = "test-publish-session-type"
	)

	regularSession := &melody.Session{}
	regularSession.Set("type", sessionType)
	publishSession := &melody.Session{}
	publishSession.Set("type", sessionType)
	publishSession.Set("isPublish", true)

	appSessions := &sync.Map{}
	appSessions.Store("regular", regularSession)
	appSessions.Store("publish", publishSession)
	sessions.Store(appID, appSessions)
	t.Cleanup(func() {
		sessions.Delete(appID)
	})

	actual := SessionsByType(sessionType)
	if len(actual) != 1 || actual[0] != regularSession {
		t.Fatalf("SessionsByType() returned %d sessions, want only the regular session", len(actual))
	}
}
