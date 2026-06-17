const fs = require('fs')
const http = require('http')
const path = require('path')
const readline = require('readline')
const dns = require('dns')
const { execFile } = require('child_process')
const mineflayer = require('mineflayer')
const minecraftProtocol = require('minecraft-protocol')
const { SocksClient } = require('socks')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

const ACCOUNTS_PATH = path.join(__dirname, 'accounts.json')
const CONFIG_PATH = path.join(__dirname, 'config.json')
const PUBLIC_DIR = path.join(__dirname, 'public')
const LOG_DIR = path.join(__dirname, 'logs')
const CHAT_LOG_PATH = path.join(LOG_DIR, 'chat.log')

const defaultConfig = {
  activeProfile: 'default',
  profiles: {
    default: {
      server: {
        host: 'play.normalsurvival.com',
        port: 25565,
        auth: 'offline'
      },
      ui: {
        enabled: true,
        host: '127.0.0.1',
        port: 3000
      },
      savedServers: [
        {
          name: 'Normal Survival',
          host: 'play.normalsurvival.com',
          port: 25565,
          auth: 'offline'
        }
      ],
      timings: {
        joinDelayMs: 5000,
        reconnectDelayMs: 5000,
        connectTimeoutMs: 15000,
        manualRestartDelayMs: 1500,
        loginDelayMs: 2000,
        afkIntervalMs: 30000,
        debugAfterCommandMs: 5000
      },
      features: {
        antiAfk: true,
        autoLogin: true,
        autoRegister: true,
        autoRespawn: true,
        chatLogger: true,
        pathfinding: true
      },
      auth: {
        registerCommand: '/register {password} {password}',
        loginCommand: '/login {password}'
      },
    }
  }
}

const config = loadConfig()
const profile = config.profiles[config.activeProfile] || config.profiles.default
let accounts = loadAccounts()
let serverSettings = {
  host: process.env.SERVER_HOST || profile.server.host,
  port: Number(process.env.SERVER_PORT || profile.server.port || 25565),
  auth: process.env.SERVER_AUTH || profile.server.auth || 'offline'
}
let resolvedServer = {
  host: serverSettings.host,
  port: serverSettings.port,
  source: 'direct'
}
let serverInfo = {
  favicon: null,
  description: '',
  players: null,
  version: null,
  latency: null,
  lastCheckedAt: null,
  lastError: ''
}
let serverInfoRefreshTimer = null
const UI_HOST = process.env.UI_HOST || profile.ui.host || '127.0.0.1'
const UI_PORT = Number(process.env.UI_PORT || profile.ui.port || 3000)
const JOIN_DELAY_MS = Number(process.env.JOIN_DELAY_MS || profile.timings.joinDelayMs || 5000)
const RECONNECT_DELAY_MS = Number(process.env.RECONNECT_DELAY_MS || profile.timings.reconnectDelayMs || 5000)
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || profile.timings.connectTimeoutMs || 15000)
const MANUAL_RESTART_DELAY_MS = Number(process.env.MANUAL_RESTART_DELAY_MS || profile.timings.manualRestartDelayMs || 1500)
const LOGIN_DELAY_MS = Number(process.env.LOGIN_DELAY_MS || profile.timings.loginDelayMs || 2000)
const AFK_INTERVAL_MS = Number(process.env.AFK_INTERVAL_MS || profile.timings.afkIntervalMs || 30000)
const DEBUG_AFTER_COMMAND_MS = Number(process.env.DEBUG_AFTER_COMMAND_MS || profile.timings.debugAfterCommandMs || 5000)
const BOT_AUTOSTART = process.env.BOT_AUTOSTART !== 'false'

const sessions = new Map()
const eventClients = new Set()
let shuttingDown = false
let httpServer = null
let rl = null

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return defaultConfig

  const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return deepMerge(defaultConfig, userConfig)
}

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) return []

  return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'))
}

function saveAccounts() {
  fs.writeFileSync(ACCOUNTS_PATH, `${JSON.stringify(accounts, null, 2)}\n`)
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base

  const result = Array.isArray(base) ? [...base] : { ...base }

  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key] || {}, value)
    } else {
      result[key] = value
    }
  }

  return result
}

function enabled(feature) {
  return profile.features[feature] !== false
}

function log(name, message) {
  emitLog(`[${name}] ${message}`)
}

function emitLog(message) {
  const line = `${new Date().toLocaleTimeString()} ${message}`
  console.log(line)
  broadcast('log', { line })
}

