import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() {
  runApp(const LarryControlApp());
}

class LarryControlApp extends StatelessWidget {
  const LarryControlApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Larry Control',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF2EFF55),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF071017),
        useMaterial3: true,
      ),
      home: const ControlHome(),
    );
  }
}

class ControlHome extends StatefulWidget {
  const ControlHome({super.key});

  @override
  State<ControlHome> createState() => _ControlHomeState();
}

class _ControlHomeState extends State<ControlHome> {
  static const _platform = MethodChannel('larry_control/termux');
  static const _localApiBase = 'http://127.0.0.1:3000';
  static const _firstTimeTermuxCommand =
      "mkdir -p ~/.termux; echo 'allow-external-apps = true' > ~/.termux/termux.properties; cat ~/.termux/termux.properties";

  final _commandController = TextEditingController();
  final _accountNameController = TextEditingController();
  final _accountPasswordController = TextEditingController();
  final _serverNameController = TextEditingController(text: 'Normal Survival');
  final _serverHostController = TextEditingController(text: 'play.normalsurvival.com');
  final _serverPortController = TextEditingController(text: '25565');
  String _serverAuth = 'offline';
  final _http = HttpClient()..connectionTimeout = const Duration(seconds: 6);
  final _events = <String>[];
  Map<String, dynamic>? _status;
  Timer? _refreshTimer;
  String _selectedBot = 'all';
  String _message = 'Not connected';
  int _tab = 0;
  bool _loading = false;

  List<Map<String, dynamic>> get _bots {
    final raw = _status?['bots'];
    if (raw is! List) return [];
    return raw.whereType<Map>().map((bot) => Map<String, dynamic>.from(bot)).toList();
  }

