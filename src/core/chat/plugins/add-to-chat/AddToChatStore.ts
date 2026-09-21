import { ListenerSet } from "../../../internal/ListenerSet";
import type {
  AddToChatSelection,
  AddToChatSnapshot,
  ContextReference,
} from "./contracts";

const EMPTY_REFERENCES: readonly ContextReference[] = Object.freeze([]);

export class AddToChatStore {
  private readonly listeners = new ListenerSet();
  private snapshot: AddToChatSnapshot = {
    references: EMPTY_REFERENCES,
  };

  public readonly subscribe = (listener: () => void): (() => void) =>
    this.listeners.add(listener);

  public readonly getSnapshot = (): AddToChatSnapshot => this.snapshot;

  public setSelection(selection?: AddToChatSelection): void {
    if (areSelectionsEqual(this.snapshot.selection, selection)) return;

    this.publish({ ...this.snapshot, selection });
  }

  public addSelection(createId: () => string): ContextReference | undefined {
    const selection = this.snapshot.selection;
    if (!selection) return undefined;

    const reference: ContextReference = Object.freeze({
      id: createId(),
      type: "text-selection",
      text: selection.text,
      source: Object.freeze({ ...selection.source }),
    });
    this.publish({
      selection: undefined,
      references: Object.freeze([...this.snapshot.references, reference]),
    });
    return reference;
  }

  public removeReference(id: string): void {
    const references = this.snapshot.references.filter(
      (reference) => reference.id !== id,
    );
    if (references.length === this.snapshot.references.length) return;

    this.publish({
      ...this.snapshot,
      references: Object.freeze(references),
    });
  }

  public clearReferences(): void {
    if (this.snapshot.references.length === 0) return;
    this.publish({ ...this.snapshot, references: EMPTY_REFERENCES });
  }

  public reset(): void {
    if (!this.snapshot.selection && this.snapshot.references.length === 0) {
      return;
    }
    this.publish({ references: EMPTY_REFERENCES });
  }

  private publish(snapshot: AddToChatSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.emit();
  }
}

function areSelectionsEqual(
  previous: AddToChatSelection | undefined,
  next: AddToChatSelection | undefined,
) {
  return (
    previous === next ||
    (previous?.text === next?.text &&
      previous?.anchor.x === next?.anchor.x &&
      previous?.anchor.y === next?.anchor.y &&
      areSourcesEqual(previous?.source, next?.source))
  );
}

function areSourcesEqual(
  previous: AddToChatSelection["source"] | undefined,
  next: AddToChatSelection["source"] | undefined,
) {
  if (previous === next) return true;
  if (!previous || !next) return false;

  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].every(
    (key) =>
      previous[key as keyof typeof previous] ===
      next[key as keyof typeof next],
  );
}
