let base32 = require('./lib/base32')
let encoded = base32.encode('some data to encode')
let decoded = base32.decode(encoded)
console.log(encoded, decoded)


const bs58 = require('bs58')
const bytes = Buffer.from('003c176e659bea0f29a3e9bf7880c112b1b31b4dc826268187', 'hex')
const address = bs58.encode(bytes)
console.log(address)
console.log(bs58.decode(address))


let crypto = require('./lib/crypto')
console.log(crypto.sha256bs58('hello'))
console.log(crypto.toBuffer(crypto.sha256bs58('hello')))
console.log(crypto.toBuffer(crypto.sha256('hello')))
console.log(crypto.toBuffer('%' + crypto.sha256bs58('hello')))
console.log('check', crypto.sha256check(crypto.sha256bs58('hello'), Buffer.from('hello')))

let keypair = crypto.loadOrCreateSync('env/alice.keyjson')
console.log('keypair')
console.log(keypair)
console.log('-----')

let signed = crypto.sign(keypair.prvkey, Buffer.from('hello'))
console.log(signed)
console.log(crypto.verify(keypair, signed, Buffer.from('hello')))

console.log(crypto.randombytes(30))
console.log(crypto.randombytes(30).length)

let schema = require('./lib/schema')
let msg = schema.publishMessage(keypair, 'post', { title: 'hello' })
console.log(msg)
console.log(schema.verifyMessage(msg))