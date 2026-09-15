// SiYuan - From thought to insight, with agents
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
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/sashabaranov/go-openai"
)

// reasoningResponseTransport 将不同 OpenAI 兼容服务商的思考字段统一为 SDK 支持的字段。
// 该适配器按 SSE 行处理响应，不会等待整个流结束后才把内容交给上层。
type reasoningResponseTransport struct {
	base openai.HTTPDoer
}

func (t *reasoningResponseTransport) Do(req *http.Request) (*http.Response, error) {
	resp, err := t.base.Do(req)
	if err != nil || resp == nil || resp.Body == nil || req.Method != http.MethodPost ||
		!strings.Contains(req.URL.Path, "chat/completions") {
		return resp, err
	}
	if strings.Contains(strings.ToLower(req.Header.Get("Accept")), "text/event-stream") ||
		strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		resp.Body = newReasoningResponseBody(resp.Body, true)
	} else {
		resp.Body = newReasoningResponseBody(resp.Body, false)
	}
	resp.ContentLength = -1
	resp.Header.Del("Content-Length")
	return resp, nil
}

type reasoningResponseBody struct {
	source      io.ReadCloser
	reader      *bufio.Reader
	sse         bool
	output      []byte
	terminalErr error
	done        bool
}

func newReasoningResponseBody(source io.ReadCloser, sse bool) *reasoningResponseBody {
	return &reasoningResponseBody{source: source, reader: bufio.NewReader(source), sse: sse}
}

func (r *reasoningResponseBody) Read(p []byte) (int, error) {
	for len(r.output) == 0 && !r.done {
		var data []byte
		var err error
		if r.sse {
			data, err = r.reader.ReadBytes('\n')
		} else {
			data, err = io.ReadAll(r.reader)
			r.done = true
		}
		if len(data) > 0 {
			if r.sse {
				r.output = normalizeReasoningResponseLine(data)
			} else if normalized, changed := normalizeReasoningJSON(data); changed {
				r.output = normalized
			} else {
				r.output = data
			}
		}
		if err != nil {
			r.terminalErr = err
			r.done = true
		}
	}
	if len(r.output) > 0 {
		n := copy(p, r.output)
		r.output = r.output[n:]
		return n, nil
	}
	if r.terminalErr != nil {
		return 0, r.terminalErr
	}
	return 0, io.EOF
}

func (r *reasoningResponseBody) Close() error {
	return r.source.Close()
}

func normalizeReasoningResponseLine(line []byte) []byte {
	trimmed := bytes.TrimLeft(line, " \t")
	if !bytes.HasPrefix(trimmed, []byte("data:")) {
		return line
	}
	dataStart := len(line) - len(trimmed) + len("data:")
	data := line[dataStart:]
	var lineEnding []byte
	if bytes.HasSuffix(data, []byte("\n")) {
		data = data[:len(data)-1]
		lineEnding = []byte("\n")
	}
	if bytes.HasSuffix(data, []byte("\r")) {
		data = data[:len(data)-1]
		lineEnding = []byte("\r\n")
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 || bytes.Equal(data, []byte("[DONE]")) {
		return line
	}
	normalized, changed := normalizeReasoningJSON(data)
	if !changed {
		return line
	}
	result := append([]byte{}, line[:dataStart-len("data:")]...)
	result = append(result, []byte("data: ")...)
	result = append(result, normalized...)
	return append(result, lineEnding...)
}

func normalizeReasoningJSON(data []byte) ([]byte, bool) {
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, false
	}
	changed := false
	choices, _ := payload["choices"].([]any)
	for _, rawChoice := range choices {
		choice, _ := rawChoice.(map[string]any)
		if choice == nil {
			continue
		}
		for _, field := range []string{"delta", "message"} {
			value, _ := choice[field].(map[string]any)
			if value != nil && normalizeReasoningFields(value) {
				changed = true
			}
		}
	}
	if !changed {
		return data, false
	}
	normalized, err := json.Marshal(payload)
	if err != nil {
		return data, false
	}
	return normalized, true
}

func normalizeReasoningFields(message map[string]any) bool {
	if reasoningContent, ok := message["reasoning_content"]; ok && reasoningContent != nil {
		return false
	}
	if text, ok := message["reasoning"].(string); ok && text != "" {
		message["reasoning_content"] = text
		return true
	}
	return false
}
