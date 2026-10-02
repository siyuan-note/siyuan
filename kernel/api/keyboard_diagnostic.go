package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

var appendKeyboardLog = contractHandler(apicontract.SystemAppendKeyboardLog,
	func(c *gin.Context, request apicontract.SystemKeyboardLogRequest) apicontract.Response[apicontract.Null] {
		if !validKeyboardLog(request) {
			return apicontract.Failure[apicontract.Null](-1, "invalid keyboard diagnostic records")
		}
		data, err := json.Marshal(request)
		if err != nil {
			return apicontract.Failure[apicontract.Null](-1, "encode keyboard diagnostic records failed")
		}
		logging.LogInfof("keyboard diagnostic [issue=20006] %s", data)
		return apicontract.Success(apicontract.Null{})
	}, func(c *gin.Context) *apicontract.Response[apicontract.Null] {
		// 限制读取大小，避免诊断接口接收无界请求。
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
		return nil
	})

func validKeyboardLog(request apicontract.SystemKeyboardLogRequest) bool {
	if len(request.Session) == 0 || len(request.Session) > 64 ||
		strings.IndexFunc(request.Session, func(r rune) bool {
			return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-')
		}) >= 0 || len(request.Entries) == 0 || len(request.Entries) > 50 {
		return false
	}
	for _, entry := range request.Entries {
		if entry.Seq < 1 || entry.Time < 1 || entry.Event < 0 ||
			!slices.Contains([]string{"", "keydown", "keyup", "input-target", "av-interactive", "composing", "progress",
				"error-log", "card-key", "plain-key", "default-prevented", "filtered", "search-keydown", "menu-keydown",
				"av-panel", "editor-handled", "missing-key", "executed", "notFound", "unavailable", "disabled",
				"exception", "string", "string-array", "invalid-data", "mobile"}, entry.Detail) ||
			!slices.Contains([]string{"environment", "capture", "settled", "compositionstart", "compositionend",
				"window-enter", "window-stop", "mobile-enter", "mobile-stop", "filter-stop", "editor-stop",
				"command-enter", "command-result", "command-error", "search-enter", "path-start", "path-error", "path-result", "path-stale",
				"dialog-created", "dialog-reused"}, entry.Stage) ||
			!slices.Contains([]string{"", "search", "globalSearch"}, entry.Command) {
			return false
		}
		if event := entry.Keyboard; event != nil {
			if !slices.Contains([]string{"f", "F", "p", "P", "Meta", "Control", "Unidentified", "Process", "Other"}, event.Key) ||
				!slices.Contains([]string{"KeyF", "KeyP", "MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "Other"}, event.Code) ||
				!slices.Contains([]string{"input", "textarea", "editor", "body", "other"}, event.Target) ||
				event.KeyCode < 0 || event.KeyCode > 255 {
				return false
			}
		}
		if env := entry.Environment; env != nil {
			if len(env.Version) > 64 || len(env.UserAgent) > 512 || len(env.Platform) > 64 ||
				!slices.Contains([]string{"desktop", "mobile"}, env.Frontend) || len(env.Search) > 8 || len(env.GlobalSearch) > 8 {
				return false
			}
			for _, binding := range append(append([]string{}, env.Search...), env.GlobalSearch...) {
				if len(binding) > 64 {
					return false
				}
			}
		}
	}
	return true
}
