import { DomainResolutionError } from './domain-resolution.error';

export class HiddenServiceRecordNotFoundError extends DomainResolutionError {
  constructor(domain: string) {
    super(`No hidden service record found for domain: ${domain}`)
    this.name = 'HiddenServiceAddressRecordNotFoundError'
  }
}
