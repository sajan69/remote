export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly ambiguous: boolean,
  ) {
    super(message)
  }
}
