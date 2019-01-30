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


try { fs.unlinkSync('data/alice.db') } catch (err) {}
try { fs.unlinkSync('data/bob.db')   } catch (err) {}
try { fs.unlinkSync('data/caddy.db') } catch (err) {}
try { fs.unlinkSync('data/dan.db')   } catch (err) {}

import { remote } from 'electron'

remote.globalShortcut.register('CommandOrControl+Shift+K', () => {
  remote.BrowserWindow.getFocusedWindow().webContents.openDevTools()
})

window.addEventListener('beforeunload', () => {
  remote.globalShortcut.unregisterAll()
})

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
    // this.db = db('data/' + name + '.db?mode=memory')
    // this.db = db('memory')
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

  addPeer(info) {
    let ts = timestamp()
    if (info.tracker) {
      this.db
          .prepare('INSERT INTO peers (pubkey, host, port, role) VALUES (@pubkey, @host, @port, @role)')
          .run({pubkey: info.pubkey, host: info.host, port: info.port, role: 'tracker'})
    } else {
      this.db
          .prepare('INSERT INTO peers (pubkey, host, port) VALUES (@pubkey, @host, @port)')
          .run({pubkey: info.pubkey, host: info.host, port: info.port})
    }
    return this.getPeer(info.pubkey)
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
// 
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
    this.isTracker = !!keys.tracker
    // console.log(this.pubkey, this.host, this.port, this.isTracker)

    this.clients = []
    this.channels = {}

    this.server = new grpc.Server()
    this.server.addService(protos.VoidRPC.service, {
      ping: this.onPing.bind(this),
      streaming: this.onStreaming.bind(this),
    })
    this.server.bind('0.0.0.0:' + keys.port, grpc.ServerCredentials.createInsecure())
    this.server.start()
    // console.log('rpc server', this.server)
  }

  getClient(pubkey) {
    if (!pubkey) throw 'pubkey empty'
    return this.clients.find(e => e.pubkey == pubkey || e.name == pubkey)
  }

  doConnectTracker(info) {
    let peer = this.addPeer(info)
    let client = new protos.VoidRPC(info.host+':'+info.port, grpc.credentials.createInsecure())
    client.pubkey = info.pubkey
    client.name = info.name || null
    this.clients.push(client)
  }

  doConnect(info) {
    let peer = this.addPeer(info)
    let client = new protos.VoidRPC(info.host+':'+info.port, grpc.credentials.createInsecure())
    client.pubkey = info.pubkey
    client.name = info.name || null
    console.log('info', info)
    if (info.isTracker) {
      console.log('is tracker')
      client.isTracker = true
    }
    this.clients.push(client)

    return new Promise((resolve, reject) => {
      let callback = (err, resp) => {
        console.log('return', err, resp)
        if (err) {
          reject(err)
        } else {
          resolve(resp)
        }
      }
      client.ping({pubkey: this.pubkey, host: this.host, port: this.port}, callback)
    })
  }

  doScan() {
    console.log('scan')
  }

  onPing(call, callback) {
    callback(null, {pubkey: this.pubkey, host: 'localhost', port: this.port})
    let peer = this.addPeer({pubkey: call.request.pubkey, host: null, port: call.request.port})
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

    if (client.isTracker) {
      this.pub(call, 'hello_tracker', {host: this.host, port: this.port})
      return
    }

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

  hello_tracker(call, data) {
    console.log('in client hello tracker', this.name, data)
  }

  shake_tracker(call, data) {
    console.log('in client tracker shake', this.name, data)
  }

  hello(call, data) {
    console.log('in client hello', this.name, data)
    this.pub(call, 'shake', data)
  }

  shake(call, data) {
    console.log('in client shake', this.name, data)
    console.log(call.pubkey)
    let peerkey = call.pubkey
    let peer = this.getPeer(peerkey)
    let old_local_latest = peer.local_latest
    let new_local_latest = this.getLocalLatest()
    peer.local_latest = new_local_latest

    let seq_range = isEmpty(peer.state) ? Object.keys(peer.state) : null
    let seqs = this.getSeqs(old_local_latest, seq_range)
    let payload = {seqs: seqs}

    this.pub(call, 'clocks', payload)
  }

  clocks(call, data) {
    console.log('in client clocks', this.name, data)
    let payload = data.data
    let peer = this.getPeer(call.pubkey)
    peer.state_change = timestamp()

    let old_local_latest = peer.local_latest
    peer.local_latest = this.getLocalLatest()
    let seq_range = payload.seqs.map(e => e.pubkey).concat(Object.keys(peer.state))
    let seqs = this.getSeqs(old_local_latest, seq_range)
    let popnotes = []

    diffloop(
      pooling(seqs), 
      pooling(payload.seqs), 
      peer.state, 
      (pubkey, [localseq, remoteseq, peerseq]) => {
        if (localseq !== null) {
          if (remoteseq !== null) {
            if (peerseq === null || peerseq === -1) {
              // this.popnotes.push({peerkey: peerkey, pubkey: pubkey, seq: localseq})
              popnotes.push({pubkey: pubkey, seq: localseq})
            }

            peer.state[pubkey] = remoteseq
          }

          if (remoteseq > localseq) {
            this.pub(call, 'notes', {pubkey: pubkey, from: (localseq + 1), to: remoteseq})
          }
        }
    })

    this.updatePeer(peer)
    if (popnotes.length > 0 && !(payload.pushback && payload.pushback == 'no')) {
      this.pub(call, 'contact', popnotes)
    }

    if (seqs.length == 0 || payload.pushback && payload.pushback == 'no') return
    let resp = seqs.map(seq => pick(seq, ['pubkey', 'seq']))
    log('resp', resp, seqs)
    this.pub(call, 'clocks', {seqs: resp, pushback: 'no'})
  }

  notes(call, data) {
    console.log('in notes', this.name, data)
    let seq = data.data
    let messages
    if (seq.from && seq.to) {
      messages = this.getAccountMessages(seq.pubkey, seq.from, seq.to).map(msg => {
        // msg.content = JSON.parse(msg.content)
        msg = pick(msg, ['key', 'author', 'previous', 'seq', 'timestamp', 'content', 'msgtype', 'sig'])
        // msg.previous = msg.previous || undefined

        console.log('logger', msg)
        return msg
      })
    } else if (seq.key) {
      let message = this.getMessage(seq.key)
      message = pick(message, ['key', 'author', 'previous', 'seq', 'timestamp', 'content', 'msgtype', 'sig'])
      messages = [message]
    }
    this.pub(call, 'receive_message', {messages: messages})

  }

  receive_message(call, data) {
    console.log('in receive_message', this.name, data)
    let messages = data.data.messages

    messages.map(msg => {
      // msg.content = JSON.parse(msg.content)
      this.commitMessage(msg)
    })

    log(this.getMessages())
  }

  contact(call, data) {
    console.log('in contact', this.name, data)
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

  let alice = new Node('alice')
  let bob = new Node('bob')
  let caddy = new Node('caddy')
  let dan = new Node('dan')
  // log(alice, bob, caddy, dan)

  alice.addContact($alice.pubkey, $caddy.pubkey)
  alice.add_samples('hello')

  bob.addContact($bob.pubkey, $alice.pubkey)
  bob.addContact($bob.pubkey, $caddy.pubkey)
  bob.add_samples('hello')

  caddy.addContact($caddy.pubkey, $alice.pubkey)
  caddy.add_samples('hello')

  dan.add_samples('hello')

  log('alice', alice.getMessages())

  bob.doConnect(dan).then((resp) => {
    return bob.doStreaming(dan.pubkey)
  })

  // bob.doConnect(alice)
  // .then((resp) => {
  // })
  // .then((resp) => {
  //   console.log('connect', resp)
  //   return bob.doStreaming(alice.pubkey)

  //   // let server = new Server(bob)
  //   // console.log('server', server, server.info())
  // })
}

testrpc()



Vue.config.productionTip = false

new Vue({
  router,
  render: h => h(App)
}).$mount("#app")
