import Vue from "vue"
import App from "./App.vue"
import router from "./router"

const fs = require('fs')
const db = require('better-sqlite3')
const EventEmitter = require('events')
const log = console.log.bind(console)
const cbor = require('cbor')

const crypto = require('./lib/crypto')
const schema = require('./lib/schema')
const timestamp = require('./lib/timestamp').timestamp
const { pick, arrayPooling, pooling, isEmpty, diffloop } = require('./lib/helper')

const grpc = require('grpc')
const protos = grpc.load(process.cwd() + '/src/channel.proto').voidrpc

const migration = fs.readFileSync(process.cwd() + '/src/schema.sql', 'utf8')


// try { fs.unlinkSync('data/alice.db') } catch (err) {}
// try { fs.unlinkSync('data/bob.db')   } catch (err) {}
// try { fs.unlinkSync('data/caddy.db') } catch (err) {}


function isString(s) {
  return 'string' === typeof s
}

class Core extends EventEmitter {

  constructor(name, keys) {
    super()

    this.name = name
    this.pubkey = keys.pubkey
    this.keys = keys
    this.db = db('data/' + name + '.db')
    this.host = keys.host
    this.port = keys.port

    this.db.exec(migration)
    this.createAccount(this.pubkey)
  }

  getAccount(pubkey) {
    return this.db
        .prepare("SELECT * from accounts where pubkey = ?")
        .get(pubkey)
  }

  getAccounts() {
    return this.db
        .prepare("SELECT * from accounts")
        .all()
  }

  createAccount(pubkey, opt) {
    let following = (opt && !opt.following) ? 0 : 1
    let account = this.getAccount(pubkey)
    if (account) return account

    let ts = timestamp()
    this.db
        .prepare('INSERT INTO accounts (pubkey, created, following) VALUES (@pubkey, @created, @following)')
        .run({pubkey: pubkey, created: ts, following: following})
    return this.getAccount(pubkey)
  }

  updateAccount(pubkey, previous, seq, updated) {
    pubkey = pubkey[0] == '@' ? pubkey.slice(1) : pubkey
    this.db
        .prepare('UPDATE accounts SET previous = @previous, seq = @seq, updated = @updated WHERE pubkey = @pubkey')
        .run({ pubkey, previous, seq, updated })
  }

  updatePeerState(pubkey, state) {
    pubkey = pubkey[0] == '@' ? pubkey.slice(1) : pubkey
    state = JSON.stringify(state)
    this.db
        .prepare('UPDATE peers SET state = @state WHERE pubkey = @pubkey')
        .run({ pubkey, state })
  }

  getSeqs(since, range) {
    since = since || 0
    let ret
    if (range) {
      let params = '?,'.repeat(range.length).slice(0, -1)
      range.unshift(since)
      range.push(since)
      ret = this.db
          .prepare("SELECT pubkey, seq from accounts WHERE (updated >= ? AND following = 1 AND pubkey in ("+params+")) OR changed > ? ORDER BY created ASC")
          .all(range)
      return ret
    } else {
      ret = this.db
          .prepare("SELECT pubkey, seq from accounts WHERE (updated >= @since AND following = 1) OR changed > @since ORDER BY created ASC")
          .all({since, range})
    }
    return ret
  }

  getMessage(key) {
    let msg = this.db
        .prepare("SELECT * from messages where key = ?")
        .get(key)

    if (msg) msg.content = JSON.parse(msg.content)
    return msg
  }

  getMessages() {
    return this.db
        .prepare("SELECT * from messages")
        .all().map(e => {
          e.content = JSON.parse(e.content)
          return e
        })
  }

  getAccountMessages(pubkey, from, to) {
    if (from) {
      return this.db
          .prepare("SELECT * from messages WHERE author = @pubkey AND seq >= @from AND seq <= @to")
          .all({pubkey, from, to})
    } else {
      return this.db
          .prepare("SELECT * from messages WHERE author = @pubkey")
          .all({pubkey})
    }
  }

  addMessage(message) {
    let ts = timestamp()
    return this.db
        .prepare('INSERT INTO messages (key, sig, author, previous, msgtype, seq, content, timestamp, localtime) VALUES (@key, @sig, @author, @previous, @msgtype, @seq, @content, @timestamp, @localtime)')
        .run(message)
  }

