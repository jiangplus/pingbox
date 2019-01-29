const sodium = require('chloride')
const cl = sodium
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


export function toBuffer (buf) {
  if(buf == null) return buf
  if(Buffer.isBuffer(buf)) return buf
  let start = (hasSigil(buf)) ? 1 : 0
  return bs58.decode(buf.substring(start, buf.length))
}

export function sha256 (data, enc) {
  data = (
    'string' === typeof data && enc == null
  ? new Buffer.from(data, 'binary')
  : new Buffer.from(data, enc)
  )
  return cl.crypto_hash_sha256(data)
}

export function sha256bs58 (data, enc) {
  return bs58.encode(sha256(data, enc))
}

export function sha256check (hash, data, enc) {
  hash = toBuffer(hash)
  data = isBuffer(data) ? data : Buffer.from(data)
  return hash.compare(cl.crypto_hash_sha256(data)) === 0
}

export function hasSigil (s) {
  return /^(@|%|&)/.test(s)
}

export function randombytes (n) {
  let buf
  sodium.randombytes(buf = Buffer.alloc(n))
  return buf
}

export function generate (seed) {
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

export function sign (privateKey, message) {
  privateKey = toBuffer(privateKey.prvkey || privateKey)
  
  if(isString(message))
    message = Buffer.from(message)
  if(!isBuffer(message))
    throw new Error('message should be buffer')


  return sodium.crypto_sign_detached(message, privateKey)
}

export function verify (publicKey, sig, message) {
  if(isObject(sig) && !isBuffer(sig))
    throw new Error('signature should be base58 string')

  publicKey = toBuffer(publicKey.pubkey || publicKey)
  sig = toBuffer(sig)
  message = isBuffer(message) ? message : Buffer.from(message)


  return sodium.crypto_sign_verify_detached(sig, message, publicKey)
}

// load keypair from disk

const fs         = require('fs')
const path       = require('path')
const mkdirp     = require('mkdirp')

export function stringifyKeys (keys) {
  return JSON.stringify({
    curve: keys.curve,
    pubkey: bs58.encode(keys.pubkey),
    prvkey: bs58.encode(keys.prvkey),
  }, null, 2)
}

export function parseKeys (keyfile) {
  let keys = JSON.parse(keyfile)
  // keys.pubkey = bs58.decode(keys.pubkey)
  // keys.prvkey = bs58.decode(keys.prvkey)
  return keys
}

export function loadOrCreateSync (filename) {
  try {
    return parseKeys(fs.readFileSync(filename, 'ascii'))
  } catch (err) {
    let keys = generate()
    let keyfile = stringifyKeys(keys)
    mkdirp.sync(path.dirname(filename))
    fs.writeFileSync(filename, keyfile)
    return keys
  }
}