  String get _apiBase => _localApiBase;

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _commandController.dispose();
    _accountNameController.dispose();
    _accountPasswordController.dispose();
    _serverNameController.dispose();
    _serverHostController.dispose();
    _serverPortController.dispose();
    _http.close(force: true);
    super.dispose();
  }

  Future<void> _connect() async {
    setState(() {
      _loading = true;
      _message = 'Connecting...';
    });

    try {
      await _refreshStatus();
      _refreshTimer?.cancel();
      _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) => _refreshStatus(silent: true));
      _addEvent('Connected to $_apiBase');
    } catch (err) {
      _setMessage(_friendlyConnectionError(err));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _friendlyConnectionError(Object err) {
    final text = err.toString();

    if (text.contains('Connection refused')) {
      return 'Bot service is not running. Open Setup, run Setup Bot Runtime, save server/account, then Start Termux Bot.';
    }

    return 'Connection failed: $text';
  }

  Future<void> _startTermuxAndConnect() async {
    setState(() {
      _loading = true;
      _message = 'Starting Termux bot service...';
    });

    try {
      final result = await _runTermux('cd ~/MC_AFK_Bot && bash termux/start-bot.sh', background: false);
      _addEvent(result);
      await Future<void>.delayed(const Duration(seconds: 6));
      await _connect();
    } on PlatformException catch (err) {
      _setMessage('Termux start failed: ${err.message ?? err.code}');
    } catch (err) {
      _setMessage('Termux start failed: $err');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String> _runTermux(String command, {bool background = true}) async {
    final result = await _platform.invokeMethod<String>('runCommand', {
      'command': command,
      'background': background,
    });

    return result ?? 'Termux command sent';
  }

  Future<void> _openTermux() async {
    await _platform.invokeMethod<String>('openTermux');
    _setMessage('Termux opened.');
  }

  Future<void> _copyFirstTimeCommand() async {
    await Clipboard.setData(const ClipboardData(text: _firstTimeTermuxCommand));
    _setMessage('First-time Termux command copied. Paste it in Termux, press Enter, then restart Termux once.');
  }

  Future<void> _setupRuntime() async {
    const command = '''
pkg update -y
pkg install -y git nodejs
if [ ! -d "\$HOME/MC_AFK_Bot/.git" ]; then
  rm -rf "\$HOME/MC_AFK_Bot"
  git clone https://github.com/kumaark7/MC_AFK_Bot.git "\$HOME/MC_AFK_Bot"
fi
cd "\$HOME/MC_AFK_Bot"
git pull --ff-only || true
bash termux/setup-termux.sh
''';

    await _runTermux(command, background: false);
    _setMessage('Setup opened in Termux. Watch it finish, then return here.');
  }

  Future<void> _updateRuntime() async {
    const command = '''
cd "\$HOME/MC_AFK_Bot"
git pull --ff-only
npm install
chmod +x termux/*.sh
''';

    await _runTermux(command, background: false);
    _setMessage('Update opened in Termux.');
  }

  Future<void> _saveServerToTermux() async {
    final name = _serverNameController.text.trim().isEmpty ? 'Minecraft Server' : _serverNameController.text.trim();
    final host = _serverHostController.text.trim();
    final port = int.tryParse(_serverPortController.text.trim()) ?? 25565;

    if (host.isEmpty) {
      _setMessage('Server host is required.');
      return;
    }

    final config = {
      'activeProfile': 'default',
      'profiles': {
        'default': {
          'server': {
            'host': host,
            'port': port,
            'auth': _serverAuth,
          },
          'ui': {
            'enabled': true,
            'host': '127.0.0.1',
            'port': 3000,
          },
          'savedServers': [
            {
              'name': name,
              'host': host,
              'port': port,
              'auth': _serverAuth,
            }
          ],
          'timings': {
            'joinDelayMs': 5000,
            'reconnectDelayMs': 5000,
            'connectTimeoutMs': 15000,
            'manualRestartDelayMs': 1500,
            'loginDelayMs': 2000,
            'afkIntervalMs': 30000,
            'debugAfterCommandMs': 5000,
          },
          'features': {
            'antiAfk': true,
            'autoLogin': true,
            'autoRegister': true,
            'autoRespawn': true,
            'chatLogger': true,
            'pathfinding': true,
          },
          'auth': {
            'registerCommand': '/register {password} {password}',
            'loginCommand': '/login {password}',
          },
        }
      },
    };

    await _writeTermuxFile('config.json', jsonEncode(config));
    _setMessage('Server config saved to Termux.');
  }

  Future<void> _saveAccountToTermux() async {
    final name = _accountNameController.text.trim();
    final password = _accountPasswordController.text;

    if (name.isEmpty || password.isEmpty) {
      _setMessage('Bot username and password are required.');
      return;
    }

    final accounts = [
      {
        'name': name,
        'password': password,
      }
    ];

    await _writeTermuxFile('accounts.json', jsonEncode(accounts));
    _accountPasswordController.clear();
    _setMessage('Bot account saved to Termux.');
  }

  Future<void> _writeTermuxFile(String fileName, String content) async {
    final encoded = base64Encode(utf8.encode(content));
    final command = "cd ~/MC_AFK_Bot && printf '%s' '$encoded' | base64 -d > '$fileName'";

    await _runTermux(command);
  }

  Future<void> _refreshStatus({bool silent = false}) async {
    final data = await _getJson('/api/status');
    if (!mounted) return;

    setState(() {
      _status = data;
      if (!_botNames().contains(_selectedBot)) _selectedBot = 'all';
      _message = 'Connected';
    });

    if (!silent) _addEvent('Status refreshed');
  }

  Future<void> _botAction(String action, String name) async {
    await _postJson('/api/accounts', {
      'action': action,
      'name': name,
    });
    _addEvent('$action $name');
    await _refreshStatus(silent: true);
  }

  Future<void> _restart(String name) async {
    await _postJson('/api/command', {'command': 'restart $name'});
    _addEvent('restart $name');
    await _refreshStatus(silent: true);
  }

  Future<void> _sendCommand(String command) async {
    final clean = command.trim();
    if (clean.isEmpty) return;
    final slashCommand = clean.startsWith('/') ? clean : '/$clean';
    await _postJson('/api/command', {'command': '$_selectedBot $slashCommand'});
    _addEvent('$_selectedBot $slashCommand');
    _commandController.clear();
    await _refreshStatus(silent: true);
  }

  Future<Map<String, dynamic>> _getJson(String path) async {
    final uri = Uri.parse('$_apiBase$path');
    final request = await _http.getUrl(uri).timeout(const Duration(seconds: 8));
    final response = await request.close().timeout(const Duration(seconds: 8));
    return _decodeResponse(response);
  }

  Future<Map<String, dynamic>> _postJson(String path, Map<String, dynamic> payload) async {
    final uri = Uri.parse('$_apiBase$path');
    final request = await _http.postUrl(uri).timeout(const Duration(seconds: 8));
    request.headers.contentType = ContentType.json;
    request.add(utf8.encode(jsonEncode(payload)));
    final response = await request.close().timeout(const Duration(seconds: 8));
    return _decodeResponse(response);
  }

  Future<Map<String, dynamic>> _decodeResponse(HttpClientResponse response) async {
    final body = await response.transform(utf8.decoder).join();
    final data = body.isEmpty ? <String, dynamic>{} : jsonDecode(body) as Map<String, dynamic>;

    if (response.statusCode >= 400) {
      throw data['error'] ?? 'HTTP ${response.statusCode}';
    }

    return data;
  }

  void _setMessage(String message) {
    if (!mounted) return;
    setState(() => _message = message);
    _addEvent(message);
  }

  void _addEvent(String event) {
    if (!mounted) return;
    final stamp = TimeOfDay.now().format(context);
    setState(() {
      _events.insert(0, '[$stamp] $event');
      if (_events.length > 50) _events.removeLast();
    });
  }

  List<String> _botNames() => ['all', ..._bots.map((bot) => '${bot['name']}')];

  Future<void> _run(Future<void> Function() action) async {
    try {
      await action();
    } catch (err) {
      _setMessage('Action failed: $err');
    }
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      _dashboardPage(),
      _setupPage(),
      _botsPage(),
      _commandsPage(),
      _logsPage(),
    ];

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            Expanded(child: pages[_tab]),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (value) => setState(() => _tab = value),
        backgroundColor: const Color(0xFF09141D),
        indicatorColor: const Color(0x332EFF55),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.build_circle_outlined), label: 'Setup'),
          NavigationDestination(icon: Icon(Icons.groups_2_outlined), label: 'Bots'),
          NavigationDestination(icon: Icon(Icons.terminal_outlined), label: 'Commands'),
          NavigationDestination(icon: Icon(Icons.article_outlined), label: 'Logs'),
        ],
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 8),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Image.asset('assets/larry-control-icon.png', width: 54, height: 54),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Larry Control', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
                Text('Minecraft AFK Bot Controller', style: TextStyle(color: Color(0xFF9BB6C8))),
              ],
            ),
          ),
          IconButton(
            onPressed: _loading ? null : () => _run(() => _refreshStatus()),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
    );
  }

  Widget _dashboardPage() {
    final server = _status?['server'] ?? 'Not connected';
    final online = _bots.where((bot) => bot['status'] == 'online').length;

    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Connection', style: _titleStyle),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: _boxDecoration(borderColor: const Color(0x2236D66A)),
                child: const Row(
                  children: [
                    Icon(Icons.smartphone, color: Color(0xFF2EFF55)),
                    SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Local Termux API', style: TextStyle(fontWeight: FontWeight.w800)),
                          Text('127.0.0.1:3000 on this phone', style: TextStyle(color: Color(0xFF9BB6C8))),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'No IP editing needed. Use Setup first, then Start Termux.',
                style: TextStyle(color: Color(0xFF9BB6C8), fontSize: 12),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _loading ? null : _startTermuxAndConnect,
                      icon: const Icon(Icons.terminal),
                      label: const Text('Start Termux Bot'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _loading ? null : _connect,
                      icon: _loading
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.refresh),
                      label: const Text('Reconnect'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(_message, style: const TextStyle(color: Color(0xFF9BB6C8))),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _panel(
          child: Row(
            children: [
              _serverBadge(server.toString()),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Server Status', style: _labelStyle),
                    Text(server.toString(), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Text('$online / ${_bots.length} bots online', style: const TextStyle(color: Color(0xFF2EFF55))),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 1.55,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          children: [
            _quickTile('Start All', Icons.play_arrow, () => _run(() => _botAction('resume', 'all'))),
            _quickTile('Stop All', Icons.stop, () => _run(() => _botAction('pause', 'all')), danger: true),
            _quickTile('Restart All', Icons.restart_alt, () => _run(() => _restart('all'))),
            _quickTile('Status', Icons.monitor_heart_outlined, () => _run(() => _refreshStatus())),
          ],
        ),
      ],
    );
  }

  Widget _setupPage() {
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        const Text('Setup', style: _screenTitleStyle),
        const SizedBox(height: 12),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('First Time Termux Permission', style: _titleStyle),
              const SizedBox(height: 8),
              const Text(
                'On a fresh Termux install, Android blocks app commands until this Termux setting exists. Copy the command, open Termux, paste it, press Enter, then restart Termux once.',
                style: TextStyle(color: Color(0xFF9BB6C8)),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _run(_copyFirstTimeCommand),
                      icon: const Icon(Icons.copy),
                      label: const Text('Copy Command'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _run(_openTermux),
                      icon: const Icon(Icons.open_in_new),
                      label: const Text('Open Termux'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Runtime', style: _titleStyle),
              const SizedBox(height: 8),
              const Text(
                'Use this once on a new phone. It installs Node, clones the bot repo, installs packages, and enables Termux app commands.',
                style: TextStyle(color: Color(0xFF9BB6C8)),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _loading ? null : () => _run(_setupRuntime),
                icon: const Icon(Icons.download),
                label: const Text('Setup Bot Runtime'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _loading ? null : () => _run(_updateRuntime),
                icon: const Icon(Icons.system_update_alt),
                label: const Text('Update Runtime'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Server', style: _titleStyle),
              const SizedBox(height: 12),
              TextField(
                controller: _serverNameController,
                decoration: const InputDecoration(labelText: 'Server Name', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _serverHostController,
                decoration: const InputDecoration(labelText: 'Server Address', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _serverPortController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Port', border: OutlineInputBorder()),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _serverAuth,
                      decoration: const InputDecoration(labelText: 'Auth', border: OutlineInputBorder()),
                      items: const [
                        DropdownMenuItem(value: 'offline', child: Text('offline')),
                        DropdownMenuItem(value: 'microsoft', child: Text('microsoft')),
                      ],
                      onChanged: (value) => setState(() => _serverAuth = value ?? 'offline'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _loading ? null : () => _run(_saveServerToTermux),
                icon: const Icon(Icons.save),
                label: const Text('Save Server To Termux'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Bot Account', style: _titleStyle),
              const SizedBox(height: 12),
              TextField(
                controller: _accountNameController,
                decoration: const InputDecoration(labelText: 'Bot Username', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _accountPasswordController,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Server Password', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _loading ? null : () => _run(_saveAccountToTermux),
                icon: const Icon(Icons.person_add_alt),
                label: const Text('Save Bot Account'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Start', style: _titleStyle),
              const SizedBox(height: 8),
              const Text(
                'After runtime, server, and account are saved, start the Termux bot service and connect locally.',
                style: TextStyle(color: Color(0xFF9BB6C8)),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _loading ? null : _startTermuxAndConnect,
                icon: const Icon(Icons.play_arrow),
                label: const Text('Start Termux Bot'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _botsPage() {
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        const Text('Bots', style: _screenTitleStyle),
        const SizedBox(height: 12),
        if (_bots.isEmpty)
          _panel(
            child: const Text(
              'Bot service is offline. Go to Setup, finish Termux setup, then tap Start Termux Bot.',
            ),
          ),
        for (final bot in _bots) _botCard(bot),
      ],
    );
  }

  Widget _commandsPage() {
    const commands = ['/spawn', '/home', '/shops', '/ah', '/balance', '/back', '/tpa', '/tpaaccept', '/rtp', '/jobs', '/warps'];

    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        const Text('Commands', style: _screenTitleStyle),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _botNames().contains(_selectedBot) ? _selectedBot : 'all',
          decoration: const InputDecoration(labelText: 'Select Bot', border: OutlineInputBorder()),
          items: _botNames().map((name) => DropdownMenuItem(value: name, child: Text(name))).toList(),
          onChanged: (value) => setState(() => _selectedBot = value ?? 'all'),
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final command in commands)
              OutlinedButton(
                onPressed: () => _run(() => _sendCommand(command)),
                child: Text(command),
              ),
          ],
        ),
        const SizedBox(height: 18),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _commandController,
                decoration: const InputDecoration(
                  labelText: 'Custom command',
                  hintText: '/spawn',
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (value) => _run(() => _sendCommand(value)),
              ),
            ),
            const SizedBox(width: 10),
            FilledButton(
              onPressed: () => _run(() => _sendCommand(_commandController.text)),
              child: const Icon(Icons.send),
            ),
          ],
        ),
      ],
    );
  }

  Widget _logsPage() {
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        const Text('Activity', style: _screenTitleStyle),
        const SizedBox(height: 12),
        if (_events.isEmpty) _panel(child: const Text('No app actions yet.')),
        for (final event in _events)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: _boxDecoration(),
            child: Text(event),
          ),
      ],
    );
  }

  Widget _botCard(Map<String, dynamic> bot) {
    final name = '${bot['name']}';
    final status = '${bot['status']}';
    final pos = bot['position'] is Map
        ? 'X:${bot['position']['x']} Y:${bot['position']['y']} Z:${bot['position']['z']}'
        : 'Position unavailable';
    final health = bot['health'] is Map ? '${bot['health']['percent']}%' : '-';
    final hunger = bot['hunger'] is Map ? '${bot['hunger']['percent']}%' : '-';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: _boxDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _avatar(name),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    Text(status, style: TextStyle(color: status == 'online' ? const Color(0xFF2EFF55) : const Color(0xFFFF5959))),
                  ],
                ),
              ),
              Text('H $health  F $hunger', style: const TextStyle(color: Color(0xFF9BB6C8))),
            ],
          ),
          const SizedBox(height: 8),
          Text(pos, style: const TextStyle(color: Color(0xFF9BB6C8))),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: OutlinedButton(onPressed: () => _run(() => _botAction('resume', name)), child: const Text('Start'))),
              const SizedBox(width: 8),
              Expanded(child: OutlinedButton(onPressed: () => _run(() => _botAction('pause', name)), child: const Text('Stop'))),
              const SizedBox(width: 8),
              Expanded(child: OutlinedButton(onPressed: () => _run(() => _restart(name)), child: const Text('Restart'))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _quickTile(String label, IconData icon, VoidCallback onTap, {bool danger = false}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: _boxDecoration(borderColor: danger ? const Color(0xFFFF5555) : const Color(0x332EFF55)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Icon(icon, color: danger ? const Color(0xFFFF5555) : const Color(0xFF2EFF55)),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
          ],
        ),
      ),
    );
  }

  Widget _panel({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: _boxDecoration(),
      child: child,
    );
  }

  Widget _avatar(String name) {
    final colors = [
      const [Color(0xFF1FD95D), Color(0xFF0D6B34)],
      const [Color(0xFF3AA7FF), Color(0xFF16508F)],
      const [Color(0xFFFFB84D), Color(0xFF8B4A10)],
      const [Color(0xFFE55BFF), Color(0xFF6F1B86)],
    ];
    final pair = colors[name.hashCode.abs() % colors.length];
    final initial = name.isEmpty ? '?' : name[0].toUpperCase();

    return Container(
      width: 46,
      height: 46,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(9),
        gradient: LinearGradient(colors: pair),
      ),
      child: Text(initial, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
    );
  }

  Widget _serverBadge(String server) {
    final parts = server.split(':').first.split('.').where((part) => part.isNotEmpty).toList();
    final label = parts.take(2).map((part) => part[0]).join().toUpperCase();

    return Container(
      width: 70,
      height: 70,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(colors: [Color(0xFF2EFF55), Color(0xFF0E6831)]),
        boxShadow: const [BoxShadow(color: Color(0x552EFF55), blurRadius: 24)],
      ),
      child: Text(label.isEmpty ? 'MC' : label, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
    );
  }

  BoxDecoration _boxDecoration({Color borderColor = const Color(0x2636D66A)}) {
    return BoxDecoration(
      color: const Color(0xFF0D1A23),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: borderColor),
    );
  }
}

const _titleStyle = TextStyle(fontSize: 18, fontWeight: FontWeight.w900);
const _labelStyle = TextStyle(color: Color(0xFF9BB6C8), fontWeight: FontWeight.w700);
const _screenTitleStyle = TextStyle(fontSize: 28, fontWeight: FontWeight.w900);
