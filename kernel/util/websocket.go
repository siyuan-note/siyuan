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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/olahol/melody"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
)

var (
	WebSocketServer *melody.Melody

	// map[string]map[string]*melody.Session{}
	sessions     = sync.Map{} // {appId, {sessionId, session}}
	authSessions = sync.Map{}

	// ReloadDocInfoGuard 由 model 层注入，在广播 docInfo 前检查 box 是否仍处于可广播状态。
	// 加密笔记本锁定后返回 false，防止 500ms 延迟任务在锁定后泄漏明文元数据。
	ReloadDocInfoGuard func(boxID string) bool
)

func BroadcastByTypeAndExcludeApp(excludeApp, typ, cmd string, code int, msg string, data any) {
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		if key == excludeApp {
			return true
		}

		appSessions.Range(func(key, value any) bool {
			session := value.(*melody.Session)
			if t, ok := session.Get("type"); ok && typ == t {
				event := NewResult()
				event.Cmd = cmd
				event.Code = code
				event.Msg = msg
				event.Data = data
				session.Write(event.Bytes())
			}
			return true
		})
		return true
	})
}

func BroadcastByTypeAndApp(typ, app, cmd string, code int, msg string, data any) {
	appSessions, ok := sessions.Load(app)
	if !ok {
		return
	}

	appSessions.(*sync.Map).Range(func(key, value any) bool {
		session := value.(*melody.Session)
		if t, ok := session.Get("type"); ok && typ == t {
			event := NewResult()
			event.Cmd = cmd
			event.Code = code
			event.Msg = msg
			event.Data = data
			session.Write(event.Bytes())
		}
		return true
	})
}

// BroadcastByType 广播所有实例上 typ 类型的会话。
func BroadcastByType(typ, cmd string, code int, msg string, data any) {
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

	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
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
	appID := strings.TrimSpace(session.Request.URL.Query().Get("app"))
	if "" == appID {
		logging.LogErrorf("app id is required")
		return
	}
	session.Set("app", appID)

	id := strings.TrimSpace(session.Request.URL.Query().Get("id"))
	if "" == id {
		logging.LogErrorf("id is required")
		return
	}
	session.Set("id", id)

	typ := strings.TrimSpace(session.Request.URL.Query().Get("type"))
	if "" == typ {
		logging.LogErrorf("type is required")
		return
	}
	session.Set("type", typ)

	if IsAuthSession(session) {
		if appSessions, ok := authSessions.Load(appID); !ok {
			appSess := &sync.Map{}
			appSess.Store(id, session)
			authSessions.Store(appID, appSess)
		} else {
			(appSessions.(*sync.Map)).Store(id, session)
		}
	} else {
		if appSessions, ok := sessions.Load(appID); !ok {
			appSess := &sync.Map{}
			appSess.Store(id, session)
			sessions.Store(appID, appSess)
		} else {
			(appSessions.(*sync.Map)).Store(id, session)
		}
	}
}

func IsAuthSession(session *melody.Session) bool {
	id, _ := session.Get("id")
	if "auth" == id {
		return true
	}

	id = session.Request.URL.Query().Get("id")
	return "auth" == id
}

func RemovePushChan(session *melody.Session) {
	app, _ := session.Get("app")
	id, _ := session.Get("id")

	if nil == app || nil == id {
		return
	}

	if IsAuthSession(session) {
		appSess, _ := authSessions.Load(app)
		if nil != appSess {
			appSessions := appSess.(*sync.Map)
			appSessions.Delete(id)
			if 1 > lenOfSyncMap(appSessions) {
				authSessions.Delete(app)
			}
		}
	} else {
		appSess, _ := sessions.Load(app)
		if nil != appSess {
			appSessions := appSess.(*sync.Map)
			appSessions.Delete(id)
			if 1 > lenOfSyncMap(appSessions) {
				sessions.Delete(app)
			}
		}
	}
}

func lenOfSyncMap(m *sync.Map) (ret int) {
	m.Range(func(key, value any) bool {
		ret++
		return true
	})
	return
}

