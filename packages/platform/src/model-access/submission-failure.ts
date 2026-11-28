/** The generation request was rejected or could not have reached the service. */
export class DefiniteSubmissionFailure extends Error {}

/** A gateway may already have accepted a paid create before returning these statuses. */
export function uncertainSubmissionStatus(status: number) {
  return (status >= 300 && status < 400) || status === 408 || status >= 500;
}
