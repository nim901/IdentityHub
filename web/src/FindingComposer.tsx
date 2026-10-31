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
};

export function FindingComposer({ draft, onChange, onBack }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main id="content" className="wrap composer">
      <button className="text-button" onClick={onBack}>
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
        Draft only in this version. Nothing is saved or sent.
      </p>
      <label>
        Project key (unverified)
        <input
          value={draft.project}
          onChange={(event) =>
            onChange({ ...draft, project: event.target.value })
          }
        />
      </label>
      <label>
        Finding title
        <input
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
          maxLength={20000}
          value={draft.description}
          onChange={(event) =>
            onChange({ ...draft, description: event.target.value })
          }
        />
      </label>
      <div className="composer-footer">
        <p>Ticket creation will be available in the next phase.</p>
        <button className="primary-button" disabled>
          Create ticket
        </button>
      </div>
    </main>
  );
}
