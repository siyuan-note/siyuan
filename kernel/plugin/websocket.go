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

package plugin

import (
	"sync/atomic"

	"github.com/dop251/goja"
	"github.com/lxzan/gws"
	"github.com/siyuan-note/logging"
)

type WsManager struct {
	BufferedAmount *atomic.Int64

	InvokeHook    func(rt *goja.Runtime, eventName string, args ...goja.Value)
	SetProtocol   func(rt *goja.Runtime, protocol string)
	SetReadyState func(rt *goja.Runtime, state WebSocketState)
}

// WsEventHandler implements gws.Event with settable callback fields so closures
// capturing the JS runtime context can be assigned after the upgrader/dialer is created.
type WsEventHandler struct {
	gws.BuiltinEventHandler
	onOpen    func(*gws.Conn)
	onClose   func(*gws.Conn, error)
	onPing    func(*gws.Conn, []byte)
	onPong    func(*gws.Conn, []byte)
	onMessage func(*gws.Conn, *gws.Message)

	p *KernelPlugin
}

func (h *WsEventHandler) OnOpen(socket *gws.Conn) {
	if h.onOpen != nil {
		h.onOpen(socket)
	}
}

func (h *WsEventHandler) OnClose(socket *gws.Conn, err error) {
	if h.onClose != nil {
		h.onClose(socket, err)
	}
}

func (h *WsEventHandler) OnPing(socket *gws.Conn, payload []byte) {
	if h.onPing != nil {
		h.onPing(socket, payload)
	}
}

func (h *WsEventHandler) OnPong(socket *gws.Conn, payload []byte) {
	if h.onPong != nil {
		h.onPong(socket, payload)
	}
}

func (h *WsEventHandler) OnMessage(socket *gws.Conn, message *gws.Message) {
	if h.onMessage != nil {
		h.onMessage(socket, message)
	} else {
		message.Close()
	}
}

func (h *WsEventHandler) BindOnOpen(manager *WsManager) {
	h.onOpen = func(conn *gws.Conn) {
		_, runErr := h.p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
			manager.SetProtocol(rt, conn.SubProtocol())
			manager.SetReadyState(rt, WebSocketReadyStateOpen)
			event := rt.NewObject()
			event.Set("type", rt.ToValue("open"))
			manager.InvokeHook(rt, "onopen", event)
			return
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] invoke websocket.onopen handler error: %v", h.p.Name, runErr)
		}
	}
}

func (h *WsEventHandler) BindOnClose(manager *WsManager) {
	h.onClose = func(conn *gws.Conn, err error) {
		_, runErr := h.p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
			if err != nil {
				errEvent := rt.NewObject()
				errEvent.Set("type", rt.ToValue("error"))
				errEvent.Set("error", rt.NewGoError(err))
				manager.InvokeHook(rt, "onerror", errEvent)
			}

			if closeError, ok := err.(*gws.CloseError); ok {
				manager.SetReadyState(rt, WebSocketReadyStateClosing)
				closeEvent := rt.NewObject()
				closeEvent.Set("type", rt.ToValue("close"))
				closeEvent.Set("code", rt.ToValue(closeError.Code))
				closeEvent.Set("reason", rt.ToValue(string(closeError.Reason)))
				closeEvent.Set("wasClean", rt.ToValue(manager.BufferedAmount.Load() == 0))
				manager.InvokeHook(rt, "onclose", closeEvent)
			}
			manager.SetReadyState(rt, WebSocketReadyStateClosed)
			return
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] invoke websocket.onclose handler error: %v", h.p.Name, runErr)
		}
	}
}

func (h *WsEventHandler) BindOnPing(manager *WsManager) {
	h.onPing = func(conn *gws.Conn, payload []byte) {
		_, runErr := h.p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
			event := rt.NewObject()
			event.Set("type", rt.ToValue("ping"))
			event.Set("data", rt.ToValue(string(payload)))
			manager.InvokeHook(rt, "onping", event)
			return
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] invoke websocket.onping handler error: %v", h.p.Name, runErr)
		}
	}
}

func (h *WsEventHandler) BindOnPong(manager *WsManager) {
	h.onPong = func(conn *gws.Conn, payload []byte) {
		_, runErr := h.p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
			event := rt.NewObject()
			event.Set("type", rt.ToValue("pong"))
			event.Set("data", rt.ToValue(string(payload)))
			manager.InvokeHook(rt, "onpong", event)
			return
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] invoke websocket.onpong handler error: %v", h.p.Name, runErr)
		}
	}
}

func (h *WsEventHandler) BindOnMessage(manager *WsManager) {
	h.onMessage = func(conn *gws.Conn, message *gws.Message) {
		defer message.Close()
		opcode := message.Opcode
		data := make([]byte, message.Data.Len())
		copy(data, message.Bytes()) // message.Bytes() points into gws-managed memory reclaimed by message.Close() (deferred above)
		_, runErr := h.p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
			event := rt.NewObject()
			switch opcode {
			case gws.OpcodeText:
				event.Set("type", rt.ToValue("text"))
				event.Set("data", rt.ToValue(string(data)))
			case gws.OpcodeBinary:
				event.Set("type", rt.ToValue("binary"))
				event.Set("data", rt.ToValue(rt.NewArrayBuffer(data)))
			default:
				return
			}
			manager.InvokeHook(rt, "onmessage", event)
			return
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] invoke websocket.onmessage handler error: %v", h.p.Name, runErr)
		}
	}
}