  getLocalLatest() {
      let latest = this.db
          .prepare("SELECT localtime from messages ORDER BY localtime limit 1")
          .get()
      return latest && latest.localtime || 0
  }

  getPeer(pubkey) {
    let peer = this.db
        .prepare("SELECT * from peers where pubkey = ?")
        .get(pubkey)

    peer.state = JSON.parse(peer.state)
    return peer
  }

  getPeers() {
    return this.db
        .prepare("SELECT * from peers")
        .all()
  }

  updatePeer(peer) {
    peer = Object.assign({}, peer, {state: JSON.stringify(peer.state)})

    this.db
        .prepare('UPDATE peers SET host = @host, port = @port, state_change = @state_change, local_latest = @local_latest, remote_latest = @remote_latest, state = @state WHERE pubkey = @pubkey')
        .run(peer)
  }

  addPeer(pubkey, host, port) {
    let ts = timestamp()
    this.db
        .prepare('INSERT INTO peers (pubkey, host, port) VALUES (@pubkey, @host, @port)')
        .run({pubkey, host, port})
    return this.getPeer(pubkey)
  }

  getContact(source, target) {
    return this.db
        .prepare("SELECT * from contacts where source = @source AND target = @target")
        .get({source, target})
  }

  getContactsFor(source) {
    return this.db
        .prepare("SELECT * from contacts where source = @source")
        .all({source})
  }

  addContact(source, target) {
    this.createAccount(target)
    let contact = this.getContact(source, target)
    if (contact) return

    this.db
        .prepare('INSERT INTO contacts (source, target) VALUES (@source, @target)')
        .run({source, target})

    if (source == this.pubkey) {
      let ts = timestamp()
      this.db
          .prepare('UPDATE accounts SET changed = @ts, following = 1 WHERE pubkey = @target')
          .run({ target, ts })
    }
  }

  removeContact(source, target) {
    let contact = this.getContact(source, target)
    if (!contact) return

    this.db
        .prepare('DELETE FROM contacts WHERE source = @source AND target = @target')
        .run({source, target})

    if (source == this.pubkey) {
      let ts = timestamp()
      this.db
          .prepare('UPDATE accounts SET changed = @ts, following = 0 WHERE pubkey = @target')
          .run({ target, ts })
    }

  }

  commitMessage(message, ts = 0) {
    ts = ts || timestamp()
    message.content = isString(message.content) ? message.content : JSON.stringify(message.content)
    message.localtime = ts
    this.addMessage(message)
    this.updateAccount(message.author, message.key, message.seq, ts)
    return this.getMessage(message.key)
  }

  pubMessage(msgtype, content) {
    let ts = timestamp()
    let account = this.getAccount(this.pubkey)
    let state = { seq: account.seq, previous: account.previous, timestamp: ts }
    let message = schema.publishMessage(this.keys, msgtype, content, state)
    return this.commitMessage(message)
  }


  newPost (title) {
    this.pubMessage('post', { title: title })
  }

  add_samples() {
    this.newPost('hello')
    this.newPost('hello')
    this.newPost('hello')
  }
}


class Node extends Core {
  constructor(name) {
    let keys = crypto.loadOrCreateSync('env/'+name+'.keyjson')
    super(name, keys)

    this.clients = []
    this.channels = {}

    this.server = new grpc.Server()
    this.server.addService(protos.VoidRPC.service, {
      ping: this.onPing.bind(this),
      streaming: this.onStreaming.bind(this),
    })
    this.server.bind('0.0.0.0:' + keys.port, grpc.ServerCredentials.createInsecure())
    this.server.start()
    console.log('rpc server', this.server)
  }

  getClient(pubkey) {
    if (!pubkey) throw 'pubkey empty'
    return this.clients.find(e => e.pubkey == pubkey || e.name == pubkey)
  }

  doConnect(info) {
    let peer = this.addPeer(info.pubkey, info.host, info.port)
    let client = new protos.VoidRPC(info.host+':'+info.port, grpc.credentials.createInsecure())
    client.pubkey = info.pubkey
    client.name = info.name || null
    this.clients.push(client)

    return new Promise((resolve, reject) => {
      client.ping({pubkey: this.pubkey, host: this.host, port: this.port}, (err, resp) => {
        console.log('return', err, resp)
        if (err) {
          reject(err)
        } else {
          resolve(resp)
        }
      })
    })
  }