func ClosePushChan(id string) {
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
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

func ReloadUIResetScroll() {
	BroadcastByType("main", "reloadui", 0, "", map[string]any{"resetScroll": true})
}

func ReloadUI() {
	BroadcastByType("main", "reloadui", 0, "", nil)
}

func PushTxErr(msg string, code int, data any) {
	BroadcastByType("main", "txerr", code, msg, data)
}

func PushUpdateMsg(msgId string, msg string, timeout int) {
	BroadcastByType("main", "msg", 0, msg, map[string]any{"id": msgId, "closeTimeout": timeout})
}

func PushMsg(msg string, timeout int) (msgId string) {
	msgId = gulu.Rand.String(7)
	BroadcastByType("main", "msg", 0, msg, map[string]any{"id": msgId, "closeTimeout": timeout})
	return
}

func PushMsgWithApp(app, msg string, timeout int) (msgId string) {
	msgId = gulu.Rand.String(7)
	if "" == app {
		BroadcastByType("main", "msg", 0, msg, map[string]any{"id": msgId, "closeTimeout": timeout})
		return
	}
	BroadcastByTypeAndApp("main", app, "msg", 0, msg, map[string]any{"id": msgId, "closeTimeout": timeout})
	return
}

func PushErrMsg(msg string, timeout int) (msgId string) {
	msgId = gulu.Rand.String(7)
	BroadcastByType("main", "msg", -1, msg, map[string]any{"id": msgId, "closeTimeout": timeout})
	return
}

func PushStatusBar(msg string) {
	msg += " (" + time.Now().Format("2006-01-02 15:04:05") + ")"
	BroadcastByType("main", "statusbar", 0, msg, nil)
}

func PushBackgroundTask(data map[string]any) {
	BroadcastByType("main", "backgroundtask", 0, "", data)
}

func PushReloadFiletree() {
	BroadcastByType("filetree", "reloadFiletree", 0, "", nil)
}

func PushReloadTag() {
	BroadcastByType("main", "reloadTag", 0, "", nil)
}

type BlockStatResult struct {
	RuneCount  int `json:"runeCount"`
	WordCount  int `json:"wordCount"`
	LinkCount  int `json:"linkCount"`
	ImageCount int `json:"imageCount"`
	RefCount   int `json:"refCount"`
	BlockCount int `json:"blockCount"`
}

func ContextPushMsg(context map[string]any, msg string) {
	switch context[eventbus.CtxPushMsg].(int) {
	case eventbus.CtxPushMsgToNone:
		break
	case eventbus.CtxPushMsgToProgress:
		PushEndlessProgress(msg)
	case eventbus.CtxPushMsgToStatusBar:
		PushStatusBar(msg)
	case eventbus.CtxPushMsgToStatusBarAndProgress:
		PushStatusBar(msg)
		PushEndlessProgress(msg)
	}
}

const (
	PushProgressCodeProgressed = 0 // 有进度
	PushProgressCodeEndless    = 1 // 无进度
	PushProgressCodeEnd        = 2 // 关闭进度
)

func PushClearAllMsg() {
	ClearPushProgress(100)
	PushClearMsg("")
}

func ClearPushProgress(total int) {
	PushProgress(PushProgressCodeEnd, total, total, "")
}

func PushEndlessProgress(msg string) {
	PushProgress(PushProgressCodeEndless, 1, 1, msg)
}

func PushProgress(code, current, total int, msg string) {
	BroadcastByType("main", "progress", code, msg, map[string]any{
		"current": current,
		"total":   total,
	})
}

// PushClearMsg 会清空指定消息。
func PushClearMsg(msgId string) {
	BroadcastByType("main", "cmsg", 0, "", map[string]any{"id": msgId})
}

// PushClearProgress 取消进度遮罩。
func PushClearProgress() {
	BroadcastByType("main", "cprogress", 0, "", nil)
}

func PushUpdateIDs(ids map[string]string) {
	BroadcastByType("main", "updateids", 0, "", ids)
}

func PushReloadDoc(rootID string) {
	BroadcastByType("main", "reloaddoc", 0, "", rootID)
}

func PushSaveDoc(rootID, typ string, sources any) {
	evt := NewCmdResult("savedoc", 0, PushModeBroadcast)
	evt.Data = map[string]any{
		"rootID":  rootID,
		"type":    typ,
		"sources": sources,
	}
	PushEvent(evt)
}

func PushReloadDocInfo(docInfo map[string]any) {
	// 加密笔记本锁定后丢弃延迟广播，避免泄漏明文元数据（title/alias/memo/bookmark）
	if ReloadDocInfoGuard != nil {
		if boxID, ok := docInfo["box"].(string); ok && boxID != "" {
			if !ReloadDocInfoGuard(boxID) {
				return
			}
		}
	}
	BroadcastByType("filetree", "reloadDocInfo", 0, "", docInfo)
}

func PushReloadProtyle(rootID string) {
	BroadcastByType("protyle", "reload", 0, "", rootID)
}

func PushSetRefDynamicText(rootID, blockID, defBlockID, refText, boxID string) {
	// 加密笔记本锁定后丢弃延迟广播，避免泄漏明文 refText
	if ReloadDocInfoGuard != nil && boxID != "" {
		if !ReloadDocInfoGuard(boxID) {
			return
		}
	}
	BroadcastByType("main", "setRefDynamicText", 0, "", map[string]any{"rootID": rootID, "blockID": blockID, "defBlockID": defBlockID, "refText": refText})
}

func PushSetDefRefCount(rootID, blockID string, defIDs []string, refCount, rootRefCount int) {
	BroadcastByType("main", "setDefRefCount", 0, "", map[string]any{"rootID": rootID, "blockID": blockID, "refCount": refCount, "rootRefCount": rootRefCount, "defIDs": defIDs})
}

func PushProtyleLoading(rootID, msg string) {
	BroadcastByType("protyle", "addLoading", 0, msg, rootID)
}

func PushReloadEmojiConf() {
	BroadcastByType("main", "reloadEmojiConf", 0, "", nil)
}

func PushKernelPluginState(name string, state int) {
	BroadcastByType("main", "updateKernelPluginState", 0, "", map[string]any{"name": name, "state": state})
}

func PushDownloadProgress(id string, percent float32) {
	evt := NewCmdResult("downloadProgress", 0, PushModeBroadcast)
	evt.Data = map[string]any{
		"id":      id,
		"percent": percent,
	}
	PushEvent(evt)
}

func PushEvent(event *Result) {
	msg := event.Bytes()
	mode := event.PushMode
	switch mode {
	case PushModeBroadcast:
		Broadcast(msg)
	case PushModeSingleSelf:
		single(msg, event.AppId, event.SessionId)
	case PushModeBroadcastExcludeSelf:
		broadcastOthers(msg, event.SessionId)
	case PushModeBroadcastExcludeSelfApp:
		broadcastOtherApps(msg, event.AppId)
	case PushModeBroadcastApp:
		broadcastApp(msg, event.AppId)
	case PushModeBroadcastMainExcludeSelfApp:
		broadcastOtherAppMains(msg, event.AppId)
	}
}

func single(msg []byte, appId, sid string) {
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		if key != appId {
			return true
		}

		appSessions.Range(func(key, value any) bool {
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
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
			session := value.(*melody.Session)
			session.Write(msg)
			return true
		})
		return true
	})
}

