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
	"github.com/gin-contrib/sse"
	"github.com/gin-gonic/gin"
	"github.com/olahol/melody"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	MessageTypeString MessageType = "string"
	MessageTypeBinary MessageType = "binary"

	MessageTypeClose MessageType = "close"
)

type MessageType string
type MessageEventChannel chan *MessageEvent

type MessageEvent struct {
	Type MessageType
	Name string // channel name
	Data []byte
}

type BroadcastSubscriber struct {
	Count int // SEE subscriber count
}

type BroadcastChannel struct {
	Name       string // channel name
	WebSocket  *melody.Melody
	Subscriber *BroadcastSubscriber // SEE subscriber
}

// SubscriberCount gets the total number of subscribers
func (b *BroadcastChannel) SubscriberCount() int {
	return b.WebSocket.Len() + b.Subscriber.Count + UnifiedSSE.Subscriber.Count()
}

// BroadcastString broadcast string message to all subscribers
func (b *BroadcastChannel) BroadcastString(message string) (sent bool, err error) {
	data := []byte(message)
	sent = UnifiedSSE.SendEvent(&MessageEvent{
		Type: MessageTypeString,
		Name: b.Name,
		Data: data,
	})
	err = b.WebSocket.Broadcast(data)
	return
}

// BroadcastBinary broadcast binary message to all subscribers
func (b *BroadcastChannel) BroadcastBinary(data []byte) (sent bool, err error) {
	sent = UnifiedSSE.SendEvent(&MessageEvent{
		Type: MessageTypeBinary,
		Name: b.Name,
		Data: data,
	})
	err = b.WebSocket.BroadcastBinary(data)
	return
}

func (b *BroadcastChannel) HandleRequest(c *gin.Context) {
	if err := b.WebSocket.HandleRequestWithKeys(
		c.Writer,
		c.Request,
		map[string]interface{}{
			"channel": b.Name,
		},
	); err != nil {
		logging.LogErrorf("create broadcast channel failed: %s", err)
		return
	}
}

func (b *BroadcastChannel) Subscribed() bool {
	return b.SubscriberCount() > 0
}

func (b *BroadcastChannel) Destroy(force bool) bool {
	if force || b.Subscribed() {
		b.WebSocket.Close()
		UnifiedSSE.SendEvent(&MessageEvent{
			Type: MessageTypeClose,
			Name: b.Name,
		})
		logging.LogInfof("destroy broadcast channel [%s]", b.Name)
		return true
	}
	return false
}

type ServerSentEventSubscriber struct {
	lock  *sync.Mutex
	count int
}

func (s *ServerSentEventSubscriber) updateCount(delta int) {
	defer s.lock.Unlock()
	s.lock.Lock()
	s.count += delta
}

func (s *ServerSentEventSubscriber) Count() int {
	defer s.lock.Unlock()
	s.lock.Lock()
	return s.count
}

type ServerSentEvent struct {
	Channel    MessageEventChannel
	WaitGroup  *sync.WaitGroup
	Subscriber *ServerSentEventSubscriber
}

func (s *ServerSentEvent) SendEvent(event *MessageEvent) bool {
	select {
	case s.Channel <- event:
		return true
	default:
		return false
	}
}