  doScan() {
    console.log('scan')
  }

  onPing(call, callback) {
    callback(null, {pubkey: this.pubkey, host: 'localhost', port: this.port})
    let peer = this.addPeer(call.request.pubkey, null, call.request.port)
  }

  doStreaming(peerkey) {
    console.log('start streaming')
    let client = this.getClient(peerkey)
    let call = client.streaming()
    call.pubkey = peerkey
    call.isConn = true
    call.isClient = true
    call.isServer = false
    this.channels[peerkey] = call
    this.onStreaming(call)

    // the same as:
    // call.write({head: 'hello', pubkey: this.pubkey})
    this.pub(call, 'hello', {})
  }

  onStreaming(call) {
    call.on('data', (item) => {
      if (item.head == 'hello') {
        let peerkey = item.pubkey
        call.pubkey = peerkey
        call.isConn = true
        call.isClient = false
        call.isServer = true
        this.channels[peerkey] = call
      }

      // find and apply rpc method
      item.data = cbor.decode(item.data)
      this[item.head](call, item)
    })

    call.on('end', () => {
      call.end()
    })
  }

  pub(peerkey, head, data) {
    let item = {
      head: head,
      pubkey: this.pubkey,
      data: cbor.encode(data)
    }
    if (peerkey.isConn) {
      peerkey.write(item)
    } else {
      this.channels[peerkey.pubkey || peerkey].write(item)
    }
  }

  hello(call, data) {
    this.pub(call, 'shake', 'ok')
  }

  shake(call, data) {
    console.log('in client', call, data)
  }

}

class Server {
  constructor(node) {
    this.node = node
    this.pubkey = node.pubkey
  }

  info() {
    let info = this.node.getAccount(this.pubkey)
    return info
  }

  get_me() {
    let account = this.node.getAccount(this.pubkey)
    return account
  }

  get_account(pubkey) {
    let account = this.node.getAccount(pubkey)
    return account
  }

  get_accounts() {
    let accounts = this.node.getAccounts()
    return accounts
  }

  get_message(key) {
    return this.node.getMessage(key)
  }

  get_messages() {
    return this.node.getMessages()
  }

  pub_message(msgtype, content) {
    return this.node.pubMessage(msgtype, content)
  }

  get_contact(source, target) {
    return this.node.getContact(source, target)
  }

  add_contact(source, target) {
    return this.node.addContact(source, target)
  }

  remove_contact(source, target) {
    return this.node.getContact(source, target)
  }

  get_contacts_for(source) {
    return this.node.getContactsFor(source)
  }

  add_peer(pubkey, host, port) {
    return this.node.addPeer(pubkey, host, port)
  }

  connect_peer(info) {
    return this.node.doConnect(info)
  }

  get_peer(pubkey) {
    return this.node.getPeer(pubkey)
  }

  list_peers() {
    return this.node.getPeers()
  }

  get_stats() {
    return {}
  }

}

function testrpc() {
  let $alice = crypto.loadOrCreateSync('env/alice.keyjson')
  let $bob   = crypto.loadOrCreateSync('env/bob.keyjson')
  let $caddy = crypto.loadOrCreateSync('env/caddy.keyjson')
  let $dan   = crypto.loadOrCreateSync('env/dan.keyjson')
  log('keys')
  log($alice, $bob, $caddy, $dan)

  let alice = new Node('alice')
  let bob = new Node('bob')
  let caddy = new Node('caddy')
  let dan = new Node('dan')
  log(alice, bob, caddy, dan)

  log(alice.addContact($alice.pubkey, $caddy.pubkey))
  // log(alice.add_samples('hello'))
  log(alice.getMessages())

  bob.doConnect(alice)
  .then((resp) => {
    console.log('connect', resp)
    bob.doStreaming(alice.pubkey)

    let server = new Server(bob)
    console.log('server', server, server.info())
  })
}

testrpc()



Vue.config.productionTip = false

new Vue({
  router,
  render: h => h(App)
}).$mount("#app")
