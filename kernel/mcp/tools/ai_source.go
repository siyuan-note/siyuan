// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"context"

	"github.com/siyuan-note/siyuan/kernel/model"
)

type agentWriteContextKey struct{}

func ContextWithAgentWrite(ctx context.Context) context.Context {
	return context.WithValue(ctx, agentWriteContextKey{}, true)
}

func isAgentWrite(ctx context.Context) bool {
	return ctx.Value(agentWriteContextKey{}) == true
}

func markAgentWriteDOM(ctx context.Context, dom string) string {
	if isAgentWrite(ctx) {
		return model.AgentBlockDOM(dom)
	}
	return dom
}
