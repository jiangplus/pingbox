const cl = sodium = require('chloride')
const bs58 = require('bs58')
let isBuffer = Buffer.isBuffer

function isObject (o) {
  return 'object' === typeof o
}

function isFunction (f) {
  return 'function' === typeof f
}

function isString(s) {
  return 'string' === typeof s
}


exports.toBuffer = function toBuffer (buf) {
  if(buf == null) return buf
  if(Buffer.isBuffer(buf)) return buf
  let start = (exports.hasSigil(buf)) ? 1 : 0
  return bs58.decode(buf.substring(start, buf.length))
}

exports.sha256 = function sha256 (data, enc) {
  data = (
    'string' === typeof data && enc == null
  ? new Buffer.from(data, 'binary')
  : new Buffer.from(data, enc)
  )
  return cl.crypto_hash_sha256(data)
}

exports.sha256bs58 = function sha256bs58 (data, enc) {
  return bs58.encode(exports.sha256(data, enc))
}

exports.sha256check = function sha256check (hash, data, enc) {
  hash = exports.toBuffer(hash)
  data = isBuffer(data) ? data : Buffer.from(data)
  return hash.compare(cl.crypto_hash_sha256(data)) === 0
}

exports.hasSigil = function hasSigil (s) {
  return /^(@|%|&)/.test(s)
}

exports.randombytes = function randombytes (n) {
  let buf
  sodium.randombytes(buf = Buffer.alloc(n))
  return buf
}

exports.generate = function generate (seed) {
  if(!seed) sodium.randombytes(seed = Buffer.alloc(32))

  let keys = seed ? sodium.crypto_sign_seed_keypair(seed) 
                  : sodium.crypto_sign_keypair()
  return {
    curve: 'ed25519',
    pubkey: keys.publicKey,

    //so that this works with either sodium
    //or libsodium-wrappers (in browser)
    prvkey: keys.privateKey || keys.secretKey
  }
}

exports.sign = function sign (privateKey, message) {
  privateKey = privateKey.prvkey || privateKey
  
  if(isString(message))
    message = Buffer.from(message)
  if(!isBuffer(message))
    throw new Error('message should be buffer')


  return sodium.crypto_sign_detached(message, privateKey)
}

exports.verify = function verify (publicKey, sig, message) {
  if(isObject(sig) && !isBuffer(sig))
    throw new Error('signature should be base58 string')

  publicKey = exports.toBuffer(publicKey.pubkey || publicKey)
  sig = exports.toBuffer(sig)
  message = isBuffer(message) ? message : Buffer.from(message)


  return sodium.crypto_sign_verify_detached(sig, message, publicKey)
}

// load keypair from disk

const fs         = require('fs')
const path       = require('path')
const mkdirp     = require('mkdirp')

exports.stringifyKeys = function stringifyKeys (keys) {
  return JSON.stringify({
    curve: keys.curve,
    pubkey: bs58.encode(keys.pubkey),
    prvkey: bs58.encode(keys.prvkey),
  }, null, 2)
}

exports.parseKeys = function parseKeys (keyfile) {
  let keys = JSON.parse(keyfile)
  return {
    curve: keys.curve,
    pubkey: Buffer.from(bs58.decode(keys.pubkey)),
    prvkey: Buffer.from(bs58.decode(keys.prvkey)),
  }
}

exports.loadOrCreateSync = function (filename) {
  try {
    return exports.parseKeys(fs.readFileSync(filename, 'ascii'))
  } catch (err) {
    let keys = exports.generate()
    let keyfile = exports.stringifyKeys(keys)
    mkdirp.sync(path.dirname(filename))
    fs.writeFileSync(filename, keyfile)
    return keys
  }
}