function broadcast(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`

  for (const res of eventClients) {
    res.write(data)
  }
}

function broadcastStatus() {
  broadcast('status', getStatus())
}

function validateAccounts() {
  if (!Array.isArray(accounts)) {
    throw new Error('accounts.json must contain an array')
  }

  const names = new Set()

  for (const account of accounts) {
    if (!account.name || !account.password) {
      throw new Error('Each account needs both "name" and "password"')
    }

    const key = account.name.toLowerCase()

    if (names.has(key)) {
      throw new Error(`Duplicate account name in accounts.json: ${account.name}`)
    }

    names.add(key)
  }
}

function createSession(account) {
  const session = {
    account,
    bot: null,
    afkTimer: null,
    reconnectTimer: null,
    debugUntil: Infinity,
    status: 'offline',
    joinedAt: null,
    reconnects: 0,
    lastMessage: '',
    lastError: '',
    afkEnabled: enabled('antiAfk'),
    manualRestart: false,
    paused: false,
    removed: false,
    registered: false,
    loggedIn: false,
    authStatus: 'waiting',
    lastAuthAction: '',
    lastAuthAt: 0,
    pathfinderReady: false,
    lastChatLine: '',
    lastChatAt: 0
  }

  sessions.set(account.name.toLowerCase(), session)
  return session
}

function getSession(name) {
  return sessions.get(String(name || '').toLowerCase())
}

function getTargets(target) {
  if (target === 'all') return [...sessions.values()]

  const session = getSession(target)
  return session ? [session] : []
}

function clearSessionTimers(session) {
  if (session.afkTimer) clearInterval(session.afkTimer)
  if (session.reconnectTimer) clearTimeout(session.reconnectTimer)

  session.afkTimer = null
  session.reconnectTimer = null
}

function disconnectBot(session) {
  if (!session.bot) return

  if (typeof session.bot.quit === 'function') {
    session.bot.quit()
    return
  }

  if (session.bot._client && typeof session.bot._client.end === 'function') {
    session.bot._client.end()
  }
}

function connectSession(session, delay = 0) {
  if (shuttingDown || session.paused || session.removed) return

  clearSessionTimers(session)

  if (delay > 0) {
    session.status = 'reconnecting'
    broadcastStatus()
    session.reconnectTimer = setTimeout(() => connectSession(session), delay)
    return
  }

  const { account } = session

  session.status = 'connecting'
  session.lastError = ''
  session.pathfinderReady = false
  log(account.name, `Connecting to ${serverSettings.host}:${serverSettings.port}...`)
  broadcastStatus()

  resolveMinecraftServer(serverSettings, (lookupErr, target) => {
    if (lookupErr) {
      session.status = 'reconnecting'
      session.lastError = `DNS failed for ${serverSettings.host}: ${lookupErr.code || lookupErr.message}`
      log(account.name, session.lastError)
      broadcastStatus()
      connectSession(session, RECONNECT_DELAY_MS)
      return
    }

    resolvedServer = target
    if (target.source === 'srv') {
      log(account.name, `SRV resolved to ${target.host}:${target.port}`)
    }

    refreshServerInfo()
    createMineflayerBot(session)
  })
}

function refreshServerInfo(force = false) {
  if (!force && serverInfoRefreshTimer) return

  clearTimeout(serverInfoRefreshTimer)
  serverInfoRefreshTimer = setTimeout(() => {
    serverInfoRefreshTimer = null
  }, 30000)

  const target = {
    host: resolvedServer.host || serverSettings.host,
    port: Number(resolvedServer.port || serverSettings.port || 25565)
  }

  minecraftProtocol.ping({
    host: target.host,
    port: target.port,
    closeTimeout: 5000,
    noPongTimeout: 2500
  }, (err, data) => {
    serverInfo.lastCheckedAt = new Date().toISOString()

    if (err) {
      serverInfo.lastError = err.code || err.message || String(err)
      broadcastStatus()
      return
    }

    serverInfo = {
      favicon: normalizeServerFavicon(data.favicon),
      description: normalizeServerDescription(data.description),
      players: data.players
        ? {
            online: Number(data.players.online || 0),
            max: Number(data.players.max || 0)
          }
        : null,
      version: data.version
        ? {
            name: data.version.name || '',
            protocol: data.version.protocol || null
          }
        : null,
      latency: Number.isFinite(data.latency) ? data.latency : null,
      lastCheckedAt: serverInfo.lastCheckedAt,
      lastError: ''
    }

    broadcastStatus()
  })
}

function resolveConfiguredServerForInfo() {
  resolveMinecraftServer(serverSettings, (lookupErr, target) => {
    if (lookupErr) {
      serverInfo.lastCheckedAt = new Date().toISOString()
      serverInfo.lastError = lookupErr.code || lookupErr.message || String(lookupErr)
      broadcastStatus()
      return
    }

    resolvedServer = target
    refreshServerInfo(true)
    broadcastStatus()
  })
}

function normalizeServerFavicon(favicon) {
  if (typeof favicon !== 'string') return null
  if (!favicon.startsWith('data:image/')) return null
  return favicon
}

function normalizeServerDescription(description) {
  if (!description) return ''
  if (typeof description === 'string') return description
  if (Array.isArray(description.extra)) {
    return description.extra.map(part => normalizeServerDescription(part)).join('')
  }
  return description.text || ''
}

function resolveMinecraftServer(settings, callback) {
  const srvName = `_minecraft._tcp.${settings.host}`
  let settled = false

  dns.resolveSrv(srvName, (srvErr, records) => {
    if (settled) return
    settled = true

    if (!srvErr && records && records.length > 0) {
      const record = records.sort((a, b) => a.priority - b.priority)[0]
      const target = {
        host: record.name,
        port: Number(record.port || settings.port),
        source: 'srv'
      }

      dns.lookup(target.host, (lookupErr) => {
        callback(lookupErr, target)
      })
      return
    }

    dns.lookup(settings.host, (lookupErr) => {
      callback(lookupErr, {
        host: settings.host,
        port: settings.port,
        source: 'direct'
      })
    })
  })

  setTimeout(() => {
    if (settled) return
    settled = true

    resolveSrvWithPowerShell(srvName, (srvErr, record) => {
      if (!srvErr && record) {
        const target = {
          host: record.host,
          port: Number(record.port || settings.port),
          source: 'srv'
        }

        dns.lookup(target.host, (lookupErr) => {
          callback(lookupErr, target)
        })
        return
      }

      dns.lookup(settings.host, (lookupErr) => {
        callback(lookupErr, {
          host: settings.host,
          port: settings.port,
          source: 'direct'
        })
      })
    })
  }, 2000)
}

function resolveSrvWithPowerShell(srvName, callback) {
  if (process.platform !== 'win32') {
    callback(new Error('PowerShell SRV fallback is only available on Windows'))
    return
  }

  const command = [
    'Resolve-DnsName -Type SRV -ErrorAction SilentlyContinue',
    `'${srvName.replaceAll("'", "''")}'`,
    '| Select-Object -First 1 NameTarget,Port',
    '| ConvertTo-Json -Compress'
  ].join(' ')

  execFile('powershell.exe', ['-NoProfile', '-Command', command], { timeout: 5000 }, (err, stdout) => {
    if (err || !stdout.trim()) {
      callback(err || new Error('No SRV record found'))
      return
    }

    try {
      const record = JSON.parse(stdout)
      callback(null, {
        host: record.NameTarget,
        port: Number(record.Port)
      })
    } catch (parseErr) {
      callback(parseErr)
    }
  })
}

