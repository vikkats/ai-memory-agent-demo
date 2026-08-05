"use client";

import { useCallback, useEffect, useState } from "react";

type FileListItem = { path: string; name: string; updatedAt: string };

type Proposal = {
  id: string;
  path: string;
  oldContent: string;
  proposedContent: string;
  reason: string;
  createdAt: string;
};

export function MemoryBrowser() {
  const [files, setFiles] = useState<FileListItem[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [filesRes, proposalsRes] = await Promise.all([
      fetch("/api/memory"),
      fetch("/api/memory?proposals=1"),
    ]);
    const filesData = (await filesRes.json()) as { files: FileListItem[] };
    const proposalsData = (await proposalsRes.json()) as { proposals: Proposal[] };
    setFiles(filesData.files ?? []);
    setProposals(proposalsData.proposals ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openFile(path: string) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    const res = await fetch(`/api/memory?path=${encodeURIComponent(path)}`);
    const data = (await res.json()) as { file?: { content: string }; error?: string };
    if (!data.file) {
      setNotice(data.error ?? "Could not open file.");
      return;
    }
    setOpenPath(path);
    setDraft(data.file.content);
    setDirty(false);
    setNotice(null);
  }

  async function save() {
    if (!openPath) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: openPath, content: draft }),
      });
      const data = (await res.json()) as { backupPath?: string | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      setDirty(false);
      setNotice(data.backupPath ? `Saved. Backup: ${data.backupPath}` : "Saved.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolveProposal(id: string, action: "accept" | "reject") {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id }),
    });
    const data = (await res.json()) as { backupPath?: string | null; error?: string };
    setNotice(
      res.ok
        ? action === "accept"
          ? `Proposal accepted${data.backupPath ? ` (backup: ${data.backupPath})` : ""}.`
          : "Proposal rejected.",
        : (data.error ?? "Action failed."),
    );
    await refresh();
  }

  async function reindex() {
    setBusy(true);
    setNotice("Re-indexing memory files…");
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reindex" }),
      });
      const data = (await res.json()) as {
        result?: { backend: string; files: number; chunks: number };
        error?: string;
      };
      if (!res.ok || !data.result) throw new Error(data.error ?? "Reindex failed.");
      setNotice(
        `Indexed ${data.result.chunks} chunks from ${data.result.files} files into the ${data.result.backend} backend.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <button type="button" className="btn" disabled={busy} onClick={() => void reindex()}>
          ⟳ Re-index memory
        </button>
        {notice ? <span className="muted small">{notice}</span> : null}
      </div>

      <div className="memory-layout">
        <aside className="memory-sidebar">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={file.path === openPath ? "memory-file active" : "memory-file"}
              onClick={() => void openFile(file.path)}
            >
              {file.path}
            </button>
          ))}
        </aside>

        <section className="memory-editor">
          {openPath ? (
            <>
              <div className="editor-header">
                <strong>{openPath}</strong>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!dirty || busy}
                  onClick={() => void save()}
                >
                  Save{dirty ? " *" : ""}
                </button>
              </div>
              <textarea
                value={draft}
                spellCheck={false}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDirty(true);
                }}
              />
            </>
          ) : (
            <p className="muted">Select a file to view or edit. All edits create timestamped backups.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Pending edit proposals ({proposals.length})</h2>
        {proposals.length === 0 ? (
          <p className="muted">
            When the agent wants to change memory significantly, it proposes the edit instead of
            writing directly. Accepted proposals overwrite the file (with a backup); rejected ones
            are dropped.
          </p>
        ) : (
          proposals.map((proposal) => (
            <div key={proposal.id} className="proposal-card">
              <div className="proposal-header">
                <strong>{proposal.path}</strong>
                <span className="muted small">{proposal.createdAt.slice(0, 16).replace("T", " ")}</span>
              </div>
              {proposal.reason ? <p className="muted">{proposal.reason}</p> : null}
              <details>
                <summary>View proposed content</summary>
                <pre className="log-block">{proposal.proposedContent}</pre>
              </details>
              <div className="toolbar">
                <button type="button" className="btn primary" onClick={() => void resolveProposal(proposal.id, "accept")}>
                  Accept
                </button>
                <button type="button" className="btn danger" onClick={() => void resolveProposal(proposal.id, "reject")}>
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
