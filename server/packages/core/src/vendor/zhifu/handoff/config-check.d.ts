/**
 * Save-time hand-off check of a channel config; [] = OK. Credentials may be undefined (unchanged).
 * Pure: the caller turns problems into a BAD_REQUEST.
 */
export declare function handoffConfigProblems(kind: string, rule: {
    subjectFormat?: string | null | undefined;
}, credentials: Record<string, unknown> | undefined, centerBase: string): string[];