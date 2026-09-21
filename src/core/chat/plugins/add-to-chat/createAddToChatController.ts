import { AddToChatStore } from "./AddToChatStore";
import type { AddToChatSelection } from "./contracts";

export interface AddToChatController {
  readonly store: AddToChatStore;
  setSelection(selection?: AddToChatSelection): void;
  addSelection(): void;
  removeReference(id: string): void;
  clearReferences(): void;
  getReferences(): ReturnType<AddToChatStore["getSnapshot"]>["references"];
}

export function createAddToChatController(
  store = new AddToChatStore(),
  createReferenceId: () => string = () => crypto.randomUUID(),
): AddToChatController {
  return {
    store,
    setSelection: (selection) => store.setSelection(selection),
    addSelection: () => {
      store.addSelection(createReferenceId);
    },
    removeReference: (id) => store.removeReference(id),
    clearReferences: () => store.clearReferences(),
    getReferences: () => Object.freeze([...store.getSnapshot().references]),
  };
}
