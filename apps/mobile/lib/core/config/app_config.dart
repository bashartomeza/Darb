import 'package:flutter_riverpod/flutter_riverpod.dart';

enum DarbAppEnvironment { local, test, demo, staging, production }

class AppConfig {
  const AppConfig({
    required this.appEnvironment,
    required this.apiBaseUrl,
    required this.demoFeaturesEnabled,
  });

  factory AppConfig.fromEnvironment() {
    return AppConfig.fromValues(
      appEnvironment: const String.fromEnvironment(
        'APP_ENV',
        defaultValue: 'local',
      ),
      apiBaseUrl: const String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://localhost:3000',
      ),
      enableDemoFeatures: const bool.fromEnvironment('ENABLE_DEMO_FEATURES'),
    );
  }

  factory AppConfig.fromValues({
    required String appEnvironment,
    required String apiBaseUrl,
    required bool enableDemoFeatures,
  }) {
    final environment = DarbAppEnvironment.values
        .where((value) => value.name == appEnvironment)
        .firstOrNull;
    if (environment == null) {
      throw StateError('APP_ENV is missing or invalid');
    }
    if (apiBaseUrl.isEmpty) {
      throw StateError('API_BASE_URL is required');
    }
    final productionLike =
        environment == DarbAppEnvironment.staging ||
        environment == DarbAppEnvironment.production;
    if (productionLike && !apiBaseUrl.startsWith('https://')) {
      throw StateError('API_BASE_URL must use HTTPS in staging and production');
    }
    if (productionLike && enableDemoFeatures) {
      throw StateError(
        'ENABLE_DEMO_FEATURES cannot be enabled in staging or production',
      );
    }
    final demoAllowed =
        environment == DarbAppEnvironment.local ||
        environment == DarbAppEnvironment.test ||
        environment == DarbAppEnvironment.demo;
    final demoFeaturesEnabled = demoAllowed && enableDemoFeatures;
    return AppConfig(
      appEnvironment: environment,
      apiBaseUrl: apiBaseUrl.replaceFirst(RegExp(r'/$'), ''),
      demoFeaturesEnabled: demoFeaturesEnabled,
    );
  }

  final DarbAppEnvironment appEnvironment;
  final String apiBaseUrl;
  final bool demoFeaturesEnabled;
}

final appConfigProvider = Provider<AppConfig>((ref) {
  return AppConfig.fromEnvironment();
});
