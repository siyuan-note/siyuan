/**
 * 设置属性
 * @param {object} data 
 * @returns 
 */
export function setBlockAttrs(data) {
  return request("/api/attr/setBlockAttrs", data)
}

export function insertBlock(data) {
  return request("/api/block/insertBlock", data)
}

export function prependBlock(data) {
  return request("/api/block/prependBlock", data)
}

export function appendBlock(data) {
  return request("/api/block/appendBlock", data)
}

export function updateBlock(data) {
  return request("/api/block/updateBlock", data)
}

export function deleteBlock(id) {
  return request("/api/block/deleteBlock", { "id": id })
}

export function querySQL(sql) {
  return request("/api/query/sql", { "stmt": sql })
}

/**
 * 网络请求
 * @param {*} url 请求地址
 * @param {object} data 
 * @param {*} method 请求方法 get post
 * @returns 
 */
export function request(url, data, method = 'POST') {
  return new Promise((resolve, reject) => {
    if (method.toUpperCase() == 'POST') {
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
        // body:data
      }).then(handleResponse)
        .then(data => resolve(data))
        .then(error => reject(error))

    } else {
      fetch(url)
        .then(handleResponse)
        .then(data => resolve(data))
        .then(error => reject(error))
    }
  })

  function handleResponse(response) {
    let contentType = response.headers.get('content-type')
    if (contentType.includes('application/json')) {
      return handleJSONResponse(response)
    } else if (contentType.includes('text/html')) {
      return handleTextResponse(response)
    } else {
      throw new Error(`Sorry, content-type ${contentType} not supported`)
    }
  }

  function handleJSONResponse(response) {
    return response.json()
      .then(json => {
        if (response.ok) {
          return json
        } else {
          return Promise.reject(Object.assign({}, json, {
            status: response.status,
            statusText: response.statusText
          }))
        }
      })
  }
  function handleTextResponse(response) {
    return response.text()
      .then(text => {
        if (response.ok) {
          return text
        } else {
          return Promise.reject({
            status: response.status,
            statusText: response.statusText,
            err: text
          })
        }
      })
  }
}
