
const fs = require('fs')
const db = require('better-sqlite3')
const EventEmitter = require('events')
const log = console.log.bind(console)

const crypto = require('./lib/crypto')
const schema = require('./lib/schema')
const timestamp = require('./lib/timestamp')
const { pick, arrayPooling, pooling, isEmpty, diffloop } = require('./lib/helper')

const grpc = require('grpc')
const protos = grpc.load(process.cwd() + '/channel.proto').voidrpc

const migration = fs.readFileSync('schema.sql', 'utf8')


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
}

testrpc()




