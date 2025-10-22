export class DomainResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainResolutionError'
  }
}
