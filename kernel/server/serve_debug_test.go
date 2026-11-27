// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"
	"runtime"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestServeDebugEnablesContentionProfiles(t *testing.T) {
	previousFlag := util.EnablePprof
	previousMutexRate := runtime.SetMutexProfileFraction(0)
	t.Cleanup(func() {
		util.EnablePprof = previousFlag
		runtime.SetBlockProfileRate(0)
		runtime.SetMutexProfileFraction(previousMutexRate)
	})

	util.EnablePprof = false
	disabled := gin.New()
	serveDebug(disabled)
	if len(disabled.Routes()) != 0 || runtime.SetMutexProfileFraction(-1) != 0 {
		t.Fatal("disabled pprof registered routes or enabled mutex sampling")
	}

	util.EnablePprof = true
	enabled := gin.New()
	serveDebug(enabled)
	routes := map[string]bool{}
	for _, route := range enabled.Routes() {
		if route.Method == http.MethodGet {
			routes[route.Path] = true
		}
	}
	if !routes["/debug/pprof/block"] || !routes["/debug/pprof/mutex"] {
		t.Fatal("contention profile routes are missing")
	}
	if runtime.SetMutexProfileFraction(-1) <= 0 {
		t.Fatal("mutex sampling is disabled")
	}
	<-time.After(10 * time.Millisecond)
	if count, _ := runtime.BlockProfile(nil); count == 0 {
		t.Fatal("blocking on a timer did not produce a block profile record")
	}
}
