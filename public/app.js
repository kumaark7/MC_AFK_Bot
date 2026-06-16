const state = {
  status: null,
  logs: [],
  serverFormDirty: false
}

const serverLine = document.querySelector('#serverLine')
const serverIcon = document.querySelector('#serverIcon')
const profileValue = document.querySelector('#profileValue')
const botCount = document.querySelector('#botCount')
const onlineCount = document.querySelector('#onlineCount')
const pathValue = document.querySelector('#pathValue')
const botRows = document.querySelector('#botRows')
const logs = document.querySelector('#logs')
const commandForm = document.querySelector('#commandForm')
const commandInput = document.querySelector('#commandInput')
const serverForm = document.querySelector('#serverForm')
const serverName = document.querySelector('#serverName')
const serverHost = document.querySelector('#serverHost')
const serverPort = document.querySelector('#serverPort')
const serverAuth = document.querySelector('#serverAuth')
const serverRestart = document.querySelector('#serverRestart')
const savedServerSelect = document.querySelector('#savedServerSelect')
const serverHostOptions = document.querySelector('#serverHostOptions')
const botForm = document.querySelector('#botForm')
const editingBot = document.querySelector('#editingBot')
const botName = document.querySelector('#botName')
const botPassword = document.querySelector('#botPassword')
const saveBot = document.querySelector('#saveBot')
const cancelEdit = document.querySelector('#cancelEdit')
const savedBotSelect = document.querySelector('#savedBotSelect')
const botNameOptions = document.querySelector('#botNameOptions')
const commandPreset = document.querySelector('#commandPreset')
const commandBot = document.querySelector('#commandBot')
const commandOptions = document.querySelector('#commandOptions')
const refreshBots = document.querySelector('#refreshBots')

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Request failed')
  }

  return response.json()
}

function sendCommand(command) {
  return postJson('/api/command', { command })
}

function refreshStatus() {
  return fetch('/api/status')
    .then(response => response.json())
    .then(renderStatus)
}

function accountAction(action, name, account) {
  return postJson('/api/accounts', { action, name, account })
}

function renderStatus(status) {
  state.status = status
  const resolved = status.resolvedServer && status.resolvedServer.host !== status.serverSettings.host
    ? ` -> ${status.resolvedServer.host}:${status.resolvedServer.port}`
    : ''
  serverLine.textContent = `Server: ${status.server}${resolved}`
  renderServerIcon(status)
  profileValue.textContent = status.profile
  botCount.textContent = status.bots.length
  onlineCount.textContent = status.bots.filter(bot => bot.status === 'online').length
  pathValue.textContent = status.features.pathfinding ? 'On' : 'Off'

  if (!state.serverFormDirty) {
    const currentSavedServer = findSavedServer(status.serverSettings, status.savedServers || [])

    serverName.value = currentSavedServer?.name || status.serverSettings.host
    serverHost.value = status.serverSettings.host
    serverPort.value = status.serverSettings.port
    serverAuth.value = status.serverSettings.auth
  }

  renderSavedServers(status.savedServers || [])
  renderBotSelectors(status.bots)
  renderCommandOptions(status.bots)

  botRows.innerHTML = ''

  for (const bot of status.bots) {
    const tr = document.createElement('tr')
    const position = bot.position ? `${bot.position.x}, ${bot.position.y}, ${bot.position.z}` : '-'
    const health = bot.health ? `${bot.health.percent}%` : '-'
    const hunger = bot.hunger ? `${bot.hunger.percent}%` : '-'
    const pauseLabel = bot.paused || bot.status === 'paused' ? 'Resume' : 'Pause'
    const pauseAction = bot.paused || bot.status === 'paused' ? 'resume' : 'pause'

    tr.innerHTML = `
      <td>
        <div class="botNameCell">
          <span class="botAvatar" style="${botAvatarStyle(bot.name)}">${escapeHtml(botInitial(bot.name))}</span>
          <strong>${escapeHtml(bot.name)}</strong>
        </div>
      </td>
      <td><span class="status ${escapeHtml(bot.status)}">${escapeHtml(bot.status)}</span></td>
      <td>${escapeHtml(bot.authStatus || '-')}</td>
      <td>${health}</td>
      <td>${hunger}</td>
      <td>${bot.afk ? 'On' : 'Off'}</td>
      <td>${escapeHtml(bot.uptime)}</td>
      <td>${bot.reconnects}</td>
      <td>${position}</td>
      <td>
        <div class="rowActions">
          <button data-command="restart ${escapeAttr(bot.name)}">Restart</button>
          <button data-account-action="${pauseAction}" data-name="${escapeAttr(bot.name)}">${pauseLabel}</button>
          <button data-edit-bot="${escapeAttr(bot.name)}">Edit</button>
          <button class="danger" data-account-action="remove" data-name="${escapeAttr(bot.name)}">Remove</button>
        </div>
      </td>
    `

    botRows.appendChild(tr)
  }
}

