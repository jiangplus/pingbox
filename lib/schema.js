const crypto = require('./crypto')
const cbor = require('cbor');
const bs58 = require('bs58')

exports.encodeMessage = function encodeMessage (keypair, msg) {
  msg = {
    msgtype: msg.msgtype,
    author: msg.author,
    seq: msg.seq,
    previous: msg.previous,
    timestamp: msg.timestamp,
    content: msg.content,
  }

  let buf = cbor.encode(msg)
  let key = crypto.sha256(buf)
  let sig = crypto.sign(keypair, key)

  msg = {
    sig: bs58.encode(sig),
    key: bs58.encode(key),
    msgtype: msg.msgtype,
    author: bs58.encode(msg.author),
    seq: msg.seq,
    previous: msg.previous,
    timestamp: msg.timestamp,
    content: msg.content,
  }

  return msg
}

exports.publishMessage = function publishMessage (keypair, msgtype, content, state = {seq: 0, previous: null, timestamp: 0}) {
  let { seq, previous, timestamp } = state
  let msg = {
    author: keypair.pubkey,
    seq: (seq + 1),
    msgtype: msgtype,
    timestamp: timestamp,
    previous: previous,
    content: content,
  }

  return exports.encodeMessage(keypair, msg)
}

exports.verifyMessage= function (msg) {
  let message = {
    msgtype: msg.msgtype,
    author: bs58.decode(msg.author),
    seq: msg.seq,
    previous: msg.previous,
    timestamp: msg.timestamp,
    content: msg.content,
  }

  let buf = cbor.encode(message)
  let key = crypto.sha256(buf)
  

  return crypto.verify({ pubkey: msg.author }, msg.sig, key)
}

exports.publishPost= function (title) {
  return exports.publishMessage(keypair, 'post', { title: title })
}
