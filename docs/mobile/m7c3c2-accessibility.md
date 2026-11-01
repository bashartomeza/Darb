# M7C3C2 accessibility and responsive behavior

The shared-offer flow uses scrollable Material layouts, directional alignment, wrapped text, and standard controls with Material minimum target sizing. Arabic remains the default RTL locale and uses the correct `درب` brand; English is LTR.

Semantics provide one concise shared-offer card announcement rather than repeating every visual child. The summary includes route, composition, status, and aggregate counts but no IDs or private data. Stop events are announced as one stop name followed by its non-zero aggregate event counts. Status is textual rather than color-only.

Disabled accept/reject controls announce whether expiry or unresolved recovery caused the disabled state. Rejection choices are localized and the selected unsent reason triggers a back-navigation warning. The uncertain-operation recovery notice is a live region.

Automated widget coverage exercises Arabic RTL at 200% text, safe aggregate cards, stop-event wording, unavailable state, and dirty back navigation. The API 36 emulator remained scrollable in portrait and landscape at 200% text with no Flutter overflow log, and UIAutomator exposed the intended aggregate semantics without internal IDs. A full hands-on TalkBack pass, representative smaller-display run, maximum-length timeline, and every rotation-in-flight boundary remain independent-review obligations and are not reported as passed.
