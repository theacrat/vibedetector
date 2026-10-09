import { Archive, ArrowDown, ArrowUp, Pencil, Save, ArchiveRestore } from "lucide-react";
import { useCallback, useState } from "react";
import type { ChangeEvent, MouseEvent, SubmitEvent } from "react";

import type { ModelOption } from "@/domain";

import type { AdminState } from "./admin-data";
import { useCatalogueOrder } from "./catalogue-order";

function useModelEdit(model: ModelOption, state: AdminState) {
  const [draft, setDraft] = useState<string>();
  const handleEdit = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setDraft(model.name);
    },
    [model.name],
  );
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.currentTarget.value);
  }, []);
  const save = useCallback(async () => {
    if (draft === undefined || !draft.trim()) {
      return;
    }
    const saved = await state.run("/api/admin/models/update", { id: model.id, name: draft.trim() });
    if (saved) {
      setDraft(undefined);
    }
  }, [draft, model.id, state]);
  const handleSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      void save();
    },
    [save],
  );
  return { draft, handleChange, handleEdit, handleSubmit };
}

// oxlint-disable-next-line eslint/max-lines-per-function -- One compact row owns its editing and ordering controls.
function AdminModel({
  model,
  ids,
  index,
  state,
}: {
  model: ModelOption;
  ids: string[];
  index: number;
  state: AdminState;
}) {
  const editor = useModelEdit(model, state);
  const focusInput = useCallback((element: HTMLInputElement | null) => {
    element?.focus();
    element?.select();
  }, []);
  const onOrder = useCallback(
    (order: string[]) => {
      void state.run("/api/admin/models/order", { ids: order, provider: model.provider });
    },
    [model.provider, state],
  );
  const { up, down, moveUp, moveDown } = useCatalogueOrder({
    id: model.id,
    ids,
    index,
    onOrder,
    pending: state.pending,
  });
  const toggle = useCallback(() => {
    void state.run("/api/admin/models/state", { active: !model.active, id: model.id });
  }, [model, state]);
  const editing = editor.draft !== undefined;
  return (
    <li>
      <form
        className={`admin-model-row${model.active ? "" : " archived"}`}
        onSubmit={editor.handleSubmit}
      >
        {editing ? (
          <input
            id={`model-name-${model.id}`}
            aria-label={`Rename ${model.name}`}
            ref={focusInput}
            value={editor.draft}
            onChange={editor.handleChange}
            maxLength={120}
            required
            disabled={state.pending}
          />
        ) : (
          <b className="admin-model-name" title={model.name}>
            {model.name}
          </b>
        )}
        <div className="admin-model-actions">
          {editing ? (
            <button
              id={`model-edit-${model.id}`}
              type="submit"
              className="admin-icon"
              aria-label={`Save ${model.name}`}
              title="Save"
              disabled={state.pending || !editor.draft?.trim()}
            >
              <Save aria-hidden="true" size={18} />
            </button>
          ) : (
            <button
              id={`model-edit-${model.id}`}
              type="button"
              className="admin-icon"
              aria-label={`Edit ${model.name}`}
              title="Edit"
              disabled={state.pending}
              onClick={editor.handleEdit}
            >
              <Pencil aria-hidden="true" size={18} />
            </button>
          )}
          <button
            className="admin-icon"
            ref={up}
            type="button"
            title="Move up"
            disabled={state.pending || index === 0}
            aria-label={`Move up ${model.name}`}
            onClick={moveUp}
          >
            <ArrowUp aria-hidden="true" size={18} />
          </button>
          <button
            className="admin-icon"
            ref={down}
            type="button"
            title="Move down"
            disabled={state.pending || index === ids.length - 1}
            aria-label={`Move down ${model.name}`}
            onClick={moveDown}
          >
            <ArrowDown aria-hidden="true" size={18} />
          </button>
          <button
            className="admin-icon"
            id={`model-state-${model.id}`}
            type="button"
            disabled={state.pending}
            aria-label={`${model.active ? "Archive" : "Reactivate"} ${model.name}`}
            title={model.active ? "Archive" : "Reactivate"}
            onClick={toggle}
          >
            {model.active ? (
              <Archive aria-hidden="true" size={18} />
            ) : (
              <ArchiveRestore aria-hidden="true" size={18} />
            )}
          </button>
        </div>
      </form>
    </li>
  );
}

export { AdminModel };
