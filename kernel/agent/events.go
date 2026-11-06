// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"errors"
	"time"
)

const EventDeliveryTimeout = 5 * time.Second

var ErrSessionTimeout = errors.New("agent session timeout")
var errSlowConsumer = errors.New("agent event consumer is too slow")

func sendEvent(ctx context.Context, ch chan<- AgentEvent, event AgentEvent) {
	if ctx.Err() != nil {
		return
	}
	select {
	case ch <- event:
	case <-ctx.Done():
	}
}

// 调用方在断开连接或取消后仍须排空输出；API 的后台排空负责完成运行状态通知。
// 生产者在关闭 input 前收尾检查点和工具结果；保存失败仍由恢复协议阻止提交。
func relayAgentEvents(ctx context.Context, cancel context.CancelCauseFunc, input <-chan AgentEvent,
	timeout time.Duration, interruptionMessage func(error) string) <-chan AgentEvent {
	output := make(chan AgentEvent)
	go func() {
		defer close(output)
		defer cancel(nil)
		terminal := false
		for event := range input {
			timer := time.NewTimer(timeout)
			select {
			case output <- event:
				timer.Stop()
			case <-timer.C:
				cancel(errSlowConsumer)
				// 超时结束生成，但已接收的事件仍按序交给恢复的消费者或 API 后台排空。
				output <- event
			}
			terminal = terminal || event.Type == "done" || event.Type == "error" || event.Type == "interrupted"
		}
		if !terminal {
			output <- AgentEvent{Type: "interrupted", Error: interruptionMessage(context.Cause(ctx))}
		}
	}()
	return output
}
