package apicontract

import "reflect"

type SystemOIDCMobileValidationData struct {
	Validation bool `json:"validation" api:"const=true"`
}

type SystemOIDCMobileRedirectData struct {
	To string `json:"to"`
}

type SystemOIDCPendingData struct {
	Status string `json:"status" api:"const=\"pending\""`
}

type SystemOIDCCompletedData struct {
	Status string `json:"status" api:"const=\"completed\""`
	To     string `json:"to"`
}

// systemVariantSchema 区分移动登录验证与跳转，以及桌面轮询完成后必需的目标地址。
func systemVariantSchema(b *schemaBuilder, t reflect.Type, input bool) (*Schema, error) {
	var members []reflect.Type
	switch t {
	case reflect.TypeFor[SystemOIDCMobileData]():
		members = []reflect.Type{reflect.TypeFor[SystemOIDCMobileValidationData](), reflect.TypeFor[SystemOIDCMobileRedirectData]()}
	case reflect.TypeFor[SystemOIDCPollData]():
		members = []reflect.Type{reflect.TypeFor[SystemOIDCPendingData](), reflect.TypeFor[SystemOIDCCompletedData]()}
	default:
		return nil, nil
	}
	name := t.Name()
	if _, exists := b.definitions[name]; exists {
		return &Schema{Ref: "#/$defs/" + name}, nil
	}
	result := &Schema{}
	b.definitions[name] = result
	for _, member := range members {
		schema, err := b.schema(member, input)
		if err != nil {
			return nil, err
		}
		result.AnyOf = append(result.AnyOf, schema)
	}
	return &Schema{Ref: "#/$defs/" + name}, nil
}
