export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The model declined to answer. Retrying the same input will not help. */
export class AiRefusalError extends AiError {
  constructor(message = "The model refused the request") {
    super(message, false);
  }
}

/** Output hit max_tokens before the JSON was complete. */
export class AiTruncatedError extends AiError {
  constructor(message = "The model output was truncated at max_tokens") {
    super(message, true);
  }
}

/** The output could not be parsed against the expected schema. */
export class AiParseError extends AiError {
  constructor(message = "The model output did not match the expected schema") {
    super(message, true);
  }
}
