// SiYuan - Build Your Eternal Digital Garden
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

	"github.com/88250/gulu"
	"github.com/88250/melody"
)

var (
	WebSocketServer = melody.New()

	// map[string]map[string]*melody.Session{}
	sessions = sync.Map{} // {appId, {sessionId, session}}
)

// BroadcastByType 广播所有实例上 typ 类型的会话。
func BroadcastByType(typ, cmd string, code int, msg string, data interface{}) {
	typeSessions := SessionsByType(typ)
	for _, sess := range typeSessions {
		event := NewResult()
		event.Cmd = cmd
		event.Code = code
		event.Msg = msg
		event.Data = data
		sess.Write(event.Bytes())
	}
}

func SessionsByType(typ string) (ret []*melody.Session) {
	ret = []*melody.Session{}

	sessions.Range(func(key, value interface{}) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value interface{}) bool {
			session := value.(*melody.Session)
			if t, ok := session.Get("type"); ok && typ == t {
				ret = append(ret, session)
			}
			return true
		})
		return true
	})
	return
}

func AddPushChan(session *melody.Session) {
	appID := session.Request.URL.Query().Get("app")
	session.Set("app", appID)
	id := session.Request.URL.Query().Get("id")
	session.Set("id", id)
	typ := session.Request.URL.Query().Get("type")
	session.Set("type", typ)

	if appSessions, ok := sessions.Load(appID); !ok {
		appSess := &sync.Map{}
		appSess.Store(id, session)
		sessions.Store(appID, appSess)
	} else {
		(appSessions.(*sync.Map)).Store(id, session)
	}
}

func RemovePushChan(session *melody.Session) {
	app, _ := session.Get("app")
	id, _ := session.Get("id")

	if nil == app || nil == id {
		return
	}

	appSess, _ := sessions.Load(app)
	if nil != appSess {
		appSessions := appSess.(*sync.Map)
		appSessions.Delete(id)
		if 1 > lenOfSyncMap(appSessions) {
			sessions.Delete(app)
		}
	}
}

func lenOfSyncMap(m *sync.Map) (ret int) {
	m.Range(func(key, value interface{}) bool {
		ret++
		return true
	})
	return
}

func ClosePushChan(id string) {
	sessions.Range(func(key, value interface{}) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value interface{}) bool {
			session := value.(*melody.Session)
			if sid, _ := session.Get("id"); sid == id {
				session.CloseWithMsg([]byte("  close websocket"))
				RemovePushChan(session)
			}
			return true
		})
		return true
	})
}

func ReloadUI() {
	evt := NewCmdResult("reloadui", 0, PushModeBroadcast, 0)
	PushEvent(evt)
}

func PushTxErr(msg string, code int, data interface{}) {
	BroadcastByType("main", "txerr", code, msg, data)
}

func PushUpdateMsg(msgId string, msg string, timeout int) {
	BroadcastByType("main", "msg", 0, msg, map[string]interface{}{"id": msgId, "closeTimeout": timeout})
	return
}

func PushMsg(msg string, timeout int) (msgId string) {
	msgId = gulu.Rand.String(7)
	BroadcastByType("main", "msg", 0, msg, map[string]interface{}{"id": msgId, "closeTimeout": timeout})
	return
}

func PushErrMsg(msg string, timeout int) (msgId string) {
	msgId = gulu.Rand.String(7)
	BroadcastByType("main", "msg", -1, msg, map[string]interface{}{"id": msgId, "closeTimeout": timeout})
	return
}

const (
	PushProgressCodeProgressed = 0 // 有进度
	PushProgressCodeEndless    = 1 // 无进度
	PushProgressCodeEnd        = 2 // 关闭进度
)

func ClearPushProgress(total int) {
	PushProgress(PushProgressCodeEnd, total, total, "")
}

func PushEndlessProgress(msg string) {
	PushProgress(PushProgressCodeEndless, 1, 1, msg)
}

func PushProgress(code, current, total int, msg string) {
	BroadcastByType("main", "progress", code, msg, map[string]interface{}{
		"current": current,
		"total":   total,
	})
}

// PushClearMsg 会清空指定消息。
func PushClearMsg(msgId string) {
	BroadcastByType("main", "cmsg", 0, "", map[string]interface{}{"id": msgId})
}

// PushClearProgress 取消进度遮罩。
func PushClearProgress() {
	BroadcastByType("main", "cprogress", 0, "", nil)
}

func PushDownloadProgress(id string, percent float32) {
	evt := NewCmdResult("downloadProgress", 0, PushModeBroadcast, 0)
	evt.Data = map[string]interface{}{
		"id":      id,
		"percent": percent,
	}
	PushEvent(evt)
}

func PushEvent(event *Result) {
	msg := event.Bytes()
	mode := event.PushMode
	if "reload" == event.Cmd {
		mode = event.ReloadPushMode
	}
	switch mode {
	case PushModeBroadcast:
		Broadcast(msg)
	case PushModeSingleSelf:
		single(msg, event.AppId, event.SessionId)
	case PushModeBroadcastExcludeSelf:
		broadcastOthers(msg, event.SessionId)
	case PushModeBroadcastExcludeSelfApp:
		broadcastOtherApps(msg, event.AppId)
	case PushModeNone:
	}
}

func single(msg []byte, appId, sid string) {
	sessions.Range(func(key, value interface{}) bool {
		appSessions := value.(*sync.Map)
		if key != appId {
			return true
		}

		appSessions.Range(func(key, value interface{}) bool {
			session := value.(*melody.Session)
			if id, _ := session.Get("id"); id == sid {
				session.Write(msg)
			}
			return true
		})
		return true
	})
}

func Broadcast(msg []byte) {
	sessions.Range(func(key, value interface{}) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value interface{}) bool {
			session := value.(*melody.Session)
			session.Write(msg)
			return true
		})
		return true
	})
}

func broadcastOtherApps(msg []byte, excludeApp string) {
	sessions.Range(func(key, value interface{}) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value interface{}) bool {
			session := value.(*melody.Session)
			if app, _ := session.Get("app"); app == excludeApp {
				return true
			}
			session.Write(msg)
			return true
		})
		return true
	})
}

func broadcastOthers(msg []byte, excludeSID string) {
	sessions.Range(func(key, value interface{}) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value interface{}) bool {
			session := value.(*melody.Session)
			if id, _ := session.Get("id"); id == excludeSID {
				return true
			}
			session.Write(msg)
			return true
		})
		return true
	})
}

func CountSessions() (ret int) {
	sessions.Range(func(key, value interface{}) bool {
		ret++
		return true
	})
	return
}