// Subscribe subscribes to specified broadcast channels
func (s *ServerSentEvent) Subscribe(c *gin.Context, channels ...string) {
	logging.LogDebugf("[%s] Subscribe: %v", c.Request.URL.RequestURI(), channels)

	defer s.WaitGroup.Done()
	s.WaitGroup.Add(1)

	wg := sync.WaitGroup{}
	wg.Add(len(channels))
	for _, channel := range channels {
		go func() {
			defer wg.Done()

			var broadcastChannel *BroadcastChannel
			_broadcastChannel, exist := BroadcastChannels.Load(channel)
			if exist { // channel exists, use it
				broadcastChannel = _broadcastChannel.(*BroadcastChannel)
			} else {
				broadcastChannel = ConstructBroadcastChannel(channel)
			}
			broadcastChannel.Subscriber.Count++
		}()
	}
	wg.Wait()

	channelSet := make(map[string]struct{})
	for _, channel := range channels {
		channelSet[channel] = struct{}{}
	}

	s.SSEvent(c, &sse.Event{
		Retry: 1000,
		Data:  "retry",
	})
	c.Writer.Flush()

	s.Stream(c, func(event *MessageEvent, ok bool) bool {
		if ok {
			if _, exists := channelSet[event.Name]; exists {
				switch event.Type {
				case MessageTypeClose:
					return false
				case MessageTypeString:
					c.SSEvent(event.Name, string(event.Data))
				default:
					c.SSEvent(event.Name, event.Data)
				}
				c.Writer.Flush()
				return true
			}
			return true
		}
		return false
	})

	wg.Add(len(channels))
	for _, channel := range channels {
		go func() {
			defer wg.Done()
			_broadcastChannel, exist := BroadcastChannels.Load(channel)
			if exist {
				broadcastChannel := _broadcastChannel.(*BroadcastChannel)
				broadcastChannel.Subscriber.Count--
				if !broadcastChannel.Subscribed() {
					BroadcastChannels.Delete(channel)
					broadcastChannel.Destroy(true)
				}
			}
		}()
	}
	wg.Wait()
	logging.LogDebugf("[%s] Subscribe END", c.Request.URL.RequestURI())
}

// SubscribeAll subscribes to all broadcast channels
func (s *ServerSentEvent) SubscribeAll(c *gin.Context) {
	logging.LogDebugf("[%s] SubscribeAll", c.Request.URL.RequestURI())

	defer s.WaitGroup.Done()
	s.WaitGroup.Add(1)

	s.Subscriber.updateCount(1)

	s.SSEvent(c, &sse.Event{
		Retry: 1000,
		Data:  "retry",
	})
	c.Writer.Flush()

	s.Stream(c, func(event *MessageEvent, ok bool) bool {
		if ok {
			switch event.Type {
			case MessageTypeClose:
				return true
			case MessageTypeString:
				c.SSEvent(event.Name, string(event.Data))
			default:
				c.SSEvent(event.Name, event.Data)
			}
			c.Writer.Flush()
			return true
		}
		return false
	})

	s.Subscriber.updateCount(-1)
	PruneBroadcastChannels()

	logging.LogDebugf("[%s] SubscribeAll END", c.Request.URL.RequestURI())
}

// Stream streams message to client
func (s *ServerSentEvent) Stream(c *gin.Context, step func(event *MessageEvent, ok bool) bool) bool {
	clientGone := c.Writer.CloseNotify()
	for {
		select {
		case <-clientGone:
			return true
		case event, ok := <-s.Channel:
			if step(event, ok) {
				continue
			}
			return false
		}
	}
}

// SSEvent writes a Server-Sent Event into the body stream.
func (s *ServerSentEvent) SSEvent(c *gin.Context, event *sse.Event) {
	c.Render(-1, event)
}

var (
	BroadcastChannels = sync.Map{} // [string (channel-name)] -> *BroadcastChannel

	UnifiedSSE = &ServerSentEvent{
		Channel:   make(chan *MessageEvent, 1024),
		WaitGroup: &sync.WaitGroup{},
		Subscriber: &ServerSentEventSubscriber{
			lock:  &sync.Mutex{},
			count: 0,
		},
	}
)

type ChannelInfo struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type PublishMessage struct {
	Type     MessageType `json:"type"`     // "string" | "binary"
	Size     int         `json:"size"`     // message size
	Filename string      `json:"filename"` // empty string for string-message
}

