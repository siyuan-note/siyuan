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
	"net/http"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/olahol/melody"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Channel struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type PublishMessage struct {
	Type     string `json:"type"`     // "string" | "binary"
	Size     int    `json:"size"`     // message size
	Filename string `json:"filename"` // empty string for string-message
}

type PublishResult struct {
	Code int    `json:"code"` // 0: success
	Msg  string `json:"msg"`  // error message

	Channel Channel        `json:"channel"`
	Message PublishMessage `json:"message"`
}

var (
	BroadcastChannels = sync.Map{}
)

const (
	StringMessageType = "string"
	BinaryMessageType = "binary"
)

// broadcast create a broadcast channel WebSocket connection
//
// @param
//
//	{
//		channel: string, // channel name
//	}
//
// @example
//
//	"ws://localhost:6806/ws/broadcast?channel=test"
func broadcast(c *gin.Context) {
	var (
		channel          string = c.Query("channel")
		broadcastChannel *melody.Melody
	)

	_broadcastChannel, exist := BroadcastChannels.Load(channel)
	if exist {
		// channel exists, use it
		broadcastChannel = _broadcastChannel.(*melody.Melody)
		if broadcastChannel.IsClosed() {
			BroadcastChannels.Delete(channel)
		} else {
			subscribe(c, broadcastChannel, channel)
			return
		}
	}
	initialize(c, channel)
}

// initialize initializes an broadcast session set
func initialize(c *gin.Context, channel string) {
	// channel not found, create a new one
	broadcastChannel := melody.New()
	broadcastChannel.Config.MaxMessageSize = 1024 * 1024 * 128 // 128 MiB

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
			broadcastChannel.Close()
			logging.LogInfof("dispose broadcast channel [%s]", channel)
		}
		return nil
	})

	for {
		// Melody Initialization is an asynchronous process, so we need to wait for it to complete
		if broadcastChannel.IsClosed() {
			time.Sleep(1 * time.Nanosecond)
		} else {
			_broadcastChannel, loaded := BroadcastChannels.LoadOrStore(channel, broadcastChannel)
			__broadcastChannel := _broadcastChannel.(*melody.Melody)
			if loaded {
				// channel exists
				if __broadcastChannel.IsClosed() {
					// channel is closed, replace it
					BroadcastChannels.Store(channel, broadcastChannel)
					__broadcastChannel = broadcastChannel
				} else {
					// channel is open, close the new one
					broadcastChannel.Close()
				}
			}
			subscribe(c, __broadcastChannel, channel)
			break
		}
	}
}

// subscribe creates a new websocket session to a channel
func subscribe(c *gin.Context, broadcastChannel *melody.Melody, channel string) {
	if err := broadcastChannel.HandleRequestWithKeys(
		c.Writer,
		c.Request,
		map[string]interface{}{
			"channel": channel,
		},
	); err != nil {
		logging.LogErrorf("create broadcast channel failed: %s", err)
		return
	}
}