function createMineflayerBot(session) {
  const { account } = session
  const botOptions = {
    host: resolvedServer.host,
    port: resolvedServer.port,
    username: account.name,
    auth: account.auth || serverSettings.auth,
    hideErrors: true
  }

  const proxy = account.proxy || profile.proxy

  if (proxy && proxy.host && proxy.port) {
    botOptions.connect = (client) => connectViaSocksProxy(client, proxy)
  }

  const bot = mineflayer.createBot(botOptions)

  session.bot = bot
  session.debugUntil = Infinity
  session.joinedAt = null
  session.registered = false
  session.loggedIn = false
  session.authStatus = 'waiting'
  session.lastAuthAction = ''
  session.lastAuthAt = 0

  if (enabled('pathfinding')) {
    bot.loadPlugin(pathfinder)
  }

  const connectTimeout = setTimeout(() => {
    if (session.status === 'online' || session.paused || session.removed || shuttingDown) return

    session.lastError = `Connection timed out after ${Math.round(CONNECT_TIMEOUT_MS / 1000)}s`
    log(account.name, session.lastError)
    disconnectBot(session)
  }, CONNECT_TIMEOUT_MS)

  bot.on('messagestr', (msg) => handleChatMessage(session, msg))

  bot.on('spawn', () => {
    clearTimeout(connectTimeout)
    session.status = 'online'
    session.joinedAt = Date.now()
    session.debugUntil = 0

    if (enabled('pathfinding')) {
      bot.pathfinder.setMovements(new Movements(bot))
      session.pathfinderReady = true
    }

    log(account.name, 'Joined server')
    startAfkLoop(session)
    broadcastStatus()
  })

  bot.on('death', () => {
    log(account.name, 'Died')

    if (enabled('autoRespawn')) {
      setTimeout(() => {
        if (session.bot) {
          session.bot.respawn()
          log(account.name, 'Respawn command sent')
        }
      }, 1500)
    }
  })

  bot.on('kicked', (reason) => {
    session.lastError = `Kicked: ${formatKickReason(reason)}`
    log(account.name, session.lastError)
    broadcastStatus()
  })

  bot.on('error', (err) => {
    session.lastError = err.message || String(err)
    log(account.name, `Error: ${session.lastError}`)
    broadcastStatus()
  })

  bot.on('end', () => {
    clearTimeout(connectTimeout)
    const restartDelay = session.manualRestart ? MANUAL_RESTART_DELAY_MS : RECONNECT_DELAY_MS

    session.bot = null
    session.joinedAt = null
    session.pathfinderReady = false
    session.manualRestart = false

    if (session.afkTimer) clearInterval(session.afkTimer)
    session.afkTimer = null

    if (shuttingDown || session.paused || session.removed) {
      session.status = session.paused ? 'paused' : 'offline'
      log(account.name, 'Disconnected')
      broadcastStatus()
      return
    }

    session.reconnects += 1
    log(account.name, `Disconnected. Reconnecting in ${Math.round(restartDelay / 1000)}s...`)
    connectSession(session, restartDelay)
  })
}

