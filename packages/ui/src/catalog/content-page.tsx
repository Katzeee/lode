import { Alert } from "../components/alert.js";
import { Button } from "../components/button.js";
import { Card, CardDescription, CardTitle } from "../components/card.js";
import { PageIntro, Specimen } from "./specimen.js";

export function ContentPage() {
  return (
    <>
      <PageIntro
        description="Interface copy names the current state, explains what the person can do, and uses the same vocabulary as the product domain."
        title="Content"
      />
      <Specimen
        description="State the problem in sentence case, then give a concrete recovery action. Use a period for complete sentences."
        title="Errors point to recovery"
      >
        <Alert tone="destructive">The passphrase does not unlock this vault. Check the passphrase and try again.</Alert>
      </Specimen>
      <Specimen
        className="items-stretch"
        description="Name what is missing and pair it with the action that creates the first item."
        title="Empty states lead somewhere"
      >
        <Card className="max-w-120 p-6">
          <CardTitle>No workspaces yet</CardTitle>
          <CardDescription className="mt-2">
            Create a workspace to organize documents and invite collaborators.
          </CardDescription>
          <Button className="mt-5">Create workspace</Button>
        </Card>
      </Specimen>
      <Specimen
        description="Buttons use a specific verb and object. Avoid Submit, Yes, and OK when the actual outcome has a name."
        title="Actions say what happens"
      >
        <Button>Create workspace</Button>
        <Button variant="outline">Export recovery phrase</Button>
        <Button variant="destructive">Delete workspace</Button>
      </Specimen>
      <Specimen
        description="Headings, labels, buttons, and messages use sentence case. Preserve official acronyms and product names such as Lode, SQLite, and API."
        title="Casing follows natural language"
      >
        <div>
          <p className="text-title-small font-semibold">Connect local storage</p>
          <p className="mt-1 text-body text-muted-foreground">SQLite keeps authoritative data on this device.</p>
        </div>
      </Specimen>
    </>
  );
}
