import { useEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FindingComposer, type FindingDraft } from "./FindingComposer";
import { Settings } from "./Settings";
import type { Session } from "./authApi";

type Props = { session: Session; onSignOut: () => void };
type Destination = "findings" | "settings" | "signout";
const emptyDraft: FindingDraft = { project: "", title: "", description: "" };

export function Shell({ session, onSignOut }: Props) {
  const [view, setView] = useState<"findings" | "report" | "settings">(
    "findings",
  );
  const [draft, setDraft] = useState<FindingDraft>(emptyDraft);
  const [pending, setPending] = useState<Destination | null>(null);
  const [focusFindings, setFocusFindings] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const hasDraft = Boolean(draft.project || draft.title || draft.description);

  useEffect(() => {
    if (!hasDraft) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasDraft]);

  useEffect(() => {
    if (view === "findings" && focusFindings) heading.current?.focus();
  }, [view, focusFindings]);

  function leave(destination: Destination) {
    if (hasDraft) {
      returnFocus.current =
        destination === "signout"
          ? accountButton.current
          : (document.activeElement as HTMLElement | null);
      setPending(destination);
      return;
    }
    navigate(destination);
  }

  function navigate(destination: Destination) {
    setDraft(emptyDraft);
    if (destination === "signout") {
      onSignOut();
    } else if (destination === "findings") {
      setFocusFindings(true);
      setView("findings");
    } else {
      setView("settings");
    }
  }

  function discardDraft() {
    returnFocus.current = null;
    if (pending) navigate(pending);
    setPending(null);
  }

  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="header wrap">
        <div className="brand">
          <span className="brand-mark">i</span>IdentityHub
        </div>
        <nav aria-label="Main navigation">
          <button
            className={view !== "settings" ? "active" : ""}
            onClick={() => leave("findings")}
          >
            Findings
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => leave("settings")}
          >
            Settings
          </button>
        </nav>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            ref={accountButton}
            className="account"
            aria-label={`Account: ${session.user.email}`}
          >
            <span className="email">{session.user.email}</span>
            <span className="avatar">
              {session.user.email[0]?.toUpperCase()}
            </span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={8}>
              <DropdownMenu.Label className="menu-label">
                {session.user.email}
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => leave("signout")}
              >
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      {view === "report" ? (
        <FindingComposer
          draft={draft}
          onChange={setDraft}
          onBack={() => leave("findings")}
        />
      ) : view === "settings" ? (
        <Settings email={session.user.email} />
      ) : (
        <main id="content" className="wrap workspace">
          <div className="findings-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                Findings
              </h1>
              <p className="subtitle">
                Report non-human identity findings to Jira.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setFocusFindings(false);
                setView("report");
              }}
            >
              + Report finding
            </button>
          </div>
          <div className="project-toolbar">
            <span>Project selection unavailable</span>
            <span>Jira integration is not available yet</span>
          </div>
          <section aria-labelledby="recent-heading">
            <div className="section-heading">
              <h2 id="recent-heading">Recent tickets</h2>
              <span>Latest 10 per project</span>
            </div>
            <p className="subtitle">
              Tickets created by this app, not your entire Jira history.
            </p>
            <div className="ledger-empty">
              <h3>Ticket history is unavailable</h3>
              <p>
                Connect Jira when integration becomes available to view tickets
                here.
              </p>
              <button className="text-button" onClick={() => setView("report")}>
                Prepare a local draft
              </button>
            </div>
          </section>
        </main>
      )}
      <AlertDialog.Root
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content
            className="dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              keepEditing.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus.current?.focus();
              returnFocus.current = null;
            }}
          >
            <AlertDialog.Title>Discard this draft?</AlertDialog.Title>
            <AlertDialog.Description>
              Leaving or signing out clears this draft. Nothing has been sent.
            </AlertDialog.Description>
            <div className="dialog-actions">
              <AlertDialog.Cancel ref={keepEditing}>
                Keep editing
              </AlertDialog.Cancel>
              <AlertDialog.Action onClick={discardDraft}>
                Discard draft
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