function pauseBot(target) {
  const targets = getTargets(target)

  if (targets.length === 0) {
    emitLog(`Bot not found: ${target}`)
    return
  }

  for (const session of targets) {
    session.paused = true
    session.status = 'paused'
    clearSessionTimers(session)

    if (session.bot) {
      log(session.account.name, 'Paused')
      disconnectBot(session)
    } else {
      session.status = 'paused'
      log(session.account.name, 'Paused')
    }
  }

  broadcastStatus()
}

function resumeBot(target) {
  const targets = getTargets(target)

  if (targets.length === 0) {
    emitLog(`Bot not found: ${target}`)
    return
  }

  for (const session of targets) {
    session.paused = false

    if (!session.bot) {
      log(session.account.name, 'Resuming')
      connectSession(session)
    }
  }

  broadcastStatus()
}

function normalizeAccount(payload, existingPassword = '') {
  const name = String(payload.name || '').trim()
  const password = String(payload.password || existingPassword || '').trim()

  if (!name) throw new Error('Bot username is required')
  if (!password) throw new Error('Bot password is required')

  const account = { name, password }

  if (payload.proxy && payload.proxy.host && payload.proxy.port) {
    account.proxy = {
      host: String(payload.proxy.host).trim(),
      port: Number(payload.proxy.port),
      type: Number(payload.proxy.type || 5),
      username: String(payload.proxy.username || ''),
      password: String(payload.proxy.password || '')
    }
  }

  return account
}

function addAccount(payload) {
  const account = normalizeAccount(payload)
  const key = account.name.toLowerCase()

  if (getSession(key) || accounts.some(item => item.name.toLowerCase() === key)) {
    throw new Error(`Bot already exists: ${account.name}`)
  }

  accounts.push(account)
  saveAccounts()

  const session = createSession(account)

  log(account.name, 'Added')
  connectSession(session)
  broadcastStatus()
}

function editAccount(oldName, payload) {
  const oldKey = String(oldName || '').toLowerCase()
  const index = accounts.findIndex(account => account.name.toLowerCase() === oldKey)

  if (index === -1) throw new Error(`Bot not found: ${oldName}`)

  const existing = accounts[index]
  const next = normalizeAccount(payload, existing.password)
  const nextKey = next.name.toLowerCase()
  const duplicate = accounts.some((account, accountIndex) => (
    accountIndex !== index && account.name.toLowerCase() === nextKey
  ))

  if (duplicate) throw new Error(`Bot already exists: ${next.name}`)

  const oldSession = getSession(oldKey)
  const wasPaused = oldSession?.paused || false

  if (oldSession) {
    oldSession.removed = true
    clearSessionTimers(oldSession)

    disconnectBot(oldSession)

    sessions.delete(oldKey)
  }

  accounts[index] = next
  saveAccounts()

  const newSession = createSession(next)
  newSession.paused = wasPaused
  newSession.status = wasPaused ? 'paused' : 'offline'

  log(next.name, 'Updated')

  if (!wasPaused) connectSession(newSession)

  broadcastStatus()
}

function removeAccount(name) {
  const key = String(name || '').toLowerCase()
  const index = accounts.findIndex(account => account.name.toLowerCase() === key)

  if (index === -1) throw new Error(`Bot not found: ${name}`)

  const [account] = accounts.splice(index, 1)
  const session = getSession(key)

  if (session) {
    session.removed = true
    clearSessionTimers(session)

    disconnectBot(session)

    sessions.delete(key)
  }

  saveAccounts()
  log(account.name, 'Removed')
  broadcastStatus()
}

function updateServerSettings(payload) {
  const parsed = parseServerInput(payload.host, payload.port)
  const host = parsed.host
  const port = parsed.port
  const auth = String(payload.auth || 'offline').trim()
  const name = String(payload.name || host).trim()

  if (!host) throw new Error('Server ID/address is required')
  if (!Number.isFinite(port) || port <= 0) throw new Error('Server port is invalid')

  profile.server.host = host
  profile.server.port = port
  profile.server.auth = auth
  profile.savedServers = upsertSavedServer(profile.savedServers || [], { name, host, port, auth })
  saveConfig()

  serverSettings = { host, port, auth }
  resolvedServer = { host, port, source: 'direct' }
  resetServerInfo()
  emitLog(`Server set to ${host}:${port}`)
  resolveConfiguredServerForInfo()

  if (payload.restart) {
    restart('all')
  }

  broadcastStatus()
}

function resetServerInfo() {
  serverInfo = {
    favicon: null,
    description: '',
    players: null,
    version: null,
    latency: null,
    lastCheckedAt: null,
    lastError: ''
  }
}

function parseServerInput(hostInput, portInput) {
  let host = String(hostInput || '').trim()
  let port = Number(portInput || 25565)

  host = host.replace(/^minecraft:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '')

  if (host.includes(':') && !host.startsWith('[')) {
    const parts = host.split(':')
    const maybePort = Number(parts[parts.length - 1])

    if (Number.isFinite(maybePort)) {
      port = maybePort
      host = parts.slice(0, -1).join(':')
    }
  }

  if (host.startsWith('[')) {
    const match = host.match(/^\[([^\]]+)\](?::(\d+))?$/)

    if (match) {
      host = match[1]
      if (match[2]) port = Number(match[2])
    }
  }

  return { host, port }
}

