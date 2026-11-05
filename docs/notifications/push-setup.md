# Push notifications: switching them on

Push notifications are built and tested but **off** until a Firebase project
exists. Until then the API sends nothing, the apps never ask for notification
permission, and the setting is hidden. Every in-app notification (the inbox and
the bell) keeps working as before.

## How it works

- Every inbox notification (match offers, trip updates, driver approaching,
  verification and document notices, report updates) can also be pushed.
- The phone registers its Firebase token with the API after sign-in
  (`PUT /api/v1/push/devices`). A token belongs to one account; if another
  account signs in on the same phone, the token moves to it.
- Logout, "sign out everywhere", a password change, an admin suspension or any
  other session revocation stops pushes to that phone. Tokens Firebase reports
  as dead are retired automatically.
- Each account can turn push off: passenger Settings, and "Security and
  sessions" for drivers and merchants (`GET`/`PUT /api/v1/push/preferences`).
- Push text is written in the language the phone uses (Arabic or English) and
  carries only the notification id, type and linked record, which the app uses
  to open the inbox, the driver's offers or the document-renewal page. Free-text
  reasons from reviewers are never put on the lock screen.
- Sending is best effort and happens after the request has finished: a push
  failure can never break or slow down the action that caused it. Only
  notifications from the last 10 minutes are pushed, so switching push on
  never sends old news.

## Owner steps

### 1. Create the Firebase project

1. In the [Firebase console](https://console.firebase.google.com/), create a
   project (for example `darb-production`; use a separate one for staging).
2. Add an **Android app** with package name `ps.darb.mobile`.
3. Add an **iOS app** with the app's bundle identifier (see `docs/mobile/IOS.md`).
4. For iOS, upload an **APNs authentication key** (Apple Developer account,
   Keys, "Apple Push Notifications service") under Project settings, Cloud
   Messaging.

You do not need to download `google-services.json` or
`GoogleService-Info.plist`: the app takes the same values from build settings
(step 3). Never commit either file.

### 2. Switch on the API

1. Project settings, Service accounts: **Generate new private key**. This JSON
   file is a credential. Store it in your secret manager, never in the
   repository, chat or tickets.
2. Give the API **one** of:
   - `FCM_SERVICE_ACCOUNT_FILE=/absolute/path/to/service-account.json`
     (a file mounted from the secret store), or
   - `FCM_SERVICE_ACCOUNT_JSON=<the file's JSON, or the JSON base64-encoded>`.
3. Set `PUSH_NOTIFICATIONS_ENABLED=true`.
4. Optional: `FCM_PROJECT_ID` if it differs from the key's `project_id`.
5. Deploy. The migration `20261111120000_push_devices` must have run. The API
   refuses to start if push is on and the key is missing or malformed (the
   error names the variable, never the value). At startup the log shows
   `push_notifications_started` with the project id.

### 3. Build the apps with push

Push is compiled into every build but only starts with these build settings
(values from Project settings, General, "Your apps"; use the Android app's
values for the Android build and the iOS app's values for the iOS build):

```
flutter build appbundle --release \
  --dart-define=APP_ENV=production \
  --dart-define=API_BASE_URL=https://darb.aynur.ps \
  --dart-define=PUSH_ENABLED=true \
  --dart-define=FIREBASE_PROJECT_ID=<project id> \
  --dart-define=FIREBASE_MESSAGING_SENDER_ID=<project number> \
  --dart-define=FIREBASE_APP_ID=<Android app id, 1:...:android:...> \
  --dart-define=FIREBASE_API_KEY=<Android API key> \
  --dart-define=APP_VERSION=1.0.0+1
```

For iOS use the iOS app id and API key, add
`--dart-define=FIREBASE_IOS_BUNDLE_ID=<bundle id>`, and in Xcode enable the
**Push Notifications** capability and **Background Modes, Remote
notifications** for the Runner target.

These values identify the app to Firebase and ship inside the app, but they
are still kept out of the repository; put them in your CI secrets or a local
`--dart-define-from-file` that is not committed.

A build without `PUSH_ENABLED=true`, or with it but without working Firebase
values, behaves exactly like today: no permission prompt, no token, no setting.

### 4. Check it

1. Sign in on a phone. After the home screen appears the app asks once for
   notification permission (Android 13+ and iOS). Allow it.
2. Trigger something that notifies that account (for example, accept a
   passenger's request as a driver). The passenger's phone shows the push;
   tapping it opens the notifications inbox.
3. Log out on the phone and trigger another event: no push arrives.

## Switching off

Set `PUSH_NOTIFICATIONS_ENABLED=false` (or remove it) and restart the API.
Registered phones are kept, so switching back on resumes pushes without users
doing anything.
