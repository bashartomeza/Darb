import type { Observed } from "./contracts";

export type ObservationState<T> = {
  last: Observed<T> | null;
  loading: boolean;
  error: string | null;
};

export function createObservationGate() {
  let generation = 0;

  return {
    begin(): number {
      generation += 1;
      return generation;
    },
    isCurrent(candidate: number): boolean {
      return candidate === generation;
    },
    invalidate(): void {
      generation += 1;
    }
  };
}
