import { Icon } from "./Icon";

/**
 * "From → To" pill. The arrow is a single glyph that mirrors with the document
 * direction, so RTL reads right-to-left without a second icon.
 */
export function RouteChip({ from, to }: { from: string; to: string }) {
  return (
    <span className="route-pair">
      <span>{from}</span>
      <Icon name="arrow" size={14} className="route-pair__arrow" />
      <span>{to}</span>
    </span>
  );
}

/** Small monospace-ish pill for IDs and keys; always rendered LTR. */
export function TechnicalValue({ children }: { children: string | undefined }) {
  return <span className="technical" dir="ltr">{children ?? "-"}</span>;
}