func broadcastOtherApps(msg []byte, excludeApp string) {
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
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

func broadcastOtherAppMains(msg []byte, excludeApp string) {
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
			session := value.(*melody.Session)
			if app, _ := session.Get("app"); app == excludeApp {
				return true
			}

			if t, ok := session.Get("type"); ok && "main" != t {
				return true
			}

			session.Write(msg)
			return true
		})
		return true
	})
}

func broadcastApp(msg []byte, app string) {
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
			session := value.(*melody.Session)
			if sessionApp, _ := session.Get("app"); sessionApp != app {
				return true
			}
			session.Write(msg)
			return true
		})
		return true
	})
}

func broadcastOthers(msg []byte, excludeSID string) {
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
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
	sessions.Range(func(key, value any) bool {
		ret++
		return true
	})
	authSessions.Range(func(key, value any) bool {
		ret++
		return true
	})
	return
}

// ClosePublishServiceSessions 关闭所有发布服务的 WebSocket 连接
func ClosePublishServiceSessions() {
	if WebSocketServer == nil {
		return
	}

	// 收集所有发布服务的会话
	var publishSessions []*melody.Session
	sessions.Range(func(key, value any) bool {
		appSessions := value.(*sync.Map)
		appSessions.Range(func(key, value any) bool {
			session := value.(*melody.Session)
			if isPublish, ok := session.Get("isPublish"); ok && isPublish == true {
				publishSessions = append(publishSessions, session)
			}
			return true
		})
		return true
	})

	// 发送消息通知客户端关闭页面
	for _, session := range publishSessions {
		event := NewResult()
		event.Cmd = "closepublishpage"
		event.Code = 0
		event.Msg = "SiYuan publish service closed"
		event.Data = map[string]any{
			"reason": "publish service closed",
		}
		session.Write(event.Bytes())
	}

	// 等待一小段时间让消息发送完成、客户端刷新页面之后显示消息
	time.Sleep(500 * time.Millisecond)

	// 关闭所有发布服务的 WebSocket 连接
	for _, session := range publishSessions {
		// 使用 "close websocket" 作为关闭消息，客户端检测到后会停止重连
		session.CloseWithMsg([]byte("  close websocket: publish service closed"))
		RemovePushChan(session)
	}
}

var (
	// lastActivityNs 记录最近一次用户写操作（前端发送 /api/transactions* 请求）的纳秒时间戳。
	lastActivityNs atomic.Int64
	// indexFixDirty 标记索引可能已脏（上次订正后用户又有新的写操作），需要再次订正。
	indexFixDirty atomic.Bool
)

func init() {
	// 初始化为启动时间，避免启动瞬间被判定为空闲
	lastActivityNs.Store(time.Now().UnixNano())
}

// RefreshActivity 刷新用户最近活动时间，并标记索引可能已脏（需要订正）。
// 在 model.Activity 中间件中，对 /api/transactions* 写操作请求调用。
func RefreshActivity() {
	lastActivityNs.Store(time.Now().UnixNano())
	indexFixDirty.Store(true)
}

// MarkIndexClean 标记索引已订正完成，清除脏标志。订正流水线结束后调用。
func MarkIndexClean() {
	indexFixDirty.Store(false)
}

// IsIdle 自上次用户活动以来是否已超过 idleThreshold。
func IsIdle(idleThreshold time.Duration) bool {
	return time.Since(time.Unix(0, lastActivityNs.Load())) >= idleThreshold
}

// IsIndexFixDirty 返回是否存在未订正的变更（上次订正后有新用户活动）。
func IsIndexFixDirty() bool {
	return indexFixDirty.Load()
}
