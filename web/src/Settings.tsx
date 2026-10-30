import { useEffect, useRef } from "react";
import * as Tabs from "@radix-ui/react-tabs";

type Props = { email: string };

export function Settings({ email }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main id="content" className="wrap settings">
      <h1 ref={heading} tabIndex={-1}>
        Settings
      </h1>
      <p className="subtitle">Manage your connections and scanner access.</p>
      <Tabs.Root defaultValue="jira">
        <Tabs.List className="settings-tabs" aria-label="Settings sections">
          <Tabs.Trigger value="jira">Jira connection</Tabs.Trigger>
          <Tabs.Trigger value="api">API access</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="jira" className="settings-panel">
          <h2>Jira connection</h2>
          <p>Not connected. Jira connection is not available yet.</p>
          <p>Account: {email}</p>
          <button className="primary-button" disabled>
            Connect Jira
          </button>
        </Tabs.Content>
        <Tabs.Content value="api" className="settings-panel">
          <h2>Scanner access</h2>
          <p>API key management is not available yet.</p>
          <button className="primary-button" disabled>
            Generate API key
          </button>
          <p>Planned endpoint — not available:</p>
          <code>POST /api/v1/findings</code>
        </Tabs.Content>
      </Tabs.Root>
    </main>
  );
}
