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
	"github.com/88250/gulu"
	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

var WrongAuthCount int

func NeedCaptcha() bool {
	return 3 < WrongAuthCount
}

// SessionData represents the session.
type SessionData struct {
	Workspaces map[string]*WorkspaceSession // <WorkspacePath, WorkspaceSession>
}

type WorkspaceSession struct {
	AccessAuthCode string
	Captcha        string
}

// Save saves the current session of the specified context.
func (sd *SessionData) Save(c *gin.Context) error {
	session := ginSessions.Default(c)
	sessionDataBytes, err := gulu.JSON.MarshalJSON(sd)
	if nil != err {
		return err
	}
	session.Set("data", string(sessionDataBytes))
	return session.Save()
}

// GetSession returns session of the specified context.
func GetSession(c *gin.Context) *SessionData {
	ret := &SessionData{}

	session := ginSessions.Default(c)
	sessionDataStr := session.Get("data")
	if nil == sessionDataStr {
		return ret
	}

	err := gulu.JSON.UnmarshalJSON([]byte(sessionDataStr.(string)), ret)
	if nil != err {
		return ret
	}

	c.Set("session", ret)
	return ret
}

func GetWorkspaceSession(session *SessionData) (ret *WorkspaceSession) {
	ret = &WorkspaceSession{}
	if nil == session.Workspaces {
		session.Workspaces = map[string]*WorkspaceSession{}
	}
	ret = session.Workspaces[WorkspaceDir]
	if nil == ret {
		ret = &WorkspaceSession{}
		session.Workspaces[WorkspaceDir] = ret
	}
	return
}

func RemoveWorkspaceSession(session *SessionData) {
	delete(session.Workspaces, WorkspaceDir)
}
