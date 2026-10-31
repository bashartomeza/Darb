// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Masari';

  @override
  String get tagline => 'Smart route-sharing logistics';

  @override
  String get welcomeTitle => 'Welcome to Masari';

  @override
  String get welcomeBody =>
      'This Android demo app is prepared for passenger, driver, and merchant roles. Only the app shell is enabled in this milestone.';

  @override
  String get arabic => 'Arabic';

  @override
  String get english => 'English';

  @override
  String get mobileDemoPreparation => 'Mobile demo preparation';

  @override
  String get apiEnvironment => 'API environment';

  @override
  String get continueAction => 'Continue';

  @override
  String get shellStatusTitle => 'App-shell status';

  @override
  String get shellStatusBody =>
      'Arabic is the default language, RTL is active for Arabic, and language selection persists after restart.';

  @override
  String get language => 'Language';

  @override
  String get configuredApiBaseUrl => 'Configured API base URL';

  @override
  String get androidOnly => 'Android target only';

  @override
  String get businessFlowsPending =>
      'Passenger, driver, and merchant flows will be added in later milestones.';

  @override
  String get lockedCorridor => 'Hebron / PPU / Bab Al-Zawiya -> Bethlehem';

  @override
  String get diagnostics => 'Technical diagnostics';

  @override
  String get loadingSession => 'Restoring your session...';

  @override
  String get sessionRestoreFailed =>
      'We could not restore your session. Please retry.';

  @override
  String get retry => 'Retry';

  @override
  String get signInWelcome => 'Sign in to continue to your role workspace.';

  @override
  String get signIn => 'Sign in';

  @override
  String get phone => 'Phone';

  @override
  String get email => 'Email';

  @override
  String get fullName => 'Full name';

  @override
  String get password => 'Password';

  @override
  String get showPassword => 'Show password';

  @override
  String get hidePassword => 'Hide password';

  @override
  String get signUp => 'Sign up';

  @override
  String get createAccount => 'Create account';

  @override
  String get createAccountSubtitle => 'Sign up as a passenger to get started.';

  @override
  String get newToMasari => 'New to Masari? Create an account';

  @override
  String get alreadyHaveAccount => 'Already have an account? Sign in';

  @override
  String get continueWithGoogle => 'Continue with Google';

  @override
  String get orSeparator => 'or';

  @override
  String get emailRequired => 'Enter your email.';

  @override
  String get emailInvalid => 'Enter a valid email address.';

  @override
  String get nameRequired => 'Enter your name.';

  @override
  String get passwordRequired => 'Enter your password.';

  @override
  String get passwordTooShort => 'Password must be at least 8 characters.';

  @override
  String get emailAlreadyRegistered =>
      'That email is already registered. Try signing in.';

  @override
  String get googleSignInFailed => 'Google sign-in failed. Please try again.';

  @override
  String get googleSignInUnavailable =>
      'Google sign-in is not available right now.';

  @override
  String get demoAccounts => 'Demo accounts';

  @override
  String get passenger => 'Passenger';

  @override
  String get driver => 'Driver';

  @override
  String get merchant => 'Merchant';

  @override
  String get admin => 'Admin';

  @override
  String get unsupportedRole => 'Unsupported role';

  @override
  String get logout => 'Logout';

  @override
  String get sessionExpired =>
      'Your session has expired. Please sign in again.';

  @override
  String get invalidCredentials => 'Invalid email or password.';

  @override
  String get networkUnavailable =>
      'Network unavailable. Check the API connection and retry.';

  @override
  String get requestTimedOut => 'The request timed out. Please retry.';

  @override
  String get validationError => 'Please check the entered details.';

  @override
  String get forbidden => 'This account is not allowed to use this action.';

  @override
  String get serverError => 'Server error. Please retry later.';

  @override
  String get requestFailed => 'Request failed. Please retry.';

  @override
  String get roleWorkspace => 'Role workspace';

  @override
  String get currentUser => 'Current user';

  @override
  String get role => 'Role';

  @override
  String get lockedCorridorLabel => 'Locked corridor';

  @override
  String get workspaceReadyMessage =>
      'This role workspace is ready for the next milestone.';

  @override
  String get comingNext => 'Coming next';

  @override
  String get businessFeaturesComingNext =>
      'Role business actions will be added in later milestones. No request, route, order, match, trip, or tracking flow is enabled yet.';

  @override
  String get unsupportedRoleTitle => 'Mobile role not supported';

  @override
  String get adminWebConsoleMessage =>
      'The admin console is available through the web application.';

  @override
  String get passengerDashboard => 'Passenger dashboard';

  @override
  String get activeRequest => 'Active request';

  @override
  String get noActiveRequest => 'No active request yet.';

  @override
  String get createRequest => 'Create request';

  @override
  String get pickup => 'Pickup';

  @override
  String get ppu => 'PPU Main Gate';

  @override
  String get babAlZawiya => 'Bab Al-Zawiya';

  @override
  String get destination => 'Destination';

  @override
  String get bethlehem => 'Bethlehem';

  @override
  String get preferredTime => 'Preferred time';

  @override
  String get passengerCount => 'Passenger count';

  @override
  String get submitRequest => 'Submit request';

  @override
  String get requestCreated => 'Request created';

  @override
  String get requestDetails => 'Request details';

  @override
  String get cancelRequest => 'Cancel request';

  @override
  String get requestCancelled => 'Request cancelled';

  @override
  String get requestCannotBeCancelled =>
      'This request cannot be cancelled now.';

  @override
  String get findCompatibleRoute => 'Find compatible route';

  @override
  String get retryMatching => 'Retry matching';

  @override
  String get noCompatibleDriverFound =>
      'No compatible driver found. You can retry later.';

  @override
  String get createdTime => 'Created time';

  @override
  String get currentStatus => 'Current status';

  @override
  String get noConnectedTrip => 'No connected trip yet.';

  @override
  String get matchResult => 'Match result';

  @override
  String get selectedDriver => 'Selected driver';

  @override
  String get selectedDriverUnavailable =>
      'The selected driver route is no longer available. Please search again.';

  @override
  String get selectedRoute => 'Selected route';

  @override
  String get matchScore => 'Match score';

  @override
  String get scoringBreakdown => 'Scoring breakdown';

  @override
  String get corridorOverlap => 'Corridor overlap';

  @override
  String get pickupDistance => 'Pickup distance';

  @override
  String get timingFit => 'Timing fit';

  @override
  String get trustScore => 'Trust score';

  @override
  String get capacityFit => 'Capacity fit';

  @override
  String get matchExplanation => 'Match explanation';

  @override
  String get routeMatchExplanation =>
      'Masari selected this driver because the route matches the active corridor, pickup is near the route, capacity is available, and trust score is high.';

  @override
  String get passengerTrip => 'Passenger trip';

  @override
  String get tripTimeline => 'Trip timeline';

  @override
  String get latestLocation => 'Latest location';

  @override
  String get waitingForDriver => 'Waiting for driver';

  @override
  String get noLocationYet => 'No location yet.';

  @override
  String get locationIsStale => 'Location is stale.';

  @override
  String get latitude => 'Latitude';

  @override
  String get longitude => 'Longitude';

  @override
  String get sequence => 'Sequence';

  @override
  String get source => 'Source';

  @override
  String get sourceSimulated => 'Simulated';

  @override
  String get recordedTime => 'Recorded time';

  @override
  String get refresh => 'Refresh';

  @override
  String get statusPending => 'Pending';

  @override
  String get statusMatched => 'Matched';

  @override
  String get statusAccepted => 'Accepted';

  @override
  String get statusPickupStarted => 'Pickup started';

  @override
  String get statusPickedUp => 'Picked up';

  @override
  String get statusInTransit => 'In transit';

  @override
  String get statusDelivered => 'Delivered';

  @override
  String get statusCompleted => 'Completed';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get driverDashboard => 'Driver dashboard';

  @override
  String get activeRoute => 'Active route';

  @override
  String get noActiveRoute => 'No active route yet.';

  @override
  String get createRoute => 'Create route';

  @override
  String get viewRoute => 'View route';

  @override
  String get routeDetails => 'Route details';

  @override
  String get origin => 'Origin';

  @override
  String get seatsAvailable => 'Seats available';

  @override
  String get parcelCapacity => 'Parcel capacity';

  @override
  String get activateRoute => 'Activate route';

  @override
  String get deactivateRoute => 'Deactivate route';

  @override
  String get routeActivated => 'Route activated';

  @override
  String get routeDeactivated => 'Route deactivated';

  @override
  String get routeStatus => 'Route status';

  @override
  String get activationTime => 'Activation time';

  @override
  String get routeAlreadyActive => 'An operational route already exists.';

  @override
  String get routeCannotDeactivate =>
      'This route cannot be deactivated in its current state.';

  @override
  String get matchInbox => 'Match inbox';

  @override
  String get noAvailableMatches => 'No available matches.';

  @override
  String get passengerRequest => 'Passenger request';

  @override
  String get merchantOrder => 'Merchant order';

  @override
  String get combinedAssignment => 'Combined assignment';

  @override
  String get requestType => 'Request type';

  @override
  String get parcelCount => 'Parcel count';

  @override
  String get parcelBatch => 'Parcel batch';

  @override
  String get estimatedDistanceSaved => 'Estimated distance saved';

  @override
  String get acceptMatch => 'Accept match';

  @override
  String get rejectMatch => 'Reject match';

  @override
  String get matchAccepted => 'Match accepted';

  @override
  String get matchRejected => 'Match rejected';

  @override
  String get matchCannotChange =>
      'This match was already changed. The latest state has been loaded.';

  @override
  String get allMatches => 'All matches';

  @override
  String get proposedMatches => 'Proposed matches';

  @override
  String get viewDetails => 'View details';

  @override
  String get activeTrip => 'Active trip';

  @override
  String get noActiveTrip => 'No active trip yet.';

  @override
  String get openActiveTrip => 'Open active trip';

  @override
  String get driverTrip => 'Driver trip';

  @override
  String get statusTimeline => 'Status timeline';

  @override
  String get startPickup => 'Start pickup';

  @override
  String get pickedUpAction => 'Picked up';

  @override
  String get startTrip => 'Start trip';

  @override
  String get deliver => 'Deliver';

  @override
  String get completeTrip => 'Complete trip';

  @override
  String get tripTransitionConflict =>
      'The trip state changed. The latest status has been loaded.';

  @override
  String get trackingSimulation => 'Tracking simulation';

  @override
  String get simulateNextPoint => 'Simulate next point';

  @override
  String get resetSimulation => 'Reset simulation';

  @override
  String get simulationReset => 'Simulation reset';

  @override
  String get routeProgress => 'Route progress';

  @override
  String get statusProposed => 'Proposed';

  @override
  String get statusSentToDriver => 'Sent to driver';

  @override
  String get statusRejected => 'Rejected';

  @override
  String get statusExpired => 'Expired';

  @override
  String get statusActive => 'Active';

  @override
  String get statusInactive => 'Inactive';

  @override
  String get statusAssigned => 'Assigned';

  @override
  String get statusOnTrip => 'On trip';

  @override
  String get statusCreated => 'Created';

  @override
  String get merchantDashboard => 'Merchant dashboard';

  @override
  String get orders => 'Orders';

  @override
  String get noOrders => 'No orders yet.';

  @override
  String get createOrder => 'Create order';

  @override
  String get latestOrder => 'Latest order';

  @override
  String get latestBatch => 'Latest parcel batch';

  @override
  String get orderDetails => 'Order details';

  @override
  String get fixedPickup => 'Fixed pickup';

  @override
  String get parcel => 'Parcel';

  @override
  String get parcelSize => 'Parcel size';

  @override
  String get priority => 'Priority';

  @override
  String get priorityLow => 'Low';

  @override
  String get priorityNormal => 'Normal';

  @override
  String get priorityHigh => 'High';

  @override
  String get addParcel => 'Add parcel';

  @override
  String get removeParcel => 'Remove parcel';

  @override
  String get parcelLimit => 'An order must contain 1 to 10 parcels.';

  @override
  String get submitOrder => 'Submit order';

  @override
  String get orderCreated => 'Order created';

  @override
  String get createBatch => 'Create parcel batch';

  @override
  String get batchCreated => 'Parcel batch created';

  @override
  String get batchExplanation => 'Batch explanation';

  @override
  String parcelBatchExplanationDemo(int parcelCount) {
    return '$parcelCount compatible parcels can use one Masari corridor trip instead of separate trips, reducing distance and cost.';
  }

  @override
  String get runMatching => 'Find a compatible driver route';

  @override
  String get matchingStarted => 'Match proposed to the driver';

  @override
  String get merchantMatchInbox => 'Merchant match inbox';

  @override
  String get waitingReadOnly =>
      'The driver decides whether to accept or reject. This screen is read-only.';

  @override
  String get openTrip => 'Open connected trip';

  @override
  String get merchantTrip => 'Merchant trip';

  @override
  String get orderStatus => 'Order status';

  @override
  String get parcelStatus => 'Parcel status';

  @override
  String get statusDraft => 'Draft';

  @override
  String get statusSubmitted => 'Submitted';

  @override
  String get statusBatched => 'Batched';

  @override
  String get orderAlreadyBatched => 'This order already has a parcel batch.';

  @override
  String get matchingUnavailable =>
      'Create a batch first or wait for the current match.';

  @override
  String get deliveryProgress => 'Delivery progress';

  @override
  String get securityAndSessions => 'Security and sessions';

  @override
  String get activeSessions => 'Active sessions';

  @override
  String get currentDevice => 'Current device';

  @override
  String get otherDevice => 'Other device';

  @override
  String get mobileSession => 'Mobile app';

  @override
  String get adminSession => 'Admin browser';

  @override
  String get created => 'Created';

  @override
  String get lastActive => 'Last active';

  @override
  String get expires => 'Expires';

  @override
  String get revokeSession => 'Revoke session';

  @override
  String get revokeThisDevice => 'Revoke this device';

  @override
  String get logoutAllDevices => 'Log out all devices';

  @override
  String get confirmLogout => 'Confirm logout';

  @override
  String get confirmLogoutMessage => 'Log out this device?';

  @override
  String get confirmLogoutAll => 'Confirm logout from all devices';

  @override
  String get confirmLogoutAllMessage =>
      'Every active session will be ended. You will need to sign in again on each device.';

  @override
  String get confirmRevokeSession => 'Revoke this session?';

  @override
  String get cancel => 'Cancel';

  @override
  String get sessionRevoked => 'Session revoked';

  @override
  String get sessionEnded => 'Your session has ended. Please sign in again.';

  @override
  String get accountUnavailable =>
      'This account is unavailable. Contact an administrator if you need help.';

  @override
  String get refreshingSession => 'Refreshing session...';

  @override
  String get unableToRefresh =>
      'Unable to refresh the session. Check the connection and retry.';

  @override
  String get localLogout => 'Log out on this device';

  @override
  String get noActiveSessions => 'No active sessions were returned.';

  @override
  String get sessionActionFailed =>
      'The session action could not be completed. Please retry.';

  @override
  String get createInvitedAccount => 'Create an invited account';

  @override
  String get selectAccountType => 'Select account type';

  @override
  String get passengerActiveAfterRegistration => 'Active after registration';

  @override
  String get pendingAfterRegistration => 'Pending until review';

  @override
  String get registerChooseTitle => 'How will you use Masari?';

  @override
  String get registerChooseSubtitle =>
      'Pick the option that fits you. We will take you through the right steps.';

  @override
  String get registerPassengerTitle => 'Normal user';

  @override
  String get registerPassengerHelp =>
      'Request trips and deliveries. Your account is ready right after sign-up.';

  @override
  String get registerDriverTitle => 'Driver';

  @override
  String get registerDriverHelp =>
      'Carry trips and deliveries. You upload your documents and an admin approves your account.';

  @override
  String get registerMerchantTitle => 'Shop owner';

  @override
  String get registerMerchantHelp =>
      'Send orders from your shop. You upload your documents and an admin approves your account.';

  @override
  String get invitationCode => 'Invitation code';

  @override
  String get phoneNumber => 'Phone number';

  @override
  String get sendVerificationCode => 'Send verification code';

  @override
  String get emailForCode => 'Email address (we send the code here)';

  @override
  String get codeSentToEmail =>
      'We emailed a six-digit code. Check your email, including the spam folder.';

  @override
  String get enterVerificationCode => 'Enter verification code';

  @override
  String get resendCode => 'Resend code';

  @override
  String get resendAvailableIn => 'Resend available in';

  @override
  String get verify => 'Verify';

  @override
  String get accountInformation => 'Account information';

  @override
  String get displayName => 'Display name';

  @override
  String get confirmPassword => 'Confirm password';

  @override
  String get terms => 'Terms';

  @override
  String get privacyNotice => 'Privacy Notice';

  @override
  String get confirmAdult => 'I confirm I am 18 or older';

  @override
  String get acceptAndContinue => 'Accept and continue';

  @override
  String get accountCreated => 'Account created';

  @override
  String get signInToContinue =>
      'Your account was created. Sign in to continue.';

  @override
  String get applicationUnderReview => 'Application under review';

  @override
  String get pendingReviewBody =>
      'Your account was created and is now pending. An admin will review it, which usually takes up to 24 hours. You can sign in once it is approved.';

  @override
  String get merchantDocumentsHint =>
      'To get approved, upload clear photos or PDFs of your commercial register (or shop licence), your national ID and a photo of your shop. Files are stored on our server and only the review team can open them.';

  @override
  String get documentKindCommercialRegister => 'Commercial register';

  @override
  String get documentKindShopPhoto => 'Shop photo';

  @override
  String get checkApplicationStatus => 'Check an existing application';

  @override
  String get registrationUnavailable =>
      'Registration is temporarily unavailable.';

  @override
  String get unableToStartRegistration =>
      'Unable to start registration. Check your invitation details and try again.';

  @override
  String get incorrectVerificationCode => 'Incorrect verification code.';

  @override
  String get codeExpired => 'Code expired.';

  @override
  String get tooManyAttempts => 'Too many attempts. Please retry later.';

  @override
  String get consentDocumentsChanged =>
      'Consent documents changed. Please review them again.';

  @override
  String get requestReference => 'Request reference';

  @override
  String get leaveRegistration => 'Leave registration';

  @override
  String get continueRegistration => 'Continue registration';

  @override
  String get leaveRegistrationWarning =>
      'Leaving will clear the registration state saved on this device. Continue?';

  @override
  String get secondsShort => 'seconds';

  @override
  String get consentVersion => 'Version';

  @override
  String get accountApproved => 'Account approved';

  @override
  String get signInAfterApproval =>
      'Your account was approved. Sign in to continue.';

  @override
  String get canonicalRoutes => 'Multi-route services';

  @override
  String get canonicalRoutesBody =>
      'Choose from current routes and approved stops.';

  @override
  String get featureUnavailable =>
      'This service is not available in this environment.';

  @override
  String get routeCatalogUnavailable =>
      'Routes are temporarily unavailable. Refresh before submitting.';

  @override
  String get noPublishedRoutes => 'No eligible published routes are available.';

  @override
  String get selectRoute => 'Select route';

  @override
  String get routeDirection => 'Direction';

  @override
  String get directionOutbound => 'Outbound';

  @override
  String get directionInbound => 'Inbound';

  @override
  String get directionLoop => 'Loop';

  @override
  String get orderedStops => 'Ordered stops';

  @override
  String stopSequence(int sequence) {
    return 'Stop $sequence';
  }

  @override
  String get driverAvailabilities => 'Route availability';

  @override
  String get newAvailability => 'Create route availability';

  @override
  String get noAvailabilities => 'No route availability has been created.';

  @override
  String get departureTime => 'Departure time';

  @override
  String get availabilityWindowEnd => 'Availability window end (optional)';

  @override
  String get seatCapacity => 'Seat capacity';

  @override
  String get reviewAndConfirm => 'Review and confirm';

  @override
  String get availabilityRecorded => 'Availability recorded';

  @override
  String remainingCapacity(int seats, int parcels) {
    return 'Remaining: $seats seats, $parcels parcels';
  }

  @override
  String get activateAvailability => 'Activate availability';

  @override
  String get pauseAvailability => 'Pause availability';

  @override
  String get resumeAvailability => 'Resume availability';

  @override
  String get cancelAvailability => 'Cancel availability';

  @override
  String get editAvailability => 'Edit availability';

  @override
  String get canonicalPassengerRequest => 'Route request';

  @override
  String get canonicalPassengerRequestBody =>
      'Request travel using an approved route and stops.';

  @override
  String get pickupStop => 'Pickup stop';

  @override
  String get dropoffStop => 'Drop-off stop';

  @override
  String get departureFrom => 'Departure from';

  @override
  String get departureUntil => 'Departure until';

  @override
  String get requestRecorded => 'Your route request was recorded.';

  @override
  String get matchingDisabledNotice =>
      'Matching is not enabled in this milestone. No driver has been assigned and no trip has been created.';

  @override
  String get canonicalMerchantOrder => 'Route parcel order';

  @override
  String get canonicalMerchantOrderBody =>
      'Create one atomic order on an approved route.';

  @override
  String get parcelPickupStop => 'Parcel pickup stop';

  @override
  String get parcelDestination => 'Parcel destination';

  @override
  String get parcelPriority => 'Parcel priority';

  @override
  String get orderRecorded => 'Your route parcel order was recorded.';

  @override
  String get batchingMatchingDisabledNotice =>
      'Batching and matching are not enabled in this milestone. No driver has been assigned and no delivery trip has been created.';

  @override
  String get submitAvailability => 'Submit availability';

  @override
  String get selectDateTime => 'Select date and time';

  @override
  String get invalidDepartureWindow =>
      'Choose a valid future departure window.';

  @override
  String get availabilityDepartureTooSoon =>
      'Departure is too soon. Choose a time at least 10 minutes from now.';

  @override
  String get availabilityDepartureTooFar =>
      'Departure is too far out. Choose a time within the next 30 days.';

  @override
  String get availabilityInvalidWindow =>
      'The availability window can end at most 2 hours after departure.';

  @override
  String get availabilityExceedsVehicleCapacity =>
      'The seats or parcels you selected exceed your registered vehicle\'s capacity.';

  @override
  String get availabilityDriverNotApproved =>
      'Your driver account isn\'t approved yet. Contact support to complete verification.';

  @override
  String get availabilityRouteNoLongerEligible =>
      'This route is no longer available. Choose a different route.';

  @override
  String get availabilityDuplicate =>
      'You already have a matching availability for this route and time.';

  @override
  String get invalidStopOrder => 'Choose an approved downstream stop.';

  @override
  String get operationTemporaryFailure =>
      'The result is uncertain. Retry the same operation when connected.';

  @override
  String get canonicalRecoveryRequired =>
      'A previous operation is unresolved. Sign in with the original account and retry the exact operation, or contact support if its recovery window expired.';

  @override
  String get transactionRetryRequired =>
      'A temporary transaction conflict occurred. Retry this operation.';

  @override
  String get refreshRoutes => 'Refresh routes';

  @override
  String get statusPaused => 'Paused';

  @override
  String get statusFilled => 'Filled';

  @override
  String get statusDeparted => 'Departed';

  @override
  String get returnToDashboard => 'Return to dashboard';

  @override
  String get canonicalDriverOffers => 'Route offers';

  @override
  String get canonicalDriverOffersBody =>
      'Review current passenger and parcel assignments for your route availability.';

  @override
  String get noCanonicalOffers => 'No route offers are available.';

  @override
  String get loadMore => 'Load more';

  @override
  String get offerDetails => 'Offer details';

  @override
  String get offerExpires => 'Offer expires';

  @override
  String get offerExpired => 'This offer has expired.';

  @override
  String get demandPassenger => 'Passenger request';

  @override
  String get demandMerchant => 'Parcel order';

  @override
  String get acceptOffer => 'Accept offer';

  @override
  String get rejectOffer => 'Reject offer';

  @override
  String get rejectReason => 'Reason for rejection';

  @override
  String get rejectDriverDeclined => 'I cannot take this assignment';

  @override
  String get rejectScheduleConflict => 'Schedule conflict';

  @override
  String get rejectCapacityUnavailable => 'Capacity unavailable';

  @override
  String get confirmAcceptOffer => 'Accept this route assignment?';

  @override
  String get confirmRejectOffer => 'Reject this route assignment?';

  @override
  String get offerAccepted => 'The assignment was accepted.';

  @override
  String get offerRejected => 'The assignment was rejected.';

  @override
  String get operationResultUncertain =>
      'The result is uncertain. Keep this operation and reconcile it before trying another.';

  @override
  String get recoverOperation => 'Reconcile operation';

  @override
  String get canonicalAssignmentStatus => 'Route assignment status';

  @override
  String get canonicalAssignments => 'Route requests and assignments';

  @override
  String get noCanonicalAssignments =>
      'No route assignments have been recorded.';

  @override
  String get statusOffered => 'Offered to a driver';

  @override
  String get statusUnavailable => 'No assignment available';

  @override
  String get canonicalTrip => 'Assigned trip';

  @override
  String get vehicleType => 'Vehicle type';

  @override
  String get trackingNotAvailable =>
      'Live tracking, maps, and arrival estimates are not available in this milestone.';

  @override
  String get manualRefreshNotice =>
      'Pull down or use Refresh to check for updates.';

  @override
  String get assignmentPendingBody => 'Your request is waiting for matching.';

  @override
  String get assignmentOfferedBody =>
      'An offer is awaiting a driver\'s decision.';

  @override
  String get assignmentAssignedBody =>
      'A driver accepted and a trip was created.';

  @override
  String get assignmentUnavailableBody =>
      'No active driver assignment is available.';

  @override
  String get assignmentCancelledBody => 'This request was cancelled.';

  @override
  String get leaveRejectionWarning =>
      'Your selected rejection reason has not been submitted. Leave this screen?';

  @override
  String get routeStops => 'Route stops';

  @override
  String get navNewRequest => 'New request';

  @override
  String get navHome => 'Home';

  @override
  String get navAccount => 'Account';

  @override
  String get navTrips => 'My trips';

  @override
  String greetingMorning(String name) {
    return 'Good morning, $name';
  }

  @override
  String greetingAfternoon(String name) {
    return 'Good afternoon, $name';
  }

  @override
  String greetingEvening(String name) {
    return 'Good evening, $name';
  }

  @override
  String get whereToGo => 'Where do you want to go?';

  @override
  String get smartSearch => 'Smart search';

  @override
  String get destinationSearchHint => 'e.g. from PPU to Bethlehem';

  @override
  String get quickDestinations => 'Quick destinations';

  @override
  String availableTripsTo(String destination) {
    return 'Available trips to $destination';
  }

  @override
  String get searchForTrip => 'Search for a trip';

  @override
  String get perPassenger => 'per passenger';

  @override
  String get departure => 'Departure';

  @override
  String get bookSeat => 'Book';

  @override
  String get noAvailableTrips => 'No available trips right now';

  @override
  String get noAvailableTripsBody =>
      'Create a request and Masari will match you with a driver on the corridor.';

  @override
  String seatsRemaining(int count) {
    return '$count seats available';
  }

  @override
  String completedTripsCount(int count) {
    return '$count trips';
  }

  @override
  String get notifications => 'Notifications';

  @override
  String get noNotifications => 'No notifications yet.';

  @override
  String get sampleDataNotice =>
      'Sample data for demonstration only, not from the server.';

  @override
  String get driverOnline => 'Online';

  @override
  String get driverOffline => 'Offline';

  @override
  String get trustPoints => 'Trust points';

  @override
  String get trustExcellent => 'Excellent';

  @override
  String get trustGood => 'Good';

  @override
  String get trustFair => 'Fair';

  @override
  String get trustWeak => 'Weak';

  @override
  String get trustScoreUnavailable => 'Not available yet';

  @override
  String get todayEarnings => 'Today\'s earnings';

  @override
  String get earningsUnavailable => 'Not available';

  @override
  String completedTripsToday(int count) {
    return '$count completed trips';
  }

  @override
  String get activateYourRoute => 'Activate your route';

  @override
  String get activateRouteHint =>
      'Set your destination to receive requests along your way';

  @override
  String get mapNoLocation => 'No location data yet.';

  @override
  String get batchSavings => 'Consolidation savings';

  @override
  String get batchSavingsCaption => 'Saved by consolidating shipments';

  @override
  String distanceSavedKm(String km) {
    return '$km km';
  }

  @override
  String get noSavingsYet => 'No savings yet';

  @override
  String get inDelivery => 'In delivery';

  @override
  String activeShipmentsCount(int count) {
    return '$count active shipments';
  }

  @override
  String get createShipment => 'Create a new shipment';

  @override
  String get smartBatchingTitle => 'Smart consolidation suggestions';

  @override
  String batchSuggestionTitle(int count, String destination) {
    return '$count parcels to $destination';
  }

  @override
  String get batchSuggestionBody =>
      'These can be consolidated into one batch on the corridor.';

  @override
  String get mergeAndSend => 'Consolidate and send';

  @override
  String get noBatchSuggestions => 'No orders are ready to consolidate.';

  @override
  String get liveTracking => 'Live tracking';

  @override
  String get recentOrders => 'Recent orders';

  @override
  String orderReference(String reference) {
    return 'Order #$reference';
  }

  @override
  String get navRequests => 'Requests';

  @override
  String get navMyTrip => 'My trip';

  @override
  String get navPerformance => 'Earnings';

  @override
  String get navNotifications => 'Alerts';

  @override
  String get navMapAlerts => 'Map';

  @override
  String get navShipments => 'Shipments';

  @override
  String get navReports => 'Reports';

  @override
  String get myTrips => 'My trips';

  @override
  String get tripsActiveSection => 'Active trip';

  @override
  String get tripsUpcomingSection => 'Upcoming trips';

  @override
  String get tripsPastSection => 'Past trips';

  @override
  String get tripsCancelledSection => 'Cancelled trips';

  @override
  String get noTripsYet => 'No trips yet';

  @override
  String get noTripsYetBody =>
      'Your trips will appear here once you create your first request.';

  @override
  String get tripHistoryFailed => 'Could not load your trip history.';

  @override
  String get mapsUnavailable => 'Map unavailable';

  @override
  String get mapsUnavailableBody =>
      'Map services are not enabled in this build, so no live position can be shown.';

  @override
  String get incidentReports => 'Reports';

  @override
  String get incidentReportingUnavailable => 'Incident reporting unavailable';

  @override
  String get incidentReportingUnavailableBody =>
      'There is no backend to receive incident reports yet, so nothing would be submitted from here.';

  @override
  String get notificationsUnavailableBody =>
      'There is no notification service in this build. Updates appear inside the trip screen.';

  @override
  String get performanceTitle => 'Earnings and performance';

  @override
  String get earningsNotTracked => 'Earnings are not tracked';

  @override
  String get earningsNotTrackedBody =>
      'The database holds no fare or pricing data, so no real earnings figure can be shown.';

  @override
  String get completedTripsTotal => 'Completed trips in total';

  @override
  String get acceptanceRateUnavailable => 'Acceptance rate unavailable';

  @override
  String destinationCount(int count) {
    return '$count destinations';
  }

  @override
  String get shipmentsTitle => 'Shipments';

  @override
  String get noShipments => 'No shipments';

  @override
  String get noShipmentsBody => 'Create a shipment and it will appear here.';

  @override
  String get shipmentsFailed => 'Could not load your shipments.';

  @override
  String get reportsUnavailable => 'Reports unavailable';

  @override
  String get reportsUnavailableBody =>
      'There is no backend for generating or exporting PDF or Excel reports.';

  @override
  String get accountProfile => 'Profile';

  @override
  String get accountSupport => 'Support';

  @override
  String get supportUnavailable => 'In-app support unavailable';

  @override
  String get supportUnavailableBody =>
      'No support channel is connected to the backend in this build.';

  @override
  String get accountSettings => 'Settings';

  @override
  String get featureNotBackedNotice =>
      'This section is not backed by the API yet.';

  @override
  String get offers => 'Offers';

  @override
  String get individualOffers => 'Individual offers';

  @override
  String get sharedOffers => 'Shared-trip offers';

  @override
  String get sharedOffersBody =>
      'Review grouped route offers. Status changes only when you refresh.';

  @override
  String get noSharedOffers => 'No shared-trip offers are available.';

  @override
  String get sharedTrip => 'Shared trip';

  @override
  String get sharedOfferDetails => 'Shared offer details';

  @override
  String get compositionPassengerOnly => 'Passenger-only';

  @override
  String get compositionMerchantOnly => 'Merchant-only';

  @override
  String get compositionMixed => 'Mixed trip';

  @override
  String get passengerRequests => 'Passenger requests';

  @override
  String get passengerSeats => 'Passenger seats';

  @override
  String get merchantOrders => 'Merchant orders';

  @override
  String get parcels => 'Parcels';

  @override
  String get entireGroup => 'Entire group';

  @override
  String get acceptEntireSharedTrip => 'Accept entire shared trip';

  @override
  String get rejectEntireSharedTrip => 'Reject entire shared trip';

  @override
  String get confirmAcceptSharedTrip =>
      'Accept all grouped requests and orders together as one shared trip?';

  @override
  String get confirmRejectSharedTrip =>
      'Reject this entire group and release all grouped requests and orders?';

  @override
  String get sharedGroupDecisionNotice =>
      'Accept or reject applies to the entire group.';

  @override
  String get sharedAcceptedNotice =>
      'One shared trip was assigned. The trip has not started.';

  @override
  String get sharedRejectedNotice => 'The complete shared offer was rejected.';

  @override
  String get sharedInvalidatedNotice =>
      'This shared offer is no longer valid. Refresh for current status.';

  @override
  String get sharedCapacityNotice =>
      'These totals are reserved for the complete route. Remaining capacity is not offered again for this departure, and segment-level reuse is not enabled.';

  @override
  String get stopEventTimeline => 'Shared stop events';

  @override
  String get passengerPickups => 'Passengers board';

  @override
  String get passengerDropoffs => 'Passengers exit';

  @override
  String get parcelPickups => 'Parcels picked up';

  @override
  String get parcelDestinations => 'Parcel destinations';

  @override
  String get sharedAssignmentIndicator => 'Assigned to a shared trip';

  @override
  String get sharedAssignmentPrivacyNotice =>
      'Only your own request or order is shown. Other trip members are private.';

  @override
  String get statusUnsupported => 'Status unavailable';

  @override
  String get unsupportedDataNotice =>
      'This status is not supported by this app version. Refresh or contact support.';

  @override
  String get vehicleSedan => 'Sedan';

  @override
  String get vehicleVan => 'Van';

  @override
  String get vehicleUnavailable => 'Vehicle type unavailable';

  @override
  String get actionDisabledExpired =>
      'Action unavailable because this offer has expired.';

  @override
  String get actionDisabledUncertain =>
      'Action unavailable until the previous operation is reconciled.';

  @override
  String get sharedFeatureUnavailable =>
      'Shared-trip offers are not available in this environment.';

  @override
  String get sharedAssignmentUnavailable =>
      'Shared-trip assignment details are not available in this environment.';

  @override
  String get notLiveNotice =>
      'This screen is not live. Use Refresh to check for updates.';

  @override
  String get assistantTitle => 'Masari assistant';

  @override
  String get assistantHomeTitle => 'Ask Masari';

  @override
  String get assistantHomeBody => 'Ask about your trips and available routes.';

  @override
  String get assistantWelcomeTitle => 'How can I help?';

  @override
  String get assistantWelcomeBody =>
      'Ask about your Masari trip data or available routes. If details are missing, I’ll ask you to clarify.';

  @override
  String get assistantTryAsking => 'Try asking';

  @override
  String get assistantExampleTripTime => 'When is my next trip?';

  @override
  String get assistantExampleAvailableTrip => 'Is there a trip to Bethlehem?';

  @override
  String get assistantInputHint => 'Type your question';

  @override
  String get assistantSend => 'Send';

  @override
  String get assistantProcessing => 'Checking Masari data…';

  @override
  String get assistantErrorTitle => 'Couldn’t complete the request';

  @override
  String get assistantErrorBody =>
      'The assistant couldn’t complete your request. Try again.';

  @override
  String get assistantUnavailable =>
      'The assistant service is not available in this build. No result was created.';

  @override
  String get assistantClarificationLabel =>
      'Masari assistant needs clarification';

  @override
  String get assistantResultLabel => 'Masari assistant reply';

  @override
  String get assistantPassengerMessage => 'Your message';

  @override
  String get assistantExampleFindTrip =>
      'Find me a ride from Bab Al-Zawiya to Bethlehem at 3 PM for one passenger';

  @override
  String get assistantReviewTitle => 'Review trip information';

  @override
  String get assistantReviewBody =>
      'Check and edit the information before starting the real search.';

  @override
  String get assistantConfirmSearch => 'Confirm and search';

  @override
  String get assistantSearching => 'Searching for a ride…';

  @override
  String get assistantSearchError =>
      'The request could not be created or no compatible route was found. No result was fabricated.';

  @override
  String get assistantFutureTimeRequired =>
      'Choose a future time before searching.';

  @override
  String get mapAttribution => '© OpenStreetMap contributors';

  @override
  String get mapLoading => 'Loading map...';

  @override
  String get mapLoadFailed => 'Map could not load';

  @override
  String get mapLoadFailedBody =>
      'Route data could not be fetched. Check your connection and retry.';

  @override
  String get mapYourLocation => 'Your location';

  @override
  String get mapRequestedRoute => 'Requested route';

  @override
  String get mapDriverRoute => 'Available driver route';

  @override
  String mapOriginLabel(String name) {
    return 'Origin: $name';
  }

  @override
  String mapDestinationLabel(String name) {
    return 'Destination: $name';
  }

  @override
  String mapStopLabel(String name) {
    return 'Stop: $name';
  }

  @override
  String get mapLegend => 'Legend';

  @override
  String get locationServiceDisabled =>
      'Location services are off on this device. Turn them on to show your position.';

  @override
  String get locationPermissionDenied =>
      'Location access was not granted. Allow access to show your position.';

  @override
  String get locationPermanentlyDenied =>
      'Location access is permanently denied. Enable it in system settings.';

  @override
  String get locationUnavailable =>
      'Your position could not be determined right now.';

  @override
  String get locationEnable => 'Enable location';

  @override
  String get checkpoints => 'Barriers';

  @override
  String get checkpointsUnavailable => 'Barrier data unavailable';

  @override
  String get checkpointsUnavailableBody =>
      'Barrier status could not be fetched. The route is shown without it.';

  @override
  String get checkpointsDisabled =>
      'Barrier data is not enabled in this build.';

  @override
  String get checkpointsStale =>
      'These are the last confirmed barrier states and may be out of date.';

  @override
  String get checkpointsEmpty => 'No barriers recorded on this route.';

  @override
  String checkpointCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count barriers',
      one: '1 barrier',
      zero: 'No barriers',
    );
    return '$_temp0';
  }

  @override
  String get checkpointOpen => 'Open';

  @override
  String get checkpointCongested => 'Congested';

  @override
  String get checkpointClosed => 'Closed';

  @override
  String get checkpointUnknown => 'Status unknown';

  @override
  String checkpointLabel(String name, String status) {
    return '$name — $status';
  }

  @override
  String get checkpointUnnamed => 'Barrier';

  @override
  String get mapRouteMissingCoordinates =>
      'This route has no coordinates, so it cannot be drawn on the map.';

  @override
  String get mapSelectRoute => 'Choose a route to show it on the map.';

  @override
  String get recoverMerchantOrder => 'Recover order';

  @override
  String get merchantOrderUncertain =>
      'The order may have been saved. Recover it before creating another order.';

  @override
  String get merchantOrderRecoveryExpired =>
      'The retry window has expired. Only a saved-order lookup is allowed. Contact support if recovery remains unresolved.';

  @override
  String get merchantOrderRecoveryUnavailable =>
      'Order recovery is unavailable. Sign in to the original merchant account or contact support. Do not submit a replacement order.';

  @override
  String get bookingTimePassed =>
      'This departure time has passed. Choose an upcoming time.';

  @override
  String get bookingOutcomeUnknown =>
      'The booking may already be saved. We will verify it when the connection returns. Do not create another booking.';

  @override
  String get verifyBooking => 'Verify booking';

  @override
  String get checkpointDirectoryTitle => 'Checkpoint directory';

  @override
  String get checkpointDirectoryDisabled =>
      'Checkpoint directory is not enabled.';

  @override
  String get checkpointDirectoryLoadFailed =>
      'Checkpoint directory could not be loaded.';

  @override
  String get checkpointDirectorySearch => 'Search checkpoints or cities';

  @override
  String get checkpointDirectoryNoResults => 'No matching checkpoints';

  @override
  String get checkpointDirectoryTrafficUnavailable =>
      'Traffic status unavailable';

  @override
  String get checkpointDirectoryLimitedNotice =>
      'Limited provider dataset: up to seven checkpoints per city. This is not the complete directory.';

  @override
  String get checkpointDirectoryGenerated => 'Provider response generated';

  @override
  String get checkpointDirectoryEnteringUpdated =>
      'Entering status last changed (status unavailable)';

  @override
  String get checkpointDirectoryLeavingUpdated =>
      'Leaving status last changed (status unavailable)';

  @override
  String get checkpointDirectoryTimezoneUnspecified => 'timezone unspecified';

  @override
  String get notifMatchOfferedTitle => 'New match offer';

  @override
  String get notifMatchOfferedBody =>
      'A new request is waiting for your response.';

  @override
  String get notifMatchAcceptedTitle => 'Your request was accepted';

  @override
  String get notifMatchAcceptedBody => 'A driver accepted your request.';

  @override
  String get notifMatchRejectedTitle => 'Driver declined';

  @override
  String get notifMatchRejectedBody =>
      'The driver declined the request. You can look for another match.';

  @override
  String get notifTripStatusTitle => 'Trip update';

  @override
  String notifTripStatusBody(String status) {
    return 'The trip is now: $status';
  }

  @override
  String get notifVerificationApprovedTitle => 'Account approved';

  @override
  String get notifVerificationApprovedBody =>
      'Your driver account was approved. You can start working now.';

  @override
  String get notifVerificationRejectedTitle => 'Verification rejected';

  @override
  String get notifVerificationRejectedBody =>
      'Your account verification was not approved.';

  @override
  String notifVerificationRejectedReason(String reason) {
    return 'Reason: $reason';
  }

  @override
  String get notifUnknownTitle => 'New notification';

  @override
  String get notificationsMarkAllRead => 'Mark all as read';

  @override
  String get notificationsLoadError => 'Could not load notifications.';

  @override
  String notificationsUnreadCount(int count) {
    return '$count unread';
  }

  @override
  String get reportsDeliveries => 'Deliveries';

  @override
  String get reportsLoadError => 'Could not load the report.';

  @override
  String get reportsOrdersByStatus => 'Orders by status';

  @override
  String get reportsDeliveriesByStatus => 'Deliveries by status';

  @override
  String get reportsNoRecords => 'No records yet.';

  @override
  String get incidentReportAction => 'Report a problem';

  @override
  String get incidentReportTitle => 'Report a problem';

  @override
  String get incidentReportNotice =>
      'Your report is recorded for Admin review. This is not an emergency service; if you are in danger, contact the authorities directly.';

  @override
  String get incidentDescriptionLabel => 'Describe the problem';

  @override
  String get incidentSubmit => 'Send report';

  @override
  String get incidentSubmitted => 'Report sent.';

  @override
  String get incidentSubmitFailed => 'The report could not be sent. Try again.';

  @override
  String get incidentTooMany =>
      'You already have several reports under review. Wait for them to be handled before sending another.';

  @override
  String get incidentCategorySafety => 'Safety';

  @override
  String get incidentCategoryDelay => 'Delay';

  @override
  String get incidentCategoryParcelDamage => 'Damaged parcel';

  @override
  String get incidentCategoryBehavior => 'Behavior';

  @override
  String get incidentCategoryOther => 'Other';

  @override
  String get notifIncidentUpdatedTitle => 'Update on your report';

  @override
  String get notifIncidentReviewingBody => 'Your report is under review.';

  @override
  String get notifIncidentResolvedBody => 'Your report has been resolved.';

  @override
  String get verificationDocuments => 'Verification documents';

  @override
  String get verificationDocumentsHint =>
      'To get approved, upload clear photos or PDFs of your driving licence, your vehicle registration and your national ID. Files are stored on our server and only the review team can open them.';

  @override
  String get documentKind => 'Document type';

  @override
  String get documentKindDriverLicence => 'Driving licence';

  @override
  String get documentKindVehicleRegistration => 'Vehicle registration';

  @override
  String get documentKindNationalId => 'National ID';

  @override
  String get documentKindInsurance => 'Insurance';

  @override
  String get documentKindOther => 'Other document';

  @override
  String get addDocument => 'Add a document';

  @override
  String get removeDocument => 'Remove document';

  @override
  String get documentTooLarge => 'That file is too large. The limit is 5 MB.';

  @override
  String get documentTypeUnsupported =>
      'Only JPEG, PNG or PDF files can be uploaded.';

  @override
  String get documentLimitReached =>
      'You have reached the maximum number of documents.';

  @override
  String get acceptanceRateTitle => 'Acceptance rate';

  @override
  String acceptanceRateValue(int percent) {
    return '$percent%';
  }

  @override
  String acceptanceRateDetail(int accepted, int responded) {
    return '$accepted of $responded offers you answered were accepted. Offers that expired unanswered are not counted.';
  }

  @override
  String acceptanceRateNeedMore(int needed, int responded) {
    return 'Your rate appears after $needed answered offers ($responded so far).';
  }

  @override
  String get emailOrPhone => 'Email or phone number';

  @override
  String get emailOrPhoneRequired => 'Enter your email or phone number.';

  @override
  String get emailOrPhoneInvalid =>
      'Enter a valid email, or a phone number starting with + and the country code.';

  @override
  String get mapLegendStart => 'Start';

  @override
  String get mapLegendDestination => 'Destination';

  @override
  String get sendParcelTitle => 'Send a parcel';

  @override
  String get sendParcelEntryBody =>
      'Send a small parcel with a driver already travelling an approved route.';

  @override
  String get sendParcelIntro =>
      'Choose a route and stops, then tell us who receives the parcel. A driver travelling that way carries it.';

  @override
  String get sendParcelPickupHint =>
      'Hand the parcel to the driver at this stop.';

  @override
  String get parcelSizeSmallHint => 'S - small, fits in a bag';

  @override
  String get parcelSizeMediumHint => 'M - medium, about a shoebox';

  @override
  String get parcelSizeLargeNotAllowed =>
      'Large parcels are for shops and cannot be sent from a personal account.';

  @override
  String get receiverNameLabel => 'Receiver\'s name';

  @override
  String get receiverPhoneLabel => 'Receiver\'s phone';

  @override
  String get receiverPrivacyNote =>
      'The receiver does not need the app. Their name and phone are used only for this delivery, are never shown to other users, and are erased afterwards.';

  @override
  String get parcelNoteLabel => 'Note for the driver (optional)';

  @override
  String get forbiddenItemsAck =>
      'I confirm the parcel contains no cash, valuables, medicine, weapons, flammable, illegal or perishable items.';

  @override
  String get sendParcelSubmit => 'Send parcel';

  @override
  String get sendParcelRecorded => 'Your parcel request was recorded.';

  @override
  String get sendParcelRecordedBody =>
      'We are looking for a driver on this route. You can cancel until a driver is offered the parcel.';

  @override
  String get myParcelsTitle => 'My parcels';

  @override
  String get myParcelsEmpty => 'You have not sent any parcels yet.';

  @override
  String get parcelTrackSearching => 'Finding a driver';

  @override
  String get parcelTrackAssigned => 'Driver assigned';

  @override
  String get parcelTrackPickedUp => 'Picked up from you';

  @override
  String get parcelTrackInTransit => 'On the way';

  @override
  String get parcelTrackDelivered => 'Delivered';

  @override
  String get parcelTrackCancelled => 'Cancelled';

  @override
  String get parcelTrackFailed => 'Delivery failed';

  @override
  String get parcelTrackExpired => 'Expired';

  @override
  String get parcelCancelAction => 'Cancel parcel';

  @override
  String get parcelCancelConfirm =>
      'Cancel this parcel? The receiver\'s details will be erased.';

  @override
  String get parcelCancelledNotice => 'Parcel cancelled.';

  @override
  String get parcelCannotCancel =>
      'A driver has already been offered this parcel, so it can no longer be cancelled.';

  @override
  String parcelReceiverLine(String name, String phone) {
    return 'Receiver: $name ($phone)';
  }

  @override
  String get parcelReceiverRemoved => 'Receiver details have been erased.';

  @override
  String get parcelLimitReached =>
      'You already have the maximum number of parcels on the way. Wait for one to finish or cancel one.';

  @override
  String get parcelDailyLimit =>
      'Daily parcel limit reached. Try again tomorrow.';

  @override
  String get invalidReceiverPhone =>
      'Enter a valid phone number for the receiver.';

  @override
  String get receiverNameInvalid => 'Enter the receiver\'s name.';

  @override
  String get parcelAckRequired =>
      'Confirm the statement about forbidden items to continue.';

  @override
  String get keepParcel => 'Keep parcel';

  @override
  String get mapOfflineSaved => 'Offline - showing saved map';

  @override
  String get clearMapCache => 'Clear saved map';

  @override
  String get clearMapCacheHint =>
      'Deletes map tiles saved on this device. They are saved again as you browse.';

  @override
  String get mapCacheCleared => 'Saved map cleared';

  @override
  String get mapCacheClearFailed => 'Could not clear the saved map';

  @override
  String get notifDocsExpiringTitle => 'Document expiring soon';

  @override
  String notifDocsExpiringBody(String document, String date) {
    return 'Your $document expires on $date. Send renewed documents before then to keep working without interruption.';
  }

  @override
  String get notifDocsExpiredTitle => 'Your documents have expired';

  @override
  String get notifDocsExpiredBody =>
      'Your account is restricted: you cannot go online or accept new trips until you send renewed documents and they are approved. Trips you already accepted are not affected.';

  @override
  String get notifDocsRenewalSubmittedTitle => 'Renewal documents sent';

  @override
  String get notifDocsRenewalSubmittedBody =>
      'Our team will review them and you will be notified of the decision.';

  @override
  String get documentKindContract => 'Contract';

  @override
  String get availabilityDocumentsExpired =>
      'Your documents have expired. Send renewed documents to restore access.';

  @override
  String get applicationDocumentsRequiredTitle => 'Upload your documents';

  @override
  String get applicationDocumentsRequiredBody =>
      'Your account is created but is not under review yet. Upload every required document, then send your application. Review usually takes up to 24 hours.';

  @override
  String documentsStillNeeded(String documents) {
    return 'Still needed: $documents';
  }

  @override
  String get submitApplication => 'Send for review';

  @override
  String get documentsRequiredError =>
      'Upload all the required documents before sending your application.';

  @override
  String get invitationCodeOptional => 'Invitation code (optional)';

  @override
  String get fareEstimatedTitle => 'Estimated fare';

  @override
  String get fareBookedTitle => 'Estimated fare when requested';

  @override
  String get fareDisclaimer =>
      'Estimated and paid directly to the driver. No payments are processed in the app.';

  @override
  String get fareNotSet => 'No estimated fare has been set for this route yet.';

  @override
  String get farePerSeat => 'Per seat';

  @override
  String fareSeatsLine(int count) {
    return 'Seats × $count';
  }

  @override
  String fareParcelLine(String size) {
    return 'Parcel $size';
  }

  @override
  String get fareTotal => 'Total';

  @override
  String get notifDriverApproachingTitle => 'Your driver is approaching';

  @override
  String get notifDriverApproachingBody =>
      'Your driver is near your pickup point. Please get ready.';

  @override
  String get ratingPromptTitle => 'How was your trip?';

  @override
  String get ratingPromptBody =>
      'Rate your driver from 1 to 5 stars. Your rating is private: the driver never sees it or who gave it.';

  @override
  String ratingStarLabel(int count) {
    return '$count stars';
  }

  @override
  String get ratingSubmit => 'Send rating';

  @override
  String get ratingThanks => 'Thanks for rating your trip.';

  @override
  String get ratingFailed => 'The rating could not be sent. Try again.';

  @override
  String get ratingAlreadyRated => 'You already rated this trip.';

  @override
  String get renewalTitle => 'Renew your documents';

  @override
  String get renewalOpen => 'Renew documents';

  @override
  String get renewalBannerTitle => 'Your documents have expired';

  @override
  String get renewalBannerBody =>
      'You cannot go online or accept new trips until you send renewed documents and they are approved.';

  @override
  String get renewalBannerSubmittedTitle => 'Renewal under review';

  @override
  String get renewalBannerSubmittedBody =>
      'Your renewed documents are waiting for review.';

  @override
  String get renewalIntro =>
      'Upload clear photos or PDFs of your renewed driving licence, vehicle registration and insurance, then send them for review. Trips you already accepted are not affected.';

  @override
  String get renewalUploaded => 'Uploaded documents';

  @override
  String get renewalNoDocuments => 'No renewed documents uploaded yet.';

  @override
  String get renewalSubmit => 'Send for review';

  @override
  String get renewalSubmittedTitle => 'Waiting for review';

  @override
  String get renewalSubmittedBody =>
      'We received your renewed documents. You will be notified once the review team approves them.';

  @override
  String get renewalDocumentsRequired =>
      'Upload at least one renewed document before sending.';

  @override
  String get renewalStateConflict =>
      'Your renewal status changed. Pull to refresh and try again.';

  @override
  String get renewalLoadError => 'Could not load your renewal status.';

  @override
  String get renewalNothingToRenew =>
      'Your documents are up to date. Nothing to renew.';
}
