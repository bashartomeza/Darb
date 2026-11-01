import 'package:masari_mobile/core/config/app_config.dart';

const demoTestAppConfig = AppConfig(
  appEnvironment: MasariAppEnvironment.test,
  apiBaseUrl: 'http://10.0.2.2:3000',
  demoFeaturesEnabled: true,
);

const productionTestAppConfig = AppConfig(
  appEnvironment: MasariAppEnvironment.production,
  apiBaseUrl: 'https://api.masari.example',
  demoFeaturesEnabled: false,
);
