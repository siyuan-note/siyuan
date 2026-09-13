package apicontract

type NotificationRequest struct {
	Msg     string   `json:"msg" api:"trim"`
	Timeout *float64 `json:"timeout" api:"optional"`
}

type NotificationData struct {
	ID string `json:"id"`
}
