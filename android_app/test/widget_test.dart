import 'package:flutter_test/flutter_test.dart';
import 'package:larry_control/main.dart';

void main() {
  testWidgets('Larry Control renders the connection screen', (tester) async {
    await tester.pumpWidget(const LarryControlApp());

    expect(find.text('Larry Control'), findsOneWidget);
    expect(find.text('Start Termux Bot'), findsOneWidget);
  });
}
