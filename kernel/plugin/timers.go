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
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
)

// pluginTimerState 维护单个插件注册的 setTimeout/setInterval 计时器,供 clearTimeout/clearInterval 停止。
type pluginTimerState struct {
	mu     sync.Mutex
	timers map[uint64]func() // id -> 幂等 stop
	nextID atomic.Uint64
}

func (s *pluginTimerState) stop(id uint64) {
	s.mu.Lock()
	stop, ok := s.timers[id]
	delete(s.timers, id)
	s.mu.Unlock()
	if ok && stop != nil {
		stop()
	}
}

func (s *pluginTimerState) stopAll() {
	s.mu.Lock()
	stops := make([]func(), 0, len(s.timers))
	for id, stop := range s.timers {
		stops = append(stops, stop)
		delete(s.timers, id)
	}
	s.mu.Unlock()
	for _, stop := range stops {
		if stop != nil {
			stop()
		}
	}
}

// injectTimers 向 goja 全局注入 setTimeout/clearTimeout/setInterval/clearInterval,
// 回调经 p.worker.RunSync 串行投递到 goja 事件循环,保证线程安全。
// 这补齐了 goja_nodejs 默认未启用的 timers 模块,使内核插件可用与浏览器一致的事件驱动调度。
func injectTimers(p *KernelPlugin, rt *goja.Runtime) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectTimers: %v", r)
		}
	}()

	state := &pluginTimerState{timers: map[uint64]func()}

	go func() {
		<-p.context.Done()
		state.stopAll()
	}()

	// schedule 注册一个计时器:repeat=false 为 setTimeout(一次性),repeat=true 为 setInterval(固定延迟)。
	// 返回 timer id,供 clearTimeout/clearInterval 使用。回调在 Go timer goroutine 触发后经 worker 投递到 goja。
	// repeat 模式用递归 AfterFunc 重新安排下一轮(而非 t.Reset),避免 timer 变量赋值与回调的竞态。
	schedule := func(fn goja.Callable, args []goja.Value, delay time.Duration, repeat bool) uint64 {
		id := state.nextID.Add(1)
		var t *time.Timer
		var timerMu sync.Mutex
		stopped := false
		setTimer := func(next *time.Timer) {
			timerMu.Lock()
			if stopped {
				next.Stop()
			} else {
				t = next
			}
			timerMu.Unlock()
		}
		stop := func() {
			timerMu.Lock()
			stopped = true
			if t != nil {
				t.Stop()
			}
			timerMu.Unlock()
			state.mu.Lock()
			delete(state.timers, id)
			state.mu.Unlock()
		}
		run := func() {
			_, runErr := p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
				defer func() {
					if r := recover(); r != nil {
						logging.LogErrorf("[plugin:%s] timer callback panic: %v", p.Name, r)
					}
				}()
				if _, callErr := fn(goja.Undefined(), args...); callErr != nil {
					logging.LogErrorf("[plugin:%s] timer callback error: %v", p.Name, callErr)
				}
				return
			})
			if runErr != nil {
				// worker 已停止(插件卸载),清理本计时器避免后续泄漏
				stop()
			}
		}
		// 先注册到 map 再启动 timer,保证 delay=0 时回调也能查到 exists
		state.mu.Lock()
		state.timers[id] = stop
		state.mu.Unlock()
		if repeat {
			var fire func()
			fire = func() {
				setTimer(time.AfterFunc(delay, func() {
					run()
					state.mu.Lock()
					_, exists := state.timers[id]
					state.mu.Unlock()
					if exists {
						fire() // 未被 clear,递归安排下一轮(固定延迟:上一轮回调完成后再等 delay)
					}
				}))
			}
			fire()
		} else {
			setTimer(time.AfterFunc(delay, func() {
				run()
				stop()
			}))
		}
		return id
	}

	setTimeout := rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		fn, ok := goja.AssertFunction(call.Argument(0))
		if !ok {
			return goja.Undefined()
		}
		delay := time.Duration(call.Argument(1).ToInteger()) * time.Millisecond
		if delay < 0 {
			delay = 0
		}
		var args []goja.Value
		if len(call.Arguments) > 2 {
			args = call.Arguments[2:]
		}
		id := schedule(fn, args, delay, false)
		return rt.ToValue(id)
	})
	setInterval := rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		fn, ok := goja.AssertFunction(call.Argument(0))
		if !ok {
			return goja.Undefined()
		}
		delay := time.Duration(call.Argument(1).ToInteger()) * time.Millisecond
		if delay < 0 {
			delay = 0
		}
		var args []goja.Value
		if len(call.Arguments) > 2 {
			args = call.Arguments[2:]
		}
		id := schedule(fn, args, delay, true)
		return rt.ToValue(id)
	})
	clearTimer := rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		if idVal := call.Argument(0); isJsValueNotNull(idVal) {
			id := uint64(idVal.ToInteger())
			state.stop(id)
		}
		return goja.Undefined()
	})

	lo.Must0(rt.GlobalObject().Set("setTimeout", setTimeout))
	lo.Must0(rt.GlobalObject().Set("setInterval", setInterval))
	lo.Must0(rt.GlobalObject().Set("clearTimeout", clearTimer))
	lo.Must0(rt.GlobalObject().Set("clearInterval", clearTimer)) // clearInterval 与 setTimeout 共用同一停止逻辑
	return
}