function upsertSavedServer(savedServers, server) {
  const key = `${server.host.toLowerCase()}:${server.port}`
  const filtered = savedServers.filter(item => `${String(item.host).toLowerCase()}:${item.port}` !== key)

  return [server, ...filtered].slice(0, 12)
}

function connectViaSocksProxy(client, proxy) {
  SocksClient.createConnection({
    proxy: {
      host: proxy.host,
      port: Number(proxy.port),
      type: Number(proxy.type || 5),
      userId: proxy.username,
      password: proxy.password
    },
    command: 'connect',
    destination: {
      host: resolvedServer.host,
      port: resolvedServer.port
    }
  }, (err, info) => {
    if (err) {
      client.emit('error', err)
      return
    }

    client.setSocket(info.socket)
    client.emit('connect')
  })
}

function handleChatMessage(session, msg) {
  session.lastMessage = msg

  if (enabled('chatLogger')) {
    appendChatLog(session, msg)
  }

  if (Date.now() < session.debugUntil) {
    log(session.account.name, msg)
  }

  const authPrompt = detectAuthPrompt(msg)

  if (authPrompt === 'register' && enabled('autoRegister')) {
    session.authStatus = 'registering'
    sendAuthCommand(session, 'register', profile.auth.registerCommand, 'Register command sent')
    return
  }

  if (authPrompt === 'login' && enabled('autoLogin')) {
    session.authStatus = 'logging-in'
    sendAuthCommand(session, 'login', profile.auth.loginCommand, 'Login command sent')
    return
  }

  updateAuthStatusFromMessage(session, msg)

  broadcastStatus()
}

function detectAuthPrompt(msg) {
  const normalized = msg.toLowerCase().replace(/\s+/g, ' ')

  if (
    normalized.includes('please register using') &&
    normalized.includes('/register') &&
    normalized.includes('<password>')
  ) {
    return 'register'
  }

  if (
    normalized.includes('please login using') &&
    normalized.includes('/login') &&
    normalized.includes('<password>')
  ) {
    return 'login'
  }

  return null
}

if (process.env.AUTH_PROMPT_SELFTEST === 'true') {
  const registerPrompt = 'Please register using: /register <password> <password>'
  const loginPrompt = 'Please login using: /login <password> [2fa_code]'

  if (detectAuthPrompt(registerPrompt) !== 'register') {
    throw new Error('Register prompt self-test failed')
  }

  if (detectAuthPrompt(loginPrompt) !== 'login') {
    throw new Error('Login prompt self-test failed')
  }

  console.log('auth-prompt-selftest-ok')
  process.exit(0)
}

function updateAuthStatusFromMessage(session, msg) {
  const normalized = msg.toLowerCase()

  if (normalized.includes('successfully registered') || normalized.includes('registered successfully')) {
    session.registered = true
    session.authStatus = 'registered'
  }

  if (
    normalized.includes('successfully logged') ||
    normalized.includes('logged in') ||
    normalized.includes('login successful')
  ) {
    session.loggedIn = true
    session.authStatus = 'logged-in'
  }
}

function sendAuthCommand(session, action, template, message) {
  const now = Date.now()

  if (session.lastAuthAction === action && now - session.lastAuthAt < 5000) {
    return
  }

  session.lastAuthAction = action
  session.lastAuthAt = now

  setTimeout(() => {
    if (!session.bot || !session.bot.entity) return

    session.bot.chat(template.replaceAll('{password}', session.account.password))
    log(session.account.name, message)
    broadcastStatus()
  }, LOGIN_DELAY_MS)
}

function appendChatLog(session, msg) {
  const now = Date.now()
  const line = `[${new Date().toISOString()}] [${session.account.name}] ${msg}`

  if (msg === session.lastChatLine && now - session.lastChatAt < 3000) return

  session.lastChatLine = msg
  session.lastChatAt = now

  fs.mkdirSync(LOG_DIR, { recursive: true })
  fs.appendFile(CHAT_LOG_PATH, `${line}\n`, () => {})
}

function startAfkLoop(session) {
  if (session.afkTimer) return

  session.afkTimer = setInterval(() => {
    const { bot } = session

    if (!session.afkEnabled || !bot || !bot.entity) return

    bot.look(Math.random() * Math.PI * 2, randomPitch(), true)
    bot.swingArm('right')

    if (Math.random() > 0.5) {
      bot.setControlState('sneak', true)
      setTimeout(() => {
        if (session.bot) session.bot.setControlState('sneak', false)
      }, 700)
    }
  }, AFK_INTERVAL_MS)
}

function randomPitch() {
  return (Math.random() - 0.5) * 0.6
}