// broadcastPublish push multiple binary messages to multiple broadcast channels
//
// @param
//
//	MultipartForm: [name] -> [values]
//	- name: string // channel name
//	- values:
//		- string[] // string-messages to the same channel
//		- File[] // binary-messages to the same channel
//			- filename: string // message key
//
// @returns
//
//	{
//		code: int,
//		msg: string,
//		data: {
//			results: {
//				code: int, // 0: success
//				msg: string, // error message
//				channel: {
//					name: string, // channel name
//					count: string, // subscriber count
//				},
//				message: {
//					type: string, // "string" | "binary"
//					size: int, // message size (Bytes)
//					filename: string, // empty string for string-message
//				},
//			}[],
//		},
//	}
func broadcastPublish(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	results := []*PublishResult{}

	// Multipart form
	form, err := c.MultipartForm()
	if err != nil {
		ret.Code = -2
		ret.Msg = err.Error()
		return
	}

	// Broadcast string messages
	for name, values := range form.Value {
		channel := Channel{
			Name:  name,
			Count: 0,
		}

		// Get broadcast channel
		_broadcastChannel, exist := BroadcastChannels.Load(name)
		var broadcastChannel *melody.Melody
		if exist {
			broadcastChannel = _broadcastChannel.(*melody.Melody)
			channel.Count = broadcastChannel.Len()
		} else {
			broadcastChannel = nil
			channel.Count = 0
		}

		// Broadcast each string message to the same channel
		for _, value := range values {
			content := []byte(value)
			result := &PublishResult{
				Code:    0,
				Msg:     "",
				Channel: channel,
				Message: PublishMessage{
					Type:     StringMessageType,
					Size:     len(content),
					Filename: "",
				},
			}
			results = append(results, result)

			if broadcastChannel != nil {
				err := broadcastChannel.Broadcast(content)
				if err != nil {
					logging.LogErrorf("broadcast message failed: %s", err)
					result.Code = -1
					result.Msg = err.Error()
					continue
				}
			}
		}
	}

	// Broadcast binary message
	for name, files := range form.File {
		channel := Channel{
			Name:  name,
			Count: 0,
		}

		// Get broadcast channel
		_broadcastChannel, exist := BroadcastChannels.Load(name)
		var broadcastChannel *melody.Melody
		if exist {
			broadcastChannel = _broadcastChannel.(*melody.Melody)
			channel.Count = broadcastChannel.Len()
		} else {
			broadcastChannel = nil
			channel.Count = 0
		}

		// Broadcast each binary message to the same channel
		for _, file := range files {
			result := &PublishResult{
				Code:    0,
				Msg:     "",
				Channel: channel,
				Message: PublishMessage{
					Type:     BinaryMessageType,
					Size:     int(file.Size),
					Filename: file.Filename,
				},
			}
			results = append(results, result)

			if broadcastChannel != nil {
				value, err := file.Open()
				if err != nil {
					logging.LogErrorf("open multipart form file [%s] failed: %s", file.Filename, err)
					result.Code = -2
					result.Msg = err.Error()
					continue
				}

				content := make([]byte, file.Size)
				if _, err := value.Read(content); err != nil {
					logging.LogErrorf("read multipart form file [%s] failed: %s", file.Filename, err)
					result.Code = -3
					result.Msg = err.Error()
					continue
				}

				if err := broadcastChannel.BroadcastBinary(content); err != nil {
					logging.LogErrorf("broadcast binary message failed: %s", err)
					result.Code = -1
					result.Msg = err.Error()
					continue
				}
			}
		}
	}

	ret.Data = map[string]interface{}{
		"results": results,
	}
}

// postMessage send string message to a broadcast channel
//
// @param
//
//	{
//		channel: string // channel name
//		message: string // message payload
//	}
//
// @returns
//
//	{
//		code: int,
//		msg: string,
//		data: {
//			channel: {
//				name: string, //channel name
//				count: string, //listener count
//			},
//		},
//	}
func postMessage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	message := arg["message"].(string)
	channel := &Channel{
		Name:  arg["channel"].(string),
		Count: 0,
	}

	if _broadcastChannel, ok := BroadcastChannels.Load(channel.Name); !ok {
		channel.Count = 0
	} else {
		var broadcastChannel = _broadcastChannel.(*melody.Melody)
		if err := broadcastChannel.Broadcast([]byte(message)); err != nil {
			logging.LogErrorf("broadcast message failed: %s", err)

			ret.Code = -2
			ret.Msg = err.Error()
			return
		}

		channel.Count = broadcastChannel.Len()
	}
	ret.Data = map[string]interface{}{
		"channel": channel,
	}
}

// getChannelInfo gets the information of a broadcast channel
//
// @param
//
//	{
//		name: string, // channel name
//	}
//
// @returns
//
//	{
//		code: int,
//		msg: string,
//		data: {
//			channel: {
//				name: string, //channel name
//				count: string, //listener count
//			},
//		},
//	}
func getChannelInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	channel := &Channel{
		Name:  arg["name"].(string),
		Count: 0,
	}

	if _broadcastChannel, ok := BroadcastChannels.Load(channel.Name); !ok {
		channel.Count = 0
	} else {
		var broadcastChannel = _broadcastChannel.(*melody.Melody)
		channel.Count = broadcastChannel.Len()
	}

	ret.Data = map[string]interface{}{
		"channel": channel,
	}
}

// getChannels gets the channel name and lintener number of all broadcast chanel
//
// @returns
//
//	{
//		code: int,
//		msg: string,
//		data: {
//			channels: {
//				name: string, //channel name
//				count: string, //listener count
//			}[],
//		},
//	}
func getChannels(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	channels := []*Channel{}
	BroadcastChannels.Range(func(key, value any) bool {
		broadcastChannel := value.(*melody.Melody)
		channels = append(channels, &Channel{
			Name:  key.(string),
			Count: broadcastChannel.Len(),
		})
		return true
	})
	ret.Data = map[string]interface{}{
		"channels": channels,
	}
}
