import { DomainResolutionError } from './domain-resolution.error';

export class UnsupportedUnsTldError extends DomainResolutionError {
  constructor(tld: string, name: string) {
    super(`TLD .${tld} is not supported for name ${name}`)
    this.name = 'UnsupportedUnsTldError'
  }
}