function formatKickReason(reason) {
  if (!reason) return 'No reason provided'
  if (typeof reason === 'string') return reason

  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function formatUptime(startedAt) {
  if (!startedAt) return '-'

  const totalSeconds = Math.floor((Date.now() - startedAt) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes < 60) return `${minutes}m ${seconds}s`

  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function printHelp() {
  emitLog(`
AFK Bot Ready
Server: ${serverSettings.host}:${serverSettings.port}
Profile: ${config.activeProfile}
Dashboard: ${profile.ui.enabled ? `http://${UI_HOST}:${UI_PORT}` : 'disabled'}
Accounts: ${accounts.map(account => account.name).join(', ')}

Commands:
help                         Show this menu
list                         Show compact bot list
status                       Show detailed bot status
pos                          Show all bot positions
pos botname                  Show one bot position
afk on|off all               Enable or disable AFK for all bots
afk on|off botname           Enable or disable AFK for one bot
restart all                  Restart all bots
restart botname              Restart one bot
pause all                    Pause all bots without reconnecting
pause botname                Pause one bot without reconnecting
resume all                   Resume all paused bots
resume botname               Resume one paused bot
debug botname seconds        Print chat for a bot temporarily
goto botname x y z           Walk a bot to coordinates
come botname player          Walk near a player
follow botname player        Follow a player
stop botname                 Stop pathfinding for a bot
all /command                 Send a slash command from every online bot
botname /command             Send a slash command from one online bot
exit                         Quit all bots
`)
}

function listBots() {
  for (const [name, session] of sessions) {
    emitLog(`${name} | ${session.status} | afk:${session.afkEnabled ? 'on' : 'off'} | reconnects:${session.reconnects}`)
  }
}

function printStatus() {
  for (const [name, session] of sessions) {
    const item = getSessionStatus(name, session)
    const lastError = item.lastError ? ` | last: ${item.lastError}` : ''

    emitLog(`${item.name} | ${item.status} | uptime:${item.uptime} | afk:${item.afk ? 'on' : 'off'} | path:${item.pathfinder ? 'ready' : 'off'} | reconnects:${item.reconnects}${lastError}`)
  }
}

function printPositions(target = 'all') {
  const targets = getTargets(target)

  if (targets.length === 0) {
    emitLog(`Bot not found: ${target}`)
    return
  }

  for (const session of targets) {
    const { account, bot } = session

    if (!bot || !bot.entity || !bot.entity.position) {
      emitLog(`${account.name.toLowerCase()} | Position unavailable`)
      continue
    }

    const p = bot.entity.position
    emitLog(`${account.name.toLowerCase()} | X:${p.x.toFixed(1)} Y:${p.y.toFixed(1)} Z:${p.z.toFixed(1)}`)
  }
}

function setAfk(target, enabled) {
  const targets = getTargets(target)

  if (targets.length === 0) {
    emitLog(`Bot not found: ${target}`)
    return
  }

  for (const session of targets) {
    session.afkEnabled = enabled
    log(session.account.name, `AFK ${enabled ? 'enabled' : 'disabled'}`)
  }

  broadcastStatus()
}

function restart(target) {
  const targets = getTargets(target)

  if (targets.length === 0) {
    emitLog(`Bot not found: ${target}`)
    return
  }

  for (const session of targets) {
    session.paused = false
    session.manualRestart = true
    clearSessionTimers(session)

    if (session.bot) {
      log(session.account.name, 'Restarting...')
      disconnectBot(session)
    } else {
      log(session.account.name, 'Starting...')
      connectSession(session)
    }
  }
}

function setDebug(target, seconds) {
  const session = getSession(target)

  if (!session) {
    emitLog(`Bot not found: ${target}`)
    return
  }

  const durationMs = Math.max(1, Number(seconds) || 10) * 1000

  session.debugUntil = Date.now() + durationMs
  log(session.account.name, `Debug enabled for ${Math.round(durationMs / 1000)}s`)
}

function sendCommand(target, command) {
  const targets = getTargets(target).filter(session => session.bot && session.status === 'online')

  if (targets.length === 0) {
    emitLog(`No online bot found for: ${target}`)
    return
  }

  for (const session of targets) {
    session.debugUntil = Date.now() + DEBUG_AFTER_COMMAND_MS
    session.bot.chat(command)
  }

  emitLog(`Sent to ${target}: ${command}`)
}

function gotoCoordinates(target, x, y, z) {
  const session = getSession(target)

  if (!canPathfind(session, target)) return

  session.bot.pathfinder.setGoal(new goals.GoalBlock(Number(x), Number(y), Number(z)))
  log(session.account.name, `Pathfinding to ${x} ${y} ${z}`)
}

function comeToPlayer(target, playerName) {
  const session = getSession(target)

  if (!canPathfind(session, target)) return

  const player = session.bot.players[playerName]?.entity

  if (!player) {
    emitLog(`Player not visible to ${target}: ${playerName}`)
    return
  }

  session.bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 2))
  log(session.account.name, `Walking near ${playerName}`)
}

function followPlayer(target, playerName) {
  const session = getSession(target)

  if (!canPathfind(session, target)) return

  const player = session.bot.players[playerName]?.entity

  if (!player) {
    emitLog(`Player not visible to ${target}: ${playerName}`)
    return
  }

  session.bot.pathfinder.setGoal(new goals.GoalFollow(player, 3), true)
  log(session.account.name, `Following ${playerName}`)
}

function stopPathfinding(target) {
  const session = getSession(target)

  if (!canPathfind(session, target)) return

  session.bot.pathfinder.setGoal(null)
  log(session.account.name, 'Pathfinding stopped')
}

function canPathfind(session, target) {
  if (!session) {
    emitLog(`Bot not found: ${target}`)
    return false
  }

  if (!enabled('pathfinding')) {
    emitLog('Pathfinding is disabled in config.json')
    return false
  }

  if (!session.bot || !session.pathfinderReady) {
    emitLog(`Pathfinding is not ready for ${target}`)
    return false
  }

  return true
}

function handleInput(input) {
  const text = String(input || '').trim()
  const lower = text.toLowerCase()

  if (!text) return

  if (lower === 'help') return printHelp()
  if (lower === 'list') return listBots()
  if (lower === 'status') return printStatus()
  if (lower === 'exit' || lower === 'quit') return shutdown()

  const parts = text.split(/\s+/)
  const action = parts[0].toLowerCase()

  if (action === 'pos') return printPositions(parts[1] || 'all')

  if (action === 'afk') {
    if (!['on', 'off'].includes((parts[1] || '').toLowerCase()) || !parts[2]) {
      emitLog('Use: afk on|off all or afk on|off botname')
      return
    }

    return setAfk(parts[2].toLowerCase(), parts[1].toLowerCase() === 'on')
  }

  if (action === 'restart') {
    if (!parts[1]) {
      emitLog('Use: restart all or restart botname')
      return
    }

    return restart(parts[1].toLowerCase())
  }

  if (action === 'pause') {
    if (!parts[1]) {
      emitLog('Use: pause all or pause botname')
      return
    }

    return pauseBot(parts[1].toLowerCase())
  }

  if (action === 'resume') {
    if (!parts[1]) {
      emitLog('Use: resume all or resume botname')
      return
    }

    return resumeBot(parts[1].toLowerCase())
  }

  if (action === 'debug') {
    if (!parts[1]) {
      emitLog('Use: debug botname seconds')
      return
    }

    return setDebug(parts[1].toLowerCase(), parts[2])
  }

  if (action === 'goto') {
    if (parts.length < 5) {
      emitLog('Use: goto botname x y z')
      return
    }

    return gotoCoordinates(parts[1].toLowerCase(), parts[2], parts[3], parts[4])
  }

  if (action === 'come') {
    if (parts.length < 3) {
      emitLog('Use: come botname player')
      return
    }

    return comeToPlayer(parts[1].toLowerCase(), parts[2])
  }

  if (action === 'follow') {
    if (parts.length < 3) {
      emitLog('Use: follow botname player')
      return
    }

    return followPlayer(parts[1].toLowerCase(), parts[2])
  }

  if (action === 'stop') {
    if (!parts[1]) {
      emitLog('Use: stop botname')
      return
    }

    return stopPathfinding(parts[1].toLowerCase())
  }

  const spaceIndex = text.indexOf(' ')

  if (spaceIndex === -1) {
    emitLog('Use: botname /command or all /command')
    return
  }

  const target = text.substring(0, spaceIndex).toLowerCase()
  const command = text.substring(spaceIndex + 1).trim()

  if (!command.startsWith('/')) {
    emitLog('Command must start with /')
    return
  }

  sendCommand(target, command)
}

function getSessionStatus(name, session) {
  const position = session.bot?.entity?.position
  const health = typeof session.bot?.health === 'number' ? session.bot.health : null
  const hunger = typeof session.bot?.food === 'number' ? session.bot.food : null

  return {
    name,
    status: session.status,
    paused: session.paused,
    authStatus: session.authStatus,
    afk: session.afkEnabled,
    uptime: formatUptime(session.joinedAt),
    reconnects: session.reconnects,
    pathfinder: session.pathfinderReady,
    health: health === null
      ? null
      : {
          value: Number(health.toFixed(1)),
          percent: Math.max(0, Math.min(100, Math.round((health / 20) * 100)))
        },
    hunger: hunger === null
      ? null
      : {
          value: Number(hunger.toFixed(1)),
          percent: Math.max(0, Math.min(100, Math.round((hunger / 20) * 100)))
        },
    lastError: session.lastError,
    lastMessage: session.lastMessage,
    position: position
      ? {
          x: Number(position.x.toFixed(1)),
          y: Number(position.y.toFixed(1)),
          z: Number(position.z.toFixed(1))
        }
      : null
  }
}

function getStatus() {
  return {
    server: `${serverSettings.host}:${serverSettings.port}`,
    serverSettings,
    resolvedServer,
    serverInfo,
    serverIconUrl: serverInfo.favicon || buildServerIconUrl(serverSettings),
    serverIconUrls: buildServerIconUrls(serverSettings),
    savedServers: profile.savedServers || [],
    profile: config.activeProfile,
    features: profile.features,
    bots: [...sessions.entries()].map(([name, session]) => getSessionStatus(name, session))
  }
}

function buildServerIconUrl(settings) {
  return buildServerIconUrls(settings)[0] || null
}

function buildServerIconUrls(settings) {
  const host = String(settings.host || '').trim()
  if (!host) return []

  const port = Number(settings.port || 25565)
  const address = port === 25565 ? host : `${host}:${port}`
  const encoded = encodeURIComponent(address)

  return [
    `https://api.mcsrvstat.us/icon/${encoded}`,
    `https://api.mcstatus.io/v2/icon/${encoded}`,
    buildLocalServerIcon(host)
  ]
}

function buildLocalServerIcon(host) {
  return `data:image/svg+xml;base64,${Buffer.from(buildLocalServerIconSvg(host)).toString('base64')}`
}

function buildLocalServerIconSvg(host) {
  const label = String(host || '?')
    .split('.')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || '?'
  const hash = hashText(host)
  const hue = hash % 360

  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="hsl(${hue},70%,24%)"/><rect x="6" y="6" width="52" height="52" rx="8" fill="hsl(${hue},75%,34%)"/><path d="M10 18h44v12H10z" fill="rgba(255,255,255,.14)"/><text x="32" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="white">${escapeXml(label)}</text></svg>`
}

function hashText(value) {
  return String(value || '').split('').reduce((hash, char) => {
    return ((hash << 5) - hash + char.charCodeAt(0)) >>> 0
  }, 0)
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, char => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;'
  })[char])
}

function startWebUi() {
  if (!profile.ui.enabled) return

  httpServer = http.createServer(async (req, res) => {
    try {
      if (req.url === '/api/status') return sendJson(res, getStatus())
      if (req.url === '/api/server-icon.svg') return sendSvg(res, buildLocalServerIconSvg(serverSettings.host))
      if (req.url === '/api/command' && req.method === 'POST') return handleApiCommand(req, res)
      if (req.url === '/api/accounts' && req.method === 'POST') return handleApiAccounts(req, res)
      if (req.url === '/api/server' && req.method === 'POST') return handleApiServer(req, res)
      if (req.url === '/events') return handleEvents(req, res)

      return serveStatic(req, res)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: err.message || String(err) }))
    }
  })

  httpServer.listen(UI_PORT, UI_HOST, () => {
    emitLog(`Dashboard ready: http://${UI_HOST}:${UI_PORT}`)
  })
}

