# Mobile onboarding accessibility

M6C2C keeps onboarding forms keyboard-safe, localized, and screen-reader friendly.

Accessibility requirements covered by the implementation:

- Arabic remains default RTL and English remains LTR.
- Phone, invitation, OTP, and request-reference fields are visually LTR where appropriate.
- Every primary field and action has a visible label.
- OTP is entered through a normal accessible field with numeric keyboard and paste support.
- Buttons are disabled while actions are in flight.
- Error messages are text-based, not color-only.
- Consent text is displayed as inert text; no arbitrary HTML is executed.
- Layouts use scroll views and existing Darb spacing tokens to tolerate larger text.
- Resend countdown is derived from server timestamps and displayed without aggressive announcements.

Manual emulator validation should still include large text, Arabic RTL, English LTR, back navigation, and pending-review restoration before a production onboarding launch.
