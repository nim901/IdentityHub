import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Session } from "./authApi";

type Props = { session: Session; onSignOut: () => void };

export function Shell({ session, onSignOut }: Props) {
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="header wrap">
        <div className="brand">
          <span className="brand-mark">i</span>
          IdentityHub
        </div>
        <nav aria-label="Main navigation">
          <span className="active">Findings</span>
          <span>
            Settings <small>coming soon</small>
          </span>
        </nav>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
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
              <DropdownMenu.Item className="menu-item" onSelect={onSignOut}>
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      <main id="content" className="wrap workspace" tabIndex={-1}>
        <h1>Findings</h1>
        <p className="subtitle">Report non-human identity findings to Jira.</p>
        <section className="notice" aria-labelledby="unavailable-heading">
          <h2 id="unavailable-heading">
            Jira integration is not available yet
          </h2>
          <p>
            Connecting Jira and reporting tickets will be available in a later
            phase.
          </p>
          <button disabled>Connect Jira</button>
        </section>
      </main>
    </>
  );
}
