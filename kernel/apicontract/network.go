package apicontract

type NetworkEchoData struct {
	Context NetworkEchoContext `json:"Context"`
	Request NetworkEchoRequest `json:"Request"`
	URL     NetworkEchoURLInfo `json:"URL"`
	User    NetworkEchoUser    `json:"User"`
}
type NetworkEchoParam struct {
	Key   string `json:"Key"`
	Value string `json:"Value"`
}
type NetworkEchoContext struct {
	Params       []NetworkEchoParam `json:"Params"`
	HandlerNames []string           `json:"HandlerNames"`
	FullPath     string             `json:"FullPath"`
	ClientIP     string             `json:"ClientIP"`
	RemoteIP     string             `json:"RemoteIP"`
	ContentType  string             `json:"ContentType"`
	IsWebsocket  bool               `json:"IsWebsocket"`
	RawData      *string            `json:"RawData"`
}
type NetworkEchoRequest struct {
	Method           string                `json:"Method"`
	URL              *NetworkEchoURL       `json:"URL"`
	Proto            string                `json:"Proto"`
	ProtoMajor       int                   `json:"ProtoMajor"`
	ProtoMinor       int                   `json:"ProtoMinor"`
	Header           map[string][]string   `json:"Header"`
	ContentLength    int64                 `json:"ContentLength"`
	TransferEncoding []string              `json:"TransferEncoding"`
	Close            bool                  `json:"Close"`
	Host             string                `json:"Host"`
	Form             map[string][]string   `json:"Form"`
	PostForm         map[string][]string   `json:"PostForm"`
	MultipartForm    *NetworkEchoMultipart `json:"MultipartForm"`
	Trailer          map[string][]string   `json:"Trailer"`
	RemoteAddr       string                `json:"RemoteAddr"`
	TLS              *NetworkEchoTLS       `json:"TLS"`
	UserAgent        string                `json:"UserAgent"`
	Cookies          NetworkEchoCookies    `json:"Cookies"`
	Referer          string                `json:"Referer"`
}
type NetworkEchoMultipart struct {
	Value map[string][]string          `json:"Value"`
	File  map[string][]NetworkEchoFile `json:"File"`
}
type NetworkEchoFile struct {
	Filename string              `json:"Filename"`
	Header   map[string][]string `json:"Header"`
	Size     int64               `json:"Size"`
	Content  string              `json:"Content"`
}
type NetworkEchoURLInfo struct {
	EscapedPath     string              `json:"EscapedPath"`
	EscapedFragment string              `json:"EscapedFragment"`
	String          string              `json:"String"`
	Redacted        string              `json:"Redacted"`
	IsAbs           bool                `json:"IsAbs"`
	Query           map[string][]string `json:"Query"`
	RequestURI      string              `json:"RequestURI"`
	Hostname        string              `json:"Hostname"`
	Port            string              `json:"Port"`
}
type NetworkEchoUser struct {
	Exists   bool   `json:"Exists"`
	Username string `json:"Username"`
	Password string `json:"Password"`
}

type NetworkForwardRequest struct {
	URL string `json:"url" api:"trim"`
	NetworkForwardOptions
	fields fileTreeFields
}
type NetworkForwardOptions struct {
	Method           *string                `json:"method" api:"optional"`
	Timeout          *float64               `json:"timeout" api:"optional"`
	ResponseEncoding string                 `json:"responseEncoding" api:"optional,nullable,ignoretype"`
	Redirect         *bool                  `json:"redirect" api:"optional"`
	Headers          []map[string]JSONValue `json:"headers" api:"optional,nullable"`
	ContentType      *string                `json:"contentType" api:"optional"`
	PayloadEncoding  *string                `json:"payloadEncoding" api:"optional"`
	Payload          JSONValue              `json:"payload" api:"optional,nullable"`
}
type NetworkForwardData struct {
	URL          string              `json:"url"`
	Status       int                 `json:"status"`
	ContentType  string              `json:"contentType"`
	Body         string              `json:"body"`
	BodyEncoding string              `json:"bodyEncoding"`
	Headers      map[string][]string `json:"headers"`
	Elapsed      int64               `json:"elapsed"`
}
