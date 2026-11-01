import 'package:darb_mobile/core/config/app_config.dart';

const demoTestAppConfig = AppConfig(
  appEnvironment: DarbAppEnvironment.test,
  apiBaseUrl: 'http://10.0.2.2:3000',
  demoFeaturesEnabled: true,
);

const productionTestAppConfig = AppConfig(
  appEnvironment: DarbAppEnvironment.production,
  apiBaseUrl: 'https://api.darb.example',
  demoFeaturesEnabled: false,
);