function sendJson(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendSvg(res, body) {
  res.writeHead(200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'no-store'
  })
  res.end(body)
}

function sendError(res, err, statusCode = 400) {
  res.writeHead(statusCode, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: err.message || String(err) }))
}

function readJsonBody(req, res, callback) {
  let body = ''

  req.on('data', chunk => {
    body += chunk
  })

  req.on('end', () => {
    try {
      callback(body ? JSON.parse(body) : {})
    } catch (err) {
      sendError(res, err)
    }
  })
}

function handleApiCommand(req, res) {
  readJsonBody(req, res, payload => {
    try {
      handleInput(payload.command || '')
      sendJson(res, { ok: true })
    } catch (err) {
      sendError(res, err)
    }
  })
}

function handleApiAccounts(req, res) {
  readJsonBody(req, res, payload => {
    try {
      const action = String(payload.action || '').toLowerCase()

      if (action === 'add') addAccount(payload.account || {})
      else if (action === 'edit') editAccount(payload.name, payload.account || {})
      else if (action === 'remove') removeAccount(payload.name)
      else if (action === 'pause') pauseBot(payload.name || 'all')
      else if (action === 'resume') resumeBot(payload.name || 'all')
      else throw new Error(`Unknown account action: ${action}`)

      sendJson(res, { ok: true, status: getStatus() })
    } catch (err) {
      sendError(res, err)
    }
  })
}

