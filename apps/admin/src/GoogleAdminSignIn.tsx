import { useEffect, useRef, useState } from "react";
import { useLocale } from "./i18n/LocaleContext";

type GoogleIdentitySdk = {
  initialize: (options: { client_id: string; auto_select: boolean; callback: (response: { credential?: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: { type: string; theme: string; size: string; text: string; locale: string }) => void;
  cancel: () => void;
};
function sdk() { return (window as Window & { google?: { accounts?: { id?: GoogleIdentitySdk } } }).google?.accounts?.id; }

/** The official GIS button owns the provider popup; credentials live only in its callback. */
export function GoogleAdminSignIn({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => Promise<boolean> }) {
  const { locale, t } = useLocale();
  const [state, setState] = useState<"loading" | "ready" | "submitting" | "cancelled" | "unavailable" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const accept = useRef(onCredential); accept.current = onCredential;
  const cancelled = useRef(false);
  useEffect(() => {
    let active = true; cancelled.current = false; setState("loading");
    let script: HTMLScriptElement | undefined;
    const unavailable = () => { if (active && !cancelled.current) setState("unavailable"); };
    const timeout = window.setTimeout(unavailable, 15000);
    const render = () => {
      if (!active || cancelled.current || !container.current) return;
      const provider = sdk(); if (!provider) { unavailable(); return; }
      window.clearTimeout(timeout);
      try {
        provider.initialize({ client_id: clientId, auto_select: false, callback: (response) => {
          if (!active || cancelled.current) return;
          if (!response.credential) { setState("failed"); return; }
          // Stop duplicate callbacks while the single server exchange is in flight.
          cancelled.current = true; setState("submitting");
          accept.current(response.credential)
            .then((accepted) => { if (active && !accepted) setState("cancelled"); })
            .catch(() => { if (active) setState("failed"); });
        } });
        container.current.replaceChildren();
        provider.renderButton(container.current, { type: "standard", theme: "outline", size: "large", text: "signin_with", locale });
        setState("ready");
      } catch { unavailable(); }
    };
    if (sdk()) render();
    else {
      script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true;
      script.onload = render; script.onerror = unavailable; document.head.append(script);
    }
    return () => { active = false; window.clearTimeout(timeout); script?.remove(); sdk()?.cancel(); };
  }, [clientId, locale, attempt]);
  return <section aria-label="Google" aria-busy={state === "loading" || state === "submitting"}>
    <div data-google-sign-in ref={container} hidden={state !== "ready"} />
    <p role="status" aria-live="polite">{state === "loading" ? t("googleLoading") : state === "submitting" ? t("signingIn") : state === "cancelled" ? t("googleCancelled") : state === "unavailable" ? t("googleUnavailable") : state === "failed" ? t("googleFailed") : ""}</p>
    {(state === "loading" || state === "ready") && <button type="button" className="btn" onClick={() => { cancelled.current = true; sdk()?.cancel(); setState("cancelled"); }}>{t("cancel")}</button>}
    {["cancelled", "unavailable", "failed"].includes(state) && <button type="button" className="btn" onClick={() => setAttempt((value) => value + 1)}>{t("retry")}</button>}
  </section>;
}
