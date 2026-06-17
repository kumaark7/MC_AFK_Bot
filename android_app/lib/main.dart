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

  final _apiController = TextEditingController(text: 'http://127.0.0.1:3000');
  final _commandController = TextEditingController();
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

  String get _apiBase => _apiController.text.trim().replaceFirst(RegExp(r'/+$'), '');

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _apiController.dispose();
    _commandController.dispose();
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
      _setMessage('Connection failed: $err');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _startTermuxAndConnect() async {
    setState(() {
      _loading = true;
      _message = 'Starting Termux bot service...';
      _apiController.text = 'http://127.0.0.1:3000';
    });

    try {
      final result = await _platform.invokeMethod<String>('startBot');
      _addEvent(result ?? 'Termux command sent');
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
              TextField(
                controller: _apiController,
                decoration: const InputDecoration(
                  labelText: 'Dashboard API URL',
                  hintText: 'http://PC_WIFI_IP:3000',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Termux mode runs the bot on this phone and connects to 127.0.0.1. PC mode uses your PC Wi-Fi IP.',
                style: TextStyle(color: Color(0xFF9BB6C8), fontSize: 12),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _loading ? null : _connect,
                      icon: _loading
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.power_settings_new),
                      label: const Text('Connect'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _loading ? null : _startTermuxAndConnect,
                      icon: const Icon(Icons.terminal),
                      label: const Text('Start Termux'),
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

  Widget _botsPage() {
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        const Text('Bots', style: _screenTitleStyle),
        const SizedBox(height: 12),
        if (_bots.isEmpty) _panel(child: const Text('Connect to the dashboard API to load bots.')),
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
