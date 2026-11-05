import 'package:flutter/widgets.dart';

import '../../core/api/api_error.dart';
import '../../l10n/app_localizations.dart';

/// Copy for the receiver handover flow, backed by the shared ARB files so any
/// parcel screen (merchant or passenger sender, driver) can use it.
class HandoverStrings {
  const HandoverStrings._(this._l);

  final AppLocalizations _l;

  static HandoverStrings of(BuildContext context) =>
      HandoverStrings._(AppLocalizations.of(context));

  String get senderTitle => _l.handoverReceiverHandoverCode;
  String get senderHint => _l.handoverGiveCodePersonReceiving;
  String get codeHidden => _l.handoverCodeWasIssuedSafety;
  String get notIssued => _l.handoverNoHandoverCodeYet;
  String get createCode => _l.handoverCreateHandoverCode;
  String get newCode => _l.handoverGetNewCode;
  String get locked => _l.handoverTooManyWrongAttempts;
  String get expired => _l.handoverCodeHasExpiredGet;
  String attemptsLeft(int count) => _l.handoverWrongAttemptsLeft(count);
  String get confirmedByCode => _l.handoverDeliveredReceiverConfirmedCode;
  String get confirmedUnavailable => _l.handoverDeliveredWithoutReceiverDriver;
  String get confirmedAdmin => _l.handoverDeliveryWasClosedBy;
  String reasonLabel(String reason) => _l.handoverDriverNote(reason);
  String get couldNotLoad => _l.handoverCouldNotLoadHandover;

  String get driverTitle => _l.handoverConfirmHandOver;
  String get driverIntro => _l.handoverAskReceiverTheir6;
  String codeFieldLabel(int index, int total) => total > 1
      ? _l.handoverCodeParcelOrder(index, total)
      : _l.handoverReceiverCode;
  String get confirm => _l.handoverConfirmDelivery;
  String get cancel => _l.cancel;
  String get receiverUnavailable => _l.handoverReceiverUnavailable;
  String get unavailableIntro => _l.handoverOnlyUseIfReceiver;
  String get reasonLabelField => _l.handoverReasonAtLeast10;
  String get confirmUnavailable => _l.handoverCompleteWithoutReceiver;
  String get back => _l.onboardingBack;
  String get invalidCodeFormat => _l.handoverEnter6DigitCode;
  String get reasonTooShort => _l.handoverDescribeWhyReceiverWas;

  /// Maps an API failure to a message the driver can act on.
  String errorFor(Object error) {
    if (error is ApiException) {
      switch (error.message) {
        case 'invalid_handover_code':
          return _l.handoverThatCodeNotRight;
        case 'handover_locked':
          return _l.handoverTooManyWrongCodes;
        case 'handover_expired':
          return _l.handoverCodeHasExpiredSender;
        case 'handover_not_issued':
          return _l.handoverNoCodeWasIssued;
        case 'delivery_confirmation_required':
          return _l.handoverReceiverMustConfirmBefore;
      }
    }
    return _l.handoverCouldNotConfirmDelivery;
  }
}
