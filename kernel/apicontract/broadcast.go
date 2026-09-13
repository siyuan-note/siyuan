package apicontract

type BroadcastMessageRequest struct {
	Message string `json:"message" api:"trim"`
	Channel string `json:"channel" api:"trim"`
}

type BroadcastChannelRequest struct {
	Name string `json:"name" api:"trim"`
}

type BroadcastChannel struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type BroadcastChannelData struct {
	Channel *BroadcastChannel `json:"channel"`
}

type BroadcastChannelsData struct {
	Channels []*BroadcastChannel `json:"channels" api:"nonnullable"`
}

type BroadcastPublishMessage struct {
	Type     string `json:"type" api:"enum=string|binary"`
	Size     int    `json:"size"`
	Filename string `json:"filename"`
}

type BroadcastPublishResult struct {
	Code    int                     `json:"code"`
	Msg     string                  `json:"msg"`
	Channel BroadcastChannel        `json:"channel"`
	Message BroadcastPublishMessage `json:"message"`
}

type BroadcastPublishData struct {
	Results []*BroadcastPublishResult `json:"results" api:"nonnullable"`
}

func init() {
	BroadcastPublish.decodeFailure = func(err error) Response[BroadcastPublishData] {
		return Failure[BroadcastPublishData](1, err.Error())
	}
}