type PublishResult struct {
	Code int    `json:"code"` // 0: success
	Msg  string `json:"msg"`  // error message

	Channel ChannelInfo    `json:"channel"`
	Message PublishMessage `json:"message"`
}

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
		broadcastChannel *BroadcastChannel
	)

	_broadcastChannel, exist := BroadcastChannels.Load(channel)
	if exist { // channel exists, use it
		broadcastChannel = _broadcastChannel.(*BroadcastChannel)
		if broadcastChannel.WebSocket.IsClosed() { // channel is closed
			// delete channel before creating a new one
			DestroyBroadcastChannel(channel, true)
		} else { // channel is open
			// connect to the existing channel
			broadcastChannel.HandleRequest(c)
			return
		}
	}

	// create a new channel
	broadcastChannel = ConstructBroadcastChannel(channel)
	broadcastChannel.HandleRequest(c)
}

// ConstructBroadcastChannel creates a broadcast channel
func ConstructBroadcastChannel(channel string) *BroadcastChannel {
	websocket := melody.New()
	websocket.Config.MaxMessageSize = 1024 * 1024 * 128 // 128 MiB

	// broadcast string message to other session
	websocket.HandleMessage(func(s *melody.Session, msg []byte) {
		UnifiedSSE.SendEvent(&MessageEvent{
			Type: MessageTypeString,
			Name: channel,
			Data: msg,
		})
		websocket.BroadcastOthers(msg, s)
	})

	// broadcast binary message to other session
	websocket.HandleMessageBinary(func(s *melody.Session, msg []byte) {
		UnifiedSSE.SendEvent(&MessageEvent{
			Type: MessageTypeBinary,
			Name: channel,
			Data: msg,
		})
		websocket.BroadcastBinaryOthers(msg, s)
	})

	// client close the connection
	websocket.HandleClose(func(s *melody.Session, status int, reason string) error {
		channel := s.Keys["channel"].(string)
		logging.LogInfof("close broadcast session in channel [%s] with status code %d: %s", channel, status, reason)

		DestroyBroadcastChannel(channel, false)
		return nil
	})

	var broadcastChannel *BroadcastChannel
	for {
		// Melody Initialization is an asynchronous process, so we need to wait for it to complete
		if websocket.IsClosed() {
			time.Sleep(1 * time.Nanosecond)
		} else {
			newBroadcastChannel := &BroadcastChannel{
				Name:      channel,
				WebSocket: websocket,
				Subscriber: &BroadcastSubscriber{
					Count: 0,
				},
			}
			_broadcastChannel, loaded := BroadcastChannels.LoadOrStore(channel, newBroadcastChannel)
			broadcastChannel = _broadcastChannel.(*BroadcastChannel)
			if loaded { // channel exists
				if broadcastChannel.WebSocket.IsClosed() { // channel is closed, replace it
					BroadcastChannels.Store(channel, newBroadcastChannel)
					broadcastChannel = newBroadcastChannel
				} else { // channel is open, destroy the new one
					newBroadcastChannel.Destroy(true)
				}
			}
			break
		}
	}
	return broadcastChannel
}

// DestroyBroadcastChannel tries to destroy a broadcast channel
//
// Return true if the channel destroy successfully, otherwise false
func DestroyBroadcastChannel(channel string, force bool) bool {
	_broadcastChannel, exist := BroadcastChannels.Load(channel)
	if !exist {
		return true
	}

	broadcastChannel := _broadcastChannel.(*BroadcastChannel)
	if force || !broadcastChannel.Subscribed() {
		BroadcastChannels.Delete(channel)
		broadcastChannel.Destroy(true)
		return true
	}

	return false
}

// PruneBroadcastChannels prunes all broadcast channels without subscribers
func PruneBroadcastChannels() []string {
	channels := []string{}
	BroadcastChannels.Range(func(key, value any) bool {
		channel := key.(string)
		broadcastChannel := value.(*BroadcastChannel)
		if !broadcastChannel.Subscribed() {
			BroadcastChannels.Delete(channel)
			broadcastChannel.Destroy(true)
			channels = append(channels, channel)
		}
		return true
	})
	return channels
}

