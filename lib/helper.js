
exports.pick = (obj, arr) =>
  arr.reduce((acc, curr) => (curr in obj && (acc[curr] = obj[curr]), acc), {})

exports.arrayPooling = function (arr, field) {
  return arr.reduce(function(acc, cur, i) {
    acc[cur[field[0]]] = cur[field[1]]
    return acc
  }, {})
}

exports.pooling = function (arr) {
  return arrayPooling(arr, ['pubkey', 'seq'])
}

exports.isEmpty = function (obj) {
  return (Object.keys(obj).length > 0)
}

exports.diffloop = function () {
  let args = Array.from(arguments)
  let callback = null
  if (typeof args[args.length - 1] == 'function') {
    callback = args.pop()
  }

  let keys = {}
  let vals = {}
  for (let i = 0; i < args.length; i++) {
    for (let k in args[i]) { keys[k] = true }
  }

  for (let key in keys) {
    vals[key] = args.map(arg => arg[key] === undefined ? null : arg[key])
  }

  if (callback) {
    for (let key in keys) {
      callback(key, vals[key])
    }
  }

  return vals
}
