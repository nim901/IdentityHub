import { useEffect, useRef } from "react";

export type FindingDraft = {
  project: string;
  title: string;
  description: string;
};

type Props = {
  draft: FindingDraft;
  onChange: (draft: FindingDraft) => void;
  onBack: () => void;
  onSubmit: () => void;
  busy: boolean;
  canSubmit: boolean;
  error: string;
  uncertain: boolean;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
};

export function FindingComposer({ draft, onChange, onBack, onSubmit, busy, canSubmit, error, uncertain, acknowledged, onAcknowledge }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main id="content" className="wrap composer">
      <button className="text-button" onClick={onBack} disabled={busy}>
        Back to findings
      </button>
      <h1 ref={heading} tabIndex={-1}>
        Report a finding
      </h1>
      <p className="subtitle">Prepare details for a Jira ticket.</p>
      <div className="destination">
        <strong>Destination project</strong>
        <span>{draft.project || "No project selected"}</span>
      </div>
      <p className="draft-notice">
        Your draft is kept in this browser until you leave or reload.
      </p>
      <label>
        Finding title
        <input
          disabled={busy}
          maxLength={255}
          value={draft.title}
          onChange={(event) =>
            onChange({ ...draft, title: event.target.value })
          }
        />
      </label>
      <label>
        Description
        <textarea
          disabled={busy}
          maxLength={20000}
          value={draft.description}
          onChange={(event) =>
            onChange({ ...draft, description: event.target.value })
          }
        />
      </label>
      {!canSubmit && <p>Select an available Jira project in Findings before creating a ticket.</p>}
      {error && <p role="alert">{error}</p>}
      {uncertain && <label className="acknowledge"><input type="checkbox" checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} /> I checked Jira and understand another attempt may create a duplicate.</label>}
      <div className="composer-footer">
        <p>{busy ? "Creating ticket…" : "Review the details before creating the ticket."}</p>
        <button className="primary-button" disabled={busy || !canSubmit || !draft.project || !draft.title.trim() || !draft.description.trim() || (uncertain && !acknowledged)} onClick={onSubmit}>
          {busy ? "Creating…" : "Create ticket"}
        </button>
      </div>
    </main>
  );
}
