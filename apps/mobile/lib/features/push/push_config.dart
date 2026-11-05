import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Build-time switch for push notifications.
///
/// Push is compiled in but stays dormant unless the build sets
/// `--dart-define=PUSH_ENABLED=true` *and* Firebase can be initialised. The
/// Firebase app is described either by the `FIREBASE_*` defines below (no
/// google-services.json or GoogleService-Info.plist needed) or, when those are
/// absent, by native config files the owner added. Builds without either
/// behave exactly like builds without push: nothing is asked or registered.
///
/// The values are Firebase client identifiers (they ship inside every app
/// binary), not secrets; they still come from the build, not the repository,
/// so each environment can point at its own Firebase project.
class PushBuildConfig {
  const PushBuildConfig({required this.enabled, this.firebase});

  factory PushBuildConfig.fromEnvironment() {
    const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
    const appId = String.fromEnvironment('FIREBASE_APP_ID');
    const senderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
    const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
    const iosBundleId = String.fromEnvironment('FIREBASE_IOS_BUNDLE_ID');
    final complete = [
      apiKey,
      appId,
      senderId,
      projectId,
    ].every((value) => value.isNotEmpty);
    return PushBuildConfig(
      enabled: const bool.fromEnvironment('PUSH_ENABLED'),
      firebase: complete
          ? FirebaseClientValues(
              apiKey: apiKey,
              appId: appId,
              messagingSenderId: senderId,
              projectId: projectId,
              iosBundleId: iosBundleId.isEmpty ? null : iosBundleId,
            )
          : null,
    );
  }

  /// `PUSH_ENABLED=true` was passed to the build.
  final bool enabled;

  /// Explicit Firebase app values, or null to use native config files.
  final FirebaseClientValues? firebase;

  static const disabled = PushBuildConfig(enabled: false);
}

class FirebaseClientValues {
  const FirebaseClientValues({
    required this.apiKey,
    required this.appId,
    required this.messagingSenderId,
    required this.projectId,
    this.iosBundleId,
  });

  final String apiKey;
  final String appId;
  final String messagingSenderId;
  final String projectId;
  final String? iosBundleId;
}

final pushBuildConfigProvider = Provider<PushBuildConfig>((ref) {
  return PushBuildConfig.fromEnvironment();
});

/// App version reported with the push token (optional, for support).
const pushAppVersion = String.fromEnvironment('APP_VERSION');
