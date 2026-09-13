/** A failed profile never returns partial numbers as a complete result. */
export class ProfileError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}
