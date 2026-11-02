import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/passenger_theme.dart';
import '../../../auth/presentation/auth_completion_screen.dart' show authText;
import 'settings_widgets.dart';

/// Help & Support: the assistant one tap away, then answers to the questions
/// passengers ask most. There is no support inbox behind the API yet, so the
/// assistant is the live way to get help.
class PassengerHelpScreen extends StatelessWidget {
  const PassengerHelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final faqs = [
      (
        authText(context, 'How do I request a trip?', 'كيف أطلب رحلة؟'),
        authText(
          context,
          'Open Home, tap the search card, choose your pickup and destination, then send the request. Drivers on that route will see it.',
          'افتح الرئيسية واضغط على بطاقة البحث، اختر نقطة الانطلاق والوجهة ثم أرسل الطلب. سيراه السائقون على هذا المسار.',
        ),
      ),
      (
        authText(context, 'Where can I see my trips?', 'أين أجد رحلاتي؟'),
        authText(
          context,
          'The Trips tab lists your requests and their status, from pending to completed.',
          'تعرض لك صفحة الرحلات طلباتك وحالتها، من قيد الانتظار حتى الاكتمال.',
        ),
      ),
      (
        authText(
          context,
          'How do I follow my driver?',
          'كيف أتابع السائق؟',
        ),
        authText(
          context,
          'Once a driver accepts, open the Maps tab to see the route, the driver’s latest location and checkpoint alerts.',
          'بعد قبول السائق افتح صفحة الخرائط لترى المسار وآخر موقع للسائق وتنبيهات الحواجز.',
        ),
      ),
      (
        authText(context, 'I forgot my password', 'نسيت كلمة المرور'),
        authText(
          context,
          'On the login screen choose “Forgot password” and we will email you a code to reset it.',
          'من شاشة تسجيل الدخول اختر «نسيت كلمة المرور» وسنرسل لك رمزاً عبر البريد لإعادة تعيينها.',
        ),
      ),
    ];

    return SettingsPage(
      title: authText(context, 'Help & Support', 'المساعدة والدعم'),
      children: [
        SettingsRow(
          key: const ValueKey('helpAssistant'),
          icon: Icons.support_agent_rounded,
          label: authText(
            context,
            'Ask the Masari assistant',
            'اسأل مساعد مسار',
          ),
          onTap: () => context.go('/passenger/assistant'),
        ),
        const SizedBox(height: 24),
        Text(
          authText(context, 'Common questions', 'أسئلة شائعة'),
          style: PassengerStyle.sectionTitle,
        ),
        const SizedBox(height: 12),
        for (final (question, answer) in faqs)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Material(
              color: PassengerStyle.panel,
              borderRadius: BorderRadius.circular(PassengerStyle.radiusTile),
              clipBehavior: Clip.antiAlias,
              child: Theme(
                data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                  childrenPadding: const EdgeInsetsDirectional.fromSTEB(
                    14,
                    0,
                    14,
                    14,
                  ),
                  expandedCrossAxisAlignment: CrossAxisAlignment.start,
                  iconColor: PassengerStyle.orange,
                  collapsedIconColor: PassengerStyle.iconMuted,
                  title: Text(
                    question,
                    style: PassengerStyle.inter(
                      size: 15,
                      height: 19,
                      weight: 560,
                    ),
                  ),
                  children: [Text(answer, style: PassengerStyle.cardBody)],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
