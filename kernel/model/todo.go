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

package model

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type AgentTodoItem struct {
	Content string `json:"content"`
	Status  string `json:"status"` // pending, in_progress, completed, cancelled
}

type AgentTodoList struct {
	SessionID string          `json:"sessionID"`
	Todos     []AgentTodoItem `json:"todos"`
}

func agentTodosPath(sessionID string) string {
	return filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", sessionID, "todos.json")
}

func SaveAgentTodos(sessionID string, todos []AgentTodoItem) error {
	dir := filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", sessionID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data := AgentTodoList{
		SessionID: sessionID,
		Todos:     todos,
	}

	b, err := json.Marshal(data)
	if err != nil {
		return err
	}

	return filelock.WriteFile(agentTodosPath(sessionID), b)
}

func LoadAgentTodos(sessionID string) ([]AgentTodoItem, error) {
	path := agentTodosPath(sessionID)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, nil
	}

	b, err := filelock.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var data AgentTodoList
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}

	return data.Todos, nil
}