function handleApiServer(req, res) {
  readJsonBody(req, res, payload => {
    try {
      updateServerSettings(payload)
      sendJson(res, { ok: true, status: getStatus() })
    } catch (err) {
      sendError(res, err)
    }
  })
}

function handleEvents(_req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })

  eventClients.add(res)
  res.write(`event: status\ndata: ${JSON.stringify(getStatus())}\n\n`)

  res.on('close', () => {
    eventClients.delete(res)
  })
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  const filePath = path.join(PUBLIC_DIR, path.normalize(requestPath))

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    res.writeHead(200, { 'content-type': getContentType(filePath) })
    res.end(data)
  })
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html'
  if (filePath.endsWith('.css')) return 'text/css'
  if (filePath.endsWith('.js')) return 'text/javascript'
  return 'application/octet-stream'
}

function shutdown() {
  if (shuttingDown) return

  shuttingDown = true
  emitLog('Stopping bots...')

  for (const session of sessions.values()) {
    clearSessionTimers(session)

    if (session.bot) {
      disconnectBot(session)
    }
  }

  if (rl) rl.close()
  if (httpServer) httpServer.close()

  setTimeout(() => {
    process.exit(0)
  }, 500)
}

validateAccounts()
accounts.forEach(createSession)
resolveConfiguredServerForInfo()
startWebUi()
printHelp()

for (const [index, session] of [...sessions.values()].entries()) {
  if (BOT_AUTOSTART) {
    connectSession(session, index * JOIN_DELAY_MS)
  }
}

rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.on('line', handleInput)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
