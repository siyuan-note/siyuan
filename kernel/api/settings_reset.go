package api

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var settingsResetMu sync.Mutex
var settingsResetPreparation struct {
	sync.Mutex
	waiter *settingsResetWaiter
}

type settingsResetWaiter struct {
	pending map[string]bool
	results chan bool
}

func (waiter *settingsResetWaiter) wait(ctx context.Context) error {
	for range cap(waiter.results) {
		select {
		case saved := <-waiter.results:
			if !saved {
				return errors.New("could not save pending input")
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

var confirmSettingsReset = contractHandler(apicontract.ConfirmSettingsReset,
	func(c *gin.Context, request apicontract.ConfirmSettingsResetRequest) apicontract.Response[apicontract.Null] {
		settingsResetPreparation.Lock()
		defer settingsResetPreparation.Unlock()
		waiter := settingsResetPreparation.waiter
		if waiter == nil || !waiter.pending[request.Token] {
			return apicontract.Failure[apicontract.Null](-1, "settings reset is not awaiting this client")
		}
		waiter.pending[request.Token] = false
		waiter.results <- request.Saved
		return apicontract.Success(apicontract.Null{})
	})

var resetSettings = contractHandler(apicontract.ResetSettings,
	func(c *gin.Context, request apicontract.ResetSettingsRequest) apicontract.Response[apicontract.Null] {
		if !settingsResetMu.TryLock() {
			return apicontract.Failure[apicontract.Null](-1, "settings reset is already running")
		}
		defer settingsResetMu.Unlock()
		defer beginSettingTask("resetSettings")()
		id := gulu.Rand.String(32)
		sessions := util.SessionsByType("main")
		waiter := &settingsResetWaiter{pending: map[string]bool{}, results: make(chan bool, len(sessions))}
		tokens := make([]string, len(sessions))
		for i := range sessions {
			tokens[i] = gulu.Rand.String(32)
			waiter.pending[tokens[i]] = true
		}
		settingsResetPreparation.Lock()
		settingsResetPreparation.waiter = waiter
		settingsResetPreparation.Unlock()
		defer func() {
			settingsResetPreparation.Lock()
			settingsResetPreparation.waiter = nil
			settingsResetPreparation.Unlock()
		}()
		committed := false
		defer func() {
			if !committed {
				util.BroadcastByType("main", "cancelSettingsReset", 0, "", id)
			}
		}()
		for i, session := range sessions {
			event := util.NewResult()
			event.Cmd = "prepareSettingsReset"
			event.Data = map[string]string{"id": id, "token": tokens[i]}
			if err := session.Write(event.Bytes()); err != nil {
				return apicontract.Failure[apicontract.Null](-1, "could not prepare connected client")
			}
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()
		if err := waiter.wait(ctx); err != nil {
			return apicontract.Failure[apicontract.Null](-1, util.I18nTerm(model.Conf.Lang, "settingsPendingSaveError"))
		}
		// 前端确认之后串行提交，与普通设置更新、布局和本地存储写入使用相同的互斥。
		settingMutationMu.Lock()
		defer settingMutationMu.Unlock()
		// 等待期间新接入的客户端尚未保存输入，此次操作应取消并由用户重试。
		for _, current := range util.SessionsByType("main") {
			prepared := false
			for _, session := range sessions {
				if current == session {
					prepared = true
					break
				}
			}
			if !prepared {
				return apicontract.Failure[apicontract.Null](-1, util.I18nTerm(model.Conf.Lang, "settingsPendingSaveError"))
			}
		}
		model.FlushTxQueue()
		previousSearch := model.Conf.Search
		if err := model.ResetSettings(); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		model.ApplyResetSettings(previousSearch)
		committed = true
		return apicontract.WithAfterWrite(apicontract.Success(apicontract.Null{}), func() {
			util.BroadcastByType("main", "settingsReset", 0, "", struct {
				ID   string `json:"id"`
				Exit bool   `json:"exit"`
			}{id, request.Exit})
		})
	})