function renderServerIcon(status) {
  const serverInfo = status.serverInfo || {}
  const urls = [
    serverInfo.favicon,
    ...(status.serverIconUrls || []),
    status.serverIconUrl,
    '/assets/larry-control-icon.png'
  ].filter(Boolean)
  const nextSrc = urls[0]

  if (serverIcon.getAttribute('src') !== nextSrc) {
    serverIcon.dataset.iconIndex = '0'
    serverIcon.dataset.iconUrls = JSON.stringify(urls)
    serverIcon.onerror = () => {
      const list = JSON.parse(serverIcon.dataset.iconUrls || '[]')
      const nextIndex = Number(serverIcon.dataset.iconIndex || 0) + 1
      serverIcon.dataset.iconIndex = String(nextIndex)

      if (list[nextIndex]) {
        serverIcon.src = list[nextIndex]
      } else {
        serverIcon.onerror = null
        serverIcon.src = '/assets/larry-control-icon.png'
      }
    }
    serverIcon.src = nextSrc
  }

  const details = []
  if (serverInfo?.description) details.push(serverInfo.description)
  if (serverInfo?.players) details.push(`${serverInfo.players.online}/${serverInfo.players.max} players`)
  if (serverInfo?.version?.name) details.push(serverInfo.version.name)
  if (serverInfo?.lastError) details.push(`Ping: ${serverInfo.lastError}`)

  serverIcon.title = details.join(' | ') || 'Server icon'
}

function botInitial(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase() || '?'
}

function botAvatarStyle(name) {
  const palettes = [
    ['#1fd95d', '#0d6b34'],
    ['#3aa7ff', '#16508f'],
    ['#ffb84d', '#8b4a10'],
    ['#e55bff', '#6f1b86'],
    ['#ff5a67', '#8d1f28'],
    ['#33d6c5', '#0d6f66']
  ]
  const hash = hashText(name)
  const colors = palettes[hash % palettes.length]

  return `--avatar-start:${colors[0]};--avatar-end:${colors[1]};`
}

function hashText(value) {
  return String(value || '').split('').reduce((hash, char) => {
    return ((hash << 5) - hash + char.charCodeAt(0)) >>> 0
  }, 0)
}

function renderSavedServers(servers) {
  const previousValue = savedServerSelect.value

  savedServerSelect.innerHTML = '<option value="">Select server</option>'
  serverHostOptions.innerHTML = ''

  for (const server of servers) {
    const label = `${server.name || server.host} (${server.host}:${server.port || 25565})`
    const option = document.createElement('option')
    option.value = `${server.host}:${server.port || 25565}`
    option.dataset.server = JSON.stringify(server)
    option.textContent = label
    savedServerSelect.appendChild(option)

    const hostOption = document.createElement('option')
    hostOption.value = server.host
    hostOption.label = label
    serverHostOptions.appendChild(hostOption)
  }

  if ([...savedServerSelect.options].some(option => option.value === previousValue)) {
    savedServerSelect.value = previousValue
  }
}

function findSavedServer(current, servers) {
  return servers.find(server => (
    String(server.host).toLowerCase() === String(current.host).toLowerCase() &&
    Number(server.port || 25565) === Number(current.port || 25565)
  ))
}

function renderBotSelectors(bots) {
  const selectedCommandBot = commandBot.value || 'all'
  const selectedSavedBot = savedBotSelect.value

  commandBot.innerHTML = '<option value="all">all</option>'
  savedBotSelect.innerHTML = '<option value="">Select bot</option>'
  botNameOptions.innerHTML = ''

  for (const bot of bots) {
    const commandOption = document.createElement('option')
    commandOption.value = bot.name
    commandOption.textContent = bot.name
    commandBot.appendChild(commandOption)

    const savedOption = document.createElement('option')
    savedOption.value = bot.name
    savedOption.textContent = bot.name
    savedBotSelect.appendChild(savedOption)

    const nameOption = document.createElement('option')
    nameOption.value = bot.name
    botNameOptions.appendChild(nameOption)
  }

  commandBot.value = [...commandBot.options].some(option => option.value === selectedCommandBot)
    ? selectedCommandBot
    : 'all'
  savedBotSelect.value = [...savedBotSelect.options].some(option => option.value === selectedSavedBot)
    ? selectedSavedBot
    : ''
}

function renderCommandOptions(bots) {
  const botName = commandBot.value || bots[0]?.name || 'botname'
  const commands = buildCommandSuggestions(botName)

  commandOptions.innerHTML = ''

  for (const command of commands) {
    const option = document.createElement('option')
    option.value = command
    commandOptions.appendChild(option)
  }
}

