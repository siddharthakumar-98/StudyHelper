/**
 * A problem the user can act on (a rule, a stale page, a validation failure).
 * Its message is meant to be shown as it is. `issues` lists the individual
 * problems when there are several (the validateStructure messages of an edit).
 */
export class BankError extends Error {
  readonly issues: string[] | undefined;

  constructor(message: string, issues?: string[]) {
    super(message);
    this.name = "BankError";
    this.issues = issues;
  }
}
