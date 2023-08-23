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

package api

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/olahol/melody"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	BroadcastChannels = sync.Map{}
)

/*
broadcast create a broadcast channel WebSocket connection

@param

	query.channel: channel name

@example

	ws://localhost:6806/ws/broadcast?channel=test
*/
func broadcast(c *gin.Context) {
	var (
		channel          string = c.Query("channel")
		broadcastChannel *melody.Melody
	)

	if _broadcastChannel, exist := BroadcastChannels.Load(channel); exist {
		// channel exists, use it
		broadcastChannel = _broadcastChannel.(*melody.Melody)
	} else {
		// channel not found, create a new one
		broadcastChannel := melody.New()
		BroadcastChannels.Store(channel, broadcastChannel)

		// broadcast string message to other session
		broadcastChannel.HandleMessage(func(s *melody.Session, msg []byte) {
			broadcastChannel.BroadcastOthers(msg, s)
		})

		// broadcast binary message to other session
		broadcastChannel.HandleMessageBinary(func(s *melody.Session, msg []byte) {
			broadcastChannel.BroadcastBinaryOthers(msg, s)
		})

		// recycling
		broadcastChannel.HandleClose(func(s *melody.Session, status int, reason string) error {
			channel := s.Keys["channel"].(string)
			logging.LogInfof("close broadcast session in channel [%s] with status code %d: %s", channel, status, reason)

			count := broadcastChannel.Len()
			if count == 0 {
				BroadcastChannels.Delete(channel)
				logging.LogInfof("dispose broadcast channel [%s]", channel)
			}
			return nil
		})
	}

	// create a new websocket connect
	if err := broadcastChannel.HandleRequestWithKeys(
		c.Writer,
		c.Request,
		map[string]interface{}{
			"channel": channel,
		},
	); nil != err {
		logging.LogErrorf("create broadcast channel failed: %s", err)
		return
	}
}

/*
postMessage send string message to a broadcast channel

@param

	body.channel: channel name
	body.message: message payload

@returns

	body.data.count: indicate how many websocket session received the message
*/
func postMessage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	channel := arg["channel"].(string)
	message := arg["message"].(string)

	if _broadcastChannel, ok := BroadcastChannels.Load(channel); !ok {
		err := fmt.Errorf("broadcast channel [%s] not found", channel)
		logging.LogWarnf(err.Error())

		ret.Code = -1
		ret.Msg = err.Error()
		return
	} else {
		var broadcastChannel = _broadcastChannel.(*melody.Melody)
		if err := broadcastChannel.Broadcast([]byte(message)); nil != err {
			logging.LogErrorf("broadcast message failed: %s", err)

			ret.Code = -2
			ret.Msg = err.Error()
			return
		}

		count := broadcastChannel.Len()
		ret.Data = map[string]interface{}{
			"count": count,
		}
	}
}

/*
getListenerCount gets the number of broadcast listeners in a channel

@param

	body.channel: channel name

@returns

	body.data.count: indicate how many websocket session received the message
*/
func getListenerCount(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	channel := arg["channel"].(string)

	if _broadcastChannel, ok := BroadcastChannels.Load(channel); !ok {
		err := fmt.Errorf("broadcast channel [%s] not found", channel)
		logging.LogWarnf(err.Error())

		ret.Code = -1
		ret.Msg = err.Error()
		return
	} else {
		var broadcastChannel = _broadcastChannel.(*melody.Melody)

		count := broadcastChannel.Len()
		ret.Data = map[string]interface{}{
			"count": count,
		}
	}
}
