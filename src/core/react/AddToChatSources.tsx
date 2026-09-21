import { useCallback, useMemo, useState } from "react";
import "./AddToChatSources.css";

export interface AddToChatSource {
  id: string;
  text: string;
}

export interface AddToChatSourceListProps {
  sources: readonly AddToChatSource[];
  onRemove(id: string): void;
}

export interface AddToChatSourcesController {
  sources: readonly AddToChatSource[];
  addSource(text: string): void;
  removeSource(id: string): void;
  clearSources(): void;
}

export function useAddToChatSources(): AddToChatSourcesController {
  const [sources, setSources] = useState<AddToChatSource[]>([]);

  const addSource = useCallback((text: string) => {
    setSources((current) => [
      ...current,
      { id: crypto.randomUUID(), text },
    ]);
  }, []);

  const removeSource = useCallback((id: string) => {
    setSources((current) => current.filter((source) => source.id !== id));
  }, []);

  const clearSources = useCallback(() => setSources([]), []);

  return useMemo(
    () => ({ sources, addSource, removeSource, clearSources }),
    [addSource, clearSources, removeSource, sources],
  );
}

export function AddToChatSourceList({
  sources,
  onRemove,
}: AddToChatSourceListProps) {
  return sources.map((source, index) => (
    <div className="add-to-chat-source" key={source.id}>
      <strong>Add to chat {index + 1}</strong>
      <span title={source.text}>{source.text}</span>
      <button
        type="button"
        aria-label={`Remove Add to chat source ${index + 1}`}
        title="Remove source"
        onClick={() => onRemove(source.id)}
      >
        ×
      </button>
    </div>
  ));
}