function buildCommandSuggestions(botName) {
  return [
    'status',
    'list',
    'pos',
    `pos ${botName}`,
    'restart all',
    `restart ${botName}`,
    'pause all',
    `pause ${botName}`,
    'resume all',
    `resume ${botName}`,
    'afk on all',
    `afk on ${botName}`,
    'afk off all',
    `afk off ${botName}`,
    `debug ${botName} 10`,
    `goto ${botName} x y z`,
    `come ${botName} player`,
    `follow ${botName} player`,
    `stop ${botName}`,
    'all /spawn',
    `${botName} /spawn`,
    `${botName} /tpa player`
  ]
}

function applyCommandPreset() {
  if (!commandPreset.value) return

  const bot = commandBot.value || 'all'
  commandInput.value = commandPreset.value.replaceAll('{bot}', bot)
  commandInput.focus()
}

function addLog(line) {
  state.logs.push(line)

  if (state.logs.length > 250) {
    state.logs.shift()
  }

  logs.textContent = state.logs.join('\n')
  logs.scrollTop = logs.scrollHeight
}

function startEdit(name) {
  editingBot.value = name
  botName.value = name
  savedBotSelect.value = name
  botPassword.value = ''
  botPassword.placeholder = 'leave blank to keep current password'
  saveBot.textContent = 'Save Bot'
  cancelEdit.hidden = false
  botName.focus()
}

function resetBotForm() {
  editingBot.value = ''
  botName.value = ''
  savedBotSelect.value = ''
  botPassword.value = ''
  botPassword.placeholder = 'new or existing password'
  saveBot.textContent = 'Add Bot'
  cancelEdit.hidden = true
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;')
}

document.body.addEventListener('click', event => {
  const commandButton = event.target.closest('[data-command]')
  const accountButton = event.target.closest('[data-account-action]')
  const editButton = event.target.closest('[data-edit-bot]')

  if (commandButton) {
    sendCommand(commandButton.dataset.command).catch(error => addLog(error.message))
    return
  }

  if (accountButton) {
    const action = accountButton.dataset.accountAction
    const name = accountButton.dataset.name

    if (action === 'remove' && !confirm(`Remove ${name}?`)) return

    accountAction(action, name).catch(error => addLog(error.message))
    return
  }

  if (editButton) {
    startEdit(editButton.dataset.editBot)
  }
})

serverForm.addEventListener('submit', event => {
  event.preventDefault()

  postJson('/api/server', {
    name: serverName.value.trim() || serverHost.value.trim(),
    host: serverHost.value.trim(),
    port: Number(serverPort.value || 25565),
    auth: serverAuth.value,
    restart: serverRestart.checked
  })
    .then(() => {
      state.serverFormDirty = false
    })
    .catch(error => addLog(error.message))
})

savedServerSelect.addEventListener('change', () => {
  if (!savedServerSelect.value) return

  const server = JSON.parse(savedServerSelect.selectedOptions[0].dataset.server)
  serverName.value = server.name || server.host || ''
  serverHost.value = server.host || ''
  serverPort.value = server.port || 25565
  serverAuth.value = server.auth || 'offline'
  state.serverFormDirty = true
})

for (const input of [serverName, serverHost, serverPort, serverAuth, serverRestart]) {
  input.addEventListener('input', () => {
    state.serverFormDirty = true
  })

  input.addEventListener('change', () => {
    state.serverFormDirty = true
  })
}

savedBotSelect.addEventListener('change', () => {
  if (!savedBotSelect.value) {
    resetBotForm()
    return
  }

  startEdit(savedBotSelect.value)
})

commandPreset.addEventListener('change', applyCommandPreset)
commandBot.addEventListener('change', () => {
  if (state.status) renderCommandOptions(state.status.bots)
  applyCommandPreset()
})

botForm.addEventListener('submit', event => {
  event.preventDefault()

  const account = {
    name: botName.value.trim()
  }

  if (botPassword.value.trim()) {
    account.password = botPassword.value.trim()
  }

  if (!editingBot.value && !account.password) {
    addLog('Password is required for new bots')
    return
  }

  const action = editingBot.value ? 'edit' : 'add'
  const oldName = editingBot.value || account.name

  accountAction(action, oldName, account)
    .then(resetBotForm)
    .catch(error => addLog(error.message))
})

cancelEdit.addEventListener('click', resetBotForm)

commandForm.addEventListener('submit', event => {
  event.preventDefault()

  const command = commandInput.value.trim()

  if (!command) return

  sendCommand(command).catch(error => addLog(error.message))
  commandInput.value = ''
})

document.querySelector('#clearLogs').addEventListener('click', () => {
  state.logs = []
  logs.textContent = ''
})

refreshBots.addEventListener('click', () => {
  refreshStatus().catch(error => addLog(error.message))
})

const events = new EventSource('/events')

events.addEventListener('status', event => {
  renderStatus(JSON.parse(event.data))
})

events.addEventListener('log', event => {
  addLog(JSON.parse(event.data).line)
})

refreshStatus()
  .catch(() => {
    serverLine.textContent = 'Dashboard API unavailable'
  })
