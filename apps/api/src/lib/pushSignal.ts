/**
 * The link between "an inbox notification was written" and the push sender.
 *
 * notify() only rings this bell; it never sends anything itself, so a push can
 * neither slow down nor fail the request that created the notification, and a
 * notification written inside a transaction that later rolls back is never
 * pushed (the sender reads committed rows only). With push disabled no handler
 * is installed and the call does nothing.
 */
let handler: (() => void) | undefined;

export function setPushDispatchHandler(next: (() => void) | undefined) {
  handler = next;
}

export function signalPushDispatch() {
  try {
    handler?.();
  } catch {
    // Best effort by contract.
  }
}
