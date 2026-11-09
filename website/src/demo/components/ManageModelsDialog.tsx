import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { formatNumber, formatRelative } from "../lib/format";
import { getModelCatalog, deleteModelData, mergeModels } from "../lib/api";
import type { ModelCatalogEntry } from "../lib/types";
import { Icon } from "./Icons";
import { SelectDropdown, type SelectGroup } from "./SelectDropdown";

interface ManageModelsDialogProps {
  open: boolean;
  onClose: () => void;
  onCompleted: (message: string) => void;
  onModelsChanged: () => void;
}

type Phase = "select" | "delete" | "merge";

export function ManageModelsDialog({
  open,
  onClose,
  onCompleted,
  onModelsChanged,
}: ManageModelsDialogProps) {
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("select");
  const [targetChoice, setTargetChoice] = useState<string>("");
  const [newTarget, setNewTarget] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      // Reset state
      setSearch("");
      setSelected(new Set());
      setPhase("select");
      setError(null);
      setTargetChoice("");
      setNewTarget("");
      setPending(false);

      // Fetch catalog
      setLoading(true);
      getModelCatalog()
        .then(setCatalog)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (!pending) {
      onClose();
    }
  }, [onClose, pending]);

  // Close on Escape, but never while a mutation is in flight.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  const toggleSelection = (model: string) => {
    const next = new Set(selected);
    if (next.has(model)) {
      next.delete(model);
    } else {
      next.add(model);
    }
    setSelected(next);
  };

  const selectAllVisible = () => {
    const visibleModels = filteredCatalog.map((m) => m.model);
    if (selected.size === visibleModels.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleModels));
    }
  };

  const clearSelection = () => setSelected(new Set());

  const filteredCatalog = useMemo(() => {
    return catalog.filter((m) =>
      m.model.toLowerCase().includes(search.toLowerCase()),
    );
  }, [catalog, search]);

  // Enter the merge phase, defaulting the target to the selected model with
  // the highest all-time token total so a two-click merge is possible.
  const goToMerge = useCallback(() => {
    const candidates = catalog
      .filter((m) => selected.has(m.model))
      .sort((a, b) => b.tokensTotal - a.tokensTotal);
    setTargetChoice(candidates[0]?.model ?? "");
    setNewTarget("");
    setPhase("merge");
  }, [catalog, selected]);

  const handleConfirmDelete = async () => {
    const modelsToDelete = Array.from(selected);
    setPending(true);
    setError(null);

    try {
      const result = await deleteModelData(modelsToDelete);
      onCompleted(
        `Deleted ${result.rowsAffected} requests across ${result.models.length} model(s).`,
      );
      onModelsChanged();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const handleConfirmMerge = async () => {
    const target = newTarget.trim() || targetChoice;
    if (!target) return;

    const effectiveSources = Array.from(selected).filter((s) => s !== target);
    if (effectiveSources.length === 0) return;

    setPending(true);
    setError(null);

    try {
      const result = await mergeModels(effectiveSources, target);
      onCompleted(
        `Merged ${result.models.length} model(s) into ${result.target || target} (${result.rowsAffected} requests relabeled).`,
      );
      onModelsChanged();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  if (!open) return null;

  // Calculate totals for the footer and the merge summary.
  const selectedCount = selected.size;
  const selectedRequests = catalog
    .filter((m) => selected.has(m.model))
    .reduce((sum, m) => sum + m.requestsTotal, 0);
  const selectedTokens = catalog
    .filter((m) => selected.has(m.model))
    .reduce((sum, m) => sum + m.tokensTotal, 0);

  // The target as it will actually be applied: a new name when the "new"
  // option is chosen, otherwise the chosen existing model ("" = none).
  const effectiveTarget =
    targetChoice === "__new__" ? newTarget.trim() : targetChoice;
  // Only the selected models other than the target are relabeled, so the merge
  // summary reflects that subset rather than the whole selection.
  const effectiveCount = Array.from(selected).filter(
    (name) => name !== effectiveTarget,
  ).length;
  const effectiveRequests = catalog
    .filter((m) => selected.has(m.model) && m.model !== effectiveTarget)
    .reduce((sum, m) => sum + m.requestsTotal, 0);
  const effectiveTokens = catalog
    .filter((m) => selected.has(m.model) && m.model !== effectiveTarget)
    .reduce((sum, m) => sum + m.tokensTotal, 0);

  // Target dropdown: every recorded model, followed by a "new name" option.
  const targetGroups: SelectGroup[] = [
    {
      label: "Existing models",
      options: catalog.map((m) => ({ value: m.model, label: m.model })),
    },
    {
      label: "New",
      options: [{ value: "__new__", label: "New model name…" }],
    },
  ];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-models-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="card w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 p-4">
          <div>
            <h2 id="manage-models-title" className="text-lg font-semibold">
              Manage models
            </h2>
            <p className="text-sm text-white/50">
              Delete or merge recorded usage. These actions affect TokenFlow
              history only, not the models installed in Ollama.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={pending}
            className="rounded-full p-1 hover:bg-white/10 disabled:opacity-50"
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 rounded-md bg-red-500/20 p-3 text-sm text-red-400 border border-red-500/30">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex h-48 items-center justify-center text-white/50">
              <div className="animate-spin">
                <Icon name="refresh" className="h-6 w-6" />
              </div>
            </div>
          ) : phase === "select" ? (
            <>
              {/* Select Phase */}
              <div className="mb-4 flex flex-col gap-2">
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30">
                    <Icon name="settings" className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search models..."
                    className="w-full rounded-md border border-white/10 bg-white/5 pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 text-white/50">
                    <tr>
                      <th className="px-4 py-2 w-10"></th>
                      <th className="px-4 py-2">Model</th>
                      <th className="px-4 py-2 text-right">Requests</th>
                      <th className="px-4 py-2 text-right">Tokens</th>
                      <th className="px-4 py-2 text-right">Last used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredCatalog.length > 0 ? (
                      filteredCatalog.map((m) => (
                        <tr
                          key={m.model}
                          className="hover:bg-white/5 cursor-pointer transition-colors"
                          onClick={() => toggleSelection(m.model)}
                        >
                          <td
                            className="px-4 py-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-white/10 bg-white/5 text-blue-600 focus:ring-blue-500"
                              checked={selected.has(m.model)}
                              onChange={() => toggleSelection(m.model)}
                            />
                          </td>
                          <td
                            className="px-4 py-2 font-mono truncate max-w-[180px]"
                            title={m.model}
                          >
                            {m.model}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div>{formatNumber(m.requestsTotal)}</div>
                            <div className="text-[10px] text-white/30">
                              30d: {formatNumber(m.requestsRecent)}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div>{formatNumber(m.tokensTotal)}</div>
                            <div className="text-[10px] text-white/30">
                              30d: {formatNumber(m.tokensRecent)}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-white/50">
                            {formatRelative(m.lastSeenAt)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-white/30"
                        >
                          {search
                            ? "No models match your search."
                            : "No model usage recorded yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {filteredCatalog.length > 0 && (
                <div className="mt-3 flex items-center justify-between text-xs text-white/30">
                  <div className="flex gap-3">
                    <button
                      onClick={selectAllVisible}
                      className="hover:text-white"
                    >
                      Select all visible
                    </button>
                    <button
                      onClick={clearSelection}
                      className="hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : phase === "delete" ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">
                Delete usage for {selectedCount} models?
              </h3>
              <div className="max-h-48 overflow-y-auto rounded-md border border-white/10 bg-white/5 p-2 space-y-1">
                {Array.from(selected)
                  .slice(0, 8)
                  .map((m) => (
                    <div
                      key={m}
                      className="text-sm font-mono truncate px-2 py-1"
                    >
                      {m}
                    </div>
                  ))}
                {selected.size > 8 && (
                  <div className="text-sm text-white/30 px-2 py-1">
                    +{selected.size - 8} more
                  </div>
                )}
              </div>
              <p className="text-sm text-white/60">
                This permanently removes{" "}
                <span className="text-red-400 font-semibold">
                  {formatNumber(selectedRequests)} requests
                </span>{" "}
                and{" "}
                <span className="text-red-400 font-semibold">
                  {formatNumber(selectedTokens)} tokens
                </span>{" "}
                across all history. Dashboard totals, streak, heatmap, and day
                details will be recalculated. It does not delete the model from
                Ollama. This cannot be undone.
              </p>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setPhase("select")}
                  className="flex-1 rounded-md border border-white/10 py-2 text-sm hover:bg-white/5"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={pending}
                  className="flex-1 rounded-md bg-red-500/20 py-2 text-sm font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50"
                >
                  {pending ? "Applying..." : "Delete permanently"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">
                Merge {selectedCount} models into
              </h3>

              <div className="space-y-2">
                <label className="text-xs text-white/40 uppercase tracking-wider font-medium">
                  Target model
                </label>
                <div className="flex flex-col gap-3">
                  <div>
                    <SelectDropdown
                      value={targetChoice || ""}
                      onChange={(value) => {
                        setTargetChoice(value);
                        setNewTarget("");
                      }}
                      ariaLabel="Target model"
                      groups={targetGroups}
                      menuSide="down"
                      minWidth="12rem"
                      maxHeight="280px"
                    />
                  </div>

                  {targetChoice === "__new__" && (
                    <input
                      type="text"
                      placeholder="Enter new name..."
                      className="w-full rounded-md border border-white/10 bg-white/5 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      value={newTarget}
                      onChange={(e) => setNewTarget(e.target.value)}
                    />
                  )}
                </div>
                <p className="text-xs text-white/40">
                  Choose an existing model or enter a new name. If you enter a
                  new name, this is a rename.
                </p>
              </div>

              <div className="rounded-md bg-blue-500/10 p-3 text-xs text-blue-300/80 border border-blue-500/20">
                <p className="font-semibold mb-1">Summary:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    {formatNumber(effectiveRequests)} requests and{" "}
                    {formatNumber(effectiveTokens)} tokens will be relabeled and
                    combined.
                  </li>
                  <li>Dashboard totals stay the same.</li>
                  <li>This cannot be undone.</li>
                </ul>
                {effectiveTarget &&
                  effectiveTarget !== "__new__" &&
                  !selected.has(effectiveTarget) &&
                  catalog.some((m) => m.model === effectiveTarget) && (
                    <p className="mt-2 text-blue-300/70">
                      {effectiveTarget} already exists and is not selected; its
                      usage will be combined into the result.
                    </p>
                  )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setPhase("select")}
                  className="whitespace-nowrap flex-1 rounded-md border border-white/10 py-2 text-sm hover:bg-white/5"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmMerge}
                  disabled={pending || !effectiveTarget || effectiveCount === 0}
                  className="whitespace-nowrap flex-1 rounded-md bg-blue-500/20 py-2 text-sm font-semibold text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                >
                  {pending ? "Applying…" : "Merge"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === "select" && (
          <div className="flex flex-col gap-3 border-t border-white/5 p-4">
            <div className="text-sm text-white/40">
              {selectedCount > 0 ? (
                <>
                  <span className="font-medium text-white/80">
                    {selectedCount} selected
                  </span>
                  <span className="mx-2">·</span>
                  <span>{formatNumber(selectedRequests)} requests</span>
                  <span className="mx-2">·</span>
                  <span>{formatNumber(selectedTokens)} tokens (all time)</span>
                </>
              ) : (
                "No models selected"
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                onClick={handleClose}
                className="whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white"
              >
                Close
              </button>
              <button
                onClick={() => setPhase("delete")}
                disabled={selectedCount === 0}
                className="whitespace-nowrap rounded-md bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-30"
              >
                Delete usage
              </button>
              <button
                onClick={goToMerge}
                disabled={selectedCount === 0}
                className="whitespace-nowrap rounded-md bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-400 hover:bg-blue-500/20 disabled:opacity-30"
              >
                Merge…
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
