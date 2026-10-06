package apicontract

type ChatGPTAccountRequest struct {
	AccountID string `json:"accountID" api:"optional"`
}

type ChatGPTLoginRequest struct {
	ID string `json:"id"`
}

type ChatGPTTransferRequest struct {
	AccountID string `json:"accountID" api:"optional"`
	Password  string `json:"password"`
	Data      string `json:"data" api:"optional"`
}

type ChatGPTAccount struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
	Sharing   bool   `json:"sharing"`
}

type ChatGPTLogin struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type ChatGPTLoginStatus struct {
	State     string `json:"state"`
	AccountID string `json:"accountID"`
	Error     string `json:"error"`
}

type ChatGPTLogoutResult struct {
	Revoked bool `json:"revoked"`
}