// broadcastSubscribe subscribe to a broadcast channel by SSE
//
// If the channel-name does not specified, the client will subscribe to all broadcast channels.
func broadcastSubscribe(c *gin.Context) {
	// REF: https://github.com/gin-gonic/examples/blob/master/server-sent-event/main.go

	channels, ok := c.GetQueryArray("channel")
	if ok { // subscribe specified broadcast channels
		UnifiedSSE.Subscribe(c, channels...)
	} else { // subscribe all broadcast channels
		UnifiedSSE.SubscribeAll(c)
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
		channel := ChannelInfo{
			Name:  name,
			Count: 0,
		}

		// Get broadcast channel
		_broadcastChannel, exist := BroadcastChannels.Load(name)
		var broadcastChannel *BroadcastChannel
		if exist {
			broadcastChannel = _broadcastChannel.(*BroadcastChannel)
			channel.Count = broadcastChannel.SubscriberCount()
		} else {
			broadcastChannel = nil
			channel.Count = 0
		}

		// Broadcast each string message to the same channel
		for _, value := range values {
			result := &PublishResult{
				Code:    0,
				Msg:     "",
				Channel: channel,
				Message: PublishMessage{
					Type:     MessageTypeString,
					Size:     len(value),
					Filename: "",
				},
			}
			results = append(results, result)

			if broadcastChannel != nil {
				_, err := broadcastChannel.BroadcastString(value)
				if err != nil {
					logging.LogErrorf("broadcast message failed: %s", err)
					result.Code = -2
					result.Msg = err.Error()
					continue
				}
			}
		}
	}

	// Broadcast binary message
	for name, files := range form.File {
		channel := ChannelInfo{
			Name:  name,
			Count: 0,
		}

		// Get broadcast channel
		_broadcastChannel, exist := BroadcastChannels.Load(name)
		var broadcastChannel *BroadcastChannel
		if exist {
			broadcastChannel = _broadcastChannel.(*BroadcastChannel)
			channel.Count = broadcastChannel.SubscriberCount()
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
					Type:     MessageTypeBinary,
					Size:     int(file.Size),
					Filename: file.Filename,
				},
			}
			results = append(results, result)

			if broadcastChannel != nil {
				value, err := file.Open()
				if err != nil {
					logging.LogErrorf("open multipart form file [%s] failed: %s", file.Filename, err)
					result.Code = -4
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

				if _, err := broadcastChannel.BroadcastBinary(content); err != nil {
					logging.LogErrorf("broadcast binary message failed: %s", err)
					result.Code = -2
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
	channel := &ChannelInfo{
		Name:  arg["channel"].(string),
		Count: 0,
	}

	if _broadcastChannel, ok := BroadcastChannels.Load(channel.Name); !ok {
		channel.Count = 0
	} else {
		var broadcastChannel = _broadcastChannel.(*BroadcastChannel)
		if _, err := broadcastChannel.BroadcastString(message); err != nil {
			logging.LogErrorf("broadcast message failed: %s", err)

			ret.Code = -2
			ret.Msg = err.Error()
			return
		}

		channel.Count = broadcastChannel.SubscriberCount()
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

	channel := &ChannelInfo{
		Name:  arg["name"].(string),
		Count: 0,
	}

	if _broadcastChannel, ok := BroadcastChannels.Load(channel.Name); !ok {
		channel.Count = 0
	} else {
		var broadcastChannel = _broadcastChannel.(*BroadcastChannel)
		channel.Count = broadcastChannel.SubscriberCount()
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

	channels := []*ChannelInfo{}
	BroadcastChannels.Range(func(key, value any) bool {
		broadcastChannel := value.(*BroadcastChannel)
		channels = append(channels, &ChannelInfo{
			Name:  key.(string),
			Count: broadcastChannel.SubscriberCount(),
		})
		return true
	})
	ret.Data = map[string]interface{}{
		"channels": channels,
	}
}
