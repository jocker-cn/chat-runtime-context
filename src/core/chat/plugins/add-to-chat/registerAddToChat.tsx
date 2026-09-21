import { createRoot, type Root } from "react-dom/client";
import { AddToChatStore } from "./AddToChatStore";
import { AddToChatView } from "./AddToChatView";
import {
  createAddToChatController,
  type AddToChatController,
} from "./createAddToChatController";
import { observeDomSelection } from "./createDomSelectionAdapter";
import type {
  AddToChatElementTarget,
  AddToChatRegistration,
  RegisterAddToChatOptions,
} from "./contracts";

const registrations = new Map<string, RegistrationEntry>();

export function registerAddToChat(
  options: RegisterAddToChatOptions,
): AddToChatRegistration {
  const id = options.id.trim();
  if (!id) throw new Error("Add to Chat registration requires a non-empty id.");

  const existing = registrations.get(id);
  if (existing) {
    existing.update({ ...options, id });
    return existing.handle;
  }

  const entry = new RegistrationEntry({ ...options, id });
  registrations.set(id, entry);
  entry.start();
  return entry.handle;
}

export function unregisterAddToChat(id: string): void {
  const entry = registrations.get(id.trim());
  if (!entry) return;
  registrations.delete(entry.id);
  entry.dispose();
}

class RegistrationEntry {
  public readonly id: string;
  public readonly handle: AddToChatRegistration;
  private options: RegisterAddToChatOptions;
  private readonly store = new AddToChatStore();
  private readonly controller: AddToChatController;
  private observer?: MutationObserver;
  private binding?: ActiveBinding;

  constructor(options: RegisterAddToChatOptions) {
    this.id = options.id;
    this.options = options;
    this.controller = createAddToChatController(
      this.store,
      () => this.options.createReferenceId?.() ?? crypto.randomUUID(),
    );
    this.handle = Object.freeze({
      id: this.id,
      getReferences: () => this.controller.getReferences(),
      clearReferences: () => this.controller.clearReferences(),
      subscribeReferences: (listener: () => void) => {
        let references = this.store.getSnapshot().references;
        return this.store.subscribe(() => {
          const nextReferences = this.store.getSnapshot().references;
          if (nextReferences === references) return;
          references = nextReferences;
          listener();
        });
      },
    });
  }

  public start(): void {
    if (typeof document === "undefined") return;
    this.reconcile();
    this.observer = new MutationObserver(() => this.reconcile());
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  public update(options: RegisterAddToChatOptions): void {
    this.options = options;
    this.reconcile(true);
  }

  public dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.unbind();
    this.store.reset();
  }

  private reconcile(force = false): void {
    if (typeof document === "undefined") return;
    const selectionRoot = resolveElement(this.options.selectionRoot);
    const referenceHost = resolveElement(this.options.referenceHost);
    const overlayHost = this.options.overlayHost
      ? resolveElement(this.options.overlayHost)
      : document.body;

    if (
      !force &&
      this.binding?.selectionRoot === selectionRoot &&
      this.binding?.referenceHost === referenceHost &&
      this.binding?.overlayHost === overlayHost
    ) {
      return;
    }

    this.unbind();
    if (!selectionRoot || !referenceHost || !overlayHost || !document.body) {
      return;
    }

    const mountNode = document.createElement("div");
    mountNode.dataset.addToChatMount = this.id;
    document.body.append(mountNode);
    const root = createRoot(mountNode);
    const stopSelection = observeDomSelection({
      root: selectionRoot,
      controller: this.controller,
      resolveSource: this.options.resolveSource,
    });
    root.render(
      <AddToChatView
        controller={this.controller}
        overlayHost={overlayHost}
        referenceHost={referenceHost}
      />,
    );
    this.binding = {
      selectionRoot,
      referenceHost,
      overlayHost,
      mountNode,
      root,
      stopSelection,
    };
  }

  private unbind(): void {
    const binding = this.binding;
    if (!binding) return;
    this.binding = undefined;
    binding.stopSelection();
    binding.root.unmount();
    binding.mountNode.remove();
  }
}

interface ActiveBinding {
  readonly selectionRoot: HTMLElement;
  readonly referenceHost: HTMLElement;
  readonly overlayHost: HTMLElement;
  readonly mountNode: HTMLElement;
  readonly root: Root;
  readonly stopSelection: () => void;
}

function resolveElement(target: AddToChatElementTarget): HTMLElement | null {
  if (typeof target === "function") return target();
  return document.querySelector<HTMLElement>(target);
}
